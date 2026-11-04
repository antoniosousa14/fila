import { expect, test } from 'claude-code/testing'

import { ordenar, pontuar } from '../src/ranker'
import type { Classificacao, Importancia, Item } from '../types'

const classe = (importancia: Importancia, extra: Partial<Classificacao> = {}): Classificacao => ({
  importancia,
  tipo: 'revisao',
  esforco: 'minutos',
  desbloqueia: false,
  rotulo: 'rever',
  cartao: { pediste: '', fez: '', precisa: '' },
  ...extra,
})

const item = (sessao: string, desde: number, classificacao?: Classificacao): Item => ({
  sessao,
  titulo: sessao,
  projeto: 'p',
  estado: 'a-espera',
  desde,
  classificacao,
})

const MIN = 60_000

test('um baixo que espera 2h30 passa um médio acabado de chegar', () => {
  expect(pontuar(classe(2), 150) > pontuar(classe(3), 0)).toBe(true)
})

test('um baixo nunca passa um alto só por esperar', () => {
  expect(pontuar(classe(2), 100_000) < pontuar(classe(5), 0)).toBe(true)
})

test('um desbloqueio de segundos sobe', () => {
  const rapido = classe(3, { desbloqueia: true, esforco: 'segundos' })
  expect(pontuar(rapido, 0) > pontuar(classe(3), 0)).toBe(true)
})

test('sem classificação conta como importância 3', () => {
  expect(pontuar(undefined, 0)).toBe(pontuar(classe(3), 0))
})

test('ordenar põe o de mais pontos primeiro', () => {
  const agora = 1_000 * MIN
  const linhas = ordenar([item('baixo', agora, classe(2)), item('alto', agora, classe(5))], undefined, agora)
  expect(linhas.map(l => l.sessao).join()).toBe('alto,baixo')
})

test('com foco de importância 4, os abaixo ficam silenciados e vão para o fim', () => {
  const agora = 1_000 * MIN
  const linhas = ordenar(
    [item('baixo', agora, classe(2)), item('alto', agora, classe(5)), item('medio', agora, classe(3))],
    4,
    agora,
  )
  expect(linhas.map(l => `${l.sessao}:${l.silenciado}`).join()).toBe('alto:false,medio:true,baixo:true')
})

test('foco abaixo de 4 não silencia nada', () => {
  const agora = 1_000 * MIN
  const linhas = ordenar([item('baixo', agora, classe(2))], 3, agora)
  expect(linhas[0].silenciado).toBe(false)
})

test('empate desfeito pelo que espera há mais tempo', () => {
  const agora = 1_000 * MIN
  const linhas = ordenar(
    [item('novo', agora - 1 * MIN, classe(3)), item('velho', agora - 5 * MIN, classe(3))],
    undefined,
    agora,
  )
  expect(linhas.map(l => l.sessao).join()).toBe('velho,novo')
})

test('o tempo à espera conta em degraus de 10 min (ordem estável)', () => {
  const agora = 1_000 * MIN
  const [a] = ordenar([item('a', agora - 1 * MIN, classe(3))], undefined, agora)
  const [b] = ordenar([item('b', agora - 9 * MIN, classe(3))], undefined, agora)
  expect(a.pontos).toBe(b.pontos)
})
