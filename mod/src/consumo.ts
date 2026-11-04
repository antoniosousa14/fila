// Registo de consumo: em cada fim de turno, os limites de uso da conta (janela de 5 h e de
// 7 dias, como na linha de estado) e os tokens do turno vão para consumo/<AAAA-MM-DD>.json.
// O gestor lê estes ficheiros e desenha a curva semanal e a previsão.

export type Limite = { kind: string; percentUsed: number; resetsAt?: string }

export type RegistoConsumo = {
  em: number
  sessao: string
  // input + output + criação de cache; a leitura de cache vai à parte, porque pesa pouco.
  tokens: number
  cache: number
  limites: Limite[]
}

export type UsoDoTurno = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

// Um ficheiro por dia nunca passa disto (cerca de 400 KB); os mais antigos do dia saem primeiro.
export const MAX_POR_DIA = 4000

const dois = (n: number) => String(n).padStart(2, '0')

export function diaLocal(ms: number): string {
  const d = new Date(ms)

  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`
}

const numero = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0)

export function registoDoTurno(args: { em: number; sessao: string; uso?: UsoDoTurno; limites: Limite[] }): RegistoConsumo | undefined {
  const { em, sessao, uso, limites } = args
  const tokens = numero(uso?.input_tokens) + numero(uso?.output_tokens) + numero(uso?.cache_creation_input_tokens)
  const cache = numero(uso?.cache_read_input_tokens)
  const validos = limites
    .filter(l => typeof l.kind === 'string' && Number.isFinite(l.percentUsed))
    .map(l => ({ kind: l.kind, percentUsed: l.percentUsed, ...(l.resetsAt && { resetsAt: l.resetsAt }) }))
  if (!tokens && !cache && !validos.length) return undefined

  return { em, sessao, tokens, cache, limites: validos }
}

// Junta o registo ao que já está no ficheiro do dia. Um ficheiro estragado (dois chats a
// escrever ao mesmo tempo) recomeça: perde-se esse dia até ali, nunca a escrita de agora.
export function juntarAoDia(texto: string | undefined, novo: RegistoConsumo): string {
  let lista: RegistoConsumo[] = []
  try {
    const lido = texto ? JSON.parse(texto) : []
    if (Array.isArray(lido)) lista = lido
  } catch {
    lista = []
  }
  lista.push(novo)

  return JSON.stringify(lista.slice(-MAX_POR_DIA))
}
