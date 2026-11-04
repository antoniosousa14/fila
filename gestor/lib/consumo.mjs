import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

// O que o mod escreve em consumo/<AAAA-MM-DD>.json (mod/src/consumo.ts): um registo por fim de
// turno, { em, sessao, tokens, cache, limites: [{ kind, percentUsed, resetsAt }] }.
const H = 3_600_000
const SEMANA = 7 * 24 * H
export const DIAS_GUARDADOS = 35
// Dois resetsAt a menos de uma hora um do outro são a mesma janela (a API arredonda).
const MESMA_JANELA = H
const RE_DIA = /^(\d{4})-(\d{2})-(\d{2})\.json$/

const dois = n => String(n).padStart(2, '0')
export const diaLocal = ms => { const d = new Date(ms); return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}` }

// Lê os ficheiros dos últimos dias (cache por nome + mtime) e devolve os registos por ordem.
export async function lerConsumo(pasta, agora, cache = new Map()) {
  const limite = diaLocal(agora - DIAS_GUARDADOS * 24 * H)
  const registos = []
  for (const nome of (await readdir(pasta).catch(() => [])).sort()) {
    const m = RE_DIA.exec(nome)
    if (!m || nome.slice(0, 10) < limite) continue
    const caminho = join(pasta, nome)
    const info = await stat(caminho).catch(() => undefined)
    if (!info?.isFile()) continue
    let lista = cache.get(nome)?.mtime === info.mtimeMs ? cache.get(nome).lista : undefined
    if (!lista) {
      try {
        const lido = JSON.parse(await readFile(caminho, 'utf8'))
        lista = Array.isArray(lido) ? lido.filter(r => Number.isFinite(r?.em)) : []
      } catch {
        lista = []
      }
      cache.set(nome, { mtime: info.mtimeMs, lista })
    }
    registos.push(...lista)
  }

  return registos.sort((a, b) => a.em - b.em)
}

// As leituras de um tipo de janela (five_hour, seven_day), por ordem, sem repetidas.
function leituras(registos, kind) {
  const lista = []
  for (const r of registos) {
    for (const l of Array.isArray(r.limites) ? r.limites : []) {
      if (l?.kind !== kind || !Number.isFinite(l.percentUsed)) continue
      const reset = Date.parse(l.resetsAt)
      lista.push({ em: r.em, p: l.percentUsed, reset: Number.isFinite(reset) ? reset : null })
    }
  }

  return lista
}

const mesmaJanela = (a, b) => a !== null && b !== null && Math.abs(a - b) < MESMA_JANELA

// Ritmo médio das últimas 24 h (pontos percentuais por hora) dentro da janela atual: da leitura
// de há 24 h (ou do início da janela, a 0%, se começou há menos) até à última.
export function ritmo(pontos, inicio, agora) {
  const ultima = pontos[pontos.length - 1]
  if (!ultima) return 0
  const desde = agora - 24 * H
  const antes = [...pontos].reverse().find(x => x.em <= desde)
  const base = antes ?? (inicio >= desde ? { em: inicio, p: 0 } : pontos[0])
  const horas = (ultima.em - base.em) / H
  if (horas < 0.25) return 0

  return Math.max(0, (ultima.p - base.p) / horas)
}

function previsao(atual, ritmoH, agora) {
  if (atual.p >= 100) return { chegaEm: atual.em, antesDoReset: true, abrandar: null }
  if (ritmoH <= 0) return { chegaEm: null, antesDoReset: false, abrandar: null }
  const chegaEm = agora + ((100 - atual.p) / ritmoH) * H
  const antesDoReset = atual.reset !== null && chegaEm < atual.reset
  // Quanto abrandar para chegar ao reset sem bater no limite.
  const horasAteReset = (atual.reset - agora) / H
  const ritmoQueChega = horasAteReset > 0 ? (100 - atual.p) / horasAteReset : 0
  const abrandar = antesDoReset && ritmoH > 0 ? Math.min(100, Math.ceil((1 - ritmoQueChega / ritmoH) * 100)) : null

  return { chegaEm, antesDoReset, abrandar }
}

// Pontos percentuais da semana gastos em cada dia: soma das subidas entre leituras seguidas;
// uma leitura de uma janela nova conta desde 0.
function porDia(registos, semana, agora, dias) {
  const mapa = new Map()
  for (let i = dias - 1; i >= 0; i--) mapa.set(diaLocal(agora - i * 24 * H), { dia: diaLocal(agora - i * 24 * H), pontos: 0, tokens: 0, turnos: 0 })
  for (const r of registos) {
    const d = mapa.get(diaLocal(r.em))
    if (!d) continue
    d.tokens += Number(r.tokens) || 0
    d.turnos++
  }
  // A primeira leitura de uma janela que começou há menos de 24 h conta desde 0 no início dela,
  // como a curva; se começou antes, não se sabe em que dia foi gasto o que já lá estava.
  const comInicio = []
  for (const x of semana) {
    const anterior = comInicio[comInicio.length - 1]
    const nova = !anterior || !(mesmaJanela(anterior.reset, x.reset) || anterior.reset === x.reset)
    if (nova && x.reset !== null && x.em - (x.reset - SEMANA) < 24 * H) comInicio.push({ em: x.reset - SEMANA, p: 0, reset: x.reset })
    comInicio.push(x)
  }
  for (let i = 1; i < comInicio.length; i++) {
    const a = comInicio[i - 1]
    const b = comInicio[i]
    const d = mapa.get(diaLocal(b.em))
    if (!d) continue
    d.pontos += mesmaJanela(a.reset, b.reset) || a.reset === b.reset ? Math.max(0, b.p - a.p) : b.p
  }
  for (const d of mapa.values()) d.pontos = Math.round(d.pontos * 10) / 10

  return [...mapa.values()]
}

// A vista do consumo: semana (curva, ritmo, previsão), sessão de 5 h e os últimos 30 dias.
export function resumirConsumo(registos, agora) {
  const semanaToda = leituras(registos, 'seven_day')
  const atualSemana = semanaToda[semanaToda.length - 1]
  let semana = null
  if (atualSemana && (atualSemana.reset === null || atualSemana.reset > agora)) {
    const fim = atualSemana.reset ?? atualSemana.em + SEMANA
    const inicio = fim - SEMANA
    const pontos = semanaToda.filter(x => x.em >= inicio && (x.reset === null || mesmaJanela(x.reset, atualSemana.reset)))
    const r = ritmo(pontos, inicio, agora)
    semana = {
      percent: atualSemana.p,
      resetsAt: fim,
      inicio,
      lidaEm: atualSemana.em,
      // Para a curva chegam umas centenas de pontos; o resto é ruído.
      pontos: reduzir(pontos).map(x => [x.em, x.p]),
      ritmoH: Math.round(r * 100) / 100,
      ...previsao({ ...atualSemana, reset: fim }, r, agora),
    }
  }
  const cinco = leituras(registos, 'five_hour')
  const atualCinco = cinco[cinco.length - 1]
  const sessao = atualCinco && (atualCinco.reset === null || atualCinco.reset > agora)
    ? { percent: atualCinco.p, resetsAt: atualCinco.reset, lidaEm: atualCinco.em }
    : null

  return {
    semana,
    sessao,
    dias: porDia(registos, semanaToda, agora, 30),
    ultimoRegisto: registos.length ? registos[registos.length - 1].em : null,
  }
}

function reduzir(pontos, max = 240) {
  if (pontos.length <= max) return pontos
  const passo = pontos.length / max
  const lista = Array.from({ length: max - 1 }, (_, i) => pontos[Math.floor(i * passo)])

  return [...lista, pontos[pontos.length - 1]]
}
