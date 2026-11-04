import type { Linha, Vista } from '../types'

export const COR = { alta: '#E24B4A', media: '#EF9F27', baixa: '#888780' } as const
export const MAX_VISIVEIS = 3

const ESFORCO = { segundos: '5s', minutos: '2 min', longo: 'longo' } as const

export type Chip = {
  sessao: string
  local?: string
  desde: number
  numero: number
  texto: string
  nota: string
  cor: string
  silenciado: boolean
  cartao?: string[]
}

export type ModeloBarra =
  | { vazia: true; resumo: string }
  | {
      vazia: false
      cabeca: string
      chips: Chip[]
      mais: number
      aTrabalhar: string
      proximo?: Chip
      extra: Chip[]
    }

export function haQuanto(ms: number): string {
  const minutos = Math.max(0, Math.floor(ms / 60_000))
  if (minutos < 60) return `há ${minutos} min`

  return `há ${Math.floor(minutos / 60)}h${String(minutos % 60).padStart(2, '0')}`
}

export function corDe(importancia: number | undefined): string {
  const n = importancia ?? 3

  return n >= 4 ? COR.alta : n === 3 ? COR.media : COR.baixa
}

function chip(linha: Linha, numero: number, nota: string, agora: number): Chip {
  const c = linha.classificacao

  return {
    sessao: linha.sessao,
    local: linha.local,
    desde: linha.desde,
    numero,
    texto: `${linha.projeto} · ${c?.rotulo || linha.titulo}`,
    nota,
    cor: linha.silenciado ? COR.baixa : corDe(c?.importancia),
    silenciado: linha.silenciado,
    cartao: c && [
      `Pediste: ${c.cartao.pediste}`,
      `Fez: ${c.cartao.fez}`,
      `Precisa de ti: ${c.cartao.precisa}`,
      `À espera ${haQuanto(agora - linha.desde)}`,
    ],
  }
}

export function modeloDaBarra(vista: Vista | null, antigosAbertos: boolean): ModeloBarra {
  const aTrabalhar = `${vista?.aTrabalhar ?? 0} a trabalhar`
  if (!vista || (vista.fila.length === 0 && vista.antigos.length === 0)) {
    return { vazia: true, resumo: `Nada à tua espera · ${aTrabalhar}` }
  }
  const agora = vista.calculadaEm
  const chips = vista.fila
    .slice(0, MAX_VISIVEIS)
    .map((linha, i) => chip(linha, i + 1, ESFORCO[linha.classificacao?.esforco ?? 'minutos'], agora))
  const resto = [...vista.fila.slice(MAX_VISIVEIS), ...vista.antigos]
  const primeiroDoResto = resto[0] && chip(resto[0], 0, '', agora)

  return {
    vazia: false,
    cabeca: vista.foco ? `Foco: ${vista.foco.titulo}` : `${vista.fila.length} à espera`,
    chips,
    mais: resto.length,
    aTrabalhar,
    proximo: chips.find(c => !c.silenciado) ?? primeiroDoResto,
    extra: antigosAbertos ? resto.map(linha => chip(linha, 0, haQuanto(agora - linha.desde), agora)) : [],
  }
}
