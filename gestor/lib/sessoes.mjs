import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

const nomeDaPasta = cwd => (cwd ?? '').split(/[\\/]/).filter(Boolean).pop() ?? ''

// { idDoCli: instante } só com instantes válidos (a app escreve-o em priorCliSessionLeftAt).
function instantesPorId(bruto) {
  const saida = {}
  if (bruto && typeof bruto === 'object' && !Array.isArray(bruto)) {
    for (const [id, em] of Object.entries(bruto)) if (typeof em === 'number' && Number.isFinite(em)) saida[id] = em
  }

  return saida
}

export function resumirSessao(s) {
  if (typeof s?.sessionId !== 'string') return undefined
  const resumo = s.postTurnSummary ?? {}

  return {
    local: s.sessionId,
    cli: s.cliSessionId ?? '',
    // A sessão do CLI atual e as anteriores (a app muda-a ao retomar): liga o chat às transcrições.
    clis: [s.cliSessionId, ...(Array.isArray(s.priorCliSessionIds) ? s.priorCliSessionIds : [])].filter(x => typeof x === 'string' && x),
    // Quando a app largou cada uma delas (um /clear, por exemplo). Um turno "a trabalhar" dessa sessão
    // do CLI que começou antes disso nunca vai acabar: o mod não chega a escrever o fim.
    clisSaidos: instantesPorId(s.priorCliSessionLeftAt),
    titulo: s.title || 'Chat sem título',
    cwd: s.cwd ?? '',
    projeto: nomeDaPasta(s.cwd),
    criadoEm: s.createdAt ?? 0,
    atividadeEm: s.lastActivityAt ?? 0,
    // A app guarda em latestUserFrameAt a hora da última mensagem que entrou no chat (escrita
    // pela pessoa, ou de outro chat); as sessões antigas não o têm e ficam com lastActivityAt.
    mensagemEm: s.latestUserFrameAt ?? s.lastActivityAt ?? 0,
    arquivado: s.isArchived === true,
    resumo: resumo.status_detail ?? '',
    precisa: resumo.needs_action ?? '',
    estado: resumo.status_category ?? '',
  }
}

// Lê todos os local_*.json da app, reaproveitando o que não mudou (cache por caminho + mtime).
// Os ficheiros têm ~600 KB; só o primeiro varrimento os lê todos.
export async function lerSessoes(base, cache = new Map()) {
  const sessoes = []
  const vistos = new Set()
  for (const conta of await readdir(base).catch(() => [])) {
    for (const org of await readdir(join(base, conta)).catch(() => [])) {
      const pasta = join(base, conta, org)
      for (const nome of await readdir(pasta).catch(() => [])) {
        if (!nome.startsWith('local_') || !nome.endsWith('.json')) continue
        const caminho = join(pasta, nome)
        const info = await stat(caminho).catch(() => undefined)
        if (!info) continue
        vistos.add(caminho)
        const guardado = cache.get(caminho)
        if (guardado?.mtime === info.mtimeMs) { if (guardado.sessao) sessoes.push(guardado.sessao); continue }
        let sessao
        try { sessao = resumirSessao(JSON.parse(await readFile(caminho, 'utf8'))) } catch { sessao = undefined }
        cache.set(caminho, { mtime: info.mtimeMs, sessao })
        if (sessao) sessoes.push(sessao)
      }
    }
  }
  for (const caminho of cache.keys()) if (!vistos.has(caminho)) cache.delete(caminho)

  return sessoes
}
