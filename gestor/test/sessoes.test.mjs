import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, utimes, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resumirSessao, lerSessoes } from '../lib/sessoes.mjs'

const bruto = {
  sessionId: 'local_abc', cliSessionId: 'cli-1', title: 'Ola', cwd: 'C:\\Users\\x\\Documents\\FAROL',
  createdAt: 1000, lastActivityAt: 5000, isArchived: false,
  postTurnSummary: { status_category: 'completed', status_detail: 'Listou o trabalho', needs_action: 'Escolher' },
}

test('resume os campos de topo', () => {
  const r = resumirSessao(bruto)
  assert.deepEqual(r, {
    local: 'local_abc', cli: 'cli-1', clis: ['cli-1'], clisSaidos: {}, titulo: 'Ola', cwd: 'C:\\Users\\x\\Documents\\FAROL', projeto: 'FAROL',
    criadoEm: 1000, atividadeEm: 5000, mensagemEm: 5000, arquivado: false, resumo: 'Listou o trabalho', precisa: 'Escolher', estado: 'completed',
  })
})

test('clisSaidos traz quando a app largou cada sessão do CLI (um /clear) e ignora o que não é instante', () => {
  const r = resumirSessao({ ...bruto, priorCliSessionLeftAt: { 'cli-0': 3000, 'cli-x': 'ontem', 'cli-y': null, 'cli-z': NaN } })
  assert.deepEqual(r.clisSaidos, { 'cli-0': 3000 })
  for (const lixo of [undefined, null, 'x', 7, ['cli-0']]) assert.deepEqual(resumirSessao({ ...bruto, priorCliSessionLeftAt: lixo }).clisSaidos, {})
})

test('mensagemEm é a última mensagem que entrou no chat; sem ela, a última atividade', () => {
  assert.equal(resumirSessao({ ...bruto, latestUserFrameAt: 4000 }).mensagemEm, 4000)
  assert.equal(resumirSessao(bruto).mensagemEm, 5000)
  assert.equal(resumirSessao({ sessionId: 'local_z' }).mensagemEm, 0)
})

test('campos em falta não partem o resumo', () => {
  const r = resumirSessao({ sessionId: 'local_z' })
  assert.equal(r.titulo, 'Chat sem título')
  assert.equal(r.precisa, '')
  assert.equal(r.projeto, '')
  assert.equal(r.arquivado, false)
})

test('sem sessionId não é sessão', () => {
  assert.equal(resumirSessao({ title: 'x' }), undefined)
  assert.equal(resumirSessao(null), undefined)
})

test('projeto é a última pasta, com barra no fim ou separadores mistos', () => {
  assert.equal(resumirSessao({ sessionId: 'local_a', cwd: 'C:\\a\\b\\' }).projeto, 'b')
  assert.equal(resumirSessao({ sessionId: 'local_a', cwd: 'C:/a/c' }).projeto, 'c')
})

async function pastaDeTeste() {
  const base = await mkdtemp(join(tmpdir(), 'gestor-sessoes-'))
  const pasta = join(base, 'conta', 'org')
  await mkdir(pasta, { recursive: true })

  return { base, pasta }
}

test('lerSessoes lê local_*.json em conta/org e ignora o resto', async t => {
  const { base, pasta } = await pastaDeTeste()
  t.after(() => rm(base, { recursive: true, force: true }))
  await writeFile(join(pasta, 'local_1.json'), JSON.stringify({ ...bruto, sessionId: 'local_1' }))
  await writeFile(join(pasta, 'local_2.json'), JSON.stringify({ sessionId: 'local_2', title: 'Dois' }))
  await writeFile(join(pasta, 'outro.json'), JSON.stringify({ sessionId: 'local_x' }))
  await writeFile(join(pasta, 'local_3.txt'), 'nada')

  const sessoes = await lerSessoes(base)
  assert.deepEqual(sessoes.map(s => s.local).sort(), ['local_1', 'local_2'])
})

test('ficheiro estragado não parte a leitura dos outros', async t => {
  const { base, pasta } = await pastaDeTeste()
  t.after(() => rm(base, { recursive: true, force: true }))
  await writeFile(join(pasta, 'local_bom.json'), JSON.stringify({ sessionId: 'local_bom' }))
  await writeFile(join(pasta, 'local_mau.json'), '{"sessionId": "local_mau", ')
  await writeFile(join(pasta, 'local_sem.json'), JSON.stringify({ title: 'sem id' }))

  const sessoes = await lerSessoes(base)
  assert.deepEqual(sessoes.map(s => s.local), ['local_bom'])
})

test('pasta base inexistente dá lista vazia', async () => {
  assert.deepEqual(await lerSessoes(join(tmpdir(), 'nao-existe-gestor-' + Date.now())), [])
})

test('cache por mtime: não relê o que não mudou, relê o que mudou', async t => {
  const { base, pasta } = await pastaDeTeste()
  t.after(() => rm(base, { recursive: true, force: true }))
  const caminho = join(pasta, 'local_c.json')
  const data = new Date('2026-11-01T10:00:00Z')
  await writeFile(caminho, JSON.stringify({ sessionId: 'local_c', title: 'Antes' }))
  await utimes(caminho, data, data)
  const cache = new Map()

  assert.equal((await lerSessoes(base, cache))[0].titulo, 'Antes')

  // Conteúdo novo com o mesmo mtime: a cache responde sem ler.
  await writeFile(caminho, JSON.stringify({ sessionId: 'local_c', title: 'Depois' }))
  await utimes(caminho, data, data)
  assert.equal((await lerSessoes(base, cache))[0].titulo, 'Antes')

  // mtime novo: relê.
  const nova = new Date('2026-11-01T11:00:00Z')
  await utimes(caminho, nova, nova)
  assert.equal((await lerSessoes(base, cache))[0].titulo, 'Depois')
})

test('cache lembra ficheiros estragados sem os voltar a ler', async t => {
  const { base, pasta } = await pastaDeTeste()
  t.after(() => rm(base, { recursive: true, force: true }))
  const caminho = join(pasta, 'local_m.json')
  const data = new Date('2026-11-01T10:00:00Z')
  await writeFile(caminho, 'estragado')
  await utimes(caminho, data, data)
  const cache = new Map()

  assert.deepEqual(await lerSessoes(base, cache), [])
  assert.equal(cache.size, 1)
  assert.equal(cache.get(caminho).sessao, undefined)
})

test('ficheiros apagados saem da cache', async t => {
  const { base, pasta } = await pastaDeTeste()
  t.after(() => rm(base, { recursive: true, force: true }))
  const caminho = join(pasta, 'local_a.json')
  await writeFile(caminho, JSON.stringify({ sessionId: 'local_a' }))
  const cache = new Map()
  await lerSessoes(base, cache)
  await rm(caminho)

  assert.deepEqual(await lerSessoes(base, cache), [])
  assert.equal(cache.size, 0)
})
