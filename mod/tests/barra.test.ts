import { expect, test } from 'claude-code/testing'

import { COR, haQuanto, modeloDaBarra } from '../src/barra'
import type { Importancia, Linha, Vista } from '../types'

const MIN = 60_000
const agora = 10_000 * MIN

const linha = (sessao: string, importancia: Importancia, extra: Partial<Linha> = {}): Linha => ({
  sessao,
  local: `local_${sessao}`,
  titulo: `t-${sessao}`,
  projeto: `proj-${sessao}`,
  desde: agora - 5 * MIN,
  pontos: 0,
  silenciado: false,
  classificacao: {
    importancia,
    tipo: 'aprovacao',
    esforco: 'segundos',
    desbloqueia: true,
    rotulo: `rot-${sessao}`,
    cartao: { pediste: 'pedi', fez: 'fez', precisa: 'precisa' },
  },
  ...extra,
})

const vista = (fila: Linha[], antigos: Linha[] = [], extra: Partial<Vista> = {}): Vista => ({
  fila,
  antigos,
  aTrabalhar: 2,
  calculadaEm: agora,
  ...extra,
})

test('sem vista, a faixa está vazia', () => {
  const m = modeloDaBarra(null, false)
  expect(m.vazia && m.resumo).toBe('Nada à tua espera · 0 a trabalhar')
})

test('fila vazia mostra quantos trabalham', () => {
  const m = modeloDaBarra(vista([]), false)
  expect(m.vazia && m.resumo).toBe('Nada à tua espera · 2 a trabalhar')
})

test('mostra 3 chips numerados e conta o resto', () => {
  const m = modeloDaBarra(vista([linha('a', 5), linha('b', 3), linha('c', 2), linha('d', 2)], [linha('e', 1)]), false)
  if (m.vazia) throw new Error('não devia estar vazia')
  expect(m.chips.map(c => `${c.numero}:${c.texto}`).join('|')).toBe(
    '1:proj-a · rot-a|2:proj-b · rot-b|3:proj-c · rot-c',
  )
  expect(m.mais).toBe(2)
  expect(m.cabeca).toBe('4 à espera')
  expect(m.extra.length).toBe(0)
})

test('cor pela importância e esforço curto', () => {
  const m = modeloDaBarra(vista([linha('a', 5), linha('b', 3), linha('c', 1)]), false)
  if (m.vazia) throw new Error('não devia estar vazia')
  expect(m.chips.map(c => c.cor).join()).toBe([COR.alta, COR.media, COR.baixa].join())
  expect(m.chips[0].nota).toBe('5s')
})

test('cartão com as três linhas e o tempo à espera', () => {
  const m = modeloDaBarra(vista([linha('a', 5)]), false)
  if (m.vazia) throw new Error('não devia estar vazia')
  expect(m.chips[0].cartao?.join('|')).toBe('Pediste: pedi|Fez: fez|Precisa de ti: precisa|À espera há 5 min')
})

test('sem classificação usa o título e não tem cartão', () => {
  const m = modeloDaBarra(vista([linha('a', 3, { classificacao: undefined })]), false)
  if (m.vazia) throw new Error('não devia estar vazia')
  expect(m.chips[0].texto).toBe('proj-a · t-a')
  expect(m.chips[0].cartao).toBe(undefined)
})

test('Próximo salta os silenciados; foco aparece na cabeça', () => {
  const m = modeloDaBarra(
    vista([linha('a', 2, { silenciado: true }), linha('b', 5)], [], { foco: { titulo: 'Leads Porto', importancia: 5 } }),
    false,
  )
  if (m.vazia) throw new Error('não devia estar vazia')
  expect(m.proximo?.sessao).toBe('b')
  expect(m.chips[0].cor).toBe(COR.baixa)
  expect(m.cabeca).toBe('Foco: Leads Porto')
})

test('Próximo usa um antigo quando a fila está vazia', () => {
  const m = modeloDaBarra(vista([], [linha('velho', 2)]), false)
  if (m.vazia) throw new Error('não devia estar vazia')
  expect(m.proximo?.sessao).toBe('velho')
})

test('lista aberta mostra o resto com o tempo à espera', () => {
  const m = modeloDaBarra(
    vista([linha('a', 5), linha('b', 5), linha('c', 5), linha('d', 5)], [linha('e', 1, { desde: agora - 80 * MIN })]),
    true,
  )
  if (m.vazia) throw new Error('não devia estar vazia')
  expect(m.extra.map(c => `${c.texto}:${c.nota}`).join('|')).toBe('proj-d · rot-d:há 5 min|proj-e · rot-e:há 1h20')
})

test('haQuanto', () => {
  expect(haQuanto(0)).toBe('há 0 min')
  expect(haQuanto(59 * MIN)).toBe('há 59 min')
  expect(haQuanto(125 * MIN)).toBe('há 2h05')
})
