import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chaveDoModelo, criarHistorico, estadoVazio, lerNovo, listarTranscricoes, objetoEm, processarLinha, tokensDoUso } from '../lib/historico.mjs'

const S = '0b54afaf-1cd9-4363-a7fa-f4060321a4fe'
const T = h => new Date(2026, 10, 3, h, 0).toISOString()
const uso = (saida, extra = {}) => ({ input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: saida, cache_creation: { ephemeral_1h_input_tokens: 100, ephemeral_5m_input_tokens: 0 }, iterations: [{ x: { y: 1 } }], speed: 'standard', ...extra })
const assistente = (id, ts, u, modelo = 'claude-opus-5-5', texto = 'olá') => JSON.stringify({
  parentUuid: 'p', isSidechain: false,
  message: { model: modelo, id, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', input: { usage: { output_tokens: 999999 }, texto } }], stop_reason: 'tool_use', usage: u },
  requestId: 'req_1', type: 'assistant', uuid: 'u', timestamp: ts, cwd: 'C:\\Users\\x\\Projetos\\caravana', sessionId: S,
})
const humano = (ts, extra = {}) => JSON.stringify({ parentUuid: 'p', isSidechain: false, promptId: 'x', type: 'user', message: { role: 'user', content: 'segredo do utilizador' }, uuid: 'u', timestamp: ts, turnOrigin: 'human', cwd: 'C:\\x', sessionId: S, ...extra })
const resultado = ts => JSON.stringify({ parentUuid: 'p', isSidechain: false, type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] }, uuid: 'u', timestamp: ts })

test('objetoEm lê um objeto com chavetas dentro de textos', () => {
  const texto = 'xx {"a":"}{","b":{"c":1}} resto'
  assert.equal(objetoEm(texto, 3), '{"a":"}{","b":{"c":1}}')
})

test('tokens por categoria: escrita de 5 min e de 1 h; sem divisão conta como 5 min', () => {
  assert.deepEqual(tokensDoUso(uso(50)), { entrada: 10, saida: 50, cache5m: 0, cache1h: 100, leitura: 1000 })
  assert.equal(tokensDoUso({ cache_creation_input_tokens: 70 }).cache5m, 70)
})

test('chave do modelo: sem data, modo rápido, Haiku 5.5 longo, nomes antigos', () => {
  const t = { entrada: 10, cache5m: 0, cache1h: 0, leitura: 0 }
  assert.equal(chaveDoModelo('claude-sonnet-4-5-20250929', {}, t), 'claude-sonnet-4-5')
  assert.equal(chaveDoModelo('claude-opus-5-5', { speed: 'fast' }, t), 'claude-opus-5-5#rapido')
  assert.equal(chaveDoModelo('claude-haiku-5-5', {}, { ...t, leitura: 100_001 }), 'claude-haiku-5-5#longo')
  assert.equal(chaveDoModelo('claude-3-5-haiku-20241022', {}, t), 'claude-3-5-haiku')
  assert.equal(chaveDoModelo('claude-opus-4-20250514', {}, t), 'claude-opus-4')
})

test('linhas: a mesma mensagem repetida pelo streaming conta uma vez, com a contagem final; o usage dentro do conteúdo não engana', () => {
  const e = estadoVazio('x')
  processarLinha(e, assistente('msg_1', T(10), uso(5)))
  processarLinha(e, assistente('msg_1', T(10), uso(50)))
  processarLinha(e, assistente('msg_2', T(11), uso(7), 'claude-sonnet-5'))
  processarLinha(e, assistente('msg_3', T(11), uso(1), '<synthetic>'))
  assert.equal(e.pendente.id, 'msg_2')
  const dia = Object.values(e.dias)[0]
  assert.deepEqual(dia['claude-opus-5-5'], { entrada: 10, saida: 50, cache5m: 0, cache1h: 100, leitura: 1000, respostas: 1 })
  assert.equal(e.cwd, 'C:\\Users\\x\\Projetos\\caravana')
  assert.equal(e.sessao, S)
})

test('mensagens tuas: só as humanas; resultados de ferramentas, meta, subagentes e avisos do sistema não', () => {
  const e = estadoVazio('x')
  processarLinha(e, humano(T(9)))
  processarLinha(e, humano(T(9), { turnOrigin: 'task_notification', promptSource: 'system' }))
  processarLinha(e, humano(T(9), { isMeta: true }))
  processarLinha(e, humano(T(9), { isSidechain: true }))
  processarLinha(e, resultado(T(9)))
  const antiga = JSON.parse(humano(T(10)))
  delete antiga.turnOrigin
  processarLinha(e, JSON.stringify(antiga))
  processarLinha(e, JSON.stringify({ ...antiga, promptSource: 'system' }))
  assert.deepEqual(e.humanos, [Date.parse(T(9)), Date.parse(T(10))])
})

test('bocados de trabalho: linhas a menos de 5 min juntam-se', () => {
  const e = estadoVazio('x')
  const base = Date.parse(T(9))
  for (const m of [0, 2, 4, 20, 21]) processarLinha(e, resultado(new Date(base + m * 60_000).toISOString()))
  assert.deepEqual(e.ocupado, [[base, base + 4 * 60_000]])
  assert.deepEqual(e.seg, [base + 20 * 60_000, base + 21 * 60_000])
})

test('leitura incremental: só linhas completas, continua do sítio; ficheiro reescrito lê-se de novo', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'gestor-hist-'))
  const f = join(pasta, 'a.jsonl')
  await writeFile(f, `${humano(T(9))}\n${assistente('msg_1', T(9), uso(5))}\n${humano(T(10)).slice(0, 20)}`)
  const e = estadoVazio(f)
  assert.equal(await lerNovo(e, f), true)
  assert.equal(e.humanos.length, 1)
  await appendFile(f, `${humano(T(10)).slice(20)}\n`)
  assert.equal(await lerNovo(e, f), true)
  assert.equal(e.humanos.length, 2)
  assert.equal(await lerNovo(e, f), false)
  await writeFile(f, `${humano(T(11))}\n`)
  await lerNovo(e, f)
  assert.deepEqual(e.humanos, [Date.parse(T(11))])
})

test('lista as transcrições dos chats e dos subagentes, com a sessão de cada uma', async () => {
  const base = await mkdtemp(join(tmpdir(), 'gestor-proj-'))
  await mkdir(join(base, 'C--x', S, 'subagents', 'workflows', 'wf_1'), { recursive: true })
  await writeFile(join(base, 'C--x', `${S}.jsonl`), '')
  await writeFile(join(base, 'C--x', S, 'subagents', 'agent-1.jsonl'), '')
  await writeFile(join(base, 'C--x', S, 'subagents', 'workflows', 'wf_1', 'agent-2.jsonl'), '')
  await writeFile(join(base, 'C--x', 'outro.txt'), '')
  const lista = (await listarTranscricoes(base)).map(x => [x.sessao, x.subagente]).sort()
  assert.deepEqual(lista, [[S, false], [S, true], [S, true]])
})

test('o histórico guarda o índice e não leva o texto das mensagens', async () => {
  const base = await mkdtemp(join(tmpdir(), 'gestor-proj-'))
  const pasta = join(base, 'historico')
  await mkdir(join(base, 'C--x'), { recursive: true })
  await writeFile(join(base, 'C--x', `${S}.jsonl`), `${humano(T(9))}\n${assistente('msg_1', T(9), uso(5), 'claude-opus-5-5', 'resposta secreta')}\n`)
  const h = criarHistorico({ base, pasta })
  await h.atualizar()
  assert.equal(h.pronto(), true)
  assert.equal(h.estados().length, 1)
  const indice = await readFile(join(pasta, 'indice.json'), 'utf8')
  assert.equal(indice.includes('segredo do utilizador'), false)
  assert.equal(indice.includes('resposta secreta'), false)
  const outra = criarHistorico({ base, pasta })
  await outra.atualizar()
  assert.equal(outra.estados()[0].humanos.length, 1)
})
