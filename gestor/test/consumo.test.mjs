import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { diaLocal, lerConsumo, resumirConsumo, ritmo } from '../lib/consumo.mjs'

const H = 3_600_000
const D = 24 * H
const agora = new Date(2026, 10, 3, 12, 0).getTime()
const reset = agora + 2 * D // a janela de 7 dias começou há 5 dias
const iso = ms => new Date(ms).toISOString()
const reg = (em, p, extra = {}) => ({
  em, sessao: 's', tokens: 1000, cache: 0,
  limites: [{ kind: 'seven_day', percentUsed: p, resetsAt: iso(extra.reset ?? reset) }, ...(extra.cinco !== undefined ? [{ kind: 'five_hour', percentUsed: extra.cinco, resetsAt: iso(agora + 2 * H) }] : [])],
})

test('ritmo: das últimas 24 h; janela com menos de 24 h conta desde 0 no início', () => {
  const pontos = [{ em: agora - 30 * H, p: 10 }, { em: agora - 24 * H, p: 20 }, { em: agora, p: 44 }]
  assert.equal(ritmo(pontos, agora - 5 * D, agora), 1)
  assert.equal(ritmo([{ em: agora, p: 12 }], agora - 6 * H, agora), 2)
  assert.equal(ritmo([], agora - D, agora), 0)
})

test('previsão: ao ritmo atual chega aos 100% antes do reset, e quanto abrandar', () => {
  // 24 pontos em 24 h → 1 pp/h; de 60% faltam 40 h, o reset é daqui a 48 h → não chega.
  const r1 = resumirConsumo([reg(agora - 24 * H, 36), reg(agora, 60)], agora).semana
  assert.equal(r1.percent, 60)
  assert.equal(r1.ritmoH, 1)
  assert.equal(r1.chegaEm, agora + 40 * H)
  assert.equal(r1.antesDoReset, true)
  assert.equal(r1.abrandar, 17) // precisa de 40/48 ≈ 0,83 pp/h
  // 0,5 pp/h: faltam 80 h, depois do reset.
  const r2 = resumirConsumo([reg(agora - 24 * H, 48), reg(agora, 60)], agora).semana
  assert.equal(r2.antesDoReset, false)
  assert.equal(r2.abrandar, null)
  assert.equal(r2.inicio, reset - 7 * D)
  assert.equal(r2.resetsAt, reset)
})

test('sem subida não há previsão; janela que já acabou não conta', () => {
  assert.equal(resumirConsumo([reg(agora - 24 * H, 60), reg(agora, 60)], agora).semana.chegaEm, null)
  assert.equal(resumirConsumo([reg(agora - 9 * D, 90, { reset: agora - D })], agora).semana, null)
})

test('a curva só leva a janela atual', () => {
  const velha = reg(agora - 6 * D, 95, { reset: reset - 7 * D })
  const { semana } = resumirConsumo([velha, reg(agora - D, 30), reg(agora, 40)], agora)
  assert.deepEqual(semana.pontos, [[agora - D, 30], [agora, 40]])
})

test('sessão de 5 h: a última leitura, se a janela ainda não acabou', () => {
  const { sessao } = resumirConsumo([reg(agora - H, 50, { cinco: 10 }), reg(agora, 51, { cinco: 42 })], agora)
  assert.deepEqual(sessao, { percent: 42, resetsAt: agora + 2 * H, lidaEm: agora })
  assert.equal(resumirConsumo([reg(agora, 1, { cinco: 42 })], agora + 3 * H).sessao, null)
})

test('por dia: pontos da semana gastos (uma janela nova conta desde 0), tokens e turnos, 30 dias', () => {
  const ontem = agora - D
  const registos = [
    reg(ontem - H, 90, { reset: agora - 2 * H }), reg(ontem, 95, { reset: agora - 2 * H }),
    reg(agora - H, 3), reg(agora - 30 * 60_000, 5), reg(agora, 5),
  ]
  const { dias } = resumirConsumo(registos, agora)
  assert.equal(dias.length, 30)
  assert.deepEqual(dias[29], { dia: diaLocal(agora), pontos: 5, tokens: 3000, turnos: 3 })
  assert.deepEqual(dias[28], { dia: diaLocal(ontem), pontos: 5, tokens: 2000, turnos: 2 })
  assert.equal(dias[0].pontos, 0)
})

test('por dia: uma janela que começou há pouco conta a primeira leitura desde 0', () => {
  const resetNovo = agora - 2 * H + 7 * D // começou há 2 h
  const { dias } = resumirConsumo([reg(agora, 12, { reset: resetNovo })], agora)
  assert.equal(dias[29].pontos, 12)
  // Uma janela que começou há 5 dias: a primeira leitura não diz em que dia foi gasto.
  assert.equal(resumirConsumo([reg(agora, 40)], agora).dias[29].pontos, 0)
})

test('lerConsumo: só ficheiros AAAA-MM-DD.json dos últimos dias, estragados não partem nada', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'gestor-consumo-'))
  await writeFile(join(pasta, `${diaLocal(agora)}.json`), JSON.stringify([reg(agora, 5), reg(agora - H, 4)]))
  await writeFile(join(pasta, `${diaLocal(agora - D)}.json`), '[{"em":')
  await writeFile(join(pasta, `${diaLocal(agora - 40 * D)}.json`), JSON.stringify([reg(agora - 40 * D, 1)]))
  await writeFile(join(pasta, 'outro.json'), JSON.stringify([reg(agora, 99)]))
  const cache = new Map()
  const lidos = await lerConsumo(pasta, agora, cache)
  assert.deepEqual(lidos.map(r => r.em), [agora - H, agora])
  assert.equal((await lerConsumo(pasta, agora, cache)).length, 2)
  assert.deepEqual(await lerConsumo(join(pasta, 'nao-existe'), agora), [])
})
