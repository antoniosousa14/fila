import { expect, test } from 'claude-code/testing'

import { enderecos, EXPIRA_MS, INTERROMPIDO_MS, lerPedido, porTratar, resultadoDoEnvio, todosFalharam } from '../src/carteiro'

const S1 = '0b54afaf-1cd9-4363-a7fa-f4060321a4fe'
const L1 = 'local_1d654087-8b79-4235-b91f-aecc4474fc2a'
const L2 = 'local_9a266efa-1601-4a6d-b5d3-e72ab68521e2'
const f = (name: string, mtimeMs = 0) => ({ name, kind: 'file', mtimeMs })

test('por tratar: pedidos sem marca nem resultado; a meio há muito contam como interrompidos', () => {
  const agora = 100 * INTERROMPIDO_MS
  const entradas = [
    f('m_aaaaaa1.json'),
    f('m_bbbbbb2.json'), f('m_bbbbbb2.resultado.json'),
    f('m_cccccc3.json'), f('m_cccccc3.a-enviar.json', agora - 60_000),
    f('m_dddddd4.json'), f('m_dddddd4.a-enviar.json', agora - INTERROMPIDO_MS - 1),
    f('m_eeeeee5.tmp'), f('outro.json'), f('m_../x.json'), { name: 'm_ffffff6.json', kind: 'dir', mtimeMs: 0 },
  ]
  expect(porTratar(entradas, agora)).toEqual({ novos: ['m_aaaaaa1'], interrompidos: ['m_dddddd4'] })
})

test('ler pedido: só bem formado, com o id do ficheiro, chats local_, sessões em UUID e texto com tamanho', () => {
  const bom = { id: 'm_aaaaaa1', em: 5, para: [L1, L2, L1], sessoes: { [L1]: S1, [L2]: '../x', lixo: S1 }, texto: '  Ponto de situação?  ' }
  expect(lerPedido(JSON.stringify(bom), 'm_aaaaaa1')).toEqual({ id: 'm_aaaaaa1', em: 5, para: [L1, L2], sessoes: { [L1]: S1 }, texto: 'Ponto de situação?' })
  expect(lerPedido(JSON.stringify(bom), 'm_outroo1')).toBe(undefined)
  expect(lerPedido(JSON.stringify({ ...bom, para: [S1] }), 'm_aaaaaa1')).toBe(undefined)
  expect(lerPedido(JSON.stringify({ ...bom, para: ['local_../x'] }), 'm_aaaaaa1')).toBe(undefined)
  expect(lerPedido(JSON.stringify({ ...bom, para: [] }), 'm_aaaaaa1')).toBe(undefined)
  expect(lerPedido(JSON.stringify({ ...bom, texto: '   ' }), 'm_aaaaaa1')).toBe(undefined)
  expect(lerPedido(JSON.stringify({ ...bom, texto: 'x'.repeat(4001) }), 'm_aaaaaa1')).toBe(undefined)
  expect(lerPedido('{', 'm_aaaaaa1')).toBe(undefined)
})

test('endereços: primeiro o local_, depois a sessão do CLI quando há', () => {
  const pedido = lerPedido(JSON.stringify({ id: 'm_aaaaaa1', em: 5, para: [L1, L2], sessoes: { [L1]: S1 }, texto: 'x' }), 'm_aaaaaa1')!
  expect(enderecos(pedido, L1)).toEqual([L1, { sessionId: S1 }])
  expect(enderecos(pedido, L2)).toEqual([L2])
})

test('resultados: entregue, recusado com o motivo, ou todos falhados', () => {
  expect(resultadoDoEnvio(L1, { isDelivered: true })).toEqual({ local: L1, entregue: true, motivo: '' })
  expect(resultadoDoEnvio(L1, { isDelivered: false, reason: 'not running' })).toEqual({ local: L1, entregue: false, motivo: 'not running' })
  expect(todosFalharam([L1, L2], 'expirou')).toEqual([
    { local: L1, entregue: false, motivo: 'expirou' },
    { local: L2, entregue: false, motivo: 'expirou' },
  ])
  expect(EXPIRA_MS).toBe(30 * 60_000)
})
