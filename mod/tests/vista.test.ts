import { expect, test } from 'claude-code/testing'

import { montarVista } from '../src/vista'
import type { Classificacao, EstadoItem, Importancia, Item } from '../types'

const H = 3_600_000
const agora = 1_000 * H

const classe = (importancia: Importancia): Classificacao => ({
  importancia,
  tipo: 'revisao',
  esforco: 'minutos',
  desbloqueia: false,
  rotulo: 'r',
  cartao: { pediste: '', fez: '', precisa: '' },
})

const item = (sessao: string, estado: EstadoItem, desde: number, importancia?: Importancia): Item => ({
  sessao,
  titulo: `t-${sessao}`,
  projeto: 'p',
  estado,
  desde,
  classificacao: importancia ? classe(importancia) : undefined,
})

test('o próprio chat não aparece na sua faixa', () => {
  const v = montarVista({
    itens: [item('eu', 'a-espera', agora), item('outro', 'a-espera', agora)],
    dispensados: {},
    propria: 'eu',
    agora,
  })
  expect(v.fila.map(l => l.sessao).join()).toBe('outro')
})

test('um dispensado não aparece até haver um turno novo', () => {
  const itens = [item('a', 'a-espera', agora - H)]
  expect(montarVista({ itens, dispensados: { a: agora - H }, propria: 'eu', agora }).fila.length).toBe(0)
  expect(montarVista({ itens, dispensados: { a: agora - 2 * H }, propria: 'eu', agora }).fila.length).toBe(1)
})

test('conta os que estão a trabalhar', () => {
  const v = montarVista({
    itens: [item('a', 'a-trabalhar', agora), item('b', 'a-trabalhar', agora), item('c', 'a-espera', agora)],
    dispensados: {},
    propria: 'eu',
    agora,
  })
  expect(v.aTrabalhar).toBe(2)
})

test('um chat a trabalhar há mais de 3h deixa de contar', () => {
  const v = montarVista({
    itens: [item('ativo', 'a-trabalhar', agora - H), item('abandonado', 'a-trabalhar', agora - 4 * H)],
    dispensados: {},
    propria: 'eu',
    agora,
  })
  expect(v.aTrabalhar).toBe(1)
})

test('foco só aparece com importância 4 ou mais', () => {
  const foco = { sessao: 'f', em: agora }
  const alto = montarVista({ itens: [item('f', 'a-trabalhar', agora, 4)], dispensados: {}, foco, propria: 'f', agora })
  const medio = montarVista({ itens: [item('f', 'a-trabalhar', agora, 3)], dispensados: {}, foco, propria: 'f', agora })
  expect(alto.foco?.titulo).toBe('t-f')
  expect(medio.foco).toBe(undefined)
})

test('itens com mais de 7 dias são ignorados', () => {
  const v = montarVista({ itens: [item('velho', 'a-espera', agora - 8 * 24 * H, 5)], dispensados: {}, propria: 'eu', agora })
  expect(v.fila.length + v.antigos.length).toBe(0)
})

test('guarda o instante em que foi calculada', () => {
  expect(montarVista({ itens: [], dispensados: {}, propria: 'eu', agora }).calculadaEm).toBe(agora)
})
