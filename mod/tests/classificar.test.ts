import { expect, test } from 'claude-code/testing'

import { lerClassificacao, montarPrompt } from '../src/classificar'

const valido = {
  importancia: 5,
  tipo: 'aprovacao',
  esforco: 'segundos',
  desbloqueia: true,
  rotulo: 'aprovar deploy',
  cartao: { pediste: 'permissões', fez: 'regras e testes', precisa: 'aprovar deploy' },
}

test('lê JSON simples', () => {
  const c = lerClassificacao(JSON.stringify(valido))
  expect(c?.importancia).toBe(5)
  expect(c?.rotulo).toBe('aprovar deploy')
  expect(c?.cartao.precisa).toBe('aprovar deploy')
})

test('lê JSON dentro de um bloco de código', () => {
  const c = lerClassificacao('```json\n' + JSON.stringify(valido) + '\n```')
  expect(c?.tipo).toBe('aprovacao')
})

test('texto sem JSON dá undefined', () => {
  expect(lerClassificacao('não sei')).toBe(undefined)
})

test('JSON sem importância dá undefined', () => {
  expect(lerClassificacao('{"tipo":"info"}')).toBe(undefined)
})

test('valores fora do intervalo são corrigidos', () => {
  const c = lerClassificacao(
    JSON.stringify({ ...valido, importancia: 9, tipo: 'outro', esforco: 'x', desbloqueia: 'sim' }),
  )
  expect(c?.importancia).toBe(5)
  expect(c?.tipo).toBe('info')
  expect(c?.esforco).toBe('minutos')
  expect(c?.desbloqueia).toBe(false)
})

test('o prompt corta o pedido no início e a resposta no fim', () => {
  const prompt = montarPrompt('farol', 'p'.repeat(3000), 'r'.repeat(5000) + 'FIM')
  expect(prompt.includes('p'.repeat(2001))).toBe(false)
  expect(prompt.endsWith('FIM')).toBe(true)
  expect(prompt.startsWith('Projeto: farol')).toBe(true)
})

test('lê o que ficou feito e o que falta, com prioridade', () => {
  const c = lerClassificacao(JSON.stringify({
    ...valido,
    feito: ['Retirada a build 7', '  ', 'Corrigido o link'],
    falta: [{ texto: 'Reenviar à Apple', prioridade: 5 }, { texto: 'Atualizar o README' }, 'só texto', { texto: 'x', prioridade: 99 }, { prioridade: 2 }],
  }))
  expect(c?.feito).toEqual(['Retirada a build 7', 'Corrigido o link'])
  expect(c?.falta).toEqual([
    { texto: 'Reenviar à Apple', prioridade: 5 },
    { texto: 'Atualizar o README', prioridade: 3 },
    { texto: 'só texto', prioridade: 3 },
    { texto: 'x', prioridade: 5 },
  ])
})

test('feito e falta só existem se o modelo os devolveu', () => {
  const c = lerClassificacao(JSON.stringify(valido))
  expect(c?.feito).toBe(undefined)
  expect(c?.falta).toBe(undefined)
  const vazio = lerClassificacao(JSON.stringify({ ...valido, feito: [], falta: [] }))
  expect(vazio?.feito).toEqual([])
  expect(vazio?.falta).toEqual([])
})

test('no máximo 3 feitos e 4 faltas', () => {
  const c = lerClassificacao(JSON.stringify({
    ...valido,
    feito: ['a', 'b', 'c', 'd', 'e'],
    falta: Array.from({ length: 9 }, (_, i) => ({ texto: `f${i}`, prioridade: 2 })),
  }))
  expect(c?.feito?.length).toBe(3)
  expect(c?.falta?.length).toBe(4)
})
