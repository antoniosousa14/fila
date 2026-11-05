import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, writeFile, readFile, rm, utimes } from 'node:fs/promises'
import { createServer, request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { criarServidor } from '../servidor.mjs'
import { pastas, localValido, uuidValido } from '../lib/caminhos.mjs'

const SESSAO = '0b54afaf-1cd9-4363-a7fa-f4060321a4fe'
const LOCAL = 'local_1d654087-8b79-4235-b91f-aecc4474fc2a'
const GRUPO_F = 'cg-b1ae0a97-cd9b-4002-9b5a-6e361a30a21d'
const GRUPO_M = 'cg-8964c94e-0142-4eb8-961c-86416ada9a09'

async function preparar() {
  const base = await mkdtemp(join(tmpdir(), 'gestor-servidor-'))
  const raiz = join(base, 'fila')
  const sessoes = join(base, 'sessoes')
  const web = join(base, 'web')
  await mkdir(join(raiz, 'itens'), { recursive: true })
  await mkdir(join(sessoes, 'conta', 'org'), { recursive: true })
  await mkdir(web)
  const agora = Date.now()
  await writeFile(join(sessoes, 'conta', 'org', `${LOCAL}.json`), JSON.stringify({
    sessionId: LOCAL, cliSessionId: SESSAO, title: 'Permissões', cwd: 'C:\\x\\FAROL', lastActivityAt: agora,
  }))
  // Uma transcrição do chat de teste: uma mensagem tua e uma resposta do Opus 5.5.
  const projetos = join(base, 'projetos')
  await mkdir(join(projetos, 'C--x-FAROL'), { recursive: true })
  const ts = new Date(agora - 60_000).toISOString()
  await writeFile(join(projetos, 'C--x-FAROL', `${SESSAO}.jsonl`), [
    JSON.stringify({ parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: 'pergunta privada' }, uuid: 'u1', timestamp: ts, turnOrigin: 'human', cwd: 'C:\\x\\FAROL', sessionId: SESSAO }),
    JSON.stringify({ parentUuid: 'u1', isSidechain: false, message: { model: 'claude-opus-5-5', id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'resposta' }], stop_reason: 'end_turn', usage: { input_tokens: 1000000, output_tokens: 1000000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }, requestId: 'req_1', type: 'assistant', uuid: 'u2', timestamp: ts, cwd: 'C:\\x\\FAROL', sessionId: SESSAO }),
    '',
  ].join('\n'))
  await writeFile(join(raiz, 'itens', `${SESSAO}.json`), JSON.stringify({
    sessao: SESSAO, local: LOCAL, titulo: 'Ola', projeto: 'FAROL', estado: 'a-espera', desde: 1000,
    classificacao: { importancia: 4, tipo: 'aprovacao', esforco: 'segundos', desbloqueia: true, rotulo: 'Deploy', cartao: { pediste: 'a', fez: 'b', precisa: 'Aprovar' } },
  }))
  await writeFile(join(raiz, 'barra.json'), JSON.stringify({
    geradaEm: agora,
    modelo: { vazia: false, cabeca: '', chips: [{ sessao: SESSAO, local: LOCAL, desde: 1000, numero: 1, texto: 'FAROL · Deploy', nota: '5s', cor: '', silenciado: false }], mais: 0, aTrabalhar: '', extra: [] },
    trabalho: [],
  }))
  // Os grupos da barra lateral do Claude: FAROL, com o chat de teste, e Matriz, vazio.
  await writeFile(join(base, 'config.json'), JSON.stringify({
    mcpServers: { x: { env: { TOKEN: 'segredo-de-teste' } } },
    preferences: { epitaxyPrefs: {
      'dframe-group-scopes': { 'conta/org': { groups: [{ id: GRUPO_F, name: 'FAROL' }, { id: GRUPO_M, name: 'Matriz' }], assignments: { [`code:${LOCAL}`]: GRUPO_F } } },
      'dframe-code-sections': { 'conta/org': { sections: [{ id: GRUPO_F, kind: 'manual', order: 2 }, { id: GRUPO_M, kind: 'manual', order: 3 }] } },
    } },
  }))
  await writeFile(join(web, 'index.html'), '<!doctype html><title>Fila · gestor de chats</title>')
  await writeFile(join(web, 'estilo.css'), 'body{}')

  return { base, raiz, sessoes, web }
}

async function arrancar(t, opcoes = {}) {
  const p = await preparar()
  const abertos = []
  const links = []
  const gestor = await criarServidor({
    pastas: { ...pastas({ FILA_RAIZ: p.raiz, FILA_SESSOES: p.sessoes, FILA_CONFIG_APP: join(p.base, 'config.json'), FILA_PROJETOS: join(p.base, 'projetos') }), web: p.web },
    portaInicial: 0,
    abrir: local => abertos.push(local),
    abrirUrl: url => links.push(url),
    // Nunca há rede nem chave de Admin real nos testes.
    chaveAdmin: '',
    buscar: async () => { throw new Error('sem rede nos testes') },
    ...opcoes,
  })
  t.after(async () => { await gestor.historicoPronto(); await gestor.fechar(); await rm(p.base, { recursive: true, force: true }) })

  return { ...p, ...gestor, abertos, links }
}

function pedido(porta, { metodo = 'GET', caminho = '/', corpo, cabecalhos = {} } = {}) {
  return new Promise((resolver, rejeitar) => {
    const texto = corpo === undefined ? undefined : typeof corpo === 'string' ? corpo : JSON.stringify(corpo)
    const req = request({
      host: '127.0.0.1', port: porta, method: metodo, path: caminho,
      headers: { ...(texto !== undefined && { 'content-type': 'application/json' }), ...cabecalhos },
    }, res => {
      let dados = ''
      res.setEncoding('utf8')
      res.on('data', d => (dados += d))
      res.on('end', () => resolver({ estado: res.statusCode, cabecalhos: res.headers, texto: dados, json: () => JSON.parse(dados) }))
    })
    req.on('error', rejeitar)
    req.end(texto)
  })
}

const post = (porta, caminho, corpo, cabecalhos = {}) =>
  pedido(porta, { metodo: 'POST', caminho, corpo, cabecalhos: { origin: `http://127.0.0.1:${porta}`, ...cabecalhos } })

test('ids: local_ e sessão têm de ser UUID completos', () => {
  assert.ok(localValido(LOCAL))
  assert.ok(uuidValido(SESSAO))
  for (const mau of ['local_' + '-'.repeat(36), 'local_../../x', `${LOCAL} `, `${LOCAL}&calc`, 'x', 42, undefined]) assert.equal(localValido(mau), false, String(mau))
  for (const mau of ['../itens/x', `${SESSAO}.json`, SESSAO.toUpperCase().replace(/F/g, 'G'), null]) assert.equal(uuidValido(mau), false, String(mau))
})

test('pastas por omissão vêm de USERPROFILE e APPDATA', () => {
  const p = pastas({ USERPROFILE: 'C:\\Users\\x', APPDATA: 'C:\\Users\\x\\AppData\\Roaming' })
  assert.equal(p.raiz, join('C:\\Users\\x', '.claude', 'fila-atencao'))
  assert.equal(p.itens, join(p.raiz, 'itens'))
  assert.equal(p.sessoes, join('C:\\Users\\x\\AppData\\Roaming', 'Claude', 'claude-code-sessions'))
})

test('GET /api/estado junta sessões e fila', async t => {
  const { porta } = await arrancar(t)
  const r = await pedido(porta, { caminho: '/api/estado' })
  assert.equal(r.estado, 200)
  assert.match(r.cabecalhos['content-type'], /application\/json/)
  const estado = r.json()
  assert.equal(estado.espera.length, 1)
  assert.equal(estado.espera[0].titulo, 'Permissões')
  assert.equal(estado.espera[0].precisa, 'Aprovar')
  assert.equal(estado.numeros.espera, 1)
  assert.deepEqual(estado.arvore.map(n => [n.nome, n.total]), [['FAROL', 1], ['Matriz', 0]])
  assert.equal(estado.espera[0].caminho, 'FAROL')
  assert.equal(JSON.stringify(estado).includes('segredo-de-teste'), false)
})

test('o chat onde escreveste por último (foco.json), escondido da barra pelo mod, também está à espera no gestor', async t => {
  const { porta, raiz } = await arrancar(t)
  // O mod publica a barra sem o chat do foco; o item continua a estar à espera.
  await writeFile(join(raiz, 'barra.json'), JSON.stringify({
    geradaEm: Date.now(), modelo: { vazia: true, resumo: 'Nada à tua espera · 0 a trabalhar' }, trabalho: [],
  }))
  assert.deepEqual((await pedido(porta, { caminho: '/api/estado' })).json().espera, [])
  await writeFile(join(raiz, 'foco.json'), JSON.stringify({ sessao: SESSAO, em: Date.now() }))
  const estado = (await pedido(porta, { caminho: '/api/estado' })).json()
  assert.deepEqual(estado.espera.map(e => [e.sessao, e.local, e.precisa]), [[SESSAO, LOCAL, 'Aprovar']])
  assert.equal(estado.numeros.espera, 1)
  // Os projetos contam-no também (é a tua vez nesse projeto).
  const projeto = (await pedido(porta, { caminho: '/api/projetos' })).json().projetos.find(p => p.id === GRUPO_F)
  assert.equal(projeto.espera, 1)
  // foco.json estragado ou com outro tipo não parte nada.
  await writeFile(join(raiz, 'foco.json'), '{{ não é json')
  assert.deepEqual((await pedido(porta, { caminho: '/api/estado' })).json().espera, [])
})

test('GET /api/projetos: um projeto por grupo, com onde ficaste tirado da transcrição', async t => {
  const { porta } = await arrancar(t)
  const r = await pedido(porta, { caminho: '/api/projetos' })
  assert.equal(r.estado, 200)
  const { projetos } = r.json()
  // O grupo Matriz não tem chats: não é um projeto.
  assert.deepEqual(projetos.map(p => [p.nome, p.total, p.espera]), [['FAROL', 1, 1]])
  const principal = projetos[0].principal
  assert.equal(principal.titulo, 'Permissões')
  assert.equal(principal.estado, 'espera')
  assert.equal(principal.precisa, 'Aprovar')
  assert.equal(principal.pedi, 'pergunta privada')
  assert.equal(principal.respondeu, 'resposta')
  assert.equal(JSON.stringify(projetos).includes('segredo-de-teste'), false)
})

test('GET /api/projetos aguenta uma transcrição que não existe', async t => {
  const { porta, base } = await arrancar(t)
  await rm(join(base, 'projetos'), { recursive: true, force: true })
  const { projetos } = (await pedido(porta, { caminho: '/api/projetos' })).json()
  assert.equal(projetos[0].principal.pedi, 'a', 'cai no cartão da IA')
  assert.equal(projetos[0].principal.respondeu, 'b')
})

test('POST /api/projeto: sem importância, dispensar e esconder linhas mudam o projeto', async t => {
  const { porta, raiz } = await arrancar(t)
  const ver = async () => (await pedido(porta, { caminho: '/api/projetos' })).json()
  let p = (await ver()).projetos[0]
  assert.equal(p.semImportancia, false)
  assert.equal(p.dispensado, false)
  assert.equal((await post(porta, '/api/projeto', { acao: 'sem-importancia', grupo: GRUPO_F })).estado, 200)
  p = (await ver()).projetos[0]
  assert.equal(p.semImportancia, true)
  // A linha «Aprovar» (o que precisa de ti) pode esconder-se, e some do que falta.
  assert.ok(p.porFazer.some(i => i.texto === 'Aprovar'))
  await post(porta, '/api/projeto', { acao: 'esconder-linha', grupo: GRUPO_F, texto: 'Aprovar' })
  p = (await ver()).projetos[0]
  assert.equal(p.porFazer.some(i => i.texto === 'Aprovar'), false)
  assert.equal(p.linhasEscondidas, 1)
  await post(porta, '/api/projeto', { acao: 'repor-linhas', grupo: GRUPO_F })
  assert.equal((await ver()).projetos[0].linhasEscondidas, 0)
  // Dispensar até haver novidades: guarda a hora da última mensagem do projeto.
  await post(porta, '/api/projeto', { acao: 'dispensar', grupo: GRUPO_F, desde: p.ultimaEm })
  assert.equal((await ver()).projetos[0].dispensado, true)
  assert.equal((await ver()).resumo.dispensados, 1)
  await post(porta, '/api/projeto', { acao: 'repor', grupo: GRUPO_F })
  assert.equal((await ver()).projetos[0].dispensado, false)
  const guardado = JSON.parse(await readFile(join(raiz, 'projetos-marcas.json'), 'utf8'))
  assert.deepEqual(guardado.grupos[GRUPO_F], { semImportancia: true })
})

test('POST /api/projeto recusa pedidos inválidos e Origin estranho', async t => {
  const { porta } = await arrancar(t)
  assert.equal((await post(porta, '/api/projeto', { acao: 'sem-importancia', grupo: 'x' })).estado, 400)
  assert.equal((await post(porta, '/api/projeto', { acao: 'fazer-coisas', grupo: GRUPO_F })).estado, 400)
  assert.equal((await post(porta, '/api/projeto', { acao: 'dispensar', grupo: GRUPO_F })).estado, 400)
  assert.equal((await pedido(porta, { metodo: 'POST', caminho: '/api/projeto', corpo: { acao: 'sem-importancia', grupo: GRUPO_F } })).estado, 403)
})

test('um chat arquivado sai da espera e dos projetos e fica dispensado na pílula', async t => {
  const { porta, sessoes, raiz } = await arrancar(t)
  await writeFile(join(sessoes, 'conta', 'org', `${LOCAL}.json`), JSON.stringify({
    sessionId: LOCAL, cliSessionId: SESSAO, title: 'Permissões', cwd: 'C:\\x\\FAROL', lastActivityAt: Date.now(), isArchived: true,
  }))
  const estado = (await pedido(porta, { caminho: '/api/estado' })).json()
  assert.deepEqual(estado.espera, [])
  assert.equal(estado.recentes.length, 0)
  assert.equal(estado.numeros.espera, 0)
  assert.deepEqual((await pedido(porta, { caminho: '/api/projetos' })).json().projetos, [])
  // A pílula (que lê o barra.json) respeita o ficheiro de dispensas: o chat arquivado ficou dispensado.
  const dispensa = JSON.parse(await readFile(join(raiz, 'itens', `${SESSAO}.dispensado.json`), 'utf8'))
  assert.equal(dispensa.desde, 1000)
})

test('um a trabalhar preso depois de um /clear sai do painel e fica dispensado para a pílula e o mod', async t => {
  const { porta, sessoes, raiz } = await arrancar(t)
  const desde = Date.now() - 60_000
  await writeFile(join(raiz, 'barra.json'), JSON.stringify({
    geradaEm: Date.now(),
    modelo: { vazia: true, resumo: '' },
    trabalho: [{ sessao: SESSAO, local: LOCAL, titulo: 'Permissões', projeto: 'FAROL', desde, pedido: '/clera', feitos: 0, total: 0, ferramentas: 0 }],
  }))
  // Antes do /clear o chat está mesmo a trabalhar e nada fica dispensado.
  assert.equal((await pedido(porta, { caminho: '/api/estado' })).json().trabalho.length, 1)
  await assert.rejects(readFile(join(raiz, 'itens', `${SESSAO}.dispensado.json`)))
  // O /clear: a app passa o chat para outra sessão do CLI e regista quando largou a antiga.
  const ficheiro = join(sessoes, 'conta', 'org', `${LOCAL}.json`)
  await writeFile(ficheiro, JSON.stringify({
    sessionId: LOCAL, cliSessionId: '9d2f6c1e-0b7a-4f3e-8a11-5c6d7e8f9a0b', priorCliSessionIds: [SESSAO],
    priorCliSessionLeftAt: { [SESSAO]: desde + 2_000 }, title: 'Permissões', cwd: 'C:\\x\\FAROL', lastActivityAt: Date.now(),
  }))
  const futuro = new Date(Date.now() + 5_000)
  await utimes(ficheiro, futuro, futuro)
  const estado = (await pedido(porta, { caminho: '/api/estado' })).json()
  assert.deepEqual(estado.trabalho, [])
  assert.equal(estado.numeros.trabalho, 0)
  const dispensa = JSON.parse(await readFile(join(raiz, 'itens', `${SESSAO}.dispensado.json`), 'utf8'))
  assert.equal(dispensa.desde, desde)
})

test('o estado traz o chat orquestrador de orquestrador.json, só se o id for válido', async t => {
  const { porta, raiz } = await arrancar(t)
  assert.equal((await pedido(porta, { caminho: '/api/estado' })).json().orquestrador, null)
  await writeFile(join(raiz, 'orquestrador.json'), JSON.stringify({ local: LOCAL }))
  assert.equal((await pedido(porta, { caminho: '/api/estado' })).json().orquestrador, LOCAL)
  await writeFile(join(raiz, 'orquestrador.json'), JSON.stringify({ local: 'local_x" onclick="' }))
  assert.equal((await pedido(porta, { caminho: '/api/estado' })).json().orquestrador, null)
})

test('itens com mais de 7 dias não contam (como no mod)', async t => {
  const { porta, raiz } = await arrancar(t)
  const velho = new Date(Date.now() - 8 * 24 * 3_600_000)
  await writeFile(join(raiz, 'itens', 'aaaaaaaa-1cd9-4363-a7fa-f4060321a4fe.json'), JSON.stringify({ sessao: 'aaaaaaaa-1cd9-4363-a7fa-f4060321a4fe', estado: 'a-espera', desde: Date.now() }))
  await utimes(join(raiz, 'itens', 'aaaaaaaa-1cd9-4363-a7fa-f4060321a4fe.json'), velho, velho)
  const { numeros } = (await pedido(porta, { caminho: '/api/estado' })).json()
  assert.equal(numeros.turnosHoje, 0)
})

test('sem ficheiros da fila o estado vem vazio, não dá erro', async t => {
  const { porta, raiz } = await arrancar(t)
  await rm(join(raiz, 'barra.json'))
  await rm(join(raiz, 'itens'), { recursive: true })
  const r = await pedido(porta, { caminho: '/api/estado' })
  assert.equal(r.estado, 200)
  assert.deepEqual(r.json().espera, [])
})

test('serve a página e os estáticos de web/, com cabeçalhos de segurança', async t => {
  const { porta } = await arrancar(t)
  const pagina = await pedido(porta, { caminho: '/' })
  assert.equal(pagina.estado, 200)
  assert.match(pagina.cabecalhos['content-type'], /text\/html/)
  assert.match(pagina.texto, /gestor de chats/)
  assert.match(pagina.cabecalhos['content-security-policy'], /script-src 'self'/)
  assert.equal(pagina.cabecalhos['x-content-type-options'], 'nosniff')
  const css = await pedido(porta, { caminho: '/web/estilo.css' })
  assert.equal(css.estado, 200)
  assert.match(css.cabecalhos['content-type'], /text\/css/)
})

test('não sai de web/ nem serve o que não existe', async t => {
  const { porta } = await arrancar(t)
  for (const caminho of ['/web/../servidor.mjs', '/web/%2e%2e/servidor.mjs', '/web/..%2fservidor.mjs', '/web/..%5cservidor.mjs', '/web/nao.css', '/servidor.mjs', '/web/']) {
    assert.equal((await pedido(porta, { caminho })).estado, 404, caminho)
  }
})

test('Host estranho é recusado (DNS rebinding)', async t => {
  const { porta } = await arrancar(t)
  const r = await pedido(porta, { caminho: '/api/estado', cabecalhos: { host: `mal.exemplo:${porta}` } })
  assert.equal(r.estado, 403)
  assert.equal((await pedido(porta, { caminho: '/api/estado', cabecalhos: { host: `localhost:${porta}` } })).estado, 200)
})

test('POST com Origin estranho ou sem Origin é recusado', async t => {
  const { porta, abertos } = await arrancar(t)
  assert.equal((await post(porta, '/api/abrir', { local: LOCAL }, { origin: 'http://mal.exemplo' })).estado, 403)
  assert.equal((await pedido(porta, { metodo: 'POST', caminho: '/api/abrir', corpo: { local: LOCAL } })).estado, 403)
  assert.deepEqual(abertos, [])
})

test('abrir: local válido chama abrir; inválido, JSON estragado ou tipo errado não', async t => {
  const { porta, abertos } = await arrancar(t)
  assert.equal((await post(porta, '/api/abrir', { local: LOCAL })).estado, 200)
  assert.deepEqual(abertos, [LOCAL])
  assert.equal((await post(porta, '/api/abrir', { local: 'local_../../calc' })).estado, 400)
  assert.equal((await post(porta, '/api/abrir', '{"local":')).estado, 400)
  assert.equal((await post(porta, '/api/abrir', 'local=x', { 'content-type': 'text/plain' })).estado, 415)
  assert.equal((await post(porta, '/api/abrir', { local: 'x'.repeat(20_000) })).estado, 413)
  assert.deepEqual(abertos, [LOCAL])
})

test('abrir deixa o sinal para a barra pôr o Claude à frente; um pedido recusado não', async t => {
  const { porta, raiz } = await arrancar(t)
  const sinal = join(raiz, 'claude-a-frente.json')
  assert.equal((await post(porta, '/api/abrir', { local: 'local_../../calc' })).estado, 400)
  await assert.rejects(readFile(sinal))
  const antes = Date.now()
  assert.equal((await post(porta, '/api/abrir', { local: LOCAL })).estado, 200)
  // O sinal é escrito sem esperar; dá-lhe um instante.
  await new Promise(ok => setTimeout(ok, 50))
  assert.ok(JSON.parse(await readFile(sinal, 'utf8')).em >= antes)
})

test('dispensar escreve o ficheiro que a barra e o mod leem e tira o chat da espera', async t => {
  const { porta, raiz } = await arrancar(t)
  assert.equal((await post(porta, '/api/dispensar', { sessao: SESSAO, desde: 1000 })).estado, 200)
  const escrito = JSON.parse(await readFile(join(raiz, 'itens', `${SESSAO}.dispensado.json`), 'utf8'))
  assert.deepEqual(escrito, { desde: 1000 })
  assert.deepEqual((await pedido(porta, { caminho: '/api/estado' })).json().espera, [])
})

test('dispensar recusa sessão que não é UUID e desde que não é número', async t => {
  const { porta, raiz } = await arrancar(t)
  assert.equal((await post(porta, '/api/dispensar', { sessao: '../barra', desde: 1 })).estado, 400)
  assert.equal((await post(porta, '/api/dispensar', { sessao: SESSAO, desde: '1' })).estado, 400)
  await assert.rejects(readFile(join(raiz, 'itens', `${SESSAO}.dispensado.json`)))
})

test('rotas desconhecidas dão 404 e método errado 405', async t => {
  const { porta } = await arrancar(t)
  assert.equal((await pedido(porta, { caminho: '/api/nada' })).estado, 404)
  assert.equal((await pedido(porta, { caminho: '/api/abrir' })).estado, 405)
  assert.equal((await post(porta, '/api/estado', {})).estado, 405)
})

test('escreve gestor.json com a porta e o pid', async t => {
  const { porta, raiz } = await arrancar(t)
  assert.deepEqual(JSON.parse(await readFile(join(raiz, 'gestor.json'), 'utf8')), { porta, pid: process.pid })
})

test('porta ocupada: tenta as seguintes', async t => {
  const ocupado = createServer()
  await new Promise(r => ocupado.listen(0, '127.0.0.1', r))
  t.after(() => new Promise(r => ocupado.close(r)))
  const primeira = ocupado.address().port
  const { porta } = await arrancar(t, { portaInicial: primeira })
  assert.ok(porta > primeira && porta <= primeira + 5, `${porta} depois de ${primeira}`)
  assert.equal((await pedido(porta, { caminho: '/api/estado' })).estado, 200)
})

const organizar = (porta, corpo) => post(porta, '/api/organizacao', corpo)
const estadoDe = async porta => (await pedido(porta, { caminho: '/api/estado' })).json()

test('pastas-mãe: começa sem nenhuma; criar, pôr um grupo do Claude dentro e o caminho muda', async t => {
  const { porta, raiz } = await arrancar(t)
  assert.deepEqual((await estadoDe(porta)).organizacao.pastas, [])
  const r = await organizar(porta, { acao: 'criar-pasta', nome: 'Escola' })
  assert.equal(r.estado, 200)
  const { id } = r.json()
  assert.equal((await organizar(porta, { acao: 'mover-grupo', grupo: GRUPO_F, pasta: id })).estado, 200)
  const e = await estadoDe(porta)
  assert.equal(e.espera[0].caminho, 'Escola / FAROL')
  assert.deepEqual(e.arvore.map(n => [n.nome, n.tipo]), [['Escola', 'pasta'], ['Matriz', 'grupo']])
  const gravada = JSON.parse(await readFile(join(raiz, 'organizacao.json'), 'utf8'))
  assert.deepEqual(gravada.grupos, { [GRUPO_F]: id })
  assert.equal(gravada.versao, 2)
})

test('pastas-mãe: renomear, subpasta, mover e apagar (os grupos sobem)', async t => {
  const { porta } = await arrancar(t)
  const mae = (await organizar(porta, { acao: 'criar-pasta', nome: 'Trabalho' })).json().id
  const filha = (await organizar(porta, { acao: 'criar-pasta', nome: 'Clientes', pai: mae })).json().id
  await organizar(porta, { acao: 'mover-grupo', grupo: GRUPO_M, pasta: filha })
  assert.equal((await organizar(porta, { acao: 'renomear-pasta', id: filha, nome: 'Os clientes' })).estado, 200)
  assert.equal((await estadoDe(porta)).organizacao.grupos.find(g => g.id === GRUPO_M).caminho, 'Trabalho / Os clientes / Matriz')
  assert.equal((await organizar(porta, { acao: 'mover-pasta', id: mae, pai: filha })).estado, 400)
  assert.equal((await organizar(porta, { acao: 'apagar-pasta', id: filha })).estado, 200)
  assert.equal((await estadoDe(porta)).organizacao.grupos.find(g => g.id === GRUPO_M).caminho, 'Trabalho / Matriz')
})

test('pastas-mãe: pedidos inválidos são recusados sem gravar; os grupos e chats do Claude não se editam aqui', async t => {
  const { porta, raiz } = await arrancar(t)
  for (const corpo of [
    { acao: 'formatar' }, { acao: 'renomear-pasta', id: '../x', nome: 'a' }, { acao: 'criar-pasta', nome: '' },
    { acao: 'mover-grupo', grupo: 'cg-../x', pasta: null }, { acao: 'mover-chats', locais: [LOCAL], seccao: null },
    { acao: 'renomear', id: GRUPO_F, nome: 'Outro' }, { acao: 'criar', nome: 'x' },
  ]) assert.equal((await organizar(porta, corpo)).estado, 400, JSON.stringify(corpo))
  assert.equal((await post(porta, '/api/organizacao', { acao: 'criar-pasta', nome: 'x' }, { origin: 'http://mal.exemplo' })).estado, 403)
  assert.equal((await readdir(raiz)).includes('organizacao.json'), false)
})

test('pastas-mãe: pedidos ao mesmo tempo não se perdem', async t => {
  const { porta } = await arrancar(t)
  await Promise.all(['A1', 'A2', 'A3', 'A4', 'A5'].map(nome => organizar(porta, { acao: 'criar-pasta', nome })))
  assert.deepEqual((await estadoDe(porta)).organizacao.pastas.map(x => x.nome).sort(), ['A1', 'A2', 'A3', 'A4', 'A5'])
})

test('mudanças no Claude aparecem sozinhas: outro grupo para o chat', async t => {
  const { porta, base } = await arrancar(t)
  assert.equal((await estadoDe(porta)).espera[0].caminho, 'FAROL')
  const config = JSON.parse(await readFile(join(base, 'config.json'), 'utf8'))
  config.preferences.epitaxyPrefs['dframe-group-scopes']['conta/org'].assignments[`code:${LOCAL}`] = GRUPO_M
  await new Promise(r => setTimeout(r, 20))
  await writeFile(join(base, 'config.json'), JSON.stringify(config))
  assert.equal((await estadoDe(porta)).espera[0].caminho, 'Matriz')
})

test('o estado traz o consumo de consumo/<dia>.json', async t => {
  const { porta, raiz } = await arrancar(t)
  assert.deepEqual((await estadoDe(porta)).consumo.semana, null)
  const agora = Date.now()
  const d = new Date(agora)
  const dia = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  await mkdir(join(raiz, 'consumo'), { recursive: true })
  const resetsAt = new Date(agora + 2 * 24 * 3_600_000).toISOString()
  await writeFile(join(raiz, 'consumo', `${dia}.json`), JSON.stringify([
    { em: agora - 1000, sessao: SESSAO, tokens: 50, cache: 0, limites: [{ kind: 'seven_day', percentUsed: 61, resetsAt }, { kind: 'five_hour', percentUsed: 42, resetsAt }] },
  ]))
  const { consumo } = await estadoDe(porta)
  assert.equal(consumo.semana.percent, 61)
  assert.equal(consumo.sessao.percent, 42)
  assert.equal(consumo.dias.at(-1).tokens, 50)
})

const ORQ = 'local_0fb96971-e60c-4c2c-8431-ea67d0f85a9a'
async function comOrquestrador(t) {
  const g = await arrancar(t)
  await writeFile(join(g.raiz, 'orquestrador.json'), JSON.stringify({ local: ORQ }))

  return g
}

test('mensagens: preparar devolve os destinatários e o texto exatos e não escreve nada', async t => {
  const { porta, raiz } = await comOrquestrador(t)
  const r = await post(porta, '/api/mensagens/preparar', { para: [LOCAL], texto: '  Ponto de situação, por favor.\r\n' })
  assert.equal(r.estado, 200)
  const { id, para, texto } = r.json()
  assert.match(id, /^m_[a-z0-9]+$/)
  assert.deepEqual(para, [{ local: LOCAL, titulo: 'Permissões', caminho: 'FAROL' }])
  assert.equal(texto, 'Ponto de situação, por favor.')
  assert.equal((await readdir(raiz)).includes('saida'), false)
})

test('mensagens: só enviar com o id do que foi mostrado escreve saida/<id>.json, uma vez', async t => {
  const { porta, raiz } = await comOrquestrador(t)
  const { id } = (await post(porta, '/api/mensagens/preparar', { para: [LOCAL], texto: 'Olá' })).json()
  assert.equal((await post(porta, '/api/mensagens/enviar', { id: 'm_inventado1' })).estado, 404)
  assert.equal((await post(porta, '/api/mensagens/enviar', { id })).estado, 200)
  const pedidoEscrito = JSON.parse(await readFile(join(raiz, 'saida', `${id}.json`), 'utf8'))
  assert.deepEqual(pedidoEscrito.para, [LOCAL])
  assert.deepEqual(pedidoEscrito.sessoes, { [LOCAL]: SESSAO })
  assert.equal(pedidoEscrito.texto, 'Olá')
  assert.equal(pedidoEscrito.nomes[LOCAL], 'Permissões')
  assert.equal((await post(porta, '/api/mensagens/enviar', { id })).estado, 404)
  const [m] = (await estadoDe(porta)).mensagens
  assert.equal(m.estado, 'na-fila')
  assert.deepEqual(m.para.map(x => [x.titulo, x.entregue]), [['Permissões', null]])
})

test('mensagens: o resultado do carteiro aparece no estado', async t => {
  const { porta, raiz } = await comOrquestrador(t)
  const { id } = (await post(porta, '/api/mensagens/preparar', { para: [LOCAL], texto: 'Olá' })).json()
  await post(porta, '/api/mensagens/enviar', { id })
  await writeFile(join(raiz, 'saida', `${id}.resultado.json`), JSON.stringify({ em: Date.now(), resultados: [{ local: LOCAL, entregue: false, motivo: 'o chat não está a correr' }] }))
  const [m] = (await estadoDe(porta)).mensagens
  assert.equal(m.estado, 'feito')
  assert.deepEqual(m.para[0], { local: LOCAL, titulo: 'Permissões', entregue: false, motivo: 'o chat não está a correr' })
})

test('mensagens: recusa texto vazio, ids maus, chats que não existem, o orquestrador e sem orquestrador', async t => {
  const { porta } = await comOrquestrador(t)
  const preparar = corpo => post(porta, '/api/mensagens/preparar', corpo)
  assert.equal((await preparar({ para: [LOCAL], texto: '   ' })).estado, 400)
  assert.equal((await preparar({ para: [LOCAL], texto: 'a\u0007b' })).estado, 400)
  assert.equal((await preparar({ para: ['local_../x'], texto: 'a' })).estado, 400)
  assert.equal((await preparar({ para: ['local_aaaaaaaa-1cd9-4363-a7fa-f4060321a4fe'], texto: 'a' })).estado, 400)
  assert.equal((await preparar({ para: [], texto: 'a' })).estado, 400)
  assert.equal((await preparar({ para: [LOCAL], texto: 'x'.repeat(4001) })).estado, 400)
  const sem = await arrancar(t)
  assert.equal((await post(sem.porta, '/api/mensagens/preparar', { para: [LOCAL], texto: 'a' })).estado, 409)
})

test('novo chat: abre claude://code/new com a pasta e o texto, só para pastas que existem', async t => {
  const { porta, links, base } = await arrancar(t)
  assert.equal((await post(porta, '/api/novo-chat', { pasta: base, texto: 'Começa pelo README' })).estado, 200)
  const url = new URL(links[0])
  assert.equal(url.protocol, 'claude:')
  assert.equal(url.host, 'code')
  assert.equal(url.pathname, '/new')
  assert.equal(url.searchParams.get('folder'), base)
  assert.equal(url.searchParams.get('q'), 'Começa pelo README')
  assert.equal((await post(porta, '/api/novo-chat', { pasta: join(base, 'nao-existe') })).estado, 400)
  assert.equal((await post(porta, '/api/novo-chat', { pasta: 'C:\\' })).estado, 400)
  assert.equal((await post(porta, '/api/novo-chat', { pasta: `${base}" & calc` })).estado, 400)
  assert.equal((await post(porta, '/api/novo-chat', { pasta: base, texto: 'a\u0000' })).estado, 400)
  assert.equal(links.length, 1)
})

test('mensagens: um chat sem sessão do CLI agora (fechado) também pode receber, pelo local_', async t => {
  const { porta, raiz, sessoes } = await comOrquestrador(t)
  const outro = 'local_9a266efa-1601-4a6d-b5d3-e72ab68521e2'
  await writeFile(join(sessoes, 'conta', 'org', `${outro}.json`), JSON.stringify({ sessionId: outro, title: 'francisca', cwd: 'C:\\x\\F', lastActivityAt: 1 }))
  const { id } = (await post(porta, '/api/mensagens/preparar', { para: [LOCAL, outro], texto: 'Olá' })).json()
  await post(porta, '/api/mensagens/enviar', { id })
  const escrito = JSON.parse(await readFile(join(raiz, 'saida', `${id}.json`), 'utf8'))
  assert.deepEqual(escrito.para, [LOCAL, outro])
  assert.deepEqual(escrito.sessoes, { [LOCAL]: SESSAO })
})

test('histórico: lê as transcrições em fundo e devolve custos, chats e grupos, sem o texto', async t => {
  const { porta, raiz, historicoPronto } = await arrancar(t)
  await historicoPronto()
  const r = await pedido(porta, { caminho: '/api/historico' })
  assert.equal(r.estado, 200)
  const h = r.json()
  assert.equal(h.pronto, true)
  assert.equal(h.totais.total.custo, 4 + 20)
  assert.equal(h.totais.total.tokens, 2_000_000)
  assert.equal(h.chats[0].titulo, 'Permissões')
  assert.equal(h.grupos[0].nome, 'FAROL')
  assert.equal(h.modelos[0].nome, 'Claude Opus 5.5')
  assert.equal(h.mensal, null)
  assert.ok(h.limites)
  assert.match(h.precos.fonte, /platform\.claude\.com/)
  assert.equal(r.texto.includes('pergunta privada'), false)
  const dias = JSON.parse(await readFile(join(raiz, 'consumo', 'historico', 'dias.json'), 'utf8'))
  assert.equal(dias.dias.at(-1).custo, 24)
})

test('subscrição: valor, moeda e taxa gravam-se em consumo-config.json; a poupança sai na moeda da subscrição', async t => {
  const { porta, raiz, historicoPronto } = await arrancar(t)
  await historicoPronto()
  for (const mau of [{ mensal: -1 }, { mensal: 'x' }, { mensal: 1e9 }, { mensal: true }, { moeda: 'GBP' }, { usdPorEur: 0 }, { usdPorEur: 'a' }]) {
    assert.equal((await post(porta, '/api/consumo/config', mau)).estado, 400, JSON.stringify(mau))
  }
  assert.equal((await post(porta, '/api/consumo/config', { mensal: 100, moeda: 'USD' })).estado, 200)
  assert.equal(JSON.parse(await readFile(join(raiz, 'consumo-config.json'), 'utf8')).mensal, 100)
  let h = (await pedido(porta, { caminho: '/api/historico' })).json()
  assert.deepEqual([h.mensal, h.moeda], [100, 'USD'])
  assert.equal(h.meses.at(-1).poupanca, 24 - 100)
  assert.equal((await post(porta, '/api/consumo/config', { mensal: 110, moeda: 'EUR', usdPorEur: 1.2 })).estado, 200)
  const config = JSON.parse(await readFile(join(raiz, 'consumo-config.json'), 'utf8'))
  assert.deepEqual([config.moeda, config.usdPorEur, config.taxaFonte], ['EUR', 1.2, 'manual'])
  h = (await pedido(porta, { caminho: '/api/historico' })).json()
  assert.equal(h.meses.at(-1).custoNaMoeda, 20)
  assert.equal(h.meses.at(-1).poupanca, 20 - 110)
  assert.ok(h.ponta.mapa.length === 7 && h.ponta.mapa[0].length === 24)
  assert.equal(h.ponta.regraOficial, false)
})

test('subscrição por mês: o preço pago em cada mês grava-se, valida-se e sobrevive à taxa do BCE', async t => {
  const xml = "<gesmes:Envelope><Cube><Cube time='2026-11-03'><Cube currency='USD' rate='1.2'/></Cube></Cube></gesmes:Envelope>"
  const { porta, raiz, historicoPronto } = await arrancar(t, { buscar: async () => ({ ok: true, status: 200, text: async () => xml }) })
  await historicoPronto()
  for (const mau of [{ meses: [] }, { meses: 'x' }, { meses: { 'junho': 22 } }, { meses: { '2026-13': 22 } }, { meses: { '2026-06': -1 } }, { meses: { '2026-06': '22' } }, { meses: { '2026-06': 1e9 } }]) {
    assert.equal((await post(porta, '/api/consumo/config', mau)).estado, 400, JSON.stringify(mau))
  }
  assert.equal((await post(porta, '/api/consumo/config', { mensal: 110, moeda: 'EUR', usdPorEur: 1.2, meses: { '2026-06': 22, '2026-07': 22, '2026-11': 20 } })).estado, 200)
  const ler = async () => JSON.parse(await readFile(join(raiz, 'consumo-config.json'), 'utf8'))
  assert.deepEqual((await ler()).meses, { '2026-06': 22, '2026-07': 22, '2026-11': 20 })
  let h = (await pedido(porta, { caminho: '/api/historico' })).json()
  assert.deepEqual(h.mensalPorMes, { '2026-06': 22, '2026-07': 22, '2026-11': 20 })
  assert.equal(h.meses.at(-1).subscricao, 20)
  assert.equal(h.meses.at(-1).poupanca, 20 - 20)
  // Um pedido sem `meses` não os apaga; null ou '' tira só esse mês.
  assert.equal((await post(porta, '/api/consumo/config', { mensal: 120 })).estado, 200)
  assert.deepEqual((await ler()).meses, { '2026-06': 22, '2026-07': 22, '2026-11': 20 })
  assert.equal((await post(porta, '/api/consumo/config', { meses: { '2026-06': 22, '2026-07': 22, '2026-11': null } })).estado, 200)
  assert.deepEqual((await ler()).meses, { '2026-06': 22, '2026-07': 22 })
  h = (await pedido(porta, { caminho: '/api/historico' })).json()
  assert.equal(h.meses.at(-1).subscricao, 120)
  // A taxa do BCE só mexe na taxa.
  assert.equal((await post(porta, '/api/consumo/taxa-bce', {})).estado, 200)
  assert.deepEqual((await ler()).meses, { '2026-06': 22, '2026-07': 22 })
})

test('taxa do BCE: lê o XML de referência e grava a taxa com a data; erro do BCE não estraga nada', async t => {
  const xml = "<gesmes:Envelope><Cube><Cube time='2026-11-03'><Cube currency='USD' rate='1.1179'/><Cube currency='JPY' rate='170.1'/></Cube></Cube></gesmes:Envelope>"
  const pedidos = []
  const { porta, raiz, historicoPronto } = await arrancar(t, { buscar: async url => { pedidos.push(String(url)); return { ok: true, status: 200, text: async () => xml } } })
  await historicoPronto()
  const r = await post(porta, '/api/consumo/taxa-bce', {})
  assert.equal(r.estado, 200)
  assert.deepEqual(r.json(), { ok: true, usdPorEur: 1.1179, taxaData: '2026-11-03' })
  assert.match(pedidos[0], /^https:\/\/www\.ecb\.europa\.eu\//)
  const config = JSON.parse(await readFile(join(raiz, 'consumo-config.json'), 'utf8'))
  assert.deepEqual([config.usdPorEur, config.taxaData, config.taxaFonte], [1.1179, '2026-11-03', 'BCE (taxa de referência)'])
  const sem = await arrancar(t)
  assert.equal((await post(sem.porta, '/api/consumo/taxa-bce', {})).estado, 502)
})
