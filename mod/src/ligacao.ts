import type { EngineInterface, FsEntry } from 'claude-code'

export type Ligacao = { local: string; titulo: string }

const RECENTE_MS = 10 * 60_000

export const linkDoChat = (local: string) => `claude://claude.ai/epitaxy/${local}`

export function deFicheiroDaApp(texto: string, sessao: string): Ligacao | undefined {
  try {
    const s = JSON.parse(texto)
    const ids: unknown[] = [s.cliSessionId, ...(Array.isArray(s.priorCliSessionIds) ? s.priorCliSessionIds : [])]
    if (!ids.includes(sessao) || typeof s.sessionId !== 'string') return undefined

    return { local: s.sessionId, titulo: typeof s.title === 'string' ? s.title : '' }
  } catch {
    return undefined
  }
}

async function listar($: EngineInterface, caminho: string): Promise<FsEntry[]> {
  return $.fs.list(caminho).catch(() => [] as FsEntry[])
}

export async function procurarLigacao($: EngineInterface, sessao: string, agora: number): Promise<Ligacao | undefined> {
  const appdata = await $.env.get('APPDATA')
  if (!appdata) return undefined
  const base = `${appdata}/Claude/claude-code-sessions`
  for (const conta of await listar($, base)) {
    if (conta.kind !== 'dir') continue
    for (const org of await listar($, `${base}/${conta.name}`)) {
      if (org.kind !== 'dir') continue
      const pasta = `${base}/${conta.name}/${org.name}`
      const recentes = (await listar($, pasta)).filter(
        f => f.kind === 'file' && f.name.startsWith('local_') && f.name.endsWith('.json') && agora - f.mtimeMs < RECENTE_MS,
      )
      for (const f of recentes) {
        const ligacao = deFicheiroDaApp(await $.fs.read(`${pasta}/${f.name}`).catch(() => ''), sessao)
        if (ligacao) return ligacao
      }
    }
  }

  return undefined
}

const RE_LOCAL = /^local_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// O ficheiro de sessão da app de um chat dado o seu local_…, em qualquer conta e organização.
export async function lerFicheiroDoChat($: EngineInterface, local: string): Promise<string | undefined> {
  if (!RE_LOCAL.test(local)) return undefined
  const appdata = await $.env.get('APPDATA')
  if (!appdata) return undefined
  const base = `${appdata}/Claude/claude-code-sessions`
  for (const conta of await listar($, base)) {
    if (conta.kind !== 'dir') continue
    for (const org of await listar($, `${base}/${conta.name}`)) {
      if (org.kind !== 'dir') continue
      const texto = await $.fs.read(`${base}/${conta.name}/${org.name}/${local}.json`).catch(() => undefined)
      if (texto) return texto
    }
  }

  return undefined
}
