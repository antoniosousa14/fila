import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { aplicarAcao, chaveDe, gravarMarcas, lerMarcas, limpar, MAX_LINHAS, vazias } from '../lib/marcas.mjs'

const G1 = 'cg-b1ae0a97-cd9b-4002-9b5a-6e361a30a21d'
const G2 = 'cg-8964c94e-0142-4eb8-961c-86416ada9a09'

test('chaveDe ignora espaços e maiúsculas', () => {
  assert.equal(chaveDe('  Correr:  SSH\nassistente '), 'correr: ssh assistente')
  assert.equal(chaveDe(undefined), '')
})

test('dispensar guarda a última mensagem; repor tira-o', () => {
  let m = aplicarAcao(vazias(), { acao: 'dispensar', grupo: G1, desde: 1234 }).marcas
  assert.deepEqual(m.grupos[G1], { dispensadoAte: 1234 })
  m = aplicarAcao(m, { acao: 'repor', grupo: G1 }).marcas
  assert.deepEqual(m.grupos, {})
})

test('sem importância liga e desliga e não mexe nas outras marcas do grupo', () => {
  let m = aplicarAcao(vazias(), { acao: 'dispensar', grupo: G1, desde: 5 }).marcas
  m = aplicarAcao(m, { acao: 'sem-importancia', grupo: G1 }).marcas
  assert.deepEqual(m.grupos[G1], { dispensadoAte: 5, semImportancia: true })
  m = aplicarAcao(m, { acao: 'com-importancia', grupo: G1 }).marcas
  assert.deepEqual(m.grupos[G1], { dispensadoAte: 5 })
})

test('esconder linha guarda o texto, não repete e repõe-se por grupo', () => {
  let m = aplicarAcao(vazias(), { acao: 'esconder-linha', grupo: G1, texto: 'Correr o restart.sh' }).marcas
  m = aplicarAcao(m, { acao: 'esconder-linha', grupo: G1, texto: '  correr   o RESTART.sh ' }).marcas
  m = aplicarAcao(m, { acao: 'esconder-linha', grupo: G2, texto: 'Outra' }).marcas
  assert.deepEqual(m.itens[G1], [{ chave: 'correr o restart.sh', texto: 'Correr o restart.sh' }])
  assert.equal(m.itens[G2].length, 1)
  m = aplicarAcao(m, { acao: 'repor-linhas', grupo: G1 }).marcas
  assert.equal(G1 in m.itens, false)
  assert.equal(G2 in m.itens, true)
})

test('pedidos inválidos são recusados', () => {
  assert.match(aplicarAcao(vazias(), { acao: 'apagar-tudo', grupo: G1 }).erro, /desconhecida/)
  assert.match(aplicarAcao(vazias(), { acao: 'dispensar', grupo: '../x', desde: 1 }).erro, /grupo/)
  assert.match(aplicarAcao(vazias(), { acao: 'dispensar', grupo: G1 }).erro, /instante/)
  assert.match(aplicarAcao(vazias(), { acao: 'dispensar', grupo: G1, desde: 'ontem' }).erro, /instante/)
  assert.match(aplicarAcao(vazias(), { acao: 'esconder-linha', grupo: G1, texto: '   ' }).erro, /vazia/)
  assert.match(aplicarAcao(vazias(), undefined).erro, /desconhecida/)
})

test('esconder linhas tem um máximo', () => {
  let m = vazias()
  for (let i = 0; i < MAX_LINHAS; i++) m = aplicarAcao(m, { acao: 'esconder-linha', grupo: G1, texto: `linha ${i}` }).marcas
  assert.match(aplicarAcao(m, { acao: 'esconder-linha', grupo: G1, texto: 'mais uma' }).erro, /a mais/)
  // Esconder uma que já lá está não conta como mais uma.
  assert.ok(aplicarAcao(m, { acao: 'esconder-linha', grupo: G1, texto: 'linha 3' }).marcas)
})

test('limpar aceita só a forma certa', () => {
  const m = limpar({
    grupos: { [G1]: { dispensadoAte: 7, semImportancia: true, lixo: 1 }, 'x': { semImportancia: true }, [G2]: { dispensadoAte: 'x' } },
    itens: { [G1]: [{ texto: ' Uma  ' }, { chave: 'duas', texto: 'Duas' }, null, { texto: '' }], 'y': [{ texto: 'z' }], [G2]: 'não' },
  })
  assert.deepEqual(m.grupos, { [G1]: { dispensadoAte: 7, semImportancia: true } })
  assert.deepEqual(m.itens[G1].map(i => i.chave), ['uma', 'duas'])
  assert.deepEqual(Object.keys(m.itens), [G1])
  assert.deepEqual(limpar(null), vazias())
})

test('lerMarcas e gravarMarcas: ida e volta, ficheiro em falta ou estragado dá vazio', async t => {
  const pasta = await mkdtemp(join(tmpdir(), 'nextup-marcas-'))
  t.after(() => rm(pasta, { recursive: true, force: true }))
  const ficheiro = join(pasta, 'dentro', 'projetos-marcas.json')
  assert.deepEqual(await lerMarcas(ficheiro), vazias())
  const m = aplicarAcao(vazias(), { acao: 'sem-importancia', grupo: G1 }).marcas
  await gravarMarcas(ficheiro, m)
  assert.deepEqual(await lerMarcas(ficheiro), m)
  assert.equal(JSON.parse(await readFile(ficheiro, 'utf8')).grupos[G1].semImportancia, true)
  await writeFile(ficheiro, '{ estragado')
  assert.deepEqual(await lerMarcas(ficheiro), vazias())
})
