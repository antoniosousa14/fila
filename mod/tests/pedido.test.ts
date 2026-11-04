import { expect, test } from 'claude-code/testing'

import { limparPedido } from '../src/pedido'

test('tira os blocos que a app injeta e deixa o que a pessoa escreveu', () => {
  const texto = '<system-reminder>\nContexto da app\n</system-reminder>\n<system-reminder>outro</system-reminder>Corrige o CI\nda agenda'
  expect(limparPedido(texto)).toBe('Corrige o CI da agenda')
  expect(limparPedido('<task-notification><task-id>x</task-id></task-notification> ok')).toBe('ok')
})

test('um bloco por fechar vai até ao fim; texto normal fica igual', () => {
  expect(limparPedido('Faz isto <system-reminder>sem fim')).toBe('Faz isto')
  expect(limparPedido('  a < b e c > d  ')).toBe('a < b e c > d')
  expect(limparPedido('')).toBe('')
})
