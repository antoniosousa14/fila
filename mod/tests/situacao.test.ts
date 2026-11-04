import { expect, test } from 'claude-code/testing'

import { juntarSituacao, MAX_FEITO } from '../src/situacao'
import type { Classificacao, Situacao } from '../types'

const base = { sessao: 's1', local: 'local_1', titulo: 'Gaivota', projeto: 'gaivota' }
const classe = (extra: Partial<Classificacao>): Classificacao => ({
  importancia: 3, tipo: 'info', esforco: 'minutos', desbloqueia: false, rotulo: 'x',
  cartao: { pediste: '', fez: '', precisa: '' }, ...extra,
})

test('sem feito nem falta na classificação não escreve nada', () => {
  expect(juntarSituacao(undefined, base, classe({}), 10)).toBe(undefined)
  expect(juntarSituacao(undefined, base, undefined, 10)).toBe(undefined)
})

test('a primeira situação traz o feito do turno e o que falta', () => {
  const s = juntarSituacao(undefined, base, classe({ feito: ['Retirada a build 7'], falta: [{ texto: 'Reenviar à Apple', prioridade: 5 }] }), 100)
  expect(s?.feito).toEqual([{ texto: 'Retirada a build 7', em: 100 }])
  expect(s?.falta).toEqual([{ texto: 'Reenviar à Apple', prioridade: 5 }])
  expect(s?.em).toBe(100)
  expect(s?.local).toBe('local_1')
})

test('o feito acumula-se (o mais recente primeiro) sem repetir; o que falta substitui-se', () => {
  const antes = juntarSituacao(undefined, base, classe({ feito: ['A', 'B'], falta: [{ texto: 'X', prioridade: 2 }] }), 100) as Situacao
  const depois = juntarSituacao(antes, base, classe({ feito: ['b', 'C'], falta: [{ texto: 'Y', prioridade: 4 }] }), 200) as Situacao
  expect(depois.feito.map(f => f.texto)).toEqual(['C', 'A', 'B'])
  expect(depois.feito.find(f => f.texto === 'C')?.em).toBe(200)
  expect(depois.feito.find(f => f.texto === 'A')?.em).toBe(100)
  expect(depois.falta).toEqual([{ texto: 'Y', prioridade: 4 }])
})

test('falta vazio limpa o que faltava; falta ausente mantém-no', () => {
  const antes = juntarSituacao(undefined, base, classe({ feito: ['A'], falta: [{ texto: 'X', prioridade: 2 }] }), 100) as Situacao
  expect(juntarSituacao(antes, base, classe({ falta: [] }), 200)?.falta).toEqual([])
  expect(juntarSituacao(antes, base, classe({ feito: ['B'] }), 200)?.falta).toEqual([{ texto: 'X', prioridade: 2 }])
})

test('o feito tem um máximo', () => {
  let s: Situacao | undefined
  for (let i = 0; i < MAX_FEITO + 5; i++) s = juntarSituacao(s, base, classe({ feito: [`coisa ${i}`] }), i)
  expect(s?.feito.length).toBe(MAX_FEITO)
  expect(s?.feito[0].texto).toBe(`coisa ${MAX_FEITO + 4}`)
})
