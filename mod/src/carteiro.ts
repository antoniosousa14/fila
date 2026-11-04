// Carteiro: o chat orquestrador entrega as mensagens que a pessoa confirmou no gestor.
// O gestor escreve saida/<id>.json = { id, em, para: [local_…], sessoes: { local_…: sessão do CLI },
// texto } (gestor/lib/mensagens.mjs); o carteiro marca <id>.a-enviar.json, envia com $.session.send
// e escreve <id>.resultado.json. Sem tokens: é só ler ficheiros e entregar.

export const INTERVALO_MS = 3000
// Iguais a gestor/lib/mensagens.mjs: um pedido que ninguém pegou em 30 min já não sai.
export const EXPIRA_MS = 30 * 60_000
// Um pedido marcado a enviar sem resultado há 10 min ficou a meio (o chat fechou): não se reenvia.
export const INTERROMPIDO_MS = 10 * 60_000
export const MAX_TEXTO = 4000
export const MAX_DESTINOS = 60

const RE_ID = /^m_[a-z0-9]{6,40}$/
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const RE_SESSAO = new RegExp(`^${UUID}$`)
const RE_LOCAL = new RegExp(`^local_${UUID}$`)

export type Pedido = { id: string; em: number; para: string[]; sessoes: Record<string, string>; texto: string }
export type Resultado = { local: string; entregue: boolean; motivo: string }
export type Entrada = { name: string; kind: string; mtimeMs: number }

// O que há para fazer em saida/: pedidos novos e pedidos que ficaram a meio.
export function porTratar(entradas: Entrada[], agora: number): { novos: string[]; interrompidos: string[] } {
  const ficheiros = new Map(entradas.filter(e => e.kind === 'file').map(e => [e.name, e]))
  const novos: string[] = []
  const interrompidos: string[] = []
  for (const nome of ficheiros.keys()) {
    if (!nome.endsWith('.json')) continue
    const id = nome.slice(0, -'.json'.length)
    if (!RE_ID.test(id) || ficheiros.has(`${id}.resultado.json`)) continue
    const marca = ficheiros.get(`${id}.a-enviar.json`)
    if (!marca) novos.push(id)
    else if (agora - marca.mtimeMs > INTERROMPIDO_MS) interrompidos.push(id)
  }

  return { novos: novos.sort(), interrompidos: interrompidos.sort() }
}

// Só passa um pedido bem formado: o id do nome do ficheiro, chats local_…, sessões em UUID e texto
// com tamanho.
export function lerPedido(texto: string, id: string): Pedido | undefined {
  try {
    const p = JSON.parse(texto)
    if (p?.id !== id || !Number.isFinite(p.em) || typeof p.texto !== 'string') return undefined
    if (!Array.isArray(p.para) || !p.para.length || p.para.length > MAX_DESTINOS || !p.para.every((x: unknown) => typeof x === 'string' && RE_LOCAL.test(x))) return undefined
    const limpo = p.texto.trim()
    if (!limpo || limpo.length > MAX_TEXTO) return undefined
    const sessoes: Record<string, string> = {}
    for (const [local, sessao] of Object.entries(p.sessoes ?? {})) {
      if (RE_LOCAL.test(local) && typeof sessao === 'string' && RE_SESSAO.test(sessao)) sessoes[local] = sessao
    }

    return { id, em: p.em, para: [...new Set<string>(p.para)], sessoes, texto: limpo }
  } catch {
    return undefined
  }
}

export const todosFalharam = (para: string[], motivo: string): Resultado[] => para.map(local => ({ local, entregue: false, motivo }))

export const resultadoDoEnvio = (local: string, r: { isDelivered: boolean; reason?: string }): Resultado => ({
  local,
  entregue: r.isDelivered,
  motivo: r.isDelivered ? '' : String(r.reason ?? 'não entregue').slice(0, 300),
})

// Endereços a tentar, por ordem: o local_… (a app encaminha e põe em fila) e, se falhar, a
// sessão do CLI que o chat tinha quando a pessoa confirmou.
export function enderecos(pedido: Pedido, local: string): Array<string | { sessionId: string }> {
  const sessao = pedido.sessoes[local]

  return sessao ? [local, { sessionId: sessao }] : [local]
}
