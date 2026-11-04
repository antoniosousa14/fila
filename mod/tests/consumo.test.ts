import { expect, test } from 'claude-code/testing'

import { diaLocal, juntarAoDia, MAX_POR_DIA, registoDoTurno } from '../src/consumo'

const limites = [
  { kind: 'five_hour', percentUsed: 42, resetsAt: '2026-11-03T13:40:00Z' },
  { kind: 'seven_day', percentUsed: 61.5, resetsAt: '2026-11-07T09:00:00Z' },
]

test('dia local em AAAA-MM-DD', () => {
  expect(diaLocal(new Date(2026, 10, 3, 23, 59).getTime())).toBe('2026-11-03')
  expect(diaLocal(new Date(2026, 0, 9, 0, 1).getTime())).toBe('2026-01-09')
})

test('registo do turno: tokens sem a leitura de cache, que vai à parte, e os limites', () => {
  const r = registoDoTurno({
    em: 5,
    sessao: 's1',
    uso: { input_tokens: 10, output_tokens: 200, cache_creation_input_tokens: 30, cache_read_input_tokens: 9000 },
    limites,
  })
  expect(r).toEqual({ em: 5, sessao: 's1', tokens: 240, cache: 9000, limites })
})

test('sem tokens nem limites não há registo; limites estranhos saem', () => {
  expect(registoDoTurno({ em: 1, sessao: 's', limites: [] })).toBe(undefined)
  const r = registoDoTurno({ em: 1, sessao: 's', limites: [{ kind: 'seven_day', percentUsed: Number.NaN }, { kind: 'five_hour', percentUsed: 3 }] })
  expect(r?.limites).toEqual([{ kind: 'five_hour', percentUsed: 3 }])
  expect(r?.tokens).toBe(0)
})

test('juntar ao dia: acrescenta, recomeça um ficheiro estragado e corta no máximo', () => {
  const r = registoDoTurno({ em: 1, sessao: 's', limites })!
  expect(JSON.parse(juntarAoDia(undefined, r))).toEqual([r])
  expect(JSON.parse(juntarAoDia(JSON.stringify([r]), { ...r, em: 2 })).map((x: { em: number }) => x.em)).toEqual([1, 2])
  expect(JSON.parse(juntarAoDia('[{"em":1', r))).toEqual([r])
  expect(JSON.parse(juntarAoDia('{"nao":"lista"}', r))).toEqual([r])
  const cheio = JSON.stringify(Array.from({ length: MAX_POR_DIA }, (_, i) => ({ ...r, em: i })))
  const cortado = JSON.parse(juntarAoDia(cheio, { ...r, em: -1 }))
  expect(cortado).toHaveLength(MAX_POR_DIA)
  expect(cortado[0].em).toBe(1)
  expect(cortado[MAX_POR_DIA - 1].em).toBe(-1)
})
