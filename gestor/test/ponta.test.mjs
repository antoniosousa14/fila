import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BLOCO_MS } from '../lib/historico.mjs'
import { analisarPonta, emPonta, horaNoFuso, medirExcesso, MIN_INTERVALOS } from '../lib/ponta.mjs'

const raiz = join(fileURLToPath(import.meta.url), '..', '..')
const precos = JSON.parse(readFileSync(join(raiz, 'precos.json'), 'utf8'))
const ponta = JSON.parse(readFileSync(join(raiz, 'ponta.json'), 'utf8'))
const janela = ponta.janela
const H = 3_600_000
// Terça, 3 nov 2026: 14:00 UTC = 06:00 em Los Angeles (PST) → em ponta; 20:00 UTC = 12:00 → fora.
const emPontaUtc = Date.UTC(2026, 10, 3, 14, 0)
const foraUtc = Date.UTC(2026, 10, 3, 20, 0)

test('o ficheiro de ponta diz que não há regra oficial e guarda as fontes com data', () => {
  assert.equal(ponta.regraOficial, false)
  assert.ok(ponta.fontes.some(f => f.oficial && /anthropic\.com/.test(f.url) && f.data === '2026-05-06'))
  assert.ok(ponta.fontes.every(f => f.url && f.data && typeof f.oficial === 'boolean'))
  assert.equal(janela.oficial, false)
})

test('hora no fuso de Los Angeles e janela de ponta (dias úteis 5–11 h PT), com a hora de verão', () => {
  assert.deepEqual(horaNoFuso(emPontaUtc, 'America/Los_Angeles'), { dia: 2, hora: 6 })
  assert.equal(emPonta(emPontaUtc, janela), true)
  assert.equal(emPonta(foraUtc, janela), false)
  assert.equal(emPonta(Date.UTC(2026, 10, 7, 14, 0), janela), false) // sábado
  assert.equal(emPonta(Date.UTC(2026, 6, 7, 12, 30), janela), true) // julho: PDT, 05:30
  assert.equal(emPonta(emPontaUtc, null), false)
})

const bloco = (ms, saida, modelo = 'claude-opus-5-5') => ({ [String(Math.floor(ms / BLOCO_MS))]: { [modelo]: [0, saida, 0, 0, 0] } })
const leitura = (em, p, kind = 'five_hour') => ({ em, limites: [{ kind, percentUsed: p, resetsAt: new Date(Date.UTC(2026, 10, 3, 23)).toISOString() }] })

test('excesso: em ponta o limite sobe mais por dólar; diz a diferença e o que se gastou a mais', () => {
  const custoPorBloco = new Map()
  const registos = []
  // 12 intervalos de 10 min em ponta e 12 fora, $2 cada; em ponta sobe 2 pp, fora 1 pp.
  let p = 0
  // Em ponta das 14 h às 16 h UTC (6–8 h PT); fora das 20 h às 22 h UTC, 4 h depois (o par do meio não conta).
  for (const [base, sobe] of [[emPontaUtc, 2], [foraUtc, 1]]) {
    registos.push(leitura(base, p))
    for (let i = 1; i <= 12; i++) {
      custoPorBloco.set(Math.floor((base + (i - 1) * BLOCO_MS) / BLOCO_MS), 2)
      p += sobe
      registos.push(leitura(base + i * BLOCO_MS, p))
    }
  }
  const r = medirExcesso({ registos, custoPorBloco, janela, kind: 'five_hour' })
  assert.equal(r.ponta.intervalos, 12)
  assert.equal(r.fora.intervalos, 12)
  assert.equal(r.suficiente, true)
  assert.ok(Math.abs(r.diferenca - 1) < 1e-9) // o dobro
  assert.ok(Math.abs(r.excessoPp - 12) < 1e-9)
  assert.ok(Math.abs(r.excessoUsd - 24) < 1e-9)
})

test('excesso: poucas leituras, reset pelo meio e intervalos longos não contam como suficiente', () => {
  const registos = [leitura(emPontaUtc, 10), leitura(emPontaUtc + 10 * 60_000, 12), leitura(emPontaUtc + 5 * H, 40), { em: emPontaUtc + 6 * H, limites: [{ kind: 'five_hour', percentUsed: 1, resetsAt: '2026-11-04T05:00:00Z' }] }]
  const r = medirExcesso({ registos, custoPorBloco: new Map(), janela, kind: 'five_hour' })
  assert.equal(r.leituras, 4)
  assert.equal(r.ponta.intervalos, 1)
  assert.equal(r.suficiente, false)
  assert.equal(r.diferenca, null)
  assert.ok(MIN_INTERVALOS >= 10)
})

test('análise: mapa dia × hora local com a ponta marcada, partilha em ponta e uso por modelo', () => {
  const estados = [
    { blocos: { ...bloco(emPontaUtc, 1e6), ...bloco(foraUtc, 1e6, 'claude-sonnet-5-5') }, pendente: null },
    { blocos: {}, pendente: { id: 'msg', em: emPontaUtc + 60_000, modelo: 'claude-opus-5-5', t: { entrada: 0, saida: 1e6, cache5m: 0, cache1h: 0, leitura: 0 } } },
  ]
  const agora = foraUtc + H
  const r = analisarPonta({ estados, registos: [], ponta, precos, agora })
  const d = new Date(emPontaUtc)
  assert.equal(r.mapa[d.getDay()][d.getHours()].custo, 40)
  assert.equal(r.mapa[d.getDay()][d.getHours()].ponta, true)
  assert.equal(r.mapa[6][12].ponta, false)
  assert.deepEqual(r.porModelo.ponta.map(m => [m.modelo, m.custo]), [['claude-opus-5-5', 40]])
  assert.deepEqual(r.porModelo.fora.map(m => [m.modelo, m.custo]), [['claude-sonnet-5-5', 10]])
  assert.ok(Math.abs(r.partilha30.fracao - 0.8) < 1e-9)
  assert.equal(r.regraOficial, false)
  assert.deepEqual(r.excesso.map(x => x.kind), ['five_hour', 'seven_day'])
})
