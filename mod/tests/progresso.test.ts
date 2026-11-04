import { expect, test } from 'claude-code/testing'

import { aplicarPlano, contaComoAcao, descreverFerramenta, resumoDosPassos } from '../src/progresso'
import type { Passo } from '../types'

const estados = (passos: Passo[]) => passos.map(p => p.estado[0]).join('')

const plano = aplicarPlano([], {
  items: [
    { content: 'Ler', status: 'in_progress' },
    { content: 'Escrever', status: 'pending' },
    { content: 'Testar', status: 'pending' },
  ],
})

test('items substitui a lista', () => {
  expect(plano.map(p => p.texto).join()).toBe('Ler,Escrever,Testar')
  expect(estados(plano)).toBe('ipp')
})

test('advance conclui o atual e começa o seguinte', () => {
  expect(estados(aplicarPlano(plano, { advance: true }))).toBe('cip')
})

test('advance no último conclui tudo', () => {
  const quase = aplicarPlano(aplicarPlano(plano, { advance: true }), { advance: true })
  expect(estados(aplicarPlano(quase, { advance: true }))).toBe('ccc')
})

test('done e start fora de ordem', () => {
  expect(estados(aplicarPlano(plano, { done: [1], start: 3 }))).toBe('cpi')
})

test('estado inválido conta como pending', () => {
  expect(estados(aplicarPlano([], { items: [{ content: 'x', status: 'feito' }] }))).toBe('p')
})

test('resumo dos passos', () => {
  const r = resumoDosPassos(aplicarPlano(plano, { advance: true }))
  expect(`${r.feitos}/${r.total} ${r.atual}`).toBe('1/3 Escrever')
})

test('descreve ferramentas com o pormenor útil', () => {
  expect(descreverFerramenta('Edit', { file_path: 'C:\\x\\mod\\hooks\\register.tsx' })).toBe('Edit register.tsx')
  expect(descreverFerramenta('Bash', { command: 'npm   test\n --watch' })).toBe('Bash npm test --watch')
  expect(descreverFerramenta('mcp__ccd_session_mgmt__list_sessions', {})).toBe('list_sessions')
})

test('o plano e o wrap_up não contam como ação', () => {
  expect(contaComoAcao('mcp__ccd_turn__update_plan')).toBe(false)
  expect(contaComoAcao('mcp__ccd_turn__wrap_up')).toBe(false)
  expect(contaComoAcao('Edit')).toBe(true)
})
