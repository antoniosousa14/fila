import { expect, test } from 'claude-code/testing'

import { inicioDaSessao, separar } from '../src/janela'
import type { Importancia, Linha } from '../types'

const H = 3_600_000
const agora = 100 * H

const linha = (sessao: string, desde: number, importancia?: Importancia): Linha => ({
  sessao,
  titulo: sessao,
  projeto: 'p',
  desde,
  pontos: 0,
  silenciado: false,
  classificacao: importancia
    ? {
        importancia,
        tipo: 'info',
        esforco: 'minutos',
        desbloqueia: false,
        rotulo: '',
        cartao: { pediste: '', fez: '', precisa: '' },
      }
    : undefined,
})

test('atividade contínua: a sessão começa no primeiro evento', () => {
  const eventos = [agora - 10 * H, agora - 7 * H, agora - 4 * H, agora - 1 * H]
  expect(inicioDaSessao(eventos, agora)).toBe(agora - 10 * H)
})

test('uma pausa de mais de 4h reinicia a sessão', () => {
  const eventos = [agora - 12 * H, agora - 11 * H, agora - 2 * H, agora - 1 * H]
  expect(inicioDaSessao(eventos, agora)).toBe(agora - 2 * H)
})

test('sem eventos, a sessão começa agora', () => {
  expect(inicioDaSessao([], agora)).toBe(agora)
})

test('baixo de antes da sessão vai para antigos; alto fica; recente fica', () => {
  const inicio = agora - 2 * H
  const { fila, antigos } = separar(
    [linha('velho-baixo', agora - 5 * H, 2), linha('velho-alto', agora - 5 * H, 4), linha('novo', agora - 1 * H, 2)],
    inicio,
  )
  expect(fila.map(l => l.sessao).join()).toBe('velho-alto,novo')
  expect(antigos.map(l => l.sessao).join()).toBe('velho-baixo')
})
