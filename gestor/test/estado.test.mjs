import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarEstado, meiaNoiteLocal } from '../lib/estado.mjs'

const M = 60_000
const H = 60 * M
const D = 24 * H
const agora = new Date(2026, 10, 3, 12, 0).getTime()
const meiaNoite = new Date(2026, 10, 3).getTime()

const sessao = (local, extra = {}) => ({
  local, cli: '', titulo: local, cwd: '', projeto: '', criadoEm: 0, atividadeEm: agora - M,
  arquivado: false, resumo: '', precisa: '', estado: '', ...extra, mensagemEm: extra.mensagemEm ?? extra.atividadeEm ?? agora - M,
})

const sessoes = [
  sessao('local_a', { titulo: 'Permissões de pagamentos', cwd: 'C:\\x\\FAROL', projeto: 'FAROL', atividadeEm: agora - 3 * M, precisa: 'Aprovar' }),
  sessao('local_b', { titulo: 'balcao', cwd: 'C:\\x\\Clientes', projeto: 'Clientes', atividadeEm: agora - M }),
  sessao('local_c', { titulo: 'Presente de 2 anos', cwd: 'C:\\x\\Matriz', projeto: 'Matriz', atividadeEm: agora - 8 * D, precisa: 'Fazer o merge', resumo: 'PR aberto' }),
]

const classificacao = {
  importancia: 5, tipo: 'aprovacao', esforco: 'segundos', desbloqueia: true, rotulo: 'Deploy',
  cartao: { pediste: 'Permissões', fez: 'Regras e testes', precisa: 'Aprovar o deploy' },
}
const passos = [
  { texto: 'Ler', estado: 'completed' }, { texto: 'Corrigir', estado: 'completed' },
  { texto: 'Correr testes', estado: 'in_progress' }, { texto: 'Publicar', estado: 'pending' },
]
const itens = [
  { sessao: 'sa', local: 'local_a', titulo: 'Ola', projeto: 'FAROL', estado: 'a-espera', desde: agora - 3 * M, classificacao },
  { sessao: 'sb', local: 'local_b', titulo: 'balcao', projeto: 'Clientes', estado: 'a-trabalhar', desde: agora - 8 * M, progresso: { passos, ferramentas: 14, ultima: 'Bash npm test' } },
]

const chip = (sessao, local, desde, texto = 'X · Y') => ({ sessao, local, desde, numero: 1, texto, nota: '5s', cor: '#888', silenciado: false })
const trabalhoB = { sessao: 'sb', local: 'local_b', titulo: 'balcao', projeto: 'Clientes', desde: agora - 8 * M, pedido: 'Corrigir o CI', feitos: 2, total: 4, atual: 'Correr testes', ferramentas: 14, ultima: 'Bash npm test' }
const barra = {
  geradaEm: agora - M,
  modelo: { vazia: false, cabeca: '1 à espera', chips: [chip('sa', 'local_a', agora - 3 * M, 'FAROL · Deploy')], mais: 0, aTrabalhar: '1 a trabalhar', extra: [] },
  trabalho: [trabalhoB],
}

const base = { sessoes, itens, barra, dispensados: {}, agora, meiaNoite }

test('espera vem do barra.json, enriquecida com a sessão (título, projeto, pasta) e o item (classificação)', () => {
  const { espera } = montarEstado(base)
  assert.equal(espera.length, 1)
  const { grupo, caminho, ...resto } = espera[0]
  assert.equal(grupo, 'sem-grupo')
  assert.equal(caminho, 'Sem grupo')
  assert.deepEqual(resto, {
    numero: 1, sessao: 'sa', local: 'local_a', titulo: 'Permissões de pagamentos', projeto: 'FAROL', cwd: 'C:\\x\\FAROL',
    desde: agora - 3 * M, rotulo: 'Deploy', precisa: 'Aprovar o deploy', pediste: 'Permissões', fez: 'Regras e testes',
    importancia: 5, tipo: 'aprovacao', esforco: 'segundos', desbloqueia: true, silenciado: false, urgente: true,
  })
})

test('espera junta chips e extra pela ordem da IA e numera de 1 a n', () => {
  const b = {
    ...barra,
    modelo: { ...barra.modelo, chips: [chip('s1', 'local_1', 10), chip('s2', 'local_2', 20)], extra: [chip('s3', 'local_3', 30)] },
  }
  const { espera } = montarEstado({ ...base, barra: b })
  assert.deepEqual(espera.map(e => [e.numero, e.sessao]), [[1, 's1'], [2, 's2'], [3, 's3']])
})

test('chip sem sessão nem item usa o texto do chip e importância 3', () => {
  const b = { ...barra, modelo: { ...barra.modelo, chips: [chip('sz', 'local_z', 5, 'Proj · Rótulo')] } }
  const [e] = montarEstado({ ...base, barra: b }).espera
  assert.equal(e.titulo, 'Proj · Rótulo')
  assert.equal(e.projeto, '')
  assert.equal(e.importancia, 3)
  assert.equal(e.urgente, false)
  assert.equal(e.precisa, '')
})

test('dispensado com o mesmo desde sai da espera; dispensa de um turno antigo não', () => {
  assert.equal(montarEstado({ ...base, dispensados: { sa: agora - 3 * M } }).espera.length, 0)
  assert.equal(montarEstado({ ...base, dispensados: { sa: agora - D } }).espera.length, 1)
})

test('um chat arquivado na app sai da espera, do trabalho e dos recentes, mesmo com o item do mod ainda vivo', () => {
  const arquivadas = sessoes.map(s => (s.local === 'local_a' || s.local === 'local_b' ? { ...s, arquivado: true } : s))
  const e = montarEstado({ ...base, sessoes: arquivadas })
  assert.deepEqual(e.espera, [])
  assert.deepEqual(e.trabalho, [])
  assert.equal(e.recentes.some(c => c.local === 'local_a' || c.local === 'local_b'), false)
  assert.equal(e.numeros.espera, 0)
  assert.equal(e.numeros.trabalho, 0)
  // Sem arquivar, continuam lá.
  assert.equal(montarEstado(base).espera.length, 1)
  assert.equal(montarEstado(base).trabalho.length, 1)
})

test('um a trabalhar cuja sessão do CLI a app largou (clear) depois de ele começar sai do trabalho e dos recentes', () => {
  const comClear = clisSaidos => sessoes.map(s => (s.local === 'local_b' ? { ...s, clisSaidos } : s))
  // Largada 2 s depois de o turno começar: o turno nunca vai acabar.
  const morto = montarEstado({ ...base, sessoes: comClear({ sb: trabalhoB.desde + 2_000 }) })
  assert.deepEqual(morto.trabalho, [])
  assert.equal(morto.numeros.trabalho, 0)
  assert.equal(morto.recentes.find(c => c.local === 'local_b').trabalho, false)
  // Largada antes de o turno começar (o chat voltou a essa sessão): o turno é válido.
  assert.equal(montarEstado({ ...base, sessoes: comClear({ sb: trabalhoB.desde - 2_000 }) }).trabalho.length, 1)
  // Outra sessão do CLI largada não mexe neste turno.
  assert.equal(montarEstado({ ...base, sessoes: comClear({ outra: trabalhoB.desde + 2_000 }) }).trabalho.length, 1)
})

test('dispensar um a trabalhar esconde-o só até ao turno seguinte', () => {
  assert.deepEqual(montarEstado({ ...base, dispensados: { sb: trabalhoB.desde } }).trabalho, [])
  assert.equal(montarEstado({ ...base, dispensados: { sb: trabalhoB.desde - D } }).trabalho.length, 1)
})

test('sem barra.json ou com a fila vazia, espera e trabalho ficam vazios', () => {
  for (const b of [undefined, { modelo: { vazia: true, resumo: 'Nada' } }]) {
    const e = montarEstado({ ...base, barra: b })
    assert.deepEqual(e.espera, [])
    assert.deepEqual(e.trabalho, [])
  }
})

test('trabalho vem do barra.json com a sessão e os passos do item', () => {
  const [t] = montarEstado(base).trabalho
  assert.equal(t.titulo, 'balcao')
  assert.equal(t.cwd, 'C:\\x\\Clientes')
  assert.equal(t.feitos, 2)
  assert.equal(t.total, 4)
  assert.equal(t.atual, 'Correr testes')
  assert.deepEqual(t.passos, passos)
})

test('trabalho com mais de 3 h é de um chat fechado a meio e sai', () => {
  const b = { ...barra, trabalho: [{ ...trabalhoB, desde: agora - 4 * H }] }
  assert.deepEqual(montarEstado({ ...base, barra: b }).trabalho, [])
})

test('recentes: todos os chats abertos, da última mensagem para a mais antiga', () => {
  const s = [
    ...sessoes,
    sessao('local_arq', { arquivado: true, mensagemEm: agora }),
    sessao('local_d', { atividadeEm: agora, mensagemEm: agora - 2 * D }),
  ]
  const { recentes } = montarEstado({ ...base, sessoes: s })
  assert.deepEqual(recentes.map(r => r.local), ['local_b', 'local_a', 'local_d', 'local_c'])
})

test('recentes: cada linha traz o resumo, o que precisa (da fila quando está à espera) e o estado', () => {
  const { recentes } = montarEstado(base)
  const de = local => recentes.find(r => r.local === local)
  const { grupo, caminho, ...resto } = de('local_a')
  assert.equal(caminho, 'Sem grupo')
  assert.deepEqual(resto, {
    local: 'local_a', titulo: 'Permissões de pagamentos', projeto: 'FAROL', cwd: 'C:\\x\\FAROL', criadoEm: 0,
    atividadeEm: agora - 3 * M, mensagemEm: agora - 3 * M, resumo: '', precisa: 'Aprovar o deploy', espera: true, trabalho: false,
  })
  assert.equal(de('local_b').trabalho, true)
  assert.equal(de('local_c').precisa, 'Fazer o merge')
  assert.equal(de('local_c').resumo, 'PR aberto')
})

test('números: espera, trabalho, urgentes, mais antiga, turnos e chats ativos hoje', () => {
  const ontem = { sessao: 'sy', local: 'local_y', titulo: 'y', projeto: '', estado: 'a-espera', desde: meiaNoite - M }
  const s = [...sessoes, sessao('local_y', { atividadeEm: meiaNoite - M })]
  const { numeros } = montarEstado({ ...base, sessoes: s, itens: [...itens, ontem] })
  assert.deepEqual(numeros, {
    espera: 1, urgentes: 1, esperaMaisAntiga: agora - 3 * M, trabalho: 1,
    turnosHoje: 2, ativosHoje: 2, chats: 4,
  })
})

const GF = 'cg-00000001-0000-4000-8000-000000000000'
const GM = 'cg-00000002-0000-4000-8000-000000000000'

test('a árvore são os grupos do Claude; cada chat leva o grupo e o caminho; os sem grupo só nos Recentes', () => {
  const e = montarEstado({ ...base, grupos: [{ id: GF, nome: 'FAROL' }, { id: GM, nome: 'Matriz' }], atribuicoes: { local_a: GF, local_c: GM } })
  assert.deepEqual(e.arvore.map(n => [n.nome, n.total, n.espera]), [['FAROL', 1, 1], ['Matriz', 1, 0]])
  assert.equal(e.recentes.length, 3)
  assert.equal(e.espera[0].grupo, GF)
  assert.equal(e.espera[0].caminho, 'FAROL')
  assert.equal(e.trabalho[0].caminho, 'Sem grupo')
  assert.deepEqual(e.organizacao.grupos.map(g => [g.nome, g.pasta]), [['FAROL', null], ['Matriz', null]])
  assert.equal(e.organizacao.erroGrupos, null)
})

test('com pastas-mãe, os caminhos levam a pasta', () => {
  const organizacao = { versao: 2, pastas: [{ id: 'p_vida', nome: 'Vida', pai: null }], grupos: { [GM]: 'p_vida' } }
  const e = montarEstado({ ...base, organizacao, grupos: [{ id: GF, nome: 'FAROL' }, { id: GM, nome: 'Matriz' }], atribuicoes: { local_c: GM } })
  assert.equal(e.recentes.find(r => r.local === 'local_c').caminho, 'Vida / Matriz')
  assert.deepEqual(e.organizacao.pastas, [{ id: 'p_vida', nome: 'Vida', pai: null, caminho: 'Vida' }])
  assert.deepEqual(e.arvore.map(n => n.nome), ['FAROL', 'Vida'])
})

test('sem os grupos da app, a árvore fica vazia, os chats ficam nos Recentes e o erro vem no estado', () => {
  const e = montarEstado({ ...base, erroGrupos: 'não consegui ler os grupos da app' })
  assert.deepEqual(e.arvore, [])
  assert.equal(e.recentes.length, 3)
  assert.equal(e.organizacao.erroGrupos, 'não consegui ler os grupos da app')
})

test('meiaNoiteLocal devolve o início do dia local', () => {
  assert.equal(meiaNoiteLocal(agora), meiaNoite)
  assert.equal(meiaNoiteLocal(meiaNoite), meiaNoite)
})
