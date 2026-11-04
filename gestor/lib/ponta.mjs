import { BLOCO_MS, vetor } from './historico.mjs'
import { custoDe } from './estatisticas.mjs'

// Horas de ponta: o teu uso dentro e fora da janela de ponta (gestor/ponta.json), o mapa de dia
// da semana × hora e, com as leituras dos limites que o mod regista (consumo/<dia>.json), quanto
// sobe a % do limite por dólar equivalente dentro e fora da janela.
const H = 3_600_000
const DIA = 24 * H
// Leituras seguidas mais afastadas do que isto não dizem onde foi gasto o que subiu.
export const MAX_INTERVALO_MS = 3 * H
// Abaixo disto em cada lado, a estimativa ainda é ruído.
export const MIN_INTERVALOS = 10
export const MIN_CUSTO_USD = 5
const CATEGORIAS = ['entrada', 'saida', 'cache5m', 'cache1h', 'leitura']

const formatadores = new Map()
// Dia da semana (0 = domingo) e hora no fuso dado.
export function horaNoFuso(ms, fuso) {
  if (!formatadores.has(fuso)) formatadores.set(fuso, new Intl.DateTimeFormat('en-US', { timeZone: fuso, weekday: 'short', hour: '2-digit', hourCycle: 'h23' }))
  const partes = formatadores.get(fuso).formatToParts(new Date(ms))
  const dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(partes.find(p => p.type === 'weekday')?.value)

  return { dia, hora: Number(partes.find(p => p.type === 'hour')?.value) % 24 }
}

export function emPonta(ms, janela) {
  if (!janela) return false
  const { dia, hora } = horaNoFuso(ms, janela.fuso)

  return janela.dias.includes(dia) && hora >= janela.inicio && hora < janela.fim
}

const deVetor = v => Object.fromEntries(CATEGORIAS.map((k, i) => [k, v[i] ?? 0]))
const tokensDe = t => t.entrada + t.saida + t.cache5m + t.cache1h

// Todos os blocos de 10 min de todos os ficheiros, juntos: bloco → modelo → tokens.
export function juntarBlocos(estados) {
  const blocos = new Map()
  const juntar = (k, modelo, v) => {
    if (!blocos.has(k)) blocos.set(k, new Map())
    const b = blocos.get(k)
    b.set(modelo, b.has(modelo) ? b.get(modelo).map((x, i) => x + v[i]) : [...v])
  }
  for (const e of estados) {
    for (const [k, modelos] of Object.entries(e.blocos ?? {})) for (const [m, v] of Object.entries(modelos)) juntar(Number(k), m, v)
    if (e.pendente) juntar(Math.floor(e.pendente.em / BLOCO_MS), e.pendente.modelo, vetor(e.pendente.t))
  }

  return blocos
}

// Pares de leituras seguidas da mesma janela de limite: quanto subiu a % e quanto se gastou entre elas.
export function medirExcesso({ registos, custoPorBloco, janela, kind }) {
  const leituras = []
  for (const r of registos) {
    for (const l of Array.isArray(r.limites) ? r.limites : []) {
      if (l?.kind !== kind || !Number.isFinite(l.percentUsed)) continue
      leituras.push({ em: r.em, p: l.percentUsed, reset: Date.parse(l.resetsAt) || null })
    }
  }
  leituras.sort((a, b) => a.em - b.em)
  const lado = () => ({ intervalos: 0, pp: 0, custo: 0 })
  const r = { kind, leituras: leituras.length, ponta: lado(), fora: lado() }
  for (let i = 1; i < leituras.length; i++) {
    const a = leituras[i - 1]
    const b = leituras[i]
    const mesma = a.reset !== null && b.reset !== null && Math.abs(a.reset - b.reset) < H
    if (!mesma || b.em <= a.em || b.em - a.em > MAX_INTERVALO_MS || b.p < a.p) continue
    let custo = 0
    for (let k = Math.floor(a.em / BLOCO_MS); k <= Math.floor(b.em / BLOCO_MS); k++) {
      const sobre = Math.min(b.em, (k + 1) * BLOCO_MS) - Math.max(a.em, k * BLOCO_MS)
      if (sobre > 0) custo += (custoPorBloco.get(k) ?? 0) * (sobre / BLOCO_MS)
    }
    const x = emPonta((a.em + b.em) / 2, janela) ? r.ponta : r.fora
    x.intervalos++
    x.pp += b.p - a.p
    x.custo += custo
  }
  for (const x of [r.ponta, r.fora]) x.porDolar = x.custo > 0 ? x.pp / x.custo : null
  const chega = x => x.intervalos >= MIN_INTERVALOS && x.custo >= MIN_CUSTO_USD
  r.suficiente = chega(r.ponta) && chega(r.fora)
  r.diferenca = r.ponta.porDolar !== null && r.fora.porDolar ? r.ponta.porDolar / r.fora.porDolar - 1 : null
  // O que subiu a mais em ponta, em pontos percentuais e no equivalente em dólares fora de ponta.
  r.excessoPp = r.diferenca !== null ? r.ponta.pp - r.ponta.custo * r.fora.porDolar : null
  r.excessoUsd = r.excessoPp !== null && r.fora.porDolar ? r.excessoPp / r.fora.porDolar : null

  return r
}

export function analisarPonta({ estados, registos = [], ponta, precos, agora, semanas = 8 }) {
  const janela = ponta?.janela
  const blocos = juntarBlocos(estados)
  const custoPorBloco = new Map()
  const lados = { ponta: new Map(), fora: new Map() }
  const mapa = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ custo: 0, tokens: 0 })))
  const desdeMapa = agora - semanas * 7 * DIA
  const desde30 = agora - 30 * DIA
  const partilha = { ponta: 0, total: 0 }
  for (const [k, modelos] of blocos) {
    const ms = k * BLOCO_MS
    const naPonta = emPonta(ms + BLOCO_MS / 2, janela)
    let custoBloco = 0
    let tokensBloco = 0
    for (const [modelo, v] of modelos) {
      const t = deVetor(v)
      const custo = custoDe(precos, modelo, t) ?? 0
      custoBloco += custo
      tokensBloco += tokensDe(t)
      const m = lados[naPonta ? 'ponta' : 'fora']
      if (!m.has(modelo)) m.set(modelo, { modelo, tokens: 0, custo: 0, respostas: 0 })
      const x = m.get(modelo)
      x.tokens += tokensDe(t)
      x.custo += custo
    }
    custoPorBloco.set(k, custoBloco)
    if (ms >= desdeMapa) {
      const d = new Date(ms)
      const celula = mapa[d.getDay()][d.getHours()]
      celula.custo += custoBloco
      celula.tokens += tokensBloco
    }
    if (ms >= desde30) {
      partilha.total += custoBloco
      if (naPonta) partilha.ponta += custoBloco
    }
  }
  // As células do mapa (hora local) que caem na janela de ponta, contadas nesta semana.
  const segunda = new Date(agora)
  segunda.setHours(0, 0, 0, 0)
  segunda.setDate(segunda.getDate() - ((segunda.getDay() + 6) % 7))
  const marcadas = Array.from({ length: 7 }, (_, dia) => Array.from({ length: 24 }, (_, hora) => {
    const quando = new Date(segunda)
    quando.setDate(segunda.getDate() + ((dia + 6) % 7))
    quando.setHours(hora, 30)

    return emPonta(quando.getTime(), janela)
  }))
  const lista = m => [...m.values()].sort((a, b) => b.custo - a.custo)

  return {
    janela: janela ?? null,
    regraOficial: ponta?.regraOficial === true,
    resumo: ponta?.resumo ?? '',
    fontes: ponta?.fontes ?? [],
    lidoEm: ponta?.lidoEm ?? null,
    semanas,
    mapa: mapa.map((linha, dia) => linha.map((c, hora) => ({ ...c, ponta: marcadas[dia][hora] }))),
    partilha30: { ...partilha, fracao: partilha.total ? partilha.ponta / partilha.total : 0 },
    porModelo: { ponta: lista(lados.ponta), fora: lista(lados.fora) },
    excesso: ['five_hour', 'seven_day'].map(kind => medirExcesso({ registos, custoPorBloco, janela, kind })),
  }
}
