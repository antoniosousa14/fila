// Gestor de chats: serve gestor/web e uma API JSON só em 127.0.0.1.
// Lê os ficheiros de sessão da app e os grupos da barra lateral (claude_desktop_config.json), só
// para leitura, e a fila do mod; escreve dispensas, gestor.json, organizacao.json (as pastas-mãe;
// só este processo o escreve, um pedido de cada vez) e os pedidos de envio de mensagens em saida/,
// que o carteiro (mod do chat orquestrador) entrega.
import { spawn } from 'node:child_process'
import { appendFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'

import { localValido, pastaDoDiscoValida, pastas as pastasPorOmissao, uuidValido } from './lib/caminhos.mjs'
import { lerConsumo, resumirConsumo } from './lib/consumo.mjs'
import { resumirHistorico } from './lib/estatisticas.mjs'
import { criarContinuidade } from './lib/continuidade.mjs'
import * as marcasDosProjetos from './lib/marcas.mjs'
import { criarHistorico } from './lib/historico.mjs'
import { locaisParaDetalhe, montarProjetos, resumirRitmo } from './lib/projetos.mjs'
import { atividadeDosChats } from './lib/ritmo.mjs'
import { lerSituacoes, situacaoPorLocal } from './lib/situacao.mjs'
import { analisarPonta } from './lib/ponta.mjs'
import { meiaNoiteLocal, montarEstado, trabalhoMorto } from './lib/estado.mjs'
import { dispensar, lerFila, lerJson } from './lib/fila.mjs'
import { grupoValido, lerGruposDaApp } from './lib/grupos.mjs'
import * as msg from './lib/mensagens.mjs'
import * as org from './lib/organizacao.mjs'
import { lerSessoes } from './lib/sessoes.mjs'

export const PORTA = 4730
const TENTATIVAS = 6
const MAX_CORPO = 16 * 1024
const RE_ESTATICO = /^[a-z0-9_-]+\.[a-z0-9]+$/i

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}
const JSON_UTF8 = 'application/json; charset=utf-8'
const BASE = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' }
// As fontes vêm do Fontshare (Switzer) e do Google Fonts (Martian Mono), como no protótipo.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://api.fontshare.com https://fonts.googleapis.com",
  'font-src https://cdn.fontshare.com https://fonts.gstatic.com',
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

// Só recebe links claude:// montados aqui, com ids e pastas já validados.
export function abrirLink(url) {
  const filho = spawn('explorer.exe', [url], { detached: true, stdio: 'ignore', windowsHide: true })
  filho.on('error', () => {})
  filho.unref()
}

export const abrirNaApp = local => abrirLink(`claude://claude.ai/epitaxy/${local}`)

function responder(res, codigo, corpo, cabecalhos = {}) {
  res.writeHead(codigo, { ...BASE, 'content-type': JSON_UTF8, ...cabecalhos })
  res.end(typeof corpo === 'string' || Buffer.isBuffer(corpo) ? corpo : JSON.stringify(corpo))
}

function lerCorpo(req) {
  return new Promise((resolver, rejeitar) => {
    const partes = []
    let tamanho = 0
    req.on('data', parte => {
      tamanho += parte.length
      if (tamanho <= MAX_CORPO) partes.push(parte)
    })
    req.on('end', () => resolver(tamanho > MAX_CORPO ? null : Buffer.concat(partes).toString('utf8')))
    req.on('error', rejeitar)
  })
}

async function escutar(servidor, inicial) {
  const ultima = inicial === 0 ? 0 : inicial + TENTATIVAS - 1
  for (let porta = inicial; porta <= ultima; porta++) {
    try {
      await new Promise((ok, falha) => {
        servidor.once('error', falha)
        servidor.listen(porta, '127.0.0.1', () => {
          servidor.off('error', falha)
          ok()
        })
      })

      return servidor.address().port
    } catch (erro) {
      if (erro.code !== 'EADDRINUSE') throw erro
    }
  }
  throw new Error(`portas ${inicial} a ${ultima} ocupadas`)
}

// De quanto em quanto tempo se volta a ler o que as transcrições ganharam (só o que cresceu).
const HISTORICO_MS = 2 * 60_000
const MAX_MENSAL = 100_000
const MAX_MESES = 60

// O preço pago em meses em que não foi o valor atual: { 'AAAA-MM': valor }. Devolve um objeto limpo,
// ou undefined se vier outra coisa (para o pedido ser recusado). Um valor null ou '' tira o mês.
function mesesValidos(bruto) {
  if (bruto === undefined || bruto === null) return {}
  if (typeof bruto !== 'object' || Array.isArray(bruto)) return undefined
  const meses = {}
  for (const [mes, valor] of Object.entries(bruto)) {
    if (valor === null || valor === '') continue
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes) || !Number.isFinite(valor) || valor < 0 || valor > MAX_MENSAL) return undefined
    meses[mes] = valor
  }

  return Object.keys(meses).length <= MAX_MESES ? meses : undefined
}
// Taxa de referência do BCE (euro → USD), para converter o custo na API (USD) para euros.
const URL_BCE = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'

export async function criarServidor({ pastas = pastasPorOmissao(), portaInicial = PORTA, abrir = abrirNaApp, abrirUrl = abrirLink, historicoMs = HISTORICO_MS, buscar = globalThis.fetch } = {}) {
  const cache = new Map()
  const cacheConsumo = new Map()
  const cacheGrupos = new Map()
  let porta = 0
  const historico = criarHistorico({ base: pastas.projetos, pasta: pastas.historico })
  let resumoHistorico = null

  // O Windows não deixa a app do Claude vir para a frente quando quem abre o link é este
  // processo (está em segundo plano); a barra vê este ficheiro mudar e põe-na à frente.
  const pedirFrente = () => writeFile(pastas.frente, JSON.stringify({ em: Date.now() })).catch(() => {})

  async function estado() {
    const agora = Date.now()
    const [sessoes, fila, barra, orquestrador, organizacao, app, consumo, mensagens] = await Promise.all([
      lerSessoes(pastas.sessoes, cache),
      lerFila(pastas.itens, agora),
      lerJson(pastas.barra),
      lerJson(pastas.orquestrador),
      org.lerOrganizacao(pastas.organizacao),
      lerGruposDaApp(pastas.configApp, cacheGrupos),
      lerConsumo(pastas.consumo, agora, cacheConsumo),
      msg.lerMensagens(pastas.saida, agora),
    ])

    // A pílula lê o barra.json sem saber de arquivados: dispensa-se lá, pelo ficheiro de dispensas que ela
    // já respeita, o chat à espera que entretanto foi arquivado.
    const arquivados = new Set(sessoes.filter(s => s.arquivado).map(s => s.local))
    for (const chip of [...(barra?.modelo?.chips ?? []), ...(barra?.modelo?.extra ?? [])]) {
      if (!chip?.local || !arquivados.has(chip.local) || fila.dispensados[chip.sessao] === chip.desde) continue
      if (!uuidValido(chip.sessao) || !Number.isFinite(chip.desde)) continue
      fila.dispensados[chip.sessao] = chip.desde
      await dispensar(pastas.itens, chip.sessao, chip.desde).catch(() => {})
    }

    // O mesmo para um «a trabalhar» que ficou preso porque o chat fez /clear a meio do turno: a pílula e o
    // mod só deixam de o contar com este ficheiro (o barra.json só é reescrito no próximo turno de algum chat).
    const sessaoDe = new Map(sessoes.map(s => [s.local, s]))
    for (const t of barra?.trabalho ?? []) {
      if (!t?.local || fila.dispensados[t.sessao] === t.desde || !trabalhoMorto(sessaoDe.get(t.local), t)) continue
      if (!uuidValido(t.sessao) || !Number.isFinite(t.desde)) continue
      fila.dispensados[t.sessao] = t.desde
      await dispensar(pastas.itens, t.sessao, t.desde).catch(() => {})
    }

    return {
      ...montarEstado({ sessoes, ...fila, barra, agora, meiaNoite: meiaNoiteLocal(agora), organizacao, grupos: app.grupos, atribuicoes: app.atribuicoes, erroGrupos: app.erro }),
      orquestrador: localValido(orquestrador?.local) ? orquestrador.local : null,
      consumo: resumirConsumo(consumo, agora),
      mensagens,
    }
  }

  // ——— Projetos: ponto de situação e onde ficaste, por grupo ———
  // Junta o estado do painel com o fim da transcrição dos chats mais recentes de cada grupo.

  const continuidade = criarContinuidade({ base: pastas.projetos })
  const cacheSituacoes = new Map()
  let projetosGuardados = null

  async function verProjetos() {
    const agora = Date.now()
    if (projetosGuardados && agora - projetosGuardados.em < 8_000) return projetosGuardados.dados
    const [e, sessoes, situacoes, marcas] = await Promise.all([estado(), lerSessoes(pastas.sessoes, cache), lerSituacoes(pastas.situacao, cacheSituacoes), marcasDosProjetos.lerMarcas(pastas.projetosMarcas)])
    const clisDe = new Map(sessoes.map(s => [s.local, s.clis]))
    const detalhes = new Map()
    await Promise.all([...locaisParaDetalhe(e)].map(async local => {
      try {
        const d = await continuidade.detalhe(clisDe.get(local))
        if (d) detalhes.set(local, d)
      } catch {
        // uma transcrição ilegível não pode estragar a vista: o chat fica só com o resumo da app
      }
    }))
    // Mensagens tuas por dia em cada chat (só quando o histórico já leu as transcrições).
    const localDe = new Map(sessoes.filter(s => !s.arquivado).flatMap(s => (s.clis ?? []).map(c => [c, s.local])))
    const atividade = historico.pronto() ? atividadeDosChats(historico.estados(), localDe, agora) : new Map()
    const projetos = montarProjetos(e, detalhes, { situacoes: situacaoPorLocal(situacoes, sessoes), atividade, marcas, agora })
    const dados = { geradoEm: agora, resumo: resumirRitmo(projetos), projetos }
    projetosGuardados = { em: agora, dados }

    return dados
  }

  async function marcarProjeto(pedido) {
    const r = marcasDosProjetos.aplicarAcao(await marcasDosProjetos.lerMarcas(pastas.projetosMarcas), pedido)
    if (r.erro) return [400, { erro: r.erro }]
    await marcasDosProjetos.gravarMarcas(pastas.projetosMarcas, r.marcas)
    projetosGuardados = null

    return { ok: true }
  }

  // ——— aba Consumo: histórico das transcrições, preços e subscrição ———

  async function configConsumo() {
    const c = await lerJson(pastas.configConsumo)

    return {
      mensal: Number.isFinite(c?.mensal) ? c.mensal : null,
      meses: mesesValidos(c?.meses) ?? {},
      moeda: c?.moeda === 'USD' ? 'USD' : 'EUR',
      usdPorEur: c?.usdPorEur > 0 ? c.usdPorEur : null,
      taxaData: typeof c?.taxaData === 'string' ? c.taxaData : null,
      taxaFonte: typeof c?.taxaFonte === 'string' ? c.taxaFonte : null,
    }
  }

  async function calcularHistorico() {
    const agora = Date.now()
    const [precos, ponta, config, e, registos] = await Promise.all([lerJson(pastas.precos), lerJson(pastas.ponta), configConsumo(), estado(), lerConsumo(pastas.consumo, agora, cacheConsumo)])
    const sessoes = await lerSessoes(pastas.sessoes, cache)
    const app = await lerGruposDaApp(pastas.configApp, cacheGrupos)
    const estados = historico.estados()
    resumoHistorico = {
      ...resumirHistorico({ estados, sessoes, grupos: e.organizacao.grupos, atribuicoes: app.atribuicoes, precos, agora, subscricao: config }),
      ponta: analisarPonta({ estados, registos, ponta, precos, agora }),
      organizacao: e.organizacao,
      limites: e.consumo,
    }

    return resumoHistorico
  }

  // Lê as transcrições em fundo e guarda os agregados diários ao lado do índice.
  async function atualizarHistorico() {
    await historico.atualizar()
    const r = await calcularHistorico()
    await mkdir(pastas.historico, { recursive: true })
    await writeFile(join(pastas.historico, 'dias.json'), JSON.stringify({ geradoEm: r.geradoEm, precos: r.precos, dias: r.dias }))
  }

  async function verHistorico() {
    if (!historico.pronto()) return { pronto: false, progresso: historico.progresso }
    // O cálculo leva algumas dezenas de ms; entre leituras basta refazê-lo de 15 em 15 s.
    if (!resumoHistorico || Date.now() - resumoHistorico.geradoEm > 15_000) await calcularHistorico()

    return { pronto: true, progresso: historico.progresso, ...resumoHistorico }
  }

  async function gravarConfigConsumo(pedido) {
    const atual = await configConsumo()
    const mensal = 'mensal' in pedido ? pedido.mensal : atual.mensal
    const moeda = 'moeda' in pedido ? pedido.moeda : atual.moeda
    const usdPorEur = 'usdPorEur' in pedido ? pedido.usdPorEur : atual.usdPorEur
    const meses = 'meses' in pedido ? mesesValidos(pedido.meses) : atual.meses
    if (!meses) return [400, { erro: 'preços por mês inválidos' }]
    if (mensal !== null && !(Number.isFinite(mensal) && mensal >= 0 && mensal <= MAX_MENSAL)) return [400, { erro: 'valor mensal inválido' }]
    if (!['EUR', 'USD'].includes(moeda)) return [400, { erro: 'moeda inválida' }]
    if (usdPorEur !== null && !(Number.isFinite(usdPorEur) && usdPorEur > 0.2 && usdPorEur < 5)) return [400, { erro: 'taxa de câmbio inválida' }]
    // Uma taxa escrita à mão fica com a data de hoje e "manual" como fonte.
    const taxaMudou = usdPorEur !== atual.usdPorEur
    await writeFile(pastas.configConsumo, JSON.stringify({
      mensal, meses, moeda, usdPorEur,
      taxaData: taxaMudou ? new Date().toISOString().slice(0, 10) : atual.taxaData,
      taxaFonte: taxaMudou ? 'manual' : atual.taxaFonte,
      em: Date.now(),
    }))
    resumoHistorico = null

    return { ok: true }
  }

  // Vai buscar a taxa de referência do dia ao BCE e grava-a.
  async function taxaDoBce() {
    let texto
    try {
      const r = await buscar(URL_BCE, { signal: AbortSignal.timeout(10_000) })
      if (!r.ok) return [502, { erro: `o BCE respondeu ${r.status}` }]
      texto = await r.text()
    } catch {
      return [502, { erro: 'não consegui falar com o BCE' }]
    }
    const taxa = Number(/currency=['"]USD['"]\s+rate=['"]([0-9.]+)['"]/.exec(texto)?.[1])
    const data = /time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(texto)?.[1]
    if (!(taxa > 0) || !data) return [502, { erro: 'resposta do BCE inesperada' }]
    const atual = await configConsumo()
    await writeFile(pastas.configConsumo, JSON.stringify({ ...atual, usdPorEur: taxa, taxaData: data, taxaFonte: 'BCE (taxa de referência)', em: Date.now() }))
    resumoHistorico = null

    return { ok: true, usdPorEur: taxa, taxaData: data }
  }

  // Um pedido de organização de cada vez: lê, muda e grava sem outro pelo meio.
  let emCurso = Promise.resolve()
  const emSerie = tarefa => (emCurso = emCurso.then(tarefa, tarefa))

  // Pastas-mãe do gestor para juntar grupos do Claude. Os grupos, os nomes e os chats de cada
  // grupo mudam-se no Claude, não aqui.
  const OPERACOES = {
    'criar-pasta': (o, { nome, pai = null }) => org.criarPasta(o, { nome, pai }),
    'renomear-pasta': (o, { id, nome }) => org.renomearPasta(o, { id, nome }),
    'apagar-pasta': (o, { id }) => org.apagarPasta(o, { id }),
    'mover-pasta': (o, { id, pai = null }) => org.moverPasta(o, { id, pai }),
    'mover-grupo': (o, { grupo, pasta = null }) => org.moverGrupo(o, { grupo, pasta }),
    'renomear-grupo': (o, { grupo, nome = null }) => org.renomearGrupo(o, { grupo, nome }),
    'esconder-grupo': (o, { grupo }) => org.esconderGrupo(o, { grupo }),
    'mostrar-grupo': (o, { grupo }) => org.mostrarGrupo(o, { grupo }),
    posicionar: (o, { tipo, no, pai = null, irmaos }) => org.posicionar(o, { tipo, no, pai, irmaos }),
  }
  const pastaOuNula = x => x === null || org.pastaValida(x)

  async function organizar(pedido) {
    const operacao = OPERACOES[pedido.acao]
    if (!operacao) return [400, { erro: 'ação desconhecida' }]
    for (const campo of ['id', 'pai', 'pasta']) if (campo in pedido && !pastaOuNula(pedido[campo])) return [400, { erro: `${campo} inválido` }]
    if ('grupo' in pedido && !grupoValido(pedido.grupo)) return [400, { erro: 'grupo inválido' }]
    const r = operacao(await org.lerOrganizacao(pastas.organizacao), pedido)
    if (r.erro) return [400, { erro: r.erro }]
    await org.gravarOrganizacao(pastas.organizacao, r.org)

    return { ok: true, ...(r.id && { id: r.id }) }
  }

  // Mensagens em dois passos: preparar devolve os destinatários e o texto exatos, que a UI mostra
  // para a pessoa confirmar; só enviar (com o id do que foi mostrado) escreve em saida/.
  const pendentes = new Map()

  async function prepararMensagem({ para, texto }) {
    const agora = Date.now()
    for (const [id, p] of pendentes) if (agora - p.em > msg.EXPIRA_MS) pendentes.delete(id)
    const orquestrador = (await lerJson(pastas.orquestrador))?.local
    const sessoes = await lerSessoes(pastas.sessoes, cache)
    const r = msg.prepararEnvio({ locais: para, texto, sessoes, orquestrador })
    if (r.erro) return [400, { erro: r.erro }]
    if (!localValido(orquestrador)) return [409, { erro: 'não há chat orquestrador (orquestrador.json): é ele que entrega as mensagens' }]
    const id = msg.novoId(agora)
    pendentes.set(id, { ...r, em: agora })
    const caminhoDe = new Map((await estado()).recentes.map(c => [c.local, c.caminho]))

    return { id, texto: r.texto, para: r.para.map(p => ({ local: p.local, titulo: p.titulo, caminho: caminhoDe.get(p.local) ?? '' })) }
  }

  async function enviarMensagem({ id }) {
    const p = msg.idValido(id) && pendentes.get(id)
    if (!p) return [404, { erro: 'pedido desconhecido ou expirado: prepara outra vez' }]
    pendentes.delete(id)
    await mkdir(pastas.saida, { recursive: true })
    await msg.escreverPedido(pastas.saida, { id, em: Date.now(), para: p.para, texto: p.texto })

    return { ok: true, id }
  }

  async function novoChat({ pasta, texto = '' }) {
    if (!pastaDoDiscoValida(pasta)) return [400, { erro: 'pasta inválida' }]
    const limpo = texto === '' ? '' : msg.textoValido(texto, 2000)
    if (limpo === undefined) return [400, { erro: 'texto inválido' }]
    const info = await stat(pasta).catch(() => undefined)
    if (!info?.isDirectory()) return [400, { erro: 'a pasta não existe' }]
    abrirUrl(msg.linkNovoChat({ pasta, texto: limpo }))
    pedirFrente()

    return { ok: true }
  }

  const rotas = {
    '/api/saude': { metodo: 'GET', fazer: () => ({ ok: true, pid: process.pid }) },
    '/api/estado': { metodo: 'GET', fazer: estado },
    '/api/projetos': { metodo: 'GET', fazer: verProjetos },
    '/api/historico': { metodo: 'GET', fazer: verHistorico },
    '/api/consumo/config': { metodo: 'POST', fazer: gravarConfigConsumo },
    '/api/consumo/taxa-bce': { metodo: 'POST', fazer: taxaDoBce },
    '/api/abrir': {
      metodo: 'POST',
      fazer: ({ local }) => {
        if (!localValido(local)) return [400, { erro: 'local inválido' }]
        abrir(local)
        pedirFrente()

        return { ok: true }
      },
    },
    '/api/organizacao': { metodo: 'POST', fazer: pedido => emSerie(() => organizar(pedido)) },
    // Marcas do gestor num projeto (grupo): dispensar, repor, sem importância, esconder linhas.
    '/api/projeto': { metodo: 'POST', fazer: pedido => emSerie(() => marcarProjeto(pedido)) },
    '/api/mensagens/preparar': { metodo: 'POST', fazer: prepararMensagem },
    '/api/mensagens/enviar': { metodo: 'POST', fazer: enviarMensagem },
    '/api/novo-chat': { metodo: 'POST', fazer: novoChat },
    '/api/dispensar': {
      metodo: 'POST',
      fazer: async ({ sessao, desde }) => {
        if (!uuidValido(sessao) || !Number.isFinite(desde)) return [400, { erro: 'pedido inválido' }]
        await dispensar(pastas.itens, sessao, desde)

        return { ok: true }
      },
    },
  }

  async function estatico(res, nome) {
    const tipo = TIPOS[extname(nome).toLowerCase()]
    const conteudo = tipo && (await readFile(join(pastas.web, nome)).catch(() => undefined))
    if (!conteudo) return responder(res, 404, { erro: 'não existe' })
    const extra = tipo.startsWith('text/html') ? { 'content-security-policy': CSP, 'x-frame-options': 'DENY' } : {}
    responder(res, 200, conteudo, { 'content-type': tipo, ...extra })
  }

  async function tratar(req, res) {
    // Só o próprio endereço: recusa páginas de fora que apontem um domínio para 127.0.0.1.
    const hosts = [`127.0.0.1:${porta}`, `localhost:${porta}`]
    if (!hosts.includes(req.headers.host)) return responder(res, 403, { erro: 'host' })
    const { pathname } = new URL(req.url, `http://${req.headers.host}`)

    const rota = rotas[pathname]
    if (rota) {
      if (req.method !== rota.metodo) return responder(res, 405, { erro: 'método' })
      let entrada = {}
      if (rota.metodo === 'POST') {
        if (!hosts.map(h => `http://${h}`).includes(req.headers.origin)) return responder(res, 403, { erro: 'origem' })
        if ((req.headers['content-type'] ?? '').split(';')[0].trim() !== 'application/json') return responder(res, 415, { erro: 'tipo' })
        const texto = await lerCorpo(req)
        if (texto === null) return responder(res, 413, { erro: 'grande demais' })
        try {
          entrada = JSON.parse(texto)
        } catch {
          return responder(res, 400, { erro: 'JSON inválido' })
        }
        if (typeof entrada !== 'object' || entrada === null) return responder(res, 400, { erro: 'JSON inválido' })
      }
      const resultado = await rota.fazer(entrada)

      return Array.isArray(resultado) ? responder(res, ...resultado) : responder(res, 200, resultado)
    }

    if (req.method === 'GET' && pathname === '/') return estatico(res, 'index.html')
    if (req.method === 'GET' && pathname.startsWith('/web/') && RE_ESTATICO.test(pathname.slice(5))) return estatico(res, pathname.slice(5))

    return responder(res, 404, { erro: 'não existe' })
  }

  const servidor = createServer((req, res) => {
    tratar(req, res).catch(async erro => {
      await appendFile(pastas.erros, `${new Date().toISOString()} ${erro?.stack ?? erro}\n`).catch(() => {})
      if (!res.headersSent) responder(res, 500, { erro: 'interno' })
      else res.end()
    })
  })

  porta = await escutar(servidor, portaInicial)
  await writeFile(pastas.gestor, JSON.stringify({ porta, pid: process.pid }))
  // Aquece a cache: o primeiro varrimento das ~230 sessões demora cerca de 1 s.
  estado().catch(() => {})
  msg.limparSaida(pastas.saida, Date.now()).catch(() => {})
  const limpeza = setInterval(() => msg.limparSaida(pastas.saida, Date.now()).catch(() => {}), 3_600_000)
  limpeza.unref()
  // O histórico das transcrições lê-se em fundo: a primeira vez demora uns segundos (GB de
  // transcrições); depois só o que cresceu.
  const registarErro = erro => appendFile(pastas.erros, `${new Date().toISOString()} histórico: ${erro?.stack ?? erro}\n`).catch(() => {})
  const primeiraLeitura = atualizarHistorico().catch(registarErro)
  const leitura = setInterval(() => atualizarHistorico().catch(registarErro), historicoMs)
  leitura.unref()

  return {
    porta,
    servidor,
    historicoPronto: () => primeiraLeitura,
    fechar: () => new Promise(resolver => {
      clearInterval(limpeza)
      clearInterval(leitura)
      servidor.closeAllConnections()
      servidor.close(() => resolver())
    }),
  }
}

async function jaACorrer(p) {
  const atual = await lerJson(p.gestor)
  if (!atual?.porta) return false
  try {
    const r = await fetch(`http://127.0.0.1:${atual.porta}/api/saude`, { signal: AbortSignal.timeout(800) })

    return (await r.json()).pid === atual.pid
  } catch {
    return false
  }
}

async function main() {
  const p = pastasPorOmissao()
  const registar = erro => appendFile(p.erros, `${new Date().toISOString()} ${erro?.stack ?? erro}\n`).catch(() => {})
  process.on('uncaughtException', async erro => {
    await registar(erro)
    process.exit(1)
  })
  if (await jaACorrer(p)) {
    console.log('O gestor já está a correr.')
    return
  }
  try {
    const { porta } = await criarServidor({ pastas: p })
    console.log(`Gestor em http://127.0.0.1:${porta}`)
  } catch (erro) {
    await registar(erro)
    process.exit(1)
  }
}

if (import.meta.main) main()
