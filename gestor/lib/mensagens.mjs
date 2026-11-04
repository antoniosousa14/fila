import { randomBytes } from 'node:crypto'
import { readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { localValido } from './caminhos.mjs'

// Mensagens a chats: o gestor escreve saida/<id>.json = { id, em, para: [local_…], sessoes, nomes,
// texto }; o carteiro (o mod do chat orquestrador, mod/src/carteiro.ts) envia-as com
// $.session.send e escreve <id>.a-enviar.json antes e <id>.resultado.json depois. O endereço é o
// local_… (a app encaminha e põe em fila); `sessoes` guarda a sessão do CLI, quando há, como
// segunda tentativa.
export const MAX_TEXTO = 4000
export const MAX_DESTINOS = 60
// Iguais a mod/src/carteiro.ts: um pedido que ninguém pegou em 30 min já não sai.
export const EXPIRA_MS = 30 * 60_000
const GUARDAR_MS = 7 * 24 * 3_600_000
const RE_ID = /^m_[a-z0-9]{6,40}$/

export const idValido = x => typeof x === 'string' && RE_ID.test(x)
export const novoId = agora => `m_${agora.toString(36)}${randomBytes(4).toString('hex')}`

// Texto de uma mensagem: com quebras de linha, sem outros caracteres de controlo.
export function textoValido(texto, max = MAX_TEXTO) {
  if (typeof texto !== 'string') return undefined
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(texto)) return undefined
  const limpo = texto.replace(/\r\n?/g, '\n').trim()

  return limpo && limpo.length <= max ? limpo : undefined
}

// Confirma os destinatários (chats abertos, que não o orquestrador) e junta a sessão do CLI de cada um.
export function prepararEnvio({ locais, texto, sessoes, orquestrador }) {
  const limpo = textoValido(texto)
  if (!limpo) return { erro: 'texto vazio ou inválido' }
  if (!Array.isArray(locais) || !locais.length || locais.length > MAX_DESTINOS || !locais.every(localValido)) return { erro: 'destinatários inválidos' }
  const porLocal = new Map(sessoes.map(s => [s.local, s]))
  const para = []
  for (const local of new Set(locais)) {
    const s = porLocal.get(local)
    if (!s || s.arquivado) return { erro: 'um dos chats já não existe ou está arquivado' }
    if (local === orquestrador) return { erro: 'o orquestrador não recebe mensagens daqui' }
    const cli = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s.cli) ? s.cli : ''
    para.push({ local, cli, titulo: s.titulo })
  }

  return { para, texto: limpo }
}

export async function escreverPedido(pasta, { id, em, para, texto }) {
  const pedido = {
    id,
    em,
    para: para.map(p => p.local),
    sessoes: Object.fromEntries(para.filter(p => p.cli).map(p => [p.local, p.cli])),
    nomes: Object.fromEntries(para.map(p => [p.local, p.titulo])),
    texto,
  }
  const temp = join(pasta, `${id}.tmp`)
  await writeFile(temp, JSON.stringify(pedido))
  await rename(temp, join(pasta, `${id}.json`))
}

async function lerJson(caminho) {
  try {
    return JSON.parse(await readFile(caminho, 'utf8'))
  } catch {
    return undefined
  }
}

// Os pedidos dos últimos 7 dias, do mais recente para o mais antigo, com o estado de cada um.
export async function lerMensagens(pasta, agora, max = 20) {
  const nomes = new Set(await readdir(pasta).catch(() => []))
  const ids = [...nomes].filter(n => n.endsWith('.json') && idValido(n.slice(0, -5))).map(n => n.slice(0, -5))
  const lista = []
  for (const id of ids) {
    const p = await lerJson(join(pasta, `${id}.json`))
    if (!p || p.id !== id || !Array.isArray(p.para) || agora - p.em > GUARDAR_MS) continue
    const resultado = nomes.has(`${id}.resultado.json`) ? await lerJson(join(pasta, `${id}.resultado.json`)) : undefined
    const aEnviar = nomes.has(`${id}.a-enviar.json`)
    const estado = resultado ? 'feito' : aEnviar ? 'a-enviar' : agora - p.em > EXPIRA_MS ? 'expirado' : 'na-fila'
    const porLocal = new Map((resultado?.resultados ?? []).map(r => [r.local, r]))
    lista.push({
      id,
      em: p.em,
      texto: String(p.texto ?? ''),
      estado,
      para: p.para.map(local => ({
        local,
        titulo: p.nomes?.[local] ?? 'chat',
        entregue: porLocal.get(local)?.entregue ?? null,
        motivo: porLocal.get(local)?.motivo ?? '',
      })),
    })
  }

  return lista.sort((a, b) => b.em - a.em).slice(0, max)
}

// Apaga os ficheiros de saida/ com mais de 7 dias (o mod não consegue apagar).
export async function limparSaida(pasta, agora) {
  for (const nome of await readdir(pasta).catch(() => [])) {
    if (!/^m_[a-z0-9]+\.(json|tmp|a-enviar\.json|resultado\.json)$/.test(nome)) continue
    const info = await stat(join(pasta, nome)).catch(() => undefined)
    if (info?.isFile() && agora - info.mtimeMs > GUARDAR_MS) await unlink(join(pasta, nome)).catch(() => {})
  }
}

// Ecrã de chat novo da app, com a pasta e a primeira mensagem já escritas (não envia nada):
// a app trata claude://code/new?folder=…&q=… (ver "Fase 4" na spec).
export function linkNovoChat({ pasta, texto }) {
  const q = new URLSearchParams()
  q.set('folder', pasta)
  if (texto) q.set('q', texto)

  return `claude://code/new?${q.toString().replace(/\+/g, '%20')}`
}
