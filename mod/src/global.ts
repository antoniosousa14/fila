import type { Foco, Item, Trabalho } from '../types'
import { modeloDaBarra } from './barra'
import type { ModeloBarra } from './barra'
import { resumoDosPassos } from './progresso'
import { montarVista, TRABALHO_MAX_MS } from './vista'

export type Dados = { itens: Item[]; dispensados: Record<string, number>; foco?: Foco }

// A barra do topo do ecrã serve todos os chats: esconde o chat onde a pessoa está
// (o último onde escreveu) e traz já a lista do resto aberta.
export function barraGlobal(dados: Dados, agora: number): ModeloBarra {
  return modeloDaBarra(montarVista({ ...dados, propria: dados.foco?.sessao ?? '', agora }), true)
}

// Os chats a trabalhar, do que começou há mais tempo para o mais recente, com o progresso. Um dispensado
// (o gestor dispensa o que ficou preso, por exemplo depois de um /clear) só volta com um turno novo.
export function trabalhoGlobal(itens: Item[], agora: number, dispensados: Record<string, number> = {}): Trabalho[] {
  return itens
    .filter(item => item.estado === 'a-trabalhar' && agora - item.desde < TRABALHO_MAX_MS && dispensados[item.sessao] !== item.desde)
    .sort((a, b) => a.desde - b.desde)
    .map(item => {
      const { feitos, total, atual } = resumoDosPassos(item.progresso?.passos ?? [])

      return {
        sessao: item.sessao,
        local: item.local,
        titulo: item.titulo,
        projeto: item.projeto,
        desde: item.desde,
        pedido: item.pedido ?? '',
        feitos,
        total,
        atual,
        ferramentas: item.progresso?.ferramentas ?? 0,
        ultima: item.progresso?.ultima,
      }
    })
}
