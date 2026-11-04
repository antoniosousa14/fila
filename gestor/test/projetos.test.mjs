import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { aplicarPlano, criarContinuidade, resumirCauda, resumirPlano, semMarcas, textoDaPessoa } from '../lib/continuidade.mjs'
import { locaisParaDetalhe, MAX_CHATS, MAX_DETALHE, montarProjetos, pontosDe, resumirRitmo } from '../lib/projetos.mjs'
import { DIAS_RITMO } from '../lib/ritmo.mjs'

const M = 60_000
const agora = new Date(2026, 10, 4, 1, 0).getTime()

// ——— continuidade: o fim da transcrição ———

const pessoa = (texto, extra = {}) => ({ type: 'user', timestamp: new Date(agora - 5 * M).toISOString(), message: { role: 'user', content: texto }, ...extra })
const chat = (texto, extra = {}) => ({ type: 'assistant', timestamp: new Date(agora - 4 * M).toISOString(), message: { role: 'assistant', content: [{ type: 'text', text: texto }] }, ...extra })
const ferramenta = (name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } })
const jsonl = entradas => entradas.map(e => JSON.stringify(e)).join('\n')

test('semMarcas tira títulos, negrito, código, listas e tabelas', () => {
  assert.equal(semMarcas('### Feito\n- **Commit** `abc` feito\n| a | b |\n|---|---|\n1. passo um\nTexto.'), 'Feito Commit abc feito a b passo um Texto.')
  assert.equal(semMarcas('antes\n```js\nconst x = 1\n```\ndepois'), 'antes depois')
})

test('textoDaPessoa só devolve o que a pessoa escreveu', () => {
  assert.equal(textoDaPessoa(pessoa('  faz isto  ')), 'faz isto')
  assert.equal(textoDaPessoa(pessoa([{ type: 'text', text: 'um' }, { type: 'text', text: 'dois' }])), 'um\ndois')
  assert.equal(textoDaPessoa({ type: 'user', message: { content: [{ type: 'tool_result', content: 'x' }] } }), '')
  assert.equal(textoDaPessoa(pessoa('<system-reminder>aviso</system-reminder>')), '')
  assert.equal(textoDaPessoa(pessoa('[Request interrupted by user]')), '')
  assert.equal(textoDaPessoa(pessoa('This session is being continued from a previous conversation')), '')
  assert.equal(textoDaPessoa(pessoa('meta', { isMeta: true })), '')
  assert.equal(textoDaPessoa(pessoa('subagente', { isSidechain: true })), '')
  assert.equal(textoDaPessoa(chat('resposta')), '')
})

test('resumirPlano: feitos, o que está a fazer e o que falta', () => {
  assert.equal(resumirPlano([]), undefined)
  assert.equal(resumirPlano(undefined), undefined)
  const passos = [
    { texto: 'Ler', estado: 'completed' }, { texto: 'Corrigir', estado: 'in_progress' },
    { texto: 'Testar', estado: 'pending' }, { texto: 'Publicar', estado: 'pending' },
  ]
  assert.deepEqual(resumirPlano(passos), { feitos: 1, total: 4, atual: 'Corrigir', faltam: ['Testar', 'Publicar'], feitosTextos: ['Ler'] })
  // Sem nenhum em curso, o primeiro por fazer é o atual.
  assert.deepEqual(resumirPlano([{ texto: 'A', estado: 'completed' }, { texto: 'B', estado: 'pending' }]), { feitos: 1, total: 2, atual: 'B', faltam: [], feitosTextos: ['A'] })
  // Tudo feito: nada atual, nada a faltar.
  assert.deepEqual(resumirPlano([{ texto: 'A', estado: 'completed' }]), { feitos: 1, total: 1, atual: '', faltam: [], feitosTextos: ['A'] })
  assert.equal(resumirPlano(passos.concat([{ texto: 'C', estado: 'pending' }, { texto: 'D', estado: 'pending' }, { texto: 'E', estado: 'pending' }])).faltam.length, 3)
})

test('aplicarPlano: TodoWrite substitui a lista', () => {
  const r = aplicarPlano(undefined, { name: 'TodoWrite', input: { todos: [{ content: 'A', status: 'in_progress' }, { content: 'B', status: 'pending' }] } })
  assert.deepEqual(r.passos, [{ texto: 'A', estado: 'in_progress' }, { texto: 'B', estado: 'pending' }])
})

test('aplicarPlano: o painel da app atualiza a lista aos poucos', () => {
  const nome = 'mcp__ccd_turn__update_plan'
  let { passos } = aplicarPlano(undefined, { name: nome, input: { items: [{ content: 'A', status: 'in_progress' }, { content: 'B', status: 'pending' }, { content: 'C', status: 'pending' }, { content: 'D', status: 'pending' }] } })
  passos = aplicarPlano(passos, { name: nome, input: { advance: true } }).passos
  assert.deepEqual(passos.map(p => p.estado), ['completed', 'in_progress', 'pending', 'pending'])
  passos = aplicarPlano(passos, { name: nome, input: { done: [2], start: 4 } }).passos
  assert.deepEqual(passos.map(p => p.estado), ['completed', 'completed', 'pending', 'in_progress'])
  passos = aplicarPlano(passos, { name: 'mcp__ccd_turn__wrap_up', input: {} }).passos
  assert.ok(passos.every(p => p.estado === 'completed'))
  // Outras ferramentas não mexem na lista.
  assert.equal(aplicarPlano(passos, { name: 'Bash', input: { command: 'ls' } }).passos, passos)
})

test('aplicarPlano: uma atualização parcial sem a lista inicial fica por reconstruir', () => {
  const r = aplicarPlano(undefined, { name: 'mcp__ccd_turn__update_plan', input: { advance: true } })
  assert.equal(r.passos, undefined)
  assert.equal(r.parcial, true)
  assert.equal(aplicarPlano(undefined, { name: 'Bash', input: {} }).parcial, undefined)
})

test('resumirCauda: último pedido, última resposta e lista de tarefas', () => {
  const texto = jsonl([
    pessoa('primeiro pedido'),
    chat('primeira resposta'),
    ferramenta('TodoWrite', { todos: [{ content: 'A', status: 'completed' }, { content: 'B', status: 'in_progress' }] }),
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
    pessoa('**segundo** pedido'),
    { type: 'assistant', timestamp: new Date(agora - M).toISOString(), message: { content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: '### Resumo\nFiz o B.' }] } },
    { type: 'last-prompt' },
  ])
  const r = resumirCauda(texto)
  assert.equal(r.pedi, 'segundo pedido')
  assert.equal(r.respondeu, 'Resumo Fiz o B.')
  assert.deepEqual(r.plano, { feitos: 1, total: 2, atual: 'B', faltam: [], feitosTextos: ['A'] })
  assert.equal(r.planoParcial, false)
  assert.ok(r.pediEm > 0 && r.respondeuEm > 0)
})

test('resumirCauda: a primeira linha cortada ignora-se e linhas estragadas também', () => {
  const texto = `{"type":"user","message":{"content":"cort\n${JSON.stringify(pessoa('inteiro'))}\nnão é json\n${JSON.stringify(chat('ok'))}`
  const r = resumirCauda(texto, { cortada: true })
  assert.equal(r.pedi, 'inteiro')
  assert.equal(r.respondeu, 'ok')
})

test('resumirCauda: textos longos cortam-se numa frase ou palavra, com reticências', () => {
  const longo = `${'Frase completa e longa. '.repeat(40)}`
  const r = resumirCauda(jsonl([pessoa(longo), chat('Uma palavra '.repeat(80))]))
  assert.ok(r.pedi.length <= 361 && r.pedi.endsWith('.') || r.pedi.endsWith('…'))
  assert.ok(r.respondeu.length <= 421 && r.respondeu.endsWith('…'))
})

test('resumirCauda: lista de tarefas só com atualizações parciais fica marcada como parcial', () => {
  const r = resumirCauda(jsonl([pessoa('x'), ferramenta('mcp__ccd_turn__update_plan', { advance: true }), chat('y')]))
  assert.equal(r.plano, undefined)
  assert.equal(r.planoParcial, true)
})

test('criarContinuidade: acha a transcrição pela sessão do CLI e guarda em cache o que não mudou', async t => {
  const base = await mkdtemp(join(tmpdir(), 'fila-cont-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  await mkdir(join(base, 'C--x-projeto'), { recursive: true })
  const ficheiro = join(base, 'C--x-projeto', 'cli-1.jsonl')
  await writeFile(ficheiro, jsonl([pessoa('pedido um'), chat('resposta um')]))
  const c = criarContinuidade({ base })
  const a = await c.detalhe(['cli-0', 'cli-1'])
  assert.equal(a.pedi, 'pedido um')
  assert.equal(a.respondeu, 'resposta um')
  assert.equal(await c.detalhe(['nao-existe']), undefined)
  assert.equal(await c.detalhe([]), undefined)
  assert.equal(await c.detalhe(undefined), undefined)
  assert.equal(await c.detalhe(['cli-1']), a, 'sem mudanças devolve o mesmo resultado em cache')
  await writeFile(ficheiro, jsonl([pessoa('pedido um'), chat('resposta um'), pessoa('pedido dois mais comprido'), chat('resposta dois')]))
  const b = await c.detalhe(['cli-1'])
  assert.equal(b.pedi, 'pedido dois mais comprido')
  assert.equal(b.respondeu, 'resposta dois')
})

test('criarContinuidade: alarga a leitura quando o fim não tem nenhuma mensagem da pessoa', async t => {
  const base = await mkdtemp(join(tmpdir(), 'fila-cont-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  await mkdir(join(base, 'p'), { recursive: true })
  // Mais de 400 KB de resultados de ferramentas depois do último pedido.
  const lixo = { type: 'user', message: { content: [{ type: 'tool_result', content: 'x'.repeat(1000) }] } }
  const entradas = [pessoa('pedido antigo'), chat('resposta antiga'), ...Array.from({ length: 500 }, () => lixo)]
  await writeFile(join(base, 'p', 'cli-2.jsonl'), jsonl(entradas))
  const r = await criarContinuidade({ base }).detalhe(['cli-2'])
  assert.equal(r.pedi, 'pedido antigo')
  assert.equal(r.respondeu, 'resposta antiga')
})

// ——— projetos ———

const chatDe = (local, extra = {}) => ({
  local, titulo: `Chat ${local}`, projeto: 'x', cwd: 'C:\\x', criadoEm: 0, atividadeEm: agora, mensagemEm: agora - M,
  resumo: '', precisa: '', espera: false, trabalho: false, grupo: 'g1', caminho: 'Apps / Gaivota', ...extra,
})
const grupo = (id, nome, chats) => ({ tipo: 'grupo', id, nome, nomeClaude: nome, filhas: [], chats: chats.map(c => c.local), espera: 0, total: chats.length })

function estadoDe() {
  const gaivota = [
    chatDe('a', { titulo: 'Expo', mensagemEm: agora - 20 * M, espera: true, caminho: 'Apps / Gaivota' }),
    chatDe('b', { titulo: 'Antigo', mensagemEm: agora - 5 * 24 * 60 * M, precisa: 'Escolher', resumo: 'build feita', caminho: 'Apps / Gaivota' }),
  ]
  const prisma = [chatDe('c', { titulo: 'Prisma chat', mensagemEm: agora - 2 * M, trabalho: true, caminho: 'Apps / Prisma' })]
  const semGrupo = [chatDe('d', { titulo: 'Solto', caminho: 'Sem grupo' })]
  const nos = [
    { tipo: 'pasta', id: 'p1', nome: 'Apps', filhas: [grupo('g1', 'Gaivota', gaivota), grupo('g2', 'Prisma', prisma)], chats: [], espera: 1, total: 3 },
    { tipo: 'grupo', id: 'sem-grupo', nome: 'Sem grupo', filhas: [], chats: ['d'], espera: 0, total: 1 },
  ]

  return {
    geradoEm: agora,
    arvore: nos,
    recentes: [...gaivota, ...prisma, ...semGrupo],
    espera: [{ local: 'a', sessao: 'sa', precisa: 'Aprovar o deploy', rotulo: 'Deploy', pediste: 'Deploy', fez: 'Build', importancia: 4 }],
    trabalho: [{ local: 'c', sessao: 'sc', atual: 'Correr testes', passos: [{ texto: 'Ler', estado: 'completed' }, { texto: 'Testar', estado: 'in_progress' }] }],
  }
}

const projetoDe = (projetos, id) => projetos.find(p => p.id === id)

test('montarProjetos: um por grupo (as pastas e o «sem grupo» não contam)', () => {
  const p = montarProjetos(estadoDe())
  assert.deepEqual(p.map(x => x.id).sort(), ['g1', 'g2'])
  assert.deepEqual(p.map(x => x.caminho).sort(), ['Apps / Gaivota', 'Apps / Prisma'])
})

test('montarProjetos: o que pede mais atenção vem primeiro (a tua vez antes do que já está a ser feito)', () => {
  const p = montarProjetos(estadoDe())
  assert.deepEqual(p.map(x => x.id), ['g1', 'g2'])
  assert.ok(p[0].atencao > p[1].atencao)
})

test('montarProjetos: contagens, chat principal (o da última mensagem) e ritmo', () => {
  const p = montarProjetos(estadoDe())
  const gaivota = projetoDe(p, 'g1')
  const prisma = projetoDe(p, 'g2')
  assert.deepEqual([prisma.total, prisma.espera, prisma.trabalho], [1, 0, 1])
  assert.deepEqual([gaivota.total, gaivota.espera, gaivota.trabalho], [2, 1, 0])
  assert.equal(gaivota.principal.local, 'a')
  assert.equal(gaivota.principal.estado, 'espera')
  assert.deepEqual(gaivota.outros.map(c => c.local), ['b'])
  assert.equal(gaivota.outros[0].estado, 'parado')
  assert.equal(gaivota.ultimaEm, agora - 20 * M)
  assert.equal(gaivota.ritmo, 'hoje')
  assert.equal(gaivota.diasParado, 0)
  assert.equal(gaivota.esquecido, false)
})

test('montarProjetos: por fazer ordenado por prioridade, a tua vez à frente', () => {
  const gaivota = projetoDe(montarProjetos(estadoDe()), 'g1')
  assert.deepEqual(gaivota.porFazer.map(i => [i.texto, i.tuaVez, i.origem, i.chat.local]), [
    ['Aprovar o deploy', true, 'espera', 'a'],
    ['Escolher', true, 'app', 'b'],
  ])
  assert.equal(gaivota.tuaVez, 2)
  assert.ok(gaivota.porFazer[0].pontos > gaivota.porFazer[1].pontos)
})

test('montarProjetos: a situação da IA (falta com prioridade) manda; sem ela, a lista de tarefas', () => {
  const situacoes = new Map([
    ['a', { falta: [{ texto: 'Reenviar à Apple', prioridade: 5 }, { texto: 'Atualizar o README', prioridade: 1 }], feito: [] }],
  ])
  const detalhes = new Map([['b', { plano: { feitos: 1, total: 3, atual: 'Reenviar', faltam: ['Testar'], feitosTextos: ['Retirar'] } }]])
  const [primeiro, segundo] = montarProjetos(estadoDe(), detalhes, { situacoes })
  const gaivota = primeiro.id === 'g1' ? primeiro : segundo
  const textos = gaivota.porFazer.map(i => i.texto)
  assert.deepEqual(textos, ['Aprovar o deploy', 'Reenviar à Apple', 'Escolher', 'Reenviar', 'Testar', 'Atualizar o README'])
  assert.equal(gaivota.porFazer.find(i => i.texto === 'Reenviar à Apple').origem, 'ia')
  assert.equal(gaivota.porFazer.find(i => i.texto === 'Testar').origem, 'plano')
  assert.equal(gaivota.porFazer.find(i => i.texto === 'Testar').prioridade, 2)
})

test('montarProjetos: o chat a trabalhar conta como em curso e pesa menos', () => {
  const prisma = projetoDe(montarProjetos(estadoDe()), 'g2')
  assert.equal(prisma.porFazer.length, 1)
  assert.equal(prisma.porFazer[0].texto, 'Testar')
  assert.equal(prisma.porFazer[0].emCurso, true)
  assert.equal(prisma.porFazer[0].tuaVez, false)
})

test('montarProjetos: o feito recente junta a IA, a lista de tarefas e o cartão, sem repetir, do mais recente', () => {
  const situacoes = new Map([['a', { falta: [], feito: [{ texto: 'Retirada a build 7', em: agora - 3 * M }, { texto: 'Corrigido o link', em: agora - 30 * M }] }]])
  const detalhes = new Map([['b', { plano: { feitos: 2, total: 3, atual: 'Reenviar', faltam: [], feitosTextos: ['Ler', 'corrigido o link'] } }]])
  const gaivota = projetoDe(montarProjetos(estadoDe(), detalhes, { situacoes }), 'g1')
  assert.deepEqual(gaivota.feito.map(f => f.texto), ['Retirada a build 7', 'Corrigido o link', 'Ler'])
  assert.deepEqual(gaivota.feito.map(f => f.chat.local), ['a', 'a', 'b'])
  assert.ok(gaivota.feito.every((f, i, l) => i === 0 || l[i - 1].em >= f.em))
})

test('montarProjetos: sem situação nem tarefas, o feito vem do cartão da IA', () => {
  const gaivota = projetoDe(montarProjetos(estadoDe()), 'g1')
  assert.deepEqual(gaivota.feito.map(f => [f.texto, f.origem]), [['Build', 'plano']])
})

test('montarProjetos: sem nada feito registado, o resumo do chat mais recente serve de último recurso', () => {
  const e = estadoDe()
  e.espera = []
  e.recentes.find(c => c.local === 'a').resumo = `${'palavra '.repeat(30)}fim`
  e.recentes.find(c => c.local === 'a').espera = false
  const gaivota = projetoDe(montarProjetos(e), 'g1')
  assert.equal(gaivota.feito.length, 1)
  assert.equal(gaivota.feito[0].origem, 'resumo')
  assert.ok(gaivota.feito[0].texto.length <= 141 && gaivota.feito[0].texto.endsWith('…'))
  assert.equal(gaivota.feito[0].chat.local, 'a')
  // Sem nada que dizer, não há linha de feito.
  e.recentes.find(c => c.local === 'a').resumo = ''
  assert.deepEqual(projetoDe(montarProjetos(e), 'g1').feito, [])
})

test('montarProjetos: projeto parado há dias com coisas por fazer fica esquecido e sobe', () => {
  const e = estadoDe()
  const velho = [chatDe('x', { titulo: 'Velho', mensagemEm: agora - 12 * 24 * 60 * M, precisa: '', resumo: '', caminho: 'Faculdade' })]
  e.arvore.push(grupo('g9', 'Faculdade', velho))
  e.recentes.push(...velho)
  const situacoes = new Map([['x', { falta: [{ texto: 'Entregar o relatório', prioridade: 4 }], feito: [] }]])
  const p = montarProjetos(e, new Map(), { situacoes })
  const fac = projetoDe(p, 'g9')
  assert.equal(fac.ritmo, 'parado')
  assert.equal(fac.diasParado, 12)
  assert.equal(fac.esquecido, true)
  assert.ok(fac.atencao >= 15 + 40)
  // Sem nada por fazer, um projeto parado não é «esquecido»: só está parado.
  const vazio = projetoDe(montarProjetos(e), 'g9')
  assert.equal(vazio.esquecido, false)
  assert.deepEqual(resumirRitmo(p), { hoje: 2, ativo: 0, arrefecer: 0, parado: 1, esquecidos: 1, tuaVez: 1, semImportancia: 0, dispensados: 0 })
})

const G = 'cg-b1ae0a97-cd9b-4002-9b5a-6e361a30a21d'

function estadoComEsquecido() {
  const e = estadoDe()
  const velho = [chatDe('x', { titulo: 'Velho', mensagemEm: agora - 12 * 24 * 60 * M, caminho: 'Faculdade' })]
  e.arvore.push(grupo(G, 'Faculdade', velho))
  e.recentes.push(...velho)

  return e
}
const faltaX = new Map([['x', { falta: [{ texto: 'Entregar o relatório', prioridade: 4 }, { texto: 'Rever as notas', prioridade: 2 }], feito: [{ texto: 'Primeira versão', em: agora - 12 * 24 * 60 * M }] }]])

test('marcas: sem importância tira o «esquecido», não conta nos alertas e vai para o fim', () => {
  const e = estadoComEsquecido()
  const marcas = { grupos: { [G]: { semImportancia: true } }, itens: {} }
  const p = montarProjetos(e, new Map(), { situacoes: faltaX, marcas })
  const fac = projetoDe(p, G)
  assert.equal(fac.semImportancia, true)
  assert.equal(fac.esquecido, false)
  assert.equal(fac.porFazer.length, 2, 'as linhas continuam à vista')
  assert.equal(p[p.length - 1].id, G)
  const r = resumirRitmo(p)
  assert.equal(r.esquecidos, 0)
  assert.equal(r.parado, 0)
  assert.equal(r.semImportancia, 1)
})

test('marcas: dispensado até haver novidades volta quando o projeto recebe uma mensagem nova', () => {
  const e = estadoComEsquecido()
  const ultima = agora - 12 * 24 * 60 * M
  let fac = projetoDe(montarProjetos(e, new Map(), { situacoes: faltaX, marcas: { grupos: { [G]: { dispensadoAte: ultima } }, itens: {} } }), G)
  assert.equal(fac.dispensado, true)
  assert.equal(fac.esquecido, false)
  assert.equal(fac.atencao, -2)
  // Uma mensagem nova (depois do instante em que foi dispensado) traz-o de volta.
  e.recentes.find(c => c.local === 'x').mensagemEm = ultima + 60_000
  fac = projetoDe(montarProjetos(e, new Map(), { situacoes: faltaX, marcas: { grupos: { [G]: { dispensadoAte: ultima } }, itens: {} } }), G)
  assert.equal(fac.dispensado, false)
  const p = montarProjetos(e, new Map(), { situacoes: faltaX, marcas: { grupos: { [G]: { dispensadoAte: ultima } }, itens: {} } })
  assert.equal(resumirRitmo(p).dispensados, 0)
})

test('marcas: dispensados não entram nas contagens e ficam depois dos sem importância', () => {
  const e = estadoComEsquecido()
  const ultima = agora - 12 * 24 * 60 * M
  const p = montarProjetos(e, new Map(), { situacoes: faltaX, marcas: { grupos: { [G]: { dispensadoAte: ultima } }, itens: {} } })
  assert.equal(p[p.length - 1].id, G)
  const r = resumirRitmo(p)
  assert.deepEqual([r.esquecidos, r.parado, r.dispensados], [0, 0, 1])
})

test('marcas: uma linha escondida não volta a aparecer, nem no que falta nem no feito', () => {
  const e = estadoComEsquecido()
  const marcas = { grupos: {}, itens: { [G]: [{ chave: 'entregar o relatório', texto: 'Entregar o relatório' }, { chave: 'primeira versão', texto: 'Primeira versão' }] } }
  const fac = projetoDe(montarProjetos(e, new Map(), { situacoes: faltaX, marcas }), G)
  assert.deepEqual(fac.porFazer.map(i => i.texto), ['Rever as notas'])
  assert.deepEqual(fac.feito, [])
  assert.equal(fac.linhasEscondidas, 2)
  // Escondê-las todas tira o esquecimento: já não há nada por fazer.
  const todas = { grupos: {}, itens: { [G]: [...marcas.itens[G], { chave: 'rever as notas', texto: 'Rever as notas' }] } }
  const sem = projetoDe(montarProjetos(e, new Map(), { situacoes: faltaX, marcas: todas }), G)
  assert.deepEqual(sem.porFazer, [])
  assert.equal(sem.esquecido, false)
})

test('montarProjetos: a atividade soma as mensagens tuas por dia dos chats do projeto', () => {
  const dias = n => Array.from({ length: DIAS_RITMO }, (_, i) => (i === DIAS_RITMO - 1 ? n : 0))
  const atividade = new Map([['a', dias(2)], ['b', dias(3)]])
  const gaivota = projetoDe(montarProjetos(estadoDe(), new Map(), { atividade }), 'g1')
  assert.equal(gaivota.atividade.length, DIAS_RITMO)
  assert.equal(gaivota.atividade[DIAS_RITMO - 1], 5)
  assert.equal(projetoDe(montarProjetos(estadoDe()), 'g2').atividade.every(n => n === 0), true)
})

test('montarProjetos: o plano do chat a trabalhar vem do mod; um parado com tarefas por fazer ficou a meio', () => {
  const detalhes = new Map([
    ['b', { pedi: 'retirar e reenviar', respondeu: 'Retirada feita', plano: { feitos: 1, total: 3, atual: 'Reenviar', faltam: ['Testar'], feitosTextos: [] } }],
  ])
  const p = montarProjetos(estadoDe(), detalhes)
  const prisma = projetoDe(p, 'g2')
  const gaivota = projetoDe(p, 'g1')
  assert.deepEqual(prisma.principal.plano, { feitos: 1, total: 2, atual: 'Testar', faltam: [], feitosTextos: ['Ler'] })
  assert.equal(prisma.principal.aMeio, false, 'a trabalhar não é «a meio»')
  const b = gaivota.outros[0]
  assert.equal(b.aMeio, true)
  assert.equal(b.pedi, 'retirar e reenviar')
  assert.equal(b.respondeu, 'Retirada feita')
  assert.equal(gaivota.aMeio, 1)
})

test('montarProjetos: sem detalhe, cai no cartão da IA e no resumo da app', () => {
  const gaivota = projetoDe(montarProjetos(estadoDe()), 'g1')
  assert.equal(gaivota.principal.pedi, 'Deploy')
  assert.equal(gaivota.principal.respondeu, 'Build')
  assert.equal(gaivota.outros[0].respondeu, 'build feita')
  assert.equal(gaivota.outros[0].plano, null)
})

test('montarProjetos: um projeto sem chats não aparece e muitos chats ficam num «+N»', () => {
  const e = estadoDe()
  const muitos = Array.from({ length: MAX_CHATS + 3 }, (_, i) => chatDe(`m${i}`, { mensagemEm: agora - (i + 1) * M, caminho: 'Marketing' }))
  e.arvore.push(grupo('g3', 'Marketing', muitos), grupo('g4', 'Vazio', []))
  e.recentes.push(...muitos)
  const p = montarProjetos(e)
  const m = projetoDe(p, 'g3')
  assert.equal(m.total, MAX_CHATS + 3)
  assert.equal(m.outros.length, MAX_CHATS - 1)
  assert.equal(m.maisChats, 3)
  assert.equal(p.some(x => x.id === 'g4'), false)
})

test('pontosDe: a prioridade pesa mais, a tua vez sobe, o em curso desce e o esquecido volta à cima', () => {
  assert.ok(pontosDe({ prioridade: 5 }) > pontosDe({ prioridade: 4, diasParado: 99 }), 'o esquecimento nunca passa uma prioridade inteira')
  assert.ok(pontosDe({ prioridade: 3, tuaVez: true }) > pontosDe({ prioridade: 3 }))
  assert.ok(pontosDe({ prioridade: 3, emCurso: true }) < pontosDe({ prioridade: 3 }))
  assert.ok(pontosDe({ prioridade: 2, diasParado: 8 }) > pontosDe({ prioridade: 2, diasParado: 1 }))
  assert.equal(pontosDe({ prioridade: 2, diasParado: 99 }), pontosDe({ prioridade: 2, diasParado: 8 }), 'os dias param de contar aos 8')
})

test('montarProjetos: os chats arquivados (que o estado já não traz) não entram em nenhum projeto', () => {
  const e = estadoDe()
  // O estado só traz chats abertos: um arquivado não está nos recentes, mesmo que ainda esteja no grupo.
  e.recentes = e.recentes.filter(c => c.local !== 'b')
  const gaivota = projetoDe(montarProjetos(e), 'g1')
  assert.equal(gaivota.total, 1)
  assert.deepEqual(gaivota.outros, [])
  assert.equal(JSON.stringify(gaivota).includes('Escolher'), false)
})

test('locaisParaDetalhe: só os chats mais recentes de cada projeto', () => {
  const e = estadoDe()
  const muitos = Array.from({ length: MAX_DETALHE + 2 }, (_, i) => chatDe(`m${i}`, { mensagemEm: agora - (i + 1) * M }))
  e.arvore.push(grupo('g3', 'Marketing', muitos))
  e.recentes.push(...muitos)
  const locais = locaisParaDetalhe(e)
  assert.equal([...locais].filter(l => l.startsWith('m')).length, MAX_DETALHE)
  assert.ok(locais.has('m0') && !locais.has(`m${MAX_DETALHE}`))
  assert.ok(locais.has('a') && locais.has('b') && locais.has('c'))
  assert.equal(locais.has('d'), false, 'chats sem grupo não têm projeto')
})
