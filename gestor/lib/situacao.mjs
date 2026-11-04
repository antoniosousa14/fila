import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

// A situação de cada chat, escrita pelo mod em cada fim de turno (mod/src/situacao.ts): o que já
// ficou feito (acumula-se) e o que ainda falta, por prioridade. Ao contrário da fila (itens/),
// não expira: serve a secção Projetos do painel.

const MAX_TEXTO = 120
const texto = t => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXTO)

// Aceita só o que tem a forma certa; o resto (ficheiro a meio, versão antiga) é ignorado.
export function lerSituacao(bruto) {
  if (typeof bruto?.sessao !== 'string' || !bruto.sessao) return undefined
  const feito = (Array.isArray(bruto.feito) ? bruto.feito : [])
    .map(f => ({ texto: texto(f?.texto), em: Number.isFinite(f?.em) ? f.em : 0 }))
    .filter(f => f.texto)
  const falta = (Array.isArray(bruto.falta) ? bruto.falta : [])
    .map(f => ({ texto: texto(f?.texto), prioridade: Math.min(5, Math.max(1, Math.round(Number(f?.prioridade)) || 3)) }))
    .filter(f => f.texto)

  return {
    sessao: bruto.sessao,
    local: typeof bruto.local === 'string' ? bruto.local : '',
    titulo: texto(bruto.titulo),
    em: Number.isFinite(bruto.em) ? bruto.em : 0,
    feito,
    falta,
  }
}

// Todas as situações da pasta, reaproveitando as que não mudaram (cache por caminho + mtime).
export async function lerSituacoes(pasta, cache = new Map()) {
  const lista = []
  const vistos = new Set()
  for (const nome of await readdir(pasta).catch(() => [])) {
    if (!nome.endsWith('.json')) continue
    const caminho = join(pasta, nome)
    const info = await stat(caminho).catch(() => undefined)
    if (!info?.isFile()) continue
    vistos.add(caminho)
    const guardado = cache.get(caminho)
    if (guardado?.mtime === info.mtimeMs) {
      if (guardado.situacao) lista.push(guardado.situacao)
      continue
    }
    let situacao
    try { situacao = lerSituacao(JSON.parse(await readFile(caminho, 'utf8'))) } catch { situacao = undefined }
    cache.set(caminho, { mtime: info.mtimeMs, situacao })
    if (situacao) lista.push(situacao)
  }
  for (const caminho of cache.keys()) if (!vistos.has(caminho)) cache.delete(caminho)

  return lista
}

// Liga cada situação ao chat da app: pelo id local_ que o mod guardou, ou, se não o tinha na
// altura, pela sessão do CLI (uma das do chat). `sessoes` são as de lib/sessoes.mjs.
export function situacaoPorLocal(situacoes, sessoes) {
  const porSessao = new Map(situacoes.map(s => [s.sessao, s]))
  const porLocal = new Map(situacoes.filter(s => s.local).map(s => [s.local, s]))
  const mapa = new Map()
  for (const s of sessoes) {
    const sit = porLocal.get(s.local) ?? s.clis?.map(c => porSessao.get(c)).find(Boolean)
    if (sit) mapa.set(s.local, sit)
  }

  return mapa
}
