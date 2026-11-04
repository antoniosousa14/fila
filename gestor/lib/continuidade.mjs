import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

// "Onde ficaste": o que um chat estava a fazer, tirado do fim da transcrição (só leitura). Serve a
// secção Projetos do painel, que, ao contrário da fila, não expira: os chats antigos também têm
// transcrição. Só se lê o fim do ficheiro (há transcrições de dezenas de MB).

export const CAUDA_BYTES = [400_000, 1_600_000]
const MAX_PEDI = 360
const MAX_RESPONDEU = 420
const MAX_PASSO = 140

const limpar = t => String(t ?? '').replace(/\s+/g, ' ').trim()

// Tira as marcas de markdown (títulos, negrito, código, listas, tabelas) para o texto ler-se numa
// linha ou duas no painel.
export function semMarcas(texto) {
  return String(texto ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .split('\n')
    .map(l => l.replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, '').replace(/^\s*\|?[\s:|-]+\|?\s*$/, ''))
    .join(' ')
    .replace(/\*\*|`|\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function cortar(texto, max) {
  const t = semMarcas(texto)
  if (t.length <= max) return t
  const corte = t.slice(0, max)
  // Corta no fim de uma frase ou palavra, não a meio.
  const frase = Math.max(corte.lastIndexOf('. '), corte.lastIndexOf('? '), corte.lastIndexOf('! '))

  return `${(frase > max * 0.6 ? corte.slice(0, frase + 1) : corte.slice(0, corte.lastIndexOf(' ') > 0 ? corte.lastIndexOf(' ') : max)).trimEnd()}…`
}

// O texto que a pessoa escreveu numa entrada 'user' (vazio se for um resultado de ferramenta, um
// aviso do sistema ou o resumo que o Claude gera ao compactar).
export function textoDaPessoa(entrada) {
  if (entrada?.type !== 'user' || entrada.isMeta || entrada.isSidechain) return ''
  const c = entrada.message?.content
  const bruto = typeof c === 'string'
    ? c
    : Array.isArray(c) ? c.filter(b => b?.type === 'text').map(b => b.text).join('\n') : ''
  const t = bruto.trim()
  if (!t || t.startsWith('<') || t.startsWith('[Request interrupted') || t.startsWith('Caveat:') || t.startsWith('This session is being continued')) return ''

  return t
}

// O texto da resposta do chat (os blocos de texto, sem o raciocínio nem as ferramentas).
export function textoDoChat(entrada) {
  if (entrada?.type !== 'assistant' || entrada.isSidechain) return ''
  const c = entrada.message?.content
  if (!Array.isArray(c)) return typeof c === 'string' ? c.trim() : ''

  return c.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n').trim()
}

const ESTADOS = new Set(['pending', 'in_progress', 'completed'])

// A lista de tarefas de uma chamada que a define por inteiro (TodoWrite, ou o `items` do painel da app).
export function passosDaFerramenta(bloco) {
  const entrada = bloco?.input
  const lista = bloco?.name === 'TodoWrite' ? entrada?.todos : /update_plan$/.test(bloco?.name ?? '') ? entrada?.items : undefined
  if (!Array.isArray(lista)) return undefined
  const passos = lista
    .filter(p => p && typeof (p.content ?? p.texto) === 'string')
    .map(p => ({ texto: limpar(p.content ?? p.texto).slice(0, MAX_PASSO), estado: ESTADOS.has(p.status ?? p.estado) ? (p.status ?? p.estado) : 'pending' }))

  return passos.length ? passos : undefined
}

// Aplica uma chamada de ferramenta à lista de tarefas. O painel da app atualiza a lista aos poucos
// (`advance`, `done`, `start`, e o `wrap_up` que dá tudo por feito); sem a chamada que a definiu
// por inteiro não há lista para atualizar, e devolve-se `parcial`.
export function aplicarPlano(passos, bloco) {
  const nome = bloco?.name ?? ''
  const entrada = bloco?.input ?? {}
  const inteira = passosDaFerramenta(bloco)
  if (inteira) return { passos: inteira }
  if (!/update_plan$/.test(nome) && !/wrap_up$/.test(nome)) return { passos }
  if (!passos) return { passos, parcial: true }
  const novos = passos.map(p => ({ ...p }))
  if (/wrap_up$/.test(nome)) {
    for (const p of novos) p.estado = 'completed'

    return { passos: novos }
  }
  if (entrada.advance) {
    const em = novos.findIndex(p => p.estado === 'in_progress')
    if (em >= 0) novos[em].estado = 'completed'
    const seguinte = novos.findIndex(p => p.estado === 'pending')
    if (seguinte >= 0) novos[seguinte].estado = 'in_progress'
  }
  for (const n of Array.isArray(entrada.done) ? entrada.done : []) if (novos[n - 1]) novos[n - 1].estado = 'completed'
  if (Number.isInteger(entrada.start) && novos[entrada.start - 1]) novos[entrada.start - 1].estado = 'in_progress'

  return { passos: novos }
}

// { feitos, total, atual, faltam[], feitosTextos[] } de uma lista de passos; undefined se não houver lista.
export function resumirPlano(passos) {
  if (!Array.isArray(passos) || !passos.length) return undefined
  const feitos = passos.filter(p => p.estado === 'completed').length
  const porFazer = passos.filter(p => p.estado !== 'completed')
  const atual = (passos.find(p => p.estado === 'in_progress') ?? porFazer[0])?.texto ?? ''

  return {
    feitos, total: passos.length, atual,
    faltam: porFazer.filter(p => p.texto !== atual).map(p => p.texto).slice(0, 3),
    // O que já ficou feito (as últimas tarefas dadas por concluídas), para o «feito recentemente» do projeto.
    feitosTextos: passos.filter(p => p.estado === 'completed').map(p => p.texto).slice(-4),
  }
}

// Lê as linhas JSON de um bloco do fim de uma transcrição e tira dele: o último pedido da pessoa,
// a última resposta do chat e o estado da lista de tarefas. A primeira linha pode estar cortada.
export function resumirCauda(texto, { cortada = false } = {}) {
  const linhas = texto.split('\n')
  if (cortada) linhas.shift()
  const entradas = []
  for (const linha of linhas) {
    if (!linha.trim()) continue
    try { entradas.push(JSON.parse(linha)) } catch { /* linha estragada: ignora */ }
  }
  let pedi
  let respondeu
  for (let i = entradas.length - 1; i >= 0 && !(pedi && respondeu); i--) {
    const e = entradas[i]
    if (!pedi) {
      const t = textoDaPessoa(e)
      if (t) pedi = { texto: cortar(t, MAX_PEDI), em: Date.parse(e.timestamp) || 0 }
    }
    if (!respondeu) {
      const t = textoDoChat(e)
      if (t) respondeu = { texto: cortar(t, MAX_RESPONDEU), em: Date.parse(e.timestamp) || 0 }
    }
  }
  // A lista de tarefas reconstrói-se de trás para a frente das chamadas, em ordem.
  let passos
  let parcial = false
  for (const e of entradas) {
    if (e.type !== 'assistant' || !Array.isArray(e.message?.content)) continue
    for (const bloco of e.message.content) {
      if (bloco?.type !== 'tool_use') continue
      const r = aplicarPlano(passos, bloco)
      passos = r.passos
      if (r.parcial) parcial = true
    }
  }

  return { pedi: pedi?.texto, pediEm: pedi?.em, respondeu: respondeu?.texto, respondeuEm: respondeu?.em, plano: resumirPlano(passos), planoParcial: !passos && parcial }
}

async function lerFim(caminho, bytes) {
  const fh = await open(caminho, 'r')
  try {
    const { size } = await fh.stat()
    const inicio = Math.max(0, size - bytes)
    const buf = Buffer.alloc(size - inicio)
    await fh.read(buf, 0, buf.length, inicio)

    return { texto: buf.toString('utf8'), cortada: inicio > 0, completa: inicio === 0 }
  } finally {
    await fh.close()
  }
}

// As transcrições dos chats são <base>/<pasta do projeto>/<sessão do CLI>.jsonl: um índice sessão →
// ficheiro, refeito de 30 em 30 s (ou quando falha uma procura).
export function criarContinuidade({ base, agora = () => Date.now() }) {
  let indice = new Map()
  let indiceEm = 0
  const cache = new Map()

  async function refazerIndice() {
    const novo = new Map()
    for (const ent of await readdir(base, { withFileTypes: true }).catch(() => [])) {
      if (!ent.isDirectory()) continue
      const pasta = join(base, ent.name)
      for (const nome of await readdir(pasta).catch(() => [])) {
        if (nome.endsWith('.jsonl')) novo.set(nome.slice(0, -6), join(pasta, nome))
      }
    }
    indice = novo
    indiceEm = agora()
  }

  async function achar(clis) {
    if (agora() - indiceEm > 30_000) await refazerIndice()
    for (const cli of clis) if (indice.has(cli)) return indice.get(cli)
    if (agora() - indiceEm > 5_000) {
      await refazerIndice()
      for (const cli of clis) if (indice.has(cli)) return indice.get(cli)
    }

    return undefined
  }

  // O resumo do fim da transcrição do chat (a mais recente das suas sessões do CLI).
  async function detalhe(clis) {
    const caminho = await achar(clis ?? [])
    if (!caminho) return undefined
    const info = await stat(caminho).catch(() => undefined)
    if (!info) return undefined
    const guardado = cache.get(caminho)
    if (guardado?.mtime === info.mtimeMs && guardado.tamanho === info.size) return guardado.detalhe
    let r
    for (const bytes of CAUDA_BYTES) {
      const { texto, cortada, completa } = await lerFim(caminho, bytes).catch(() => ({ texto: '' }))
      r = resumirCauda(texto, { cortada })
      // Um turno longo pode ter mais de 400 KB sem nenhuma mensagem da pessoa: alarga-se uma vez.
      if ((r.pedi && r.respondeu && !r.planoParcial) || completa) break
    }
    cache.set(caminho, { mtime: info.mtimeMs, tamanho: info.size, detalhe: r })

    return r
  }

  return { detalhe, limparCache: () => cache.clear() }
}
