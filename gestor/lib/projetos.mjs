import { resumirPlano } from './continuidade.mjs'
import { chaveDe, vazias } from './marcas.mjs'
import { SEM_GRUPO } from './organizacao.mjs'
import { DIAS_RITMO, diasEntre, ritmoDe, somarAtividade } from './ritmo.mjs'

// Projetos: um por grupo da barra lateral do Claude (as pastas do gestor só juntam grupos). Cada
// projeto mostra, juntando todos os seus chats: o que ainda há por fazer, por ordem de prioridade
// agora; o que ficou feito há pouco; e o ritmo (quando mexeste nele pela última vez), para não
// deixar projetos esquecidos. Ao contrário da fila, nada disto expira.
//
// As fontes, da melhor para a pior: a situação que o mod pede à IA em cada fim de turno (feito e
// falta com prioridade, situacao.mjs); a lista de tarefas do chat (reconstruída da transcrição,
// continuidade.mjs); o cartão da IA e o resumo que a app guarda.

// Quantos chats por projeto levam o resumo do fim da transcrição (os mais recentes).
export const MAX_DETALHE = 4
// Quantos chats por projeto se listam (os outros ficam num «+N»).
export const MAX_CHATS = 6
export const MAX_POR_FAZER = 12
export const MAX_FEITO = 8
const MAX_POR_CHAT = 5

const gruposDe = nos => nos.flatMap(n => (n.tipo === 'grupo' && n.id !== SEM_GRUPO ? [n] : []).concat(gruposDe(n.filhas ?? [])))
const normalizar = t => String(t ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
const limpo = t => String(t ?? '').replace(/\s+/g, ' ').trim()
const hora = ms => (Number.isFinite(ms) && ms > 0 ? ms : 0)

function chatsDoGrupo(estado, grupo) {
  const porLocal = new Map(estado.recentes.map(c => [c.local, c]))

  return grupo.chats.map(l => porLocal.get(l)).filter(Boolean).sort((a, b) => b.mensagemEm - a.mensagemEm)
}

// Os chats que precisam de detalhe: os mais recentes de cada projeto.
export function locaisParaDetalhe(estado) {
  const locais = new Set()
  for (const grupo of gruposDe(estado.arvore ?? [])) {
    for (const c of chatsDoGrupo(estado, grupo).slice(0, MAX_DETALHE)) locais.add(c.local)
  }

  return locais
}

// Os pontos de uma coisa por fazer; quanto maior, mais acima. A prioridade (1 a 5) pesa mais; ser a
// tua vez sobe (o projeto está parado à tua espera); estar em curso desce (já está a ser feito); e
// cada dia sem mexer no chat sobe um ponto (até 8, para nunca passar uma prioridade inteira), para
// o que ficou esquecido voltar à cima.
export function pontosDe({ prioridade, tuaVez = false, emCurso = false, diasParado = 0 }) {
  return prioridade * 10 + (tuaVez ? 12 : 0) - (emCurso ? 5 : 0) + Math.min(Math.max(diasParado, 0), 8)
}

function resumirChat(estado, chat, detalhe) {
  const espera = estado.espera.find(x => x.local === chat.local)
  const trabalho = estado.trabalho.find(x => x.local === chat.local)
  const estadoChat = trabalho ? 'trabalho' : espera ? 'espera' : 'parado'
  // O plano do chat a trabalhar vem dos passos do mod; senão da última lista de tarefas da transcrição.
  const plano = resumirPlano(trabalho?.passos) ?? detalhe?.plano

  return {
    local: chat.local,
    titulo: chat.titulo,
    estado: estadoChat,
    mensagemEm: hora(chat.mensagemEm),
    // O que o chat precisa de ti: o cartão da IA (se está à espera), senão o resumo que a app guarda.
    precisa: espera?.precisa || (trabalho ? '' : chat.precisa) || '',
    rotulo: espera?.rotulo ?? '',
    pedi: detalhe?.pedi || espera?.pediste || '',
    respondeu: detalhe?.respondeu || espera?.fez || chat.resumo || '',
    plano: plano ?? null,
    // Parado com tarefas por fazer: ficou a meio.
    aMeio: estadoChat !== 'trabalho' && !!plano && plano.feitos < plano.total,
    atual: trabalho?.atual ?? '',
    importancia: espera?.importancia ?? 0,
  }
}

// O que falta fazer num chat, por ordem de pontos: primeiro o que é a tua vez; depois o que a IA
// disse que falta (ou, sem isso, as tarefas por fazer da lista do chat).
function faltasDoChat(agora, resumo, situacao) {
  const itens = []
  const dias = Math.max(0, diasEntre(resumo.mensagemEm, agora))
  const poe = (texto, prioridade, extra) => {
    const t = limpo(texto)
    if (!t || itens.some(i => normalizar(i.texto) === normalizar(t))) return
    itens.push({
      texto: t, prioridade, tuaVez: false, emCurso: false, origem: '', desde: resumo.mensagemEm,
      chat: { local: resumo.local, titulo: resumo.titulo }, ...extra,
    })
  }
  if (resumo.estado === 'espera') poe(resumo.precisa || resumo.rotulo || 'Responder a este chat', resumo.importancia || 3, { tuaVez: true, origem: 'espera' })
  else if (resumo.precisa) poe(resumo.precisa, 3, { tuaVez: true, origem: 'app' })
  if (situacao?.falta?.length) {
    for (const f of situacao.falta) poe(f.texto, f.prioridade, { origem: 'ia' })
  } else if (resumo.plano && resumo.plano.feitos < resumo.plano.total) {
    if (resumo.plano.atual) poe(resumo.plano.atual, resumo.estado === 'trabalho' ? 4 : 3, { origem: 'plano', emCurso: resumo.estado === 'trabalho' })
    for (const t of resumo.plano.faltam) poe(t, 2, { origem: 'plano' })
  }
  for (const i of itens) i.pontos = pontosDe({ ...i, diasParado: dias })

  return itens.slice(0, MAX_POR_CHAT)
}

// O que ficou feito num chat: o que a IA registou turno a turno; sem isso, as tarefas da lista do
// chat dadas por concluídas e o «fez» do cartão da IA.
function feitosDoChat(resumo, situacao, espera) {
  const chat = { local: resumo.local, titulo: resumo.titulo }
  if (situacao?.feito?.length) return situacao.feito.map(f => ({ texto: f.texto, em: f.em || resumo.mensagemEm, chat, origem: 'ia' }))
  const textos = resumo.plano?.feitosTextos?.length ? resumo.plano.feitosTextos : espera?.fez ? [espera.fez] : []

  return textos.map(texto => ({ texto: limpo(texto), em: resumo.mensagemEm, chat, origem: 'plano' }))
}

// Um projeto sem nada feito registado mostra, como último recurso, o que o chat mais recente diz que fez.
function resumoComoFeito(resumo) {
  const t = limpo(resumo.respondeu)
  if (!t) return []
  const corte = t.length > 140 ? `${t.slice(0, t.lastIndexOf(' ', 140) > 60 ? t.lastIndexOf(' ', 140) : 140).trimEnd()}…` : t

  return [{ texto: corte, em: resumo.mensagemEm, chat: { local: resumo.local, titulo: resumo.titulo }, origem: 'resumo' }]
}

function semRepetidos(lista) {
  const vistos = new Set()

  return lista.filter(x => {
    const chave = normalizar(x.texto)
    if (!chave || vistos.has(chave)) return false
    vistos.add(chave)

    return true
  })
}

// `detalhes`: Map local → resumo do fim da transcrição. `situacoes`: Map local → situação do mod.
// `atividade`: Map local → mensagens tuas por dia (ritmo.mjs). `marcas`: o que a pessoa pôs nos
// projetos (marcas.mjs): dispensado até haver novidades, sem importância, linhas escondidas.
// Os projetos vêm pelo que pede mais atenção: a tua vez e a prioridade, os esquecidos (parados há 7
// dias ou mais, com coisas por fazer) e, a seguir, os mais recentes; os sem importância vão para o
// fim e os dispensados para depois deles.
export function montarProjetos(estado, detalhes = new Map(), { situacoes = new Map(), atividade = new Map(), marcas = vazias(), agora = estado.geradoEm } = {}) {
  const projetos = []
  for (const grupo of gruposDe(estado.arvore ?? [])) {
    const chats = chatsDoGrupo(estado, grupo)
    if (!chats.length) continue
    const resumidos = chats.map(c => resumirChat(estado, c, detalhes.get(c.local)))
    const esperaDe = new Map(estado.espera.map(x => [x.local, x]))
    // As linhas que a pessoa escondeu deste projeto (por já não valerem) não voltam a aparecer.
    const marca = marcas.grupos?.[grupo.id] ?? {}
    const escondidas = new Set((marcas.itens?.[grupo.id] ?? []).map(i => i.chave))
    const visivel = i => !escondidas.has(chaveDe(i.texto))
    const porFazer = resumidos
      .flatMap(r => faltasDoChat(agora, r, situacoes.get(r.local)))
      .filter(visivel)
      .sort((a, b) => b.pontos - a.pontos || b.desde - a.desde)
    let feito = semRepetidos(resumidos
      .flatMap(r => feitosDoChat(r, situacoes.get(r.local), esperaDe.get(r.local)))
      .filter(visivel)
      .sort((a, b) => b.em - a.em))
    if (!feito.length) feito = resumoComoFeito(resumidos[0]).filter(visivel)
    const ultimaEm = resumidos[0].mensagemEm
    const ritmo = ritmoDe(ultimaEm, agora)
    const semImportancia = marca.semImportancia === true
    // Dispensado até haver novidades: volta quando algum chat do projeto recebe uma mensagem nova.
    const dispensado = Number.isFinite(marca.dispensadoAte) && ultimaEm <= marca.dispensadoAte
    const esquecido = !semImportancia && !dispensado && ritmo === 'parado' && porFazer.length > 0
    const atencao = dispensado ? -2 : semImportancia ? -1
      : (porFazer[0]?.pontos ?? 0) + (esquecido ? 15 : 0) + (ritmo === 'hoje' ? 6 : ritmo === 'ativo' ? 3 : 0)
    projetos.push({
      id: grupo.id,
      nome: grupo.nome,
      caminho: chats[0].caminho ?? grupo.nome,
      total: chats.length,
      espera: resumidos.filter(c => c.estado === 'espera').length,
      trabalho: resumidos.filter(c => c.estado === 'trabalho').length,
      aMeio: resumidos.filter(c => c.aMeio).length,
      ultimaEm,
      diasParado: Math.max(0, diasEntre(ultimaEm, agora)),
      ritmo,
      esquecido,
      semImportancia,
      dispensado,
      linhasEscondidas: escondidas.size,
      atencao,
      atividade: somarAtividade(chats.map(c => atividade.get(c.local)), DIAS_RITMO),
      tuaVez: porFazer.filter(i => i.tuaVez).length,
      porFazer: porFazer.slice(0, MAX_POR_FAZER),
      maisPorFazer: Math.max(0, porFazer.length - MAX_POR_FAZER),
      feito: feito.slice(0, MAX_FEITO),
      principal: resumidos[0],
      outros: resumidos.slice(1, MAX_CHATS),
      maisChats: Math.max(0, resumidos.length - MAX_CHATS),
    })
  }

  return projetos.sort((a, b) => b.atencao - a.atencao || b.ultimaEm - a.ultimaEm)
}

// Quantos projetos há em cada ritmo, e quantos estão esquecidos (para o resumo no topo das pastas).
// Os dispensados e os sem importância não entram nas contagens; contam-se à parte.
export function resumirRitmo(projetos) {
  const contam = projetos.filter(p => !p.dispensado && !p.semImportancia)
  const conta = r => contam.filter(p => p.ritmo === r).length

  return {
    hoje: conta('hoje'),
    ativo: conta('ativo'),
    arrefecer: conta('arrefecer'),
    parado: conta('parado'),
    esquecidos: contam.filter(p => p.esquecido).length,
    tuaVez: contam.filter(p => p.tuaVez > 0).length,
    semImportancia: projetos.filter(p => p.semImportancia && !p.dispensado).length,
    dispensados: projetos.filter(p => p.dispensado).length,
  }
}
