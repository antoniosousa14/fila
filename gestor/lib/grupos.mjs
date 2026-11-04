import { readFile, stat } from 'node:fs/promises'

// Os grupos da barra lateral do Claude, tirados de claude_desktop_config.json (só leitura).
// O ficheiro tem segredos de servidores MCP: daqui só saem os ids, os nomes, a ordem e as
// atribuições dos chats; nunca se escreve, copia ou regista nada dele.
//   preferences.epitaxyPrefs['dframe-group-scopes'][conta/org] = { groups: [{ id, name }], assignments: { 'code:local_…': id } }
//   preferences.epitaxyPrefs['dframe-code-sections'][conta/org].sections = [{ id, kind, order, … }] (ordem da barra lateral)
const RE_GRUPO = /^cg-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const RE_LOCAL = /^local_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const MAX_NOME = 80

export const grupoValido = x => typeof x === 'string' && RE_GRUPO.test(x)

const nomeLimpo = n => (typeof n === 'string' ? n.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_NOME) : '')

// Devolve { grupos: [{ id, nome }] pela ordem da barra lateral, atribuicoes: { local: idDoGrupo } }.
export function extrairGrupos(config) {
  const prefs = config?.preferences?.epitaxyPrefs ?? {}
  const escopos = prefs['dframe-group-scopes'] ?? {}
  const seccoes = prefs['dframe-code-sections'] ?? {}
  const grupos = new Map()
  const atribuicoes = {}
  const posicao = new Map()
  for (const [escopo, v] of Object.entries(escopos)) {
    const ordem = new Map()
    const manuais = []
    for (const s of Array.isArray(seccoes[escopo]?.sections) ? seccoes[escopo].sections : []) {
      if (!grupoValido(s?.id)) continue
      if (Number.isFinite(s.order)) ordem.set(s.id, s.order)
      if (s.kind === 'manual') manuais.push(s)
    }
    for (const [i, g] of (Array.isArray(v?.groups) ? v.groups : []).entries()) {
      const nome = nomeLimpo(g?.name)
      if (!grupoValido(g?.id) || !nome || grupos.has(g.id)) continue
      grupos.set(g.id, { id: g.id, nome })
      // Na ordem da barra lateral; um grupo sem secção vai para o fim, pela ordem da lista.
      posicao.set(g.id, [ordem.get(g.id) ?? 10_000 + i, posicao.size])
    }
    // Um grupo sem chats não vem em `groups`, só como secção manual da barra lateral.
    for (const s of manuais) {
      const nome = nomeLimpo(s.name)
      if (!nome || grupos.has(s.id)) continue
      grupos.set(s.id, { id: s.id, nome })
      posicao.set(s.id, [ordem.get(s.id) ?? 20_000, posicao.size])
    }
    for (const [chave, id] of Object.entries(v?.assignments ?? {})) {
      const local = chave.startsWith('code:') ? chave.slice(5) : ''
      if (RE_LOCAL.test(local) && grupoValido(id)) atribuicoes[local] = id
    }
  }
  const lista = [...grupos.values()].sort((a, b) => {
    const [pa, ia] = posicao.get(a.id)
    const [pb, ib] = posicao.get(b.id)

    return pa - pb || ia - ib
  })
  // Atribuições a grupos que já não existem contam como sem grupo.
  for (const [local, id] of Object.entries(atribuicoes)) if (!grupos.has(id)) delete atribuicoes[local]

  return { grupos: lista, atribuicoes }
}

// Lê o ficheiro da app com cache por mtime. Um ficheiro ilegível dá { erro } sem mais nada.
export async function lerGruposDaApp(caminho, cache = new Map()) {
  const info = await stat(caminho).catch(() => undefined)
  if (!info) return { grupos: [], atribuicoes: {}, erro: 'sem ficheiro de configuração da app' }
  const guardado = cache.get(caminho)
  if (guardado?.mtime === info.mtimeMs) return guardado.dados
  let dados
  try {
    dados = extrairGrupos(JSON.parse(await readFile(caminho, 'utf8')))
  } catch {
    dados = { grupos: [], atribuicoes: {}, erro: 'não consegui ler os grupos da app' }
  }
  cache.set(caminho, { mtime: info.mtimeMs, dados })

  return dados
}
