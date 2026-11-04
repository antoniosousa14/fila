import type { EngineInterface, Register } from 'claude-code'

import type { Item, Progresso } from '../types'
import { caminhos, escreverFoco, escreverItem, escreverSituacao, garantirPastas, lerItem, lerSituacao, lerTudo } from '../src/armazem'
import type { Caminhos } from '../src/armazem'
import { enderecos, EXPIRA_MS, INTERVALO_MS, lerPedido, porTratar, resultadoDoEnvio, todosFalharam } from '../src/carteiro'
import type { Pedido, Resultado } from '../src/carteiro'
import { lerClassificacao, montarPrompt, MODELO, SISTEMA } from '../src/classificar'
import { diaLocal, juntarAoDia, registoDoTurno } from '../src/consumo'
import type { UsoDoTurno } from '../src/consumo'
import { barraGlobal, trabalhoGlobal } from '../src/global'
import { deFicheiroDaApp, lerFicheiroDoChat, procurarLigacao } from '../src/ligacao'
import { limparPedido } from '../src/pedido'
import { juntarSituacao } from '../src/situacao'
import type { Ligacao } from '../src/ligacao'
import { aplicarPlano, contaComoAcao, descreverFerramenta, FERRAMENTA_PLANO } from '../src/progresso'

let ultimoPedido = ''
let versao = 0
// Só chats a sério entram na fila: os do terminal e os da app (têm
// ficheiro de sessão local_…). Sessões de fundo (-p, SDK, plugins) não são nenhum dos dois,
// e o chat orquestrador também fica de fora.
let temSuperficie = false
let ehChat: boolean | undefined
let tentativasChat = 0
let ligacaoConhecida: Ligacao | undefined
// Conta prompts e fins de turno, confirmados ou não: uma escrita atrasada só corre se
// nada aconteceu entretanto.
let eventos = 0
let progressoAtual: Progresso = { passos: [], ferramentas: 0 }
let ultimaEscrita = 0

function rotuloDoProjeto(cwd: string): string {
  const nome = cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd

  return /^scratch-\d{4}-\d{2}-\d{2}/.test(nome) ? 'chat rápido' : nome
}

async function localDoOrquestrador($: EngineInterface, c: Caminhos): Promise<string | undefined> {
  try {
    return JSON.parse(await $.fs.read(`${c.raiz}/orquestrador.json`)).local
  } catch {
    return undefined
  }
}

// Na 1.ª mensagem de um chat novo a app ainda não escreveu o cliSessionId no seu ficheiro;
// por isso só os fins de turno contam para desistir de um chat sem ficheiro.
async function confirmarChat($: EngineInterface, sessao: string, agora: number, contaParaDesistir: boolean) {
  if (temSuperficie) return true
  if (ehChat !== undefined) return ehChat
  ligacaoConhecida = await procurarLigacao($, sessao, agora)
  if (ligacaoConhecida) {
    ehChat = ligacaoConhecida.local !== (await localDoOrquestrador($, await caminhos($)))

    return ehChat
  }
  if (contaParaDesistir && ++tentativasChat >= 2) ehChat = false

  return false
}

async function publicarBarra($: EngineInterface, c: Caminhos) {
  const agora = await $.clock.now()
  const dados = await lerTudo($, c, agora)
  const orquestrador = await localDoOrquestrador($, c)
  const itens = dados.itens.filter(item => !orquestrador || item.local !== orquestrador)
  await $.fs.write(
    `${c.raiz}/barra.json`,
    JSON.stringify({ geradaEm: agora, modelo: barraGlobal({ ...dados, itens }, agora), trabalho: trabalhoGlobal(itens, agora, dados.dispensados) }),
  )
}

async function classificar($: EngineInterface, projeto: string, pedido: string, resposta: string) {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const r = await $.model.complete({
      model: MODELO,
      system: SISTEMA,
      prompt: montarPrompt(projeto, pedido, resposta),
      maxTokens: 700,
    })
    const classificacao = r.isAnswered ? lerClassificacao(r.text) : undefined
    if (classificacao) return classificacao
  }

  return undefined
}

// A situação do chat (o que ficou feito, o que falta) é um extra para o gestor: não expira como o
// item da fila e um erro aqui nunca pode estragar a fila.
let pastaSituacaoPronta = false

async function guardarSituacao($: EngineInterface, c: Caminhos, item: Item, classificacao: Item['classificacao']) {
  try {
    if (!pastaSituacaoPronta) {
      await garantirPastas($, c)
      pastaSituacaoPronta = true
    }
    const anterior = await lerSituacao($, c, item.sessao)
    const situacao = juntarSituacao(anterior, { sessao: item.sessao, local: item.local, titulo: item.titulo, projeto: item.projeto }, classificacao, await $.clock.now())
    if (situacao) await escreverSituacao($, c, situacao)
  } catch {
    // sem situação deste turno: o gestor usa o resto (lista de tarefas, resumo da app)
  }
}

async function completar($: EngineInterface, c: Caminhos, item: Item, pedido: string, resposta: string, minha: number) {
  const ligacao = item.local ? undefined : await procurarLigacao($, item.sessao, item.desde)
  const classificacao = await classificar($, item.projeto, pedido, resposta)
  if (minha !== versao) return
  const completo = {
    ...item,
    local: item.local ?? ligacao?.local,
    titulo: ligacao?.titulo || item.titulo,
    classificacao,
  }
  await escreverItem($, c, completo)
  await guardarSituacao($, c, completo, classificacao)
  await publicarBarra($, c)
}

async function repetirTrabalho($: EngineInterface, pedido: string, meu: number) {
  if (eventos === meu) await marcarATrabalhar($, pedido, true)
}

async function marcarATrabalhar($: EngineInterface, pedido: string, repetida = false) {
  ultimoPedido = pedido
  if (!repetida) eventos += 1
  const meu = eventos
  const c = await caminhos($)
  const sessao = await $.session.id()
  const agora = await $.clock.now()
  if (!(await confirmarChat($, sessao, agora, false))) {
    if (!repetida) $.clock.after(5000, () => void repetirTrabalho($, pedido, meu))
    return
  }
  versao += 1
  const projeto = rotuloDoProjeto(await $.session.cwd())
  const anterior = await lerItem($, c, sessao)
  progressoAtual = { passos: anterior?.progresso?.passos ?? [], ferramentas: 0 }
  await escreverItem($, c, {
    ...(anterior ?? { sessao, projeto, titulo: ligacaoConhecida?.titulo || projeto, local: ligacaoConhecida?.local }),
    estado: 'a-trabalhar',
    desde: agora,
    pedido: pedido.slice(0, 300),
    progresso: progressoAtual,
  })
  await escreverFoco($, c, { sessao, em: agora })
  await publicarBarra($, c)
}

async function marcarAEspera($: EngineInterface, resposta: string) {
  eventos += 1
  const c = await caminhos($)
  const sessao = await $.session.id()
  const agora = await $.clock.now()
  if (!(await confirmarChat($, sessao, agora, true))) return
  versao += 1
  const minha = versao
  const projeto = rotuloDoProjeto(await $.session.cwd())
  const anterior = await lerItem($, c, sessao)
  const item: Item = {
    sessao,
    projeto,
    titulo: anterior?.titulo ?? (ligacaoConhecida?.titulo || projeto),
    local: anterior?.local ?? ligacaoConhecida?.local,
    estado: 'a-espera',
    desde: agora,
    pedido: anterior?.pedido,
    progresso: progressoAtual,
  }
  await escreverItem($, c, item)
  await publicarBarra($, c)
  void completar($, c, item, ultimoPedido, resposta, minha)
}

// Todos os chats registam o consumo (os limites são da conta), também o orquestrador e as
// sessões de fundo: a pasta pode ainda não existir num chat aberto antes desta versão do mod.
let pastasProntas = false

async function registarConsumo($: EngineInterface, uso: UsoDoTurno | undefined) {
  const c = await caminhos($)
  const em = await $.clock.now()
  const { rateLimits } = await $.session.usage()
  const registo = registoDoTurno({ em, sessao: await $.session.id(), uso, limites: rateLimits })
  if (!registo) return
  if (!pastasProntas) {
    await garantirPastas($, c)
    pastasProntas = true
  }
  const ficheiro = `${c.consumo}/${diaLocal(em)}.json`
  const atual = await $.fs.read(ficheiro).catch(() => undefined)
  await $.fs.write(ficheiro, juntarAoDia(atual, registo))
}

// Carteiro: só o chat orquestrador entrega as mensagens que o gestor deixa em saida/. Cada chat
// verifica se é ele (pelo ficheiro da app do local_ de orquestrador.json) e, se não for, volta a
// ver de 5 em 5 min, para o caso de orquestrador.json mudar.
let carteiro = { ativo: false, vistoEm: 0 }
let aEntregar = false

async function souOrquestrador($: EngineInterface): Promise<boolean> {
  const local = await localDoOrquestrador($, await caminhos($))
  if (!local) return false
  const ficheiro = await lerFicheiroDoChat($, local)

  return Boolean(ficheiro && deFicheiroDaApp(ficheiro, await $.session.id()))
}

async function escreverResultado($: EngineInterface, c: Caminhos, id: string, resultados: Resultado[]) {
  await $.fs.write(`${c.saida}/${id}.resultado.json`, JSON.stringify({ em: await $.clock.now(), resultados }))
}

// Tenta cada endereço do chat até um entregar; o motivo que fica é o da última tentativa.
async function enviarA($: EngineInterface, pedido: Pedido, local: string): Promise<Resultado> {
  let ultimo: Resultado = { local, entregue: false, motivo: 'sem endereço' }
  for (const to of enderecos(pedido, local)) {
    try {
      ultimo = resultadoDoEnvio(local, await $.session.send({ to, text: pedido.texto }))
    } catch (erro) {
      ultimo = { local, entregue: false, motivo: String((erro as Error)?.message ?? erro).slice(0, 300) }
    }
    if (ultimo.entregue) break
  }

  return ultimo
}

async function entregarPedidos($: EngineInterface, agora: number) {
  const c = await caminhos($)
  const { novos, interrompidos } = porTratar(await $.fs.list(c.saida).catch(() => []), agora)
  for (const id of interrompidos) {
    const pedido = lerPedido(await $.fs.read(`${c.saida}/${id}.json`).catch(() => ''), id)
    await escreverResultado($, c, id, todosFalharam(pedido?.para ?? [], 'ficou a meio (o orquestrador fechou); não foi reenviado'))
  }
  const proprio = await localDoOrquestrador($, c)
  for (const id of novos) {
    const pedido = lerPedido(await $.fs.read(`${c.saida}/${id}.json`).catch(() => ''), id)
    if (!pedido) {
      await escreverResultado($, c, id, [])
      continue
    }
    if (agora - pedido.em > EXPIRA_MS) {
      await escreverResultado($, c, id, todosFalharam(pedido.para, 'expirou: o orquestrador não o apanhou em 30 min'))
      continue
    }
    await $.fs.write(`${c.saida}/${id}.a-enviar.json`, JSON.stringify({ em: agora }))
    const resultados: Resultado[] = []
    for (const local of pedido.para) {
      if (local === proprio) {
        resultados.push({ local, entregue: false, motivo: 'é o próprio orquestrador' })
        continue
      }
      resultados.push(await enviarA($, pedido, local))
    }
    await escreverResultado($, c, id, resultados)
  }
}

async function correrCarteiro($: EngineInterface) {
  if (aEntregar) return
  const agora = await $.clock.now()
  if (!carteiro.ativo) {
    if (carteiro.vistoEm && agora - carteiro.vistoEm < 5 * 60_000) return
    carteiro = { ativo: await souOrquestrador($), vistoEm: agora }
    if (!carteiro.ativo) return
  }
  aEntregar = true
  try {
    await entregarPedidos($, agora)
  } finally {
    aEntregar = false
  }
}

// O progresso vive em memória e vai para o ficheiro no máximo a cada 5 s (de imediato
// quando a lista de tarefas muda); o fim do turno escreve-o sempre.
async function registarFerramenta($: EngineInterface, ferramenta: string, entrada: Record<string, unknown>) {
  if (!temSuperficie && ehChat !== true) return
  const meu = eventos
  const plano = ferramenta === FERRAMENTA_PLANO
  if (plano) {
    progressoAtual = { ...progressoAtual, passos: aplicarPlano(progressoAtual.passos, entrada) }
  } else if (contaComoAcao(ferramenta)) {
    progressoAtual = {
      ...progressoAtual,
      ferramentas: progressoAtual.ferramentas + 1,
      ultima: descreverFerramenta(ferramenta, entrada),
    }
  }
  const agora = await $.clock.now()
  if (!plano && agora - ultimaEscrita < 5000) return
  ultimaEscrita = agora
  const c = await caminhos($)
  const atual = await lerItem($, c, await $.session.id())
  if (!atual || atual.estado !== 'a-trabalhar' || meu !== eventos) return
  await escreverItem($, c, { ...atual, progresso: progressoAtual })
  await publicarBarra($, c)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await garantirPastas($, await caminhos($)).catch(() => undefined)
    // Os chats do terminal contam como chats a sério; os da app provam-no pelo ficheiro de sessão.
    // A pílula e o gestor (bar/, gestor/) leem o barra.json que publicarBarra escreve.
    temSuperficie = e.surface === 'terminal'
    $.clock.every(INTERVALO_MS, () => void correrCarteiro($).catch(() => undefined))

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await marcarATrabalhar($, limparPedido(e.text ?? '')).catch(() => undefined)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const resultado = await next(e)
    const entrada = e as unknown as Record<string, unknown>
    if (entrada.agentId === undefined) void registarFerramenta($, String(e.tool), entrada).catch(() => undefined)

    return resultado
  })

  on('turn.complete', async ($, e, next) => {
    const resultado = await next(e)
    if (e.agentId === undefined && !e.isAborted) await marcarAEspera($, e.answer).catch(() => undefined)
    if (e.agentId === undefined) void registarConsumo($, e.usage).catch(() => undefined)

    return resultado
  })
}
