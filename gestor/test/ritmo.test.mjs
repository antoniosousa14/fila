import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { atividadeDosChats, DIAS_RITMO, diasEntre, ritmoDe, somarAtividade } from '../lib/ritmo.mjs'
import { lerSituacao, lerSituacoes, situacaoPorLocal } from '../lib/situacao.mjs'

const H = 3_600_000
const D = 24 * H
const agora = new Date(2026, 10, 4, 1, 0).getTime()

// ——— ritmo ———

test('diasEntre conta dias de calendário, não períodos de 24 h', () => {
  assert.equal(diasEntre(new Date(2026, 10, 3, 23, 59).getTime(), new Date(2026, 10, 4, 0, 1).getTime()), 1)
  assert.equal(diasEntre(new Date(2026, 10, 4, 0, 1).getTime(), new Date(2026, 10, 4, 23, 59).getTime()), 0)
  assert.equal(diasEntre(new Date(2026, 9, 25, 12).getTime(), new Date(2026, 10, 4, 12).getTime()), 10)
})

test('ritmoDe: hoje, ativo, a arrefecer e parado', () => {
  assert.equal(ritmoDe(agora - 5 * 60_000, agora), 'hoje')
  assert.equal(ritmoDe(agora - 23 * H, agora), 'hoje')
  assert.equal(ritmoDe(agora - 30 * H, agora), 'ativo')
  assert.equal(ritmoDe(agora - 2 * D, agora), 'ativo')
  assert.equal(ritmoDe(agora - 4 * D, agora), 'arrefecer')
  assert.equal(ritmoDe(agora - 6 * D, agora), 'arrefecer')
  assert.equal(ritmoDe(agora - 8 * D, agora), 'parado')
  assert.equal(ritmoDe(0, agora), 'parado')
})

test('atividadeDosChats conta as mensagens tuas por dia, só dos ficheiros dos chats', () => {
  const estados = [
    { sessaoDoFicheiro: 'cli-a', subagente: false, humanos: [agora - 10 * 60_000, agora - 30 * 60_000, agora - D, agora - 3 * D, agora - 40 * D] },
    { sessaoDoFicheiro: 'cli-a', subagente: true, humanos: [agora - H] },
    { sessaoDoFicheiro: 'cli-x', subagente: false, humanos: [agora - H] },
  ]
  const mapa = atividadeDosChats(estados, new Map([['cli-a', 'local_a']]), agora)
  assert.deepEqual([...mapa.keys()], ['local_a'])
  const a = mapa.get('local_a')
  assert.equal(a.length, DIAS_RITMO)
  // Duas de hoje, uma de ontem e uma de há 3 dias; a de há 40 dias fica de fora.
  assert.equal(a[DIAS_RITMO - 1], 2)
  assert.equal(a[DIAS_RITMO - 2], 1)
  assert.equal(a[DIAS_RITMO - 4], 1)
  assert.equal(a.reduce((x, y) => x + y, 0), 4)
})

test('somarAtividade soma listas dia a dia e aguenta listas em falta', () => {
  const um = Array.from({ length: DIAS_RITMO }, (_, i) => i)
  const soma = somarAtividade([um, undefined, um])
  assert.equal(soma.length, DIAS_RITMO)
  assert.equal(soma[5], 10)
  assert.equal(somarAtividade([]).every(n => n === 0), true)
})

// ——— situação (escrita pelo mod) ———

test('lerSituacao aceita a forma certa e limpa o resto', () => {
  const s = lerSituacao({
    sessao: 's1', local: 'local_1', titulo: '  Gaivota  ', em: 5,
    feito: [{ texto: ' Retirada  a build ', em: 3 }, { texto: '', em: 1 }, { texto: 'sem hora' }, null],
    falta: [{ texto: 'Reenviar', prioridade: 9 }, { texto: 'Sem prioridade' }, { texto: '   ', prioridade: 2 }],
  })
  assert.equal(s.titulo, 'Gaivota')
  assert.deepEqual(s.feito, [{ texto: 'Retirada a build', em: 3 }, { texto: 'sem hora', em: 0 }])
  assert.deepEqual(s.falta, [{ texto: 'Reenviar', prioridade: 5 }, { texto: 'Sem prioridade', prioridade: 3 }])
  assert.equal(lerSituacao({ feito: [] }), undefined)
  assert.equal(lerSituacao(null), undefined)
  assert.deepEqual(lerSituacao({ sessao: 's', feito: 'x', falta: 3 }).feito, [])
})

test('situacaoPorLocal liga pelo id local_ ou pela sessão do CLI do chat', () => {
  const situacoes = [
    { sessao: 's1', local: 'local_1', feito: [], falta: [] },
    { sessao: 's2', local: '', feito: [], falta: [] },
  ]
  const sessoes = [
    { local: 'local_1', clis: ['outro'] },
    { local: 'local_2', clis: ['antiga', 's2'] },
    { local: 'local_3', clis: [] },
  ]
  const mapa = situacaoPorLocal(situacoes, sessoes)
  assert.equal(mapa.get('local_1').sessao, 's1')
  assert.equal(mapa.get('local_2').sessao, 's2')
  assert.equal(mapa.has('local_3'), false)
})

test('lerSituacoes lê a pasta, ignora o que não é válido e usa cache', async t => {
  const pasta = await mkdtemp(join(tmpdir(), 'fila-sit-'))
  t.after(() => rm(pasta, { recursive: true, force: true }))
  await mkdir(pasta, { recursive: true })
  await writeFile(join(pasta, 's1.json'), JSON.stringify({ sessao: 's1', local: 'local_1', feito: [{ texto: 'A', em: 1 }], falta: [] }))
  await writeFile(join(pasta, 'estragado.json'), '{ não é json')
  await writeFile(join(pasta, 'sem-sessao.json'), JSON.stringify({ feito: [] }))
  await writeFile(join(pasta, 'nota.txt'), 'x')
  const cache = new Map()
  const a = await lerSituacoes(pasta, cache)
  assert.deepEqual(a.map(s => s.sessao), ['s1'])
  assert.equal(cache.size, 3, 'lembra também os ficheiros inválidos, para não os reler')
  await rm(join(pasta, 's1.json'))
  assert.deepEqual(await lerSituacoes(pasta, cache), [])
  assert.equal(cache.size, 2, 'o que foi apagado sai da cache')
  assert.deepEqual(await lerSituacoes(join(pasta, 'nao-existe'), new Map()), [])
})
