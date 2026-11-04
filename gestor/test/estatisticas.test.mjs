import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { custoDe, intervalosAtivos, juntar, porDia, precoDe, resumirHistorico, subtrair } from '../lib/estatisticas.mjs'

const precos = JSON.parse(readFileSync(join(fileURLToPath(import.meta.url), '..', '..', 'precos.json'), 'utf8'))
const MIN = 60_000
const H = 60 * MIN
const agora = new Date(2026, 10, 3, 12, 0).getTime()
const ontem = new Date(2026, 10, 2, 12, 0).getTime()
const t = (x = {}) => ({ entrada: 0, saida: 0, cache5m: 0, cache1h: 0, leitura: 0, respostas: 1, ...x })

test('preços: tabela, modo rápido com os multiplicadores de cache, Haiku 5.5 longo, e sem preço', () => {
  assert.equal(custoDe(precos, 'claude-opus-5-5', t({ entrada: 1e6, saida: 1e6, cache5m: 1e6, cache1h: 1e6, leitura: 1e6 })), 4 + 20 + 5 + 8 + 0.2)
  const rapido = precoDe(precos, 'claude-opus-5-5#rapido')
  assert.deepEqual([rapido.entrada, rapido.saida, rapido.cache5m, rapido.cache1h], [8, 40, 10, 16])
  assert.ok(Math.abs(rapido.leitura - 0.4) < 1e-9)
  assert.equal(custoDe(precos, 'claude-haiku-5-5#longo', t({ saida: 1e6 })), 2.5)
  assert.equal(custoDe(precos, 'claude-sonnet-5-5#rapido', t({ saida: 1 })), null)
  assert.equal(custoDe(precos, 'claude-desconhecido', t({ saida: 1 })), null)
  assert.match(precos.fonte, /^https:\/\/platform\.claude\.com\//)
})

test('intervalos: juntar, subtrair e cortar à meia-noite', () => {
  assert.deepEqual(juntar([[5, 9], [1, 3], [2, 6]]), [[1, 9]])
  assert.deepEqual(subtrair([[0, 10], [20, 30]], [[2, 4], [8, 22]]), [[0, 2], [4, 8], [22, 30]])
  const antes = new Date(2026, 10, 2, 23, 30).getTime()
  const m = porDia([[antes, antes + H]])
  assert.deepEqual([...m.values()], [30 * MIN, 30 * MIN])
})

test('ativo: entre mensagens a menos de 15 min; uma sozinha conta 2 min', () => {
  const b = agora
  assert.deepEqual(intervalosAtivos([b, b + 10 * MIN, b + 60 * MIN]), [[b, b + 10 * MIN], [b + 58 * MIN, b + 60 * MIN]])
})

const sessoes = [{ local: 'local_a', cli: 'cli-a', clis: ['cli-a', 'cli-velha'], titulo: 'Dinamo app', arquivado: false }]
const grupos = [{ id: 'cg-d', nome: 'Dinamo', caminho: 'Apps / Dinamo' }]
const estado = (sessao, dias, extra = {}) => ({ sessaoDoFicheiro: sessao, sessao, subagente: false, cwd: 'C:\\x\\caravana', dias, humanos: [], ocupado: [], pendente: null, seg: null, ...extra })

test('resumo: dias, totais, modelos, grupos e chats, com custo e o que não tem preço', () => {
  const diaHoje = '2026-11-03'
  const diaOntem = '2026-11-02'
  const estados = [
    estado('cli-a', { [diaHoje]: { 'claude-opus-5-5': t({ saida: 1e6 }) }, [diaOntem]: { 'claude-sonnet-5': t({ entrada: 1e6 }) } }),
    estado('cli-velha', { [diaHoje]: { 'claude-x': t({ saida: 500 }) } }, { subagente: true }),
    estado('cli-terminal', { [diaHoje]: { 'claude-opus-5-5': t({ saida: 1e5 }) } }, { cwd: 'C:\\y\\outro' }),
  ]
  const r = resumirHistorico({ estados, sessoes, grupos, atribuicoes: { local_a: 'cg-d' }, precos, agora, subscricao: { mensal: 200, moeda: 'USD' } })
  assert.equal(r.desde, diaOntem)
  assert.deepEqual(r.dias.map(d => d.dia), [diaOntem, diaHoje])
  assert.equal(r.totais.hoje.custo, 20 + 2)
  assert.equal(r.totais.hoje.semPreco, 500)
  assert.equal(r.totais.total.custo, 24)
  assert.equal(r.modelos.find(m => m.chave === 'claude-x').temPreco, false)
  assert.deepEqual(r.grupos.map(g => [g.nome, g.custo]), [['Apps / Dinamo', 22], ['Fora da app (terminal)', 2]])
  assert.equal(r.chats[0].titulo, 'Dinamo app')
  assert.equal(r.chats[0].custo, 22)
  assert.equal(r.chats[1].caminho, 'fora da app')
  assert.deepEqual(r.meses.map(m => [m.mes, m.custo, m.subscricao, m.poupanca]), [['2026-11', 24, 200, -176]])
  assert.deepEqual(r.chatsPorGrupo['cg-d'].map(c => c.titulo), ['Dinamo app'])
  // Em euros: 24 USD a 1,2 USD/€ são 20 €; com 110 €/mês, a poupança é −90 €.
  const eur = resumirHistorico({ estados, sessoes, grupos, atribuicoes: { local_a: 'cg-d' }, precos, agora, subscricao: { mensal: 110, moeda: 'EUR', usdPorEur: 1.2, taxaData: '2026-11-03' } })
  assert.equal(eur.meses[0].custoNaMoeda, 20)
  assert.equal(eur.meses[0].poupanca, -90)
  assert.deepEqual([eur.moeda, eur.usdPorEur, eur.taxaData], ['EUR', 1.2, '2026-11-03'])
  assert.equal(resumirHistorico({ estados, sessoes, grupos, precos, agora, subscricao: { mensal: 110, moeda: 'EUR' } }).meses[0].poupanca, null)
  assert.ok(r.definicoes.ativo.includes('15 min'))
})

test('resumo: cada mês usa o que se pagou nesse mês; os outros usam o valor atual', () => {
  // 1 milhão de tokens de saída do Opus 5.5 são 20 USD; a 1,25 USD/€ são 16 €.
  const dia = (d, saida) => ({ [d]: { 'claude-opus-5-5': t({ saida }) } })
  const estados = [estado('cli-a', { ...dia('2026-06-20', 1e6), ...dia('2026-07-10', 1e6), ...dia('2026-08-05', 1e6) })]
  const subscricao = { mensal: 110, moeda: 'EUR', usdPorEur: 1.25, meses: { '2026-06': 22, '2026-07': 22, 'lixo': 5, '2026-13': 1, '2026-08': -3, '2026-09': 'x' } }
  const r = resumirHistorico({ estados, sessoes, grupos, precos, agora, subscricao })
  // Os meses sem uso também entram (a zero), por isso há seis, de junho a novembro.
  const mes = (x, quem = r) => quem.meses.find(m => m.mes === x)
  assert.deepEqual(r.meses.map(m => m.mes), ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'])
  assert.deepEqual(['2026-06', '2026-07', '2026-08', '2026-09'].map(x => [mes(x).subscricao, mes(x).poupanca]), [[22, 16 - 22], [22, 16 - 22], [110, 16 - 110], [110, -110]])
  // Só entram os preços por mês que fazem sentido.
  assert.deepEqual(r.mensalPorMes, { '2026-06': 22, '2026-07': 22, '2026-13': 1 })
  assert.equal(r.mensal, 110)
  // Sem valor atual, só os meses com preço próprio têm poupança.
  const so = resumirHistorico({ estados, sessoes, grupos, precos, agora, subscricao: { moeda: 'EUR', usdPorEur: 1.25, meses: { '2026-06': 22 } } })
  assert.deepEqual(so.meses.map(m => m.poupanca), [16 - 22, null, null, null, null, null])
})

test('resumo: horas ativas das mensagens tuas e passivas do Claude a trabalhar fora delas', () => {
  const b = agora - 2 * H
  const estados = [
    estado('cli-a', {}, { humanos: [b, b + 10 * MIN], ocupado: [[b, b + 40 * MIN]] }),
    estado('cli-sub', {}, { subagente: true, humanos: [b + 30 * MIN], ocupado: [[b + 50 * MIN, b + 60 * MIN]] }),
  ]
  const r = resumirHistorico({ estados, sessoes, grupos, precos, agora })
  const hoje = r.dias.at(-1)
  assert.equal(hoje.ativoMs, 10 * MIN)
  assert.equal(hoje.passivoMs, 40 * MIN)
  assert.equal(r.mensal, null)
  assert.equal(r.meses[0].poupanca, null)
})

test('resumo: a mensagem a meio (pendente) também conta; sem histórico vem vazio', () => {
  const estados = [estado('cli-a', {}, { pendente: { id: 'msg_1', em: agora, modelo: 'claude-opus-5-5', t: t({ saida: 1e6 }) } })]
  assert.equal(resumirHistorico({ estados, sessoes, grupos, precos, agora }).totais.hoje.custo, 20)
  const vazio = resumirHistorico({ estados: [], precos, agora: ontem })
  assert.deepEqual([vazio.dias, vazio.desde, vazio.totais.total.custo], [[], null, 0])
})
