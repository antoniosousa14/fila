import type { Classificacao, Item, Linha } from '../types'

export const IMPORTANCIA_PADRAO = 3

// A pontuação de um item à espera; quanto maior, mais acima na fila.
// Tem de cumprir os quatro primeiros testes de tests/ranker.test.ts.
export function pontuar(classificacao: Classificacao | undefined, minutosAEspera: number): number {
  const importancia = classificacao?.importancia ?? IMPORTANCIA_PADRAO
  const rapido = classificacao?.desbloqueia === true && classificacao.esforco === 'segundos' ? 8 : 0

  return importancia * 10 + rapido + Math.min(minutosAEspera / 10, 15)
}

export function ordenar(itens: Item[], focoImportancia: number | undefined, agora: number): Linha[] {
  const linhas = itens.map(item => {
    const importancia = item.classificacao?.importancia ?? IMPORTANCIA_PADRAO
    const minutos = Math.floor(Math.max(0, agora - item.desde) / 600_000) * 10

    return {
      sessao: item.sessao,
      local: item.local,
      titulo: item.titulo,
      projeto: item.projeto,
      desde: item.desde,
      classificacao: item.classificacao,
      pontos: pontuar(item.classificacao, minutos),
      silenciado: focoImportancia !== undefined && focoImportancia >= 4 && importancia < focoImportancia,
    }
  })

  return linhas.sort(
    (a, b) => Number(a.silenciado) - Number(b.silenciado) || b.pontos - a.pontos || a.desde - b.desde,
  )
}
