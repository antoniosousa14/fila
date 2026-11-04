import type { Linha } from '../types'

export const PAUSA_MS = 4 * 3_600_000
export const VALIDADE_MS = 7 * 24 * 3_600_000

export function inicioDaSessao(atividade: number[], agora: number): number {
  const instantes = [...atividade, agora].sort((a, b) => b - a)
  let inicio = agora
  for (const instante of instantes) {
    if (inicio - instante > PAUSA_MS) break
    inicio = Math.min(inicio, instante)
  }

  return inicio
}

export function separar(linhas: Linha[], inicio: number): { fila: Linha[]; antigos: Linha[] } {
  const fila: Linha[] = []
  const antigos: Linha[] = []
  for (const linha of linhas) {
    const importante = (linha.classificacao?.importancia ?? 3) >= 4
    if (linha.desde < inicio && !importante) antigos.push(linha)
    else fila.push(linha)
  }

  return { fila, antigos }
}
