import type { Foco, Item, Vista } from '../types'
import { inicioDaSessao, separar, VALIDADE_MS } from './janela'
import { ordenar } from './ranker'

// Um chat fechado a meio de um turno nunca chega a "a-espera"; passado este tempo deixa de contar.
export const TRABALHO_MAX_MS = 3 * 3_600_000

export type Entrada = {
  itens: Item[]
  dispensados: Record<string, number>
  foco?: Foco
  propria: string
  agora: number
}

export function montarVista({ itens, dispensados, foco, propria, agora }: Entrada): Vista {
  const validos = itens.filter(item => agora - item.desde < VALIDADE_MS)
  const aEspera = validos.filter(
    item => item.estado === 'a-espera' && item.sessao !== propria && dispensados[item.sessao] !== item.desde,
  )
  const focado = foco ? validos.find(item => item.sessao === foco.sessao) : undefined
  const focoImportancia = focado?.classificacao?.importancia
  const linhas = ordenar(aEspera, focoImportancia, agora)
  const atividade = [...validos.map(item => item.desde), ...(foco ? [foco.em] : [])]
  const { fila, antigos } = separar(linhas, inicioDaSessao(atividade, agora))

  return {
    fila,
    antigos,
    aTrabalhar: validos.filter(item => item.estado === 'a-trabalhar' && agora - item.desde < TRABALHO_MAX_MS).length,
    foco:
      focado && focoImportancia !== undefined && focoImportancia >= 4
        ? { titulo: focado.titulo, importancia: focoImportancia }
        : undefined,
    calculadaEm: agora,
  }
}
