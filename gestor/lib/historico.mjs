import { createReadStream } from 'node:fs'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, join, sep } from 'node:path'

// Histórico de consumo reconstruído das transcrições do Claude Code (~/.claude/projects/**/*.jsonl,
// subagentes incluídos). De cada linha só se tiram a hora, o modelo, o id da mensagem, as contagens
// de tokens e a pasta: nunca o texto. Cada ficheiro lê-se uma vez e depois só o que cresceu
// (posição em bytes, cache por tamanho e mtime); o estado fica em consumo/historico/.
// 2: blocos de 10 min (para o horário e as horas de ponta).
export const VERSAO = 2
// Os blocos de tempo guardam os tokens por modelo em [entrada, saída, cache 5 min, cache 1 h, leitura].
export const BLOCO_MS = 10 * 60_000
// Duas linhas a menos disto uma da outra contam como o mesmo bocado de trabalho do Claude.
export const PAUSA_OCUPADO_MS = 5 * 60_000

const RE_TS = /"uuid":"[^"]+","timestamp":"([^"]+)"/
const RE_TS_QUALQUER = /"timestamp":"(\d{4}-[^"]+)"/
const RE_MODELO_ID = /"message":\{"model":"([^"]+)","id":"(msg_[^"]+)"/
const RE_CWD = /"cwd":"((?:[^"\\]|\\.)*)","sessionId":"([0-9a-f-]{36})"/
const RE_ORIGEM = /"turnOrigin":"([^"]*)"/
const RE_FONTE = /"promptSource":"([^"]*)"/

const dois = n => String(n).padStart(2, '0')
export const diaLocal = ms => { const d = new Date(ms); return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}` }

// O objeto JSON que começa em `inicio` (o `{`), lido com as chavetas equilibradas.
export function objetoEm(texto, inicio) {
  let fundo = 0
  let emTexto = false
  for (let i = inicio; i < texto.length; i++) {
    const c = texto[i]
    if (emTexto) {
      if (c === '\\') i++
      else if (c === '"') emTexto = false
    } else if (c === '"') emTexto = true
    else if (c === '{') fundo++
    else if (c === '}' && --fundo === 0) return texto.slice(inicio, i + 1)
  }

  return undefined
}

const n = x => (Number.isFinite(x) && x > 0 ? x : 0)

// Os tokens de uma resposta, pelas categorias da tabela de preços.
export function tokensDoUso(uso) {
  const c5 = uso.cache_creation?.ephemeral_5m_input_tokens
  const c1 = uso.cache_creation?.ephemeral_1h_input_tokens
  const escrita = n(uso.cache_creation_input_tokens)

  return {
    entrada: n(uso.input_tokens),
    saida: n(uso.output_tokens),
    // Sem a divisão 5 min / 1 h, conta tudo como 5 min (o preço mais baixo das duas escritas).
    cache5m: c5 === undefined && c1 === undefined ? escrita : n(c5),
    cache1h: n(c1),
    leitura: n(uso.cache_read_input_tokens),
  }
}

// A chave do modelo para os preços: sem a data do fim (…-20250929) nem sufixos ([1m]), com
// #rapido no modo rápido e #longo no Haiku 5.5 acima de 100 000 tokens de prompt.
export function chaveDoModelo(modelo, uso, t) {
  let id = String(modelo).replace(/\[.*\]$/, '').replace(/-\d{8}$/, '')
  const antigo = /^claude-(\d)-(\d)-(haiku|sonnet|opus)/.exec(id)
  if (antigo) id = `claude-${antigo[1]}-${antigo[2]}-${antigo[3]}`
  if (uso.speed === 'fast') return `${id}#rapido`
  if (id === 'claude-haiku-5-5' && t.entrada + t.cache5m + t.cache1h + t.leitura > 100_000) return `${id}#longo`

  return id
}

export function estadoVazio(caminho) {
  return { caminho, tam: 0, mtime: 0, pos: 0, sessao: '', cwd: '', pendente: null, seg: null, dias: {}, blocos: {}, humanos: [], ocupado: [] }
}

function somar(destino, t) {
  for (const k of ['entrada', 'saida', 'cache5m', 'cache1h', 'leitura']) destino[k] = (destino[k] ?? 0) + t[k]
  destino.respostas = (destino.respostas ?? 0) + 1
}

export const blocoDe = ms => String(Math.floor(ms / BLOCO_MS))
export const vetor = t => [t.entrada, t.saida, t.cache5m, t.cache1h, t.leitura]

function fecharPendente(e) {
  const p = e.pendente
  if (!p) return
  const dia = (e.dias[diaLocal(p.em)] ??= {})
  somar((dia[p.modelo] ??= {}), p.t)
  const bloco = ((e.blocos ??= {})[blocoDe(p.em)] ??= {})
  const v = vetor(p.t)
  bloco[p.modelo] = bloco[p.modelo] ? bloco[p.modelo].map((x, i) => x + v[i]) : v
  e.pendente = null
}

// Processa uma linha completa da transcrição e atualiza o estado do ficheiro.
export function processarLinha(e, linha) {
  const ts = Date.parse((RE_TS.exec(linha) ?? RE_TS_QUALQUER.exec(linha))?.[1] ?? '')
  if (!Number.isFinite(ts)) return
  if (!e.cwd) {
    const m = RE_CWD.exec(linha)
    if (m) {
      try { e.cwd = JSON.parse(`"${m[1]}"`) } catch { e.cwd = '' }
      e.sessao = m[2]
    }
  }
  // Bocados de trabalho: linhas seguidas a menos de 5 min.
  if (e.seg && ts - e.seg[1] <= PAUSA_OCUPADO_MS && ts >= e.seg[0]) e.seg[1] = Math.max(e.seg[1], ts)
  else {
    if (e.seg) e.ocupado.push(e.seg)
    e.seg = [ts, ts]
  }
  const tipo = RE_MODELO_ID.test(linha) ? 'assistant' : linha.includes('"type":"user","message":{"role":"user"') ? 'user' : ''
  if (tipo === 'assistant') {
    const m = RE_MODELO_ID.exec(linha)
    const parada = linha.indexOf('"stop_reason":')
    const i = parada < 0 ? -1 : linha.indexOf('"usage":{', parada)
    if (!m || i < 0 || m[1] === '<synthetic>') return
    let uso
    try { uso = JSON.parse(objetoEm(linha, i + 8)) } catch { return }
    const t = tokensDoUso(uso)
    const modelo = chaveDoModelo(m[1], uso, t)
    // O streaming repete a mesma mensagem em várias linhas: fica a última (a contagem final).
    if (e.pendente && e.pendente.id === m[2]) e.pendente = { ...e.pendente, t, modelo }
    else {
      fecharPendente(e)
      e.pendente = { id: m[2], em: ts, modelo, t }
    }
  } else if (tipo === 'user') {
    if (linha.includes('"tool_result"') || linha.includes('"isMeta":true') || linha.includes('"isSidechain":true')) return
    const origem = RE_ORIGEM.exec(linha)?.[1]
    // Só o que a pessoa escreveu: as transcrições novas marcam-no com turnOrigin "human"; nas
    // antigas, tudo o que não vem do sistema (avisos de tarefas, mensagens de outros chats).
    if (origem ? origem === 'human' : RE_FONTE.exec(linha)?.[1] !== 'system') e.humanos.push(ts)
  }
}

// Lê do ficheiro o que ainda não foi lido, só linhas completas.
export async function lerNovo(e, caminho) {
  const info = await stat(caminho).catch(() => undefined)
  if (!info) return false
  if (info.size === e.tam && info.mtimeMs === e.mtime) return false
  // Um ficheiro que encolheu ou mudou sem crescer foi reescrito: lê-se outra vez do início.
  if (info.size < e.pos || (info.size === e.tam && info.mtimeMs !== e.mtime)) Object.assign(e, estadoVazio(caminho))
  let resto = Buffer.alloc(0)
  let pos = e.pos
  const fluxo = createReadStream(caminho, { start: e.pos, end: info.size - 1, highWaterMark: 1 << 20 })
  for await (const pedaco of fluxo) {
    let buf = resto.length ? Buffer.concat([resto, pedaco]) : pedaco
    let ini = 0
    for (let fim = buf.indexOf(10, ini); fim !== -1; fim = buf.indexOf(10, ini)) {
      processarLinha(e, buf.toString('utf8', ini, fim))
      pos += fim + 1 - ini
      ini = fim + 1
    }
    resto = buf.subarray(ini)
  }
  e.pos = pos
  e.tam = info.size
  e.mtime = info.mtimeMs
  // Uma mensagem a meio pode continuar no próximo pedaço; fecha-se se o ficheiro estiver parado.
  if (Date.now() - info.mtimeMs > 10 * 60_000) {
    fecharPendente(e)
    if (e.seg) { e.ocupado.push(e.seg); e.seg = null }
  }

  return true
}

// Todas as transcrições: as dos chats (<projeto>/<sessão>.jsonl) e as dos subagentes e workflows
// (<projeto>/<sessão>/subagents/[workflows/<wf>/]*.jsonl), com a sessão a que pertencem.
export async function listarTranscricoes(base) {
  const lista = []
  const andar = async (pasta, fundo) => {
    for (const ent of await readdir(pasta, { withFileTypes: true }).catch(() => [])) {
      const p = join(pasta, ent.name)
      // <projeto>/<sessão>/subagents/workflows/<wf>/agent-*.jsonl é o mais fundo que há.
      if (ent.isDirectory() && fundo < 6) await andar(p, fundo + 1)
      else if (ent.isFile() && ent.name.endsWith('.jsonl')) {
        const partes = p.slice(base.length + 1).split(sep)
        const subagente = partes.includes('subagents')
        const sessao = subagente ? partes[1] : basename(ent.name, '.jsonl')
        lista.push({ caminho: p, sessao, subagente })
      }
    }
  }
  await andar(base, 0)

  return lista
}

// Um leitor que guarda o estado de cada ficheiro em consumo/historico/indice.json.
export function criarHistorico({ base, pasta }) {
  const indice = join(pasta, 'indice.json')
  let estados = null
  let emCurso = null
  const progresso = { lidos: 0, total: 0, bytes: 0, comecouEm: 0, acabouEm: 0 }

  async function carregar() {
    if (estados) return
    try {
      const dados = JSON.parse(await readFile(indice, 'utf8'))
      estados = new Map(dados.versao === VERSAO ? Object.entries(dados.ficheiros) : [])
    } catch {
      estados = new Map()
    }
  }

  async function gravar() {
    await mkdir(pasta, { recursive: true })
    const temp = `${indice}.${process.pid}.tmp`
    await writeFile(temp, JSON.stringify({ versao: VERSAO, ficheiros: Object.fromEntries(estados) }))
    await rename(temp, indice)
  }

  async function varrer() {
    await carregar()
    const lista = await listarTranscricoes(base)
    progresso.total = lista.length
    progresso.lidos = 0
    progresso.comecouEm = Date.now()
    let mudou = false
    for (const f of lista) {
      const e = estados.get(f.caminho) ?? estadoVazio(f.caminho)
      e.sessaoDoFicheiro = f.sessao
      e.subagente = f.subagente
      const antes = e.pos
      if (await lerNovo(e, f.caminho).catch(() => false)) {
        estados.set(f.caminho, e)
        mudou = true
        progresso.bytes += e.pos - antes
      }
      progresso.lidos++
    }
    const existem = new Set(lista.map(f => f.caminho))
    for (const caminho of [...estados.keys()]) if (!existem.has(caminho)) { estados.delete(caminho); mudou = true }
    if (mudou) await gravar()
    progresso.acabouEm = Date.now()

    return mudou
  }

  return {
    progresso,
    // Um varrimento de cada vez; quem chama a meio espera pelo que está a correr.
    atualizar: () => (emCurso ??= varrer().finally(() => { emCurso = null })),
    estados: () => [...(estados?.values() ?? [])],
    pronto: () => progresso.acabouEm > 0,
  }
}

export const nomeDaPasta = cwd => (cwd ?? '').split(/[\\/]/).filter(Boolean).pop() ?? ''
