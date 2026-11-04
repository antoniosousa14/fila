import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  apagarPasta, caminhos, criarPasta, esconderGrupo, gravarOrganizacao, lerOrganizacao, montarArvore, mostrarGrupo,
  moverGrupo, moverPasta, nomeValido, normalizar, posicionar, renomearGrupo, renomearPasta, SEM_GRUPO, vazia,
} from '../lib/organizacao.mjs'

const G = n => `cg-${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
const L = n => `local_${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
// Grupos do Claude pela ordem da barra lateral.
const grupos = [{ id: G(1), nome: 'MesasOnline' }, { id: G(2), nome: 'ISEP' }, { id: G(3), nome: 'Dinamo' }, { id: G(4), nome: 'Gaivota' }, { id: G(5), nome: 'Matriz' }]
const atribuicoes = { [L(1)]: G(3), [L(2)]: G(4), [L(3)]: G(1), [L(4)]: G(9) }
const chats = [1, 2, 3, 4, 5].map(n => ({ local: L(n), espera: n === 2 }))
const base = normalizar({ versao: 2, pastas: [{ id: 'p_apps', nome: 'Apps', pai: null }], grupos: { [G(3)]: 'p_apps', [G(4)]: 'p_apps' } })
const resumo = nos => nos.map(n => [n.nome, n.total, n.espera, ...(n.filhas.length ? [resumo(n.filhas)] : [])])

test('a árvore são os grupos do Claude, pela ordem dele; os chats sem grupo não entram', () => {
  const arvore = montarArvore({ org: vazia(), grupos, atribuicoes, chats })
  assert.deepEqual(resumo(arvore), [
    ['MesasOnline', 1, 0], ['ISEP', 0, 0], ['Dinamo', 1, 0], ['Gaivota', 1, 1], ['Matriz', 0, 0],
  ])
  assert.equal(arvore.some(n => n.id === SEM_GRUPO), false)
  assert.equal(arvore.flatMap(n => n.chats).includes(L(4)), false)
})

test('uma pasta-mãe junta grupos e fica onde está o primeiro deles; vazia vai para o fim', () => {
  const comVazia = criarPasta(base, { nome: 'Vazia' }).org
  const arvore = montarArvore({ org: comVazia, grupos, atribuicoes, chats })
  assert.deepEqual(resumo(arvore), [
    ['MesasOnline', 1, 0], ['ISEP', 0, 0], ['Apps', 2, 1, [['Dinamo', 1, 0], ['Gaivota', 1, 1]]], ['Matriz', 0, 0], ['Vazia', 0, 0],
  ])
  assert.equal(arvore[2].tipo, 'pasta')
  assert.equal(arvore[2].filhas[0].tipo, 'grupo')
  assert.equal(caminhos(arvore).get(G(4)), 'Apps / Gaivota')
})

test('um grupo pode ter um nome só do gestor; vazio volta ao nome do Claude', () => {
  const org = renomearGrupo(base, { grupo: G(4), nome: '  Gaivota (hábitos) ' }).org
  const arvore = montarArvore({ org, grupos, atribuicoes, chats })
  const gaivota = arvore[2].filhas[1]
  assert.equal(gaivota.nome, 'Gaivota (hábitos)')
  assert.equal(gaivota.nomeClaude, 'Gaivota')
  assert.equal(montarArvore({ org: renomearGrupo(org, { grupo: G(4), nome: '' }).org, grupos, atribuicoes, chats })[2].filhas[1].nome, 'Gaivota')
  assert.ok(renomearGrupo(base, { grupo: 'x', nome: 'a' }).erro)
  assert.ok(renomearGrupo(base, { grupo: G(4), nome: 'x'.repeat(61) }).erro)
})

test('esconder tira o grupo da árvore do gestor; mostrar devolve-o', () => {
  const org = esconderGrupo(base, { grupo: G(1) }).org
  assert.deepEqual(org.ocultos, [G(1)])
  assert.equal(montarArvore({ org, grupos, atribuicoes, chats }).some(n => n.id === G(1)), false)
  assert.deepEqual(esconderGrupo(org, { grupo: G(1) }).org.ocultos, [G(1)])
  const devolvido = mostrarGrupo(org, { grupo: G(1) }).org
  assert.equal(montarArvore({ org: devolvido, grupos, atribuicoes, chats })[0].id, G(1))
})

test('arrastar para entre dois nós muda de pasta e guarda a ordem dos irmãos', () => {
  // Matriz para dentro de Apps, entre Dinamo e Gaivota.
  const org = posicionar(base, { tipo: 'grupo', no: G(5), pai: 'p_apps', irmaos: [G(3), G(5), G(4)] }).org
  let arvore = montarArvore({ org, grupos, atribuicoes, chats })
  assert.deepEqual(resumo(arvore), [
    ['MesasOnline', 1, 0], ['ISEP', 0, 0], ['Apps', 2, 1, [['Dinamo', 1, 0], ['Matriz', 0, 0], ['Gaivota', 1, 1]]],
  ])
  // A pasta Apps para o topo da raiz.
  const noTopo = posicionar(org, { tipo: 'pasta', no: 'p_apps', pai: null, irmaos: ['p_apps', G(1), G(2)] }).org
  arvore = montarArvore({ org: noTopo, grupos, atribuicoes, chats })
  assert.deepEqual(arvore.map(n => n.nome), ['Apps', 'MesasOnline', 'ISEP'])
  assert.ok(posicionar(base, { tipo: 'grupo', no: G(5), pai: null, irmaos: [G(1)] }).erro)
  assert.ok(posicionar(base, { tipo: 'grupo', no: G(5), pai: null, irmaos: [G(5), '../x'] }).erro)
  assert.ok(posicionar(base, { tipo: 'outro', no: G(5), pai: null, irmaos: [G(5)] }).erro)
  // A ordem sobrevive à leitura do disco.
  assert.deepEqual(normalizar(JSON.parse(JSON.stringify(noTopo))).ordem.raiz, ['p_apps', G(1), G(2)])
})

test('pastas dentro de pastas; um grupo apontado a uma pasta que não existe fica no topo', () => {
  const sub = criarPasta(base, { nome: 'Móveis', pai: 'p_apps' })
  const org = moverGrupo(sub.org, { grupo: G(4), pasta: sub.id }).org
  const arvore = montarArvore({ org: { ...org, grupos: { ...org.grupos, [G(5)]: 'p_nada' } }, grupos, atribuicoes, chats })
  assert.deepEqual(resumo(arvore).find(n => n[0] === 'Apps'), ['Apps', 2, 1, [['Dinamo', 1, 0], ['Móveis', 1, 1, [['Gaivota', 1, 1]]]]])
  assert.ok(arvore.some(n => n.nome === 'Matriz'))
})

test('normalizar: o formato antigo conta como vazio; ids, nomes, pais e ciclos inválidos saem', () => {
  assert.deepEqual(normalizar({ seccoes: [{ id: 's_apps', nome: 'Apps' }], chats: {} }), vazia())
  const org = normalizar({
    versao: 2,
    pastas: [{ id: 'p_okok', nome: ' Apps  ' }, { id: 'mau', nome: 'x' }, { id: 'p_okok', nome: 'Repetida' }, { id: 'p_orfa', nome: 'Órfã', pai: 'p_nada' }, { id: 'p_cic1', nome: 'A', pai: 'p_cic2' }, { id: 'p_cic2', nome: 'B', pai: 'p_cic1' }],
    grupos: { [G(1)]: 'p_okok', 'cg-mau': 'p_okok', [G(2)]: 'p_nada' },
  })
  assert.deepEqual(org.pastas.map(p => p.id).sort(), ['p_cic1', 'p_cic2', 'p_okok', 'p_orfa'])
  assert.equal(org.pastas.find(p => p.id === 'p_okok').nome, 'Apps')
  assert.equal(org.pastas.find(p => p.id === 'p_orfa').pai, null)
  assert.ok(org.pastas.filter(p => p.id.startsWith('p_cic')).some(p => p.pai === null))
  assert.deepEqual(org.grupos, { [G(1)]: 'p_okok' })
})

test('criar, renomear e mover pastas; nunca para dentro de si própria', () => {
  const { org, id } = criarPasta(base, { nome: 'Pessoal' })
  assert.match(id, /^p_[0-9a-f]{10}$/)
  assert.equal(renomearPasta(org, { id, nome: 'Vida' }).org.pastas.find(p => p.id === id).nome, 'Vida')
  const dentro = moverPasta(org, { id, pai: 'p_apps' }).org
  assert.equal(dentro.pastas.find(p => p.id === id).pai, 'p_apps')
  assert.match(moverPasta(dentro, { id: 'p_apps', pai: id }).erro, /dentro de si/)
  assert.equal(criarPasta(base, { nome: ' ' }).erro, 'nome inválido')
  assert.equal(criarPasta(base, { nome: 'x', pai: 'p_nada' }).erro, 'a pasta-mãe não existe')
  assert.equal(renomearPasta(base, { id: 'p_nada', nome: 'x' }).erro, 'a pasta não existe')
  assert.equal(nomeValido('x'.repeat(61)), undefined)
})

test('apagar uma pasta: os grupos e subpastas sobem para a de cima; os grupos do Claude não mudam', () => {
  const sub = criarPasta(base, { nome: 'Móveis', pai: 'p_apps' })
  const org = moverGrupo(sub.org, { grupo: G(4), pasta: sub.id }).org
  const semSub = apagarPasta(org, { id: sub.id }).org
  assert.equal(semSub.grupos[G(4)], 'p_apps')
  const semApps = apagarPasta(org, { id: 'p_apps' }).org
  assert.deepEqual(semApps.grupos, { [G(4)]: sub.id })
  assert.equal(semApps.pastas.find(p => p.id === sub.id).pai, null)
})

test('mover grupo para uma pasta e tirá-lo', () => {
  const dentro = moverGrupo(base, { grupo: G(5), pasta: 'p_apps' }).org
  assert.equal(dentro.grupos[G(5)], 'p_apps')
  assert.equal(moverGrupo(dentro, { grupo: G(5), pasta: null }).org.grupos[G(5)], undefined)
  assert.equal(moverGrupo(base, { grupo: 'cg-x', pasta: 'p_apps' }).erro, 'grupo inválido')
  assert.equal(moverGrupo(base, { grupo: G(5), pasta: 'p_nada' }).erro, 'a pasta não existe')
})

test('gravar troca o ficheiro de uma vez e guarda o formato antigo em .v1.json; ler um estragado dá vazio', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'gestor-org-'))
  const caminho = join(pasta, 'organizacao.json')
  assert.deepEqual(await lerOrganizacao(caminho), vazia())
  await writeFile(caminho, JSON.stringify({ seccoes: [{ id: 's_apps', nome: 'Apps' }], chats: {} }))
  assert.deepEqual(await lerOrganizacao(caminho), vazia())
  await gravarOrganizacao(caminho, base)
  assert.deepEqual(await lerOrganizacao(caminho), base)
  assert.deepEqual((await readdir(pasta)).sort(), ['organizacao.json', 'organizacao.v1.json'])
  assert.match(await readFile(join(pasta, 'organizacao.v1.json'), 'utf8'), /s_apps/)
  await writeFile(caminho, '{ estragado')
  assert.deepEqual(await lerOrganizacao(caminho), vazia())
  assert.equal(await readFile(`${caminho}.estragado`, 'utf8'), '{ estragado')
})
