import { expect, test } from 'claude-code/testing'

import { barraGlobal, trabalhoGlobal } from '../src/global'
import type { EstadoItem, Item } from '../types'

const MIN = 60_000
const agora = 10_000 * MIN

const item = (sessao: string, estado: EstadoItem, desde = agora - 5 * MIN): Item => ({
  sessao,
  titulo: `t-${sessao}`,
  projeto: `proj-${sessao}`,
  estado,
  desde,
})

test('esconde o chat em foco e mostra os outros', () => {
  const m = barraGlobal(
    { itens: [item('a', 'a-espera'), item('b', 'a-espera')], dispensados: {}, foco: { sessao: 'a', em: agora } },
    agora,
  )
  if (m.vazia) throw new Error('não devia estar vazia')
  expect(m.chips.map(c => c.sessao).join()).toBe('b')
})

test('sem foco mostra todos', () => {
  const m = barraGlobal({ itens: [item('a', 'a-espera'), item('b', 'a-espera')], dispensados: {} }, agora)
  if (m.vazia) throw new Error('não devia estar vazia')
  expect(m.chips.length).toBe(2)
})

test('trabalho: só os ativos, do mais antigo para o mais recente, com progresso', () => {
  const comPlano: Item = {
    ...item('b', 'a-trabalhar', agora - 2 * MIN),
    pedido: 'cruzar leads',
    progresso: {
      passos: [
        { texto: 'Ler', estado: 'completed' },
        { texto: 'Escrever', estado: 'in_progress' },
      ],
      ferramentas: 7,
      ultima: 'Edit x.ts',
    },
  }
  const lista = trabalhoGlobal(
    [comPlano, item('a', 'a-trabalhar', agora - 9 * MIN), item('c', 'a-espera'), item('velho', 'a-trabalhar', agora - 300 * MIN)],
    agora,
  )
  expect(lista.map(t => t.sessao).join()).toBe('a,b')
  expect(`${lista[1].feitos}/${lista[1].total} ${lista[1].atual} ${lista[1].ferramentas} ${lista[1].ultima}`).toBe(
    '1/2 Escrever 7 Edit x.ts',
  )
  expect(lista[1].pedido).toBe('cruzar leads')
})

test('trabalho: um dispensado sai até haver um turno novo', () => {
  const preso = item('preso', 'a-trabalhar', agora - 20 * MIN)
  const outro = item('outro', 'a-trabalhar', agora - 5 * MIN)
  expect(trabalhoGlobal([preso, outro], agora, { preso: preso.desde }).map(t => t.sessao).join()).toBe('outro')
  // A dispensa é de um turno antigo: o turno de agora conta.
  expect(trabalhoGlobal([preso, outro], agora, { preso: preso.desde - MIN }).map(t => t.sessao).join()).toBe('preso,outro')
})

test('traz a lista do resto já aberta', () => {
  const itens = ['a', 'b', 'c', 'd'].map(s => item(s, 'a-espera'))
  const m = barraGlobal({ itens, dispensados: {} }, agora)
  if (m.vazia) throw new Error('não devia estar vazia')
  expect(m.extra.length).toBe(1)
})
