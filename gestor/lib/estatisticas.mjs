import { diaLocal, nomeDaPasta } from './historico.mjs'

// O painel de consumo a partir dos estados do histórico (gestor/lib/historico.mjs): tokens e custo
// equivalente na API por dia, modelo, projeto, grupo e chat, e as horas de uso ativo e passivo.
const MIN = 60_000
const DIA = 24 * 60 * MIN
// Ativo: o tempo entre duas mensagens tuas seguidas (em qualquer chat) quando estão a menos disto;
// uma mensagem sozinha conta MENSAGEM_SOLTA_MS.
export const INATIVIDADE_MS = 15 * MIN
export const MENSAGEM_SOLTA_MS = 2 * MIN
export const DEFINICOES = {
  ativo: 'Ativo: o tempo entre mensagens tuas seguidas, em qualquer chat, quando estão a menos de 15 min uma da outra; uma mensagem sozinha conta 2 min.',
  passivo: 'Passivo: o Claude a trabalhar sem ti, ou seja, linhas das transcrições (chats e subagentes) a menos de 5 min umas das outras, fora do tempo ativo.',
  tokens: 'Tokens: entrada + saída + escrita de cache; a leitura de cache conta à parte, porque é muito maior e muito mais barata.',
}
const CATEGORIAS = ['entrada', 'saida', 'cache5m', 'cache1h', 'leitura']

export const tokensDe = t => (t.entrada ?? 0) + (t.saida ?? 0) + (t.cache5m ?? 0) + (t.cache1h ?? 0)

// O preço de um modelo pela chave do histórico: o base, o #longo do Haiku 5.5 ou o #rapido (entrada
// e saída da tabela do modo rápido; as escritas e leituras de cache com os multiplicadores normais).
export function precoDe(precos, chave) {
  const direto = precos?.modelos?.[chave]
  if (direto) return direto
  const [id, modo] = chave.split('#')
  const base = precos?.modelos?.[id]
  const rapido = precos?.rapido?.[id]
  if (modo !== 'rapido' || !base || !rapido) return undefined

  return { nome: `${base.nome} (modo rápido)`, entrada: rapido.entrada, saida: rapido.saida, cache5m: rapido.entrada * 1.25, cache1h: rapido.entrada * 2, leitura: rapido.entrada * (base.leitura / base.entrada) }
}

// Custo em USD de um conjunto de tokens; null se o modelo não tiver preço conhecido.
export function custoDe(precos, chave, t) {
  const p = precoDe(precos, chave)
  if (!p) return null

  return CATEGORIAS.reduce((s, k) => s + ((t[k] ?? 0) * p[k]) / 1e6, 0)
}

// ——— intervalos de tempo ———

export function juntar(intervalos) {
  const lista = intervalos.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])
  const saida = []
  for (const [a, b] of lista) {
    const ultimo = saida[saida.length - 1]
    if (ultimo && a <= ultimo[1]) ultimo[1] = Math.max(ultimo[1], b)
    else saida.push([a, b])
  }

  return saida
}

// A − B, com os dois já juntos.
export function subtrair(a, b) {
  const saida = []
  let j = 0
  for (const [ini, fim] of a) {
    let cursor = ini
    while (j < b.length && b[j][1] <= cursor) j++
    for (let k = j; k < b.length && b[k][0] < fim; k++) {
      if (b[k][0] > cursor) saida.push([cursor, b[k][0]])
      cursor = Math.max(cursor, b[k][1])
      if (cursor >= fim) break
    }
    if (cursor < fim) saida.push([cursor, fim])
  }

  return saida
}

// Milissegundos por dia local, cortando os intervalos à meia-noite.
export function porDia(intervalos) {
  const mapa = new Map()
  for (const [a, b] of intervalos) {
    for (let ini = a; ini < b;) {
      const d = new Date(ini)
      const meiaNoite = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
      const fim = Math.min(b, meiaNoite)
      const dia = diaLocal(ini)
      mapa.set(dia, (mapa.get(dia) ?? 0) + (fim - ini))
      ini = fim
    }
  }

  return mapa
}

export function intervalosAtivos(humanos) {
  const t = [...humanos].sort((a, b) => a - b)
  const lista = []
  for (let i = 0; i < t.length; i++) {
    const antes = i > 0 ? t[i] - t[i - 1] : Infinity
    const depois = i < t.length - 1 ? t[i + 1] - t[i] : Infinity
    if (antes <= INATIVIDADE_MS) lista.push([t[i - 1], t[i]])
    else if (depois > INATIVIDADE_MS) lista.push([t[i] - MENSAGEM_SOLTA_MS, t[i]])
  }

  return juntar(lista)
}

// ——— resumo ———

const vazioT = () => ({ entrada: 0, saida: 0, cache5m: 0, cache1h: 0, leitura: 0, respostas: 0 })
function acumular(destino, t) {
  for (const k of CATEGORIAS) destino[k] += t[k] ?? 0
  destino.respostas += t.respostas ?? 0
}

const mesDe = dia => dia.slice(0, 7)

// O custo na API vem em USD; a subscrição pode estar em EUR. `usdPorEur` converte (1 € = x USD).
export function paraMoeda(usd, moeda, usdPorEur) {
  if (moeda !== 'EUR') return usd

  return usdPorEur > 0 ? usd / usdPorEur : null
}

export function resumirHistorico({ estados, sessoes = [], grupos = [], atribuicoes = {}, precos, agora, subscricao = {} }) {
  const mensal = Number.isFinite(subscricao.mensal) ? subscricao.mensal : null
  // O que se pagou nos meses em que não foi o valor atual (ex.: um plano mais barato): { 'AAAA-MM': valor }.
  const mensalPorMes = {}
  for (const [mes, valor] of Object.entries(subscricao.meses ?? {})) if (/^\d{4}-\d{2}$/.test(mes) && Number.isFinite(valor) && valor >= 0) mensalPorMes[mes] = valor
  const moeda = subscricao.moeda === 'USD' ? 'USD' : 'EUR'
  const usdPorEur = subscricao.usdPorEur > 0 ? subscricao.usdPorEur : null
  // cli → chat da app (pelo id atual e pelos anteriores).
  const chatDoCli = new Map()
  for (const s of sessoes) for (const cli of s.clis ?? [s.cli]) if (cli) chatDoCli.set(cli, s)
  const nomeDoGrupo = new Map(grupos.map(g => [g.id, g.caminho ?? g.nome]))

  const porDiaModelo = new Map() // dia → modelo → tokens
  const porModelo = new Map()
  const porProjeto = new Map()
  const porGrupo = new Map()
  const porChat = new Map()
  const humanos = []
  const ocupado = []
  const somarEm = (mapa, chave, base, t, custo) => {
    if (!mapa.has(chave)) mapa.set(chave, { ...base, t: vazioT(), custo: 0, semPreco: 0 })
    const x = mapa.get(chave)
    acumular(x.t, t)
    if (custo === null) x.semPreco += tokensDe(t)
    else x.custo += custo
    return x
  }

  for (const e of estados) {
    const chat = chatDoCli.get(e.sessaoDoFicheiro) ?? chatDoCli.get(e.sessao)
    const grupo = chat ? (nomeDoGrupo.has(atribuicoes[chat.local]) ? atribuicoes[chat.local] : 'sem-grupo') : 'fora-da-app'
    const projeto = nomeDaPasta(e.cwd) || 'sem pasta'
    const projetoNome = /^scratch-\d{4}-\d{2}-\d{2}/.test(projeto) ? 'chats rápidos' : projeto
    if (!e.subagente) humanos.push(...e.humanos)
    ocupado.push(...e.ocupado, ...(e.seg ? [e.seg] : []))
    const dias = { ...e.dias }
    if (e.pendente) {
      const d = diaLocal(e.pendente.em)
      dias[d] = { ...(dias[d] ?? {}) }
      const atual = dias[d][e.pendente.modelo] ?? vazioT()
      dias[d][e.pendente.modelo] = { ...atual, ...Object.fromEntries(CATEGORIAS.map(k => [k, (atual[k] ?? 0) + e.pendente.t[k]])), respostas: (atual.respostas ?? 0) + 1 }
    }
    for (const [dia, modelos] of Object.entries(dias)) {
      for (const [modelo, t] of Object.entries(modelos)) {
        const custo = custoDe(precos, modelo, t)
        if (!porDiaModelo.has(dia)) porDiaModelo.set(dia, new Map())
        const dm = porDiaModelo.get(dia)
        if (!dm.has(modelo)) dm.set(modelo, { t: vazioT(), custo: 0, semPreco: 0 })
        const x = dm.get(modelo)
        acumular(x.t, t)
        if (custo === null) x.semPreco += tokensDe(t)
        else x.custo += custo
        somarEm(porModelo, modelo, { chave: modelo, nome: precoDe(precos, modelo)?.nome ?? modelo, temPreco: custo !== null }, t, custo)
        somarEm(porProjeto, projetoNome, { nome: projetoNome }, t, custo)
        somarEm(porGrupo, grupo, { id: grupo, nome: grupo === 'sem-grupo' ? 'Sem grupo' : grupo === 'fora-da-app' ? 'Fora da app (terminal)' : nomeDoGrupo.get(grupo) }, t, custo)
        const chaveChat = chat?.local ?? `cli:${e.sessaoDoFicheiro}`
        const c = somarEm(porChat, chaveChat, {
          local: chat?.local ?? null,
          grupo,
          titulo: chat?.titulo ?? `Sessão do terminal · ${projetoNome}`,
          caminho: chat ? (grupo === 'sem-grupo' ? 'Sem grupo' : nomeDoGrupo.get(grupo)) : 'fora da app',
          projeto: projetoNome,
          ultimo: '',
        }, t, custo)
        if (dia > c.ultimo) c.ultimo = dia
      }
    }
  }

  // Horas: ativo pelas mensagens tuas; passivo = o Claude ocupado fora do ativo.
  const ativos = intervalosAtivos(humanos)
  const ocupadoJunto = juntar(ocupado.map(([a, b]) => [a, Math.max(b, a + MIN / 6)]))
  const ativoPorDia = porDia(ativos)
  const passivoPorDia = porDia(subtrair(ocupadoJunto, ativos))

  // Dias seguidos do primeiro ao de hoje.
  const todosDias = [...porDiaModelo.keys(), ...ativoPorDia.keys()].sort()
  const hoje = diaLocal(agora)
  const dias = []
  if (todosDias.length) {
    const [a, m, d] = todosDias[0].split('-').map(Number)
    for (let x = new Date(a, m - 1, d); diaLocal(x.getTime()) <= hoje; x.setDate(x.getDate() + 1)) {
      const dia = diaLocal(x.getTime())
      const dm = porDiaModelo.get(dia) ?? new Map()
      const t = vazioT()
      let custo = 0
      let semPreco = 0
      const modelos = {}
      const custos = {}
      for (const [modelo, v] of dm) {
        acumular(t, v.t)
        custo += v.custo
        semPreco += v.semPreco
        modelos[modelo] = tokensDe(v.t)
        if (v.custo) custos[modelo] = v.custo
      }
      dias.push({ dia, tokens: tokensDe(t), leitura: t.leitura, respostas: t.respostas, custo, semPreco, modelos, custos, ativoMs: ativoPorDia.get(dia) ?? 0, passivoMs: passivoPorDia.get(dia) ?? 0 })
    }
  }

  const total = lista => lista.reduce((s, d) => ({
    tokens: s.tokens + d.tokens, leitura: s.leitura + d.leitura, custo: s.custo + d.custo, semPreco: s.semPreco + d.semPreco,
    ativoMs: s.ativoMs + d.ativoMs, passivoMs: s.passivoMs + d.passivoMs, respostas: s.respostas + d.respostas, dias: s.dias + (d.respostas > 0 ? 1 : 0),
  }), { tokens: 0, leitura: 0, custo: 0, semPreco: 0, ativoMs: 0, passivoMs: 0, respostas: 0, dias: 0 })
  const semanaDesde = diaLocal(agora - 6 * DIA)
  const mesAtual = mesDe(hoje)

  const meses = [...new Set(dias.map(d => mesDe(d.dia)))].map(mes => {
    const t = total(dias.filter(d => mesDe(d.dia) === mes))

    const naMoeda = paraMoeda(t.custo, moeda, usdPorEur)
    const pago = mensalPorMes[mes] ?? mensal

    return { mes, ...t, custoNaMoeda: naMoeda, subscricao: pago, poupanca: pago === null || naMoeda === null ? null : naMoeda - pago }
  })

  const lista = (mapa, max) => [...mapa.values()]
    .map(({ t, ...x }) => ({ ...x, tokens: tokensDe(t), leitura: t.leitura, respostas: t.respostas, detalhe: { entrada: t.entrada, saida: t.saida, cache5m: t.cache5m, cache1h: t.cache1h } }))
    .sort((a, b) => b.custo - a.custo || b.tokens - a.tokens)
    .slice(0, max)

  return {
    geradoEm: agora,
    desde: dias[0]?.dia ?? null,
    dias,
    totais: {
      hoje: total(dias.filter(d => d.dia === hoje)),
      semana: total(dias.filter(d => d.dia >= semanaDesde)),
      mes: total(dias.filter(d => mesDe(d.dia) === mesAtual)),
      total: total(dias),
    },
    meses,
    modelos: lista(porModelo, 50),
    projetos: lista(porProjeto, 30),
    grupos: lista(porGrupo, 50),
    chats: lista(porChat, 25),
    // Os chats de cada grupo, os 5 que mais custam, para a árvore pasta › grupo › chat.
    chatsPorGrupo: Object.fromEntries([...new Set([...porChat.values()].map(c => c.grupo))].map(g => [g, lista(new Map([...porChat].filter(([, c]) => c.grupo === g)), 5)])),
    mensal,
    mensalPorMes,
    moeda,
    usdPorEur,
    taxaData: subscricao.taxaData ?? null,
    taxaFonte: subscricao.taxaFonte ?? null,
    precos: { fonte: precos?.fonte ?? null, lidoEm: precos?.lidoEm ?? null, moeda: precos?.moeda ?? 'USD' },
    definicoes: DEFINICOES,
  }
}
