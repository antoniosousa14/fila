import { randomBytes } from 'node:crypto'
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises'

import { grupoValido } from './grupos.mjs'

// A árvore do gestor é a dos grupos da barra lateral do Claude (gestor/lib/grupos.mjs), com os
// chats de lá. O gestor acrescenta pastas-mãe para juntar grupos e, só para si, nomes, grupos
// escondidos e a ordem que a pessoa arrastou:
//   organizacao.json = { versao: 2, pastas: [{ id, nome, pai }], grupos: { [idDoGrupo]: idDaPasta },
//                        nomes: { [idDoGrupo]: nome }, ocultos: [idDoGrupo], ordem: { [idDaPasta|'raiz']: [ids] } }
// Sem ordem guardada, os grupos seguem a barra lateral e uma pasta fica onde está o primeiro dos
// seus grupos (vazia, vai para o fim). Nada disto muda os grupos no Claude. Só o servidor escreve
// o ficheiro.
export const SEM_GRUPO = 'sem-grupo'
export const RAIZ = 'raiz'
export const MAX_NOME = 60
export const MAX_PASTAS = 100
const MAX_IDS = 500

const RE_PASTA = /^p_[a-z0-9]{4,32}$/

export const pastaValida = x => typeof x === 'string' && RE_PASTA.test(x)
export const novoId = () => `p_${randomBytes(5).toString('hex')}`

export function nomeValido(nome) {
  if (typeof nome !== 'string') return undefined
  // eslint-disable-next-line no-control-regex
  const limpo = nome.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()

  return limpo && limpo.length <= MAX_NOME ? limpo : undefined
}

export function vazia() {
  return { versao: 2, pastas: [], grupos: {}, nomes: {}, ocultos: [], ordem: {} }
}

const idDeNo = x => pastaValida(x) || grupoValido(x)

// Aceita o que vier do disco e devolve sempre uma organização coerente. O formato antigo (fase 2
// por pastas, com `seccoes`) não serve aqui e conta como vazio.
export function normalizar(bruto) {
  if (bruto?.versao !== 2) return vazia()
  const pastas = []
  const vistos = new Set()
  for (const p of Array.isArray(bruto.pastas) ? bruto.pastas : []) {
    const nome = nomeValido(p?.nome)
    if (!pastaValida(p?.id) || vistos.has(p.id) || !nome || pastas.length >= MAX_PASTAS) continue
    vistos.add(p.id)
    pastas.push({ id: p.id, nome, pai: pastaValida(p.pai) ? p.pai : null })
  }
  const porId = new Map(pastas.map(p => [p.id, p]))
  for (const p of pastas) {
    if (p.pai && !porId.has(p.pai)) p.pai = null
    const cadeia = new Set([p.id])
    for (let x = p.pai; x; x = porId.get(x)?.pai) {
      if (cadeia.has(x)) { p.pai = null; break }
      cadeia.add(x)
    }
  }
  const grupos = {}
  for (const [grupo, pasta] of Object.entries(bruto.grupos ?? {})) if (grupoValido(grupo) && porId.has(pasta)) grupos[grupo] = pasta
  const nomes = {}
  for (const [grupo, nome] of Object.entries(bruto.nomes ?? {})) {
    const limpo = nomeValido(nome)
    if (grupoValido(grupo) && limpo) nomes[grupo] = limpo
  }
  const ocultos = [...new Set((Array.isArray(bruto.ocultos) ? bruto.ocultos : []).filter(grupoValido))].slice(0, MAX_IDS)
  const ordem = {}
  for (const [pai, ids] of Object.entries(bruto.ordem ?? {})) {
    if ((pai === RAIZ || porId.has(pai)) && Array.isArray(ids)) ordem[pai] = [...new Set(ids.filter(idDeNo))].slice(0, MAX_IDS)
  }

  return { versao: 2, pastas, grupos, nomes, ocultos, ordem }
}

function descendentes(org, id) {
  const fora = new Set([id])
  for (let mudou = true; mudou;) {
    mudou = false
    for (const p of org.pastas) if (p.pai && fora.has(p.pai) && !fora.has(p.id)) { fora.add(p.id); mudou = true }
  }

  return fora
}

// ——— operações: devolvem { org } ou { erro } e nunca mexem na organização recebida ———

export function criarPasta(org, { nome, pai = null }) {
  const limpo = nomeValido(nome)
  if (!limpo) return { erro: 'nome inválido' }
  if (pai !== null && !org.pastas.some(p => p.id === pai)) return { erro: 'a pasta-mãe não existe' }
  if (org.pastas.length >= MAX_PASTAS) return { erro: 'pastas a mais' }
  const id = novoId()

  return { id, org: { ...org, pastas: [...org.pastas, { id, nome: limpo, pai }] } }
}

export function renomearPasta(org, { id, nome }) {
  const limpo = nomeValido(nome)
  if (!limpo) return { erro: 'nome inválido' }
  if (!org.pastas.some(p => p.id === id)) return { erro: 'a pasta não existe' }

  return { org: { ...org, pastas: org.pastas.map(p => (p.id === id ? { ...p, nome: limpo } : p)) } }
}

// Apagar uma pasta não mexe nos grupos do Claude: o que estava dentro sobe para a pasta de cima.
export function apagarPasta(org, { id }) {
  const alvo = org.pastas.find(p => p.id === id)
  if (!alvo) return { erro: 'a pasta não existe' }
  const pastas = org.pastas.filter(p => p.id !== id).map(p => (p.pai === id ? { ...p, pai: alvo.pai } : p))
  const grupos = {}
  for (const [grupo, pasta] of Object.entries(org.grupos)) {
    if (pasta !== id) grupos[grupo] = pasta
    else if (alvo.pai) grupos[grupo] = alvo.pai
  }

  return { org: { ...org, pastas, grupos } }
}

export function moverPasta(org, { id, pai = null }) {
  if (!org.pastas.some(p => p.id === id)) return { erro: 'a pasta não existe' }
  if (pai !== null && !org.pastas.some(p => p.id === pai)) return { erro: 'a pasta-mãe não existe' }
  if (pai !== null && descendentes(org, id).has(pai)) return { erro: 'uma pasta não pode ir para dentro de si própria' }

  return { org: { ...org, pastas: org.pastas.map(p => (p.id === id ? { ...p, pai } : p)) } }
}

// Põe um grupo do Claude dentro de uma pasta (null tira-o de lá). O grupo em si não muda.
export function moverGrupo(org, { grupo, pasta = null }) {
  if (!grupoValido(grupo)) return { erro: 'grupo inválido' }
  if (pasta !== null && !org.pastas.some(p => p.id === pasta)) return { erro: 'a pasta não existe' }
  const grupos = { ...org.grupos }
  if (pasta) grupos[grupo] = pasta
  else delete grupos[grupo]

  return { org: { ...org, grupos } }
}

// Um nome só do gestor para um grupo do Claude; vazio ou null volta ao nome do Claude.
export function renomearGrupo(org, { grupo, nome = null }) {
  if (!grupoValido(grupo)) return { erro: 'grupo inválido' }
  const nomes = { ...org.nomes }
  if (nome === null || nome === '') {
    delete nomes[grupo]

    return { org: { ...org, nomes } }
  }
  const limpo = nomeValido(nome)
  if (!limpo) return { erro: 'nome inválido' }
  nomes[grupo] = limpo

  return { org: { ...org, nomes } }
}

// Esconder tira o grupo da árvore do gestor; no Claude fica tudo igual.
export function esconderGrupo(org, { grupo }) {
  if (!grupoValido(grupo)) return { erro: 'grupo inválido' }

  return { org: { ...org, ocultos: [...new Set([...(org.ocultos ?? []), grupo])] } }
}

export function mostrarGrupo(org, { grupo }) {
  if (!grupoValido(grupo)) return { erro: 'grupo inválido' }

  return { org: { ...org, ocultos: (org.ocultos ?? []).filter(g => g !== grupo) } }
}

// Arrastar para entre dois nós: põe o nó (pasta ou grupo) em `pai` e guarda a ordem dos irmãos
// tal como ficou no ecrã.
export function posicionar(org, { tipo, no, pai = null, irmaos }) {
  if (!Array.isArray(irmaos) || irmaos.length > MAX_IDS || !irmaos.every(idDeNo) || !irmaos.includes(no)) return { erro: 'ordem inválida' }
  const r = tipo === 'pasta' ? moverPasta(org, { id: no, pai })
    : tipo === 'grupo' ? moverGrupo(org, { grupo: no, pasta: pai })
      : { erro: 'tipo inválido' }
  if (r.erro) return r

  return { org: { ...r.org, ordem: { ...r.org.ordem, [pai ?? RAIZ]: [...new Set(irmaos)] } } }
}

// ——— leitura ———

// A árvore para a barra lateral: pastas e grupos do Claude, com os chats de cada grupo (pela ordem
// recebida) e as contagens. Só entram os chats que estão num grupo do Claude; os outros aparecem
// apenas nos Recentes. `grupos` vem pela ordem da barra lateral do Claude e `atribuicoes` diz o
// grupo de cada chat.
export function montarArvore({ org, grupos, atribuicoes, chats }) {
  const existe = new Set(grupos.map(g => g.id))
  const porGrupo = new Map()
  for (const c of chats) {
    const id = existe.has(atribuicoes[c.local]) ? atribuicoes[c.local] : SEM_GRUPO
    if (!porGrupo.has(id)) porGrupo.set(id, [])
    porGrupo.get(id).push(c)
  }
  const pastaDe = id => (org.pastas.some(p => p.id === org.grupos[id]) ? org.grupos[id] : null)
  const ocultos = new Set(org.ocultos ?? [])
  const visiveis = grupos.map((g, i) => [g, i]).filter(([g]) => !ocultos.has(g.id))
  // A ordem arrastada manda; o que não está nela segue a ordem do Claude, depois.
  const pela = chave => {
    const posicao = new Map((org.ordem?.[chave] ?? []).map((id, i) => [id, i]))
    const p = n => posicao.get(n.id) ?? Infinity

    return (a, b) => (p(a) - p(b)) || (a.ordem - b.ordem)
  }
  const noGrupo = (g, ordem) => {
    const meus = porGrupo.get(g.id) ?? []

    return {
      tipo: 'grupo', id: g.id, nome: org.nomes?.[g.id] ?? g.nome, nomeClaude: g.nome, ordem, filhas: [],
      chats: meus.map(c => c.local), espera: meus.filter(c => c.espera).length, total: meus.length,
    }
  }
  const noPasta = p => {
    const filhas = [
      ...org.pastas.filter(x => x.pai === p.id).map(noPasta),
      ...visiveis.filter(([g]) => pastaDe(g.id) === p.id).map(([g, i]) => noGrupo(g, i)),
    ].sort(pela(p.id))

    return {
      tipo: 'pasta', id: p.id, nome: p.nome, filhas, chats: [],
      // Fica onde está o primeiro dos seus grupos; vazia, vai para o fim.
      ordem: Math.min(Infinity, ...filhas.map(f => f.ordem)),
      espera: filhas.reduce((n, f) => n + f.espera, 0),
      total: filhas.reduce((n, f) => n + f.total, 0),
    }
  }
  const arvore = [
    ...org.pastas.filter(p => p.pai === null).map(noPasta),
    ...visiveis.filter(([g]) => pastaDe(g.id) === null).map(([g, i]) => noGrupo(g, i)),
  ].sort(pela(RAIZ))

  return arvore
}

// Caminho de nomes de cada nó da árvore ("Apps / Dinamo").
export function caminhos(arvore) {
  const nomes = new Map()
  const andar = (nos, antes) => {
    for (const n of nos) {
      const caminho = antes ? `${antes} / ${n.nome}` : n.nome
      nomes.set(n.id, caminho)
      andar(n.filhas, caminho)
    }
  }
  andar(arvore, '')

  return nomes
}

export async function lerOrganizacao(caminho) {
  try {
    return normalizar(JSON.parse(await readFile(caminho, 'utf8')))
  } catch (erro) {
    if (erro?.code !== 'ENOENT') await copyFile(caminho, `${caminho}.estragado`).catch(() => {})
    return vazia()
  }
}

// Escreve num temporário e troca. Um ficheiro do formato antigo fica guardado em .v1.json antes.
export async function gravarOrganizacao(caminho, org) {
  const antigo = await readFile(caminho, 'utf8').then(t => JSON.parse(t), () => undefined)
  if (antigo && antigo.versao !== 2) await copyFile(caminho, caminho.replace(/\.json$/, '.v1.json')).catch(() => {})
  const temp = `${caminho}.${process.pid}.tmp`
  await writeFile(temp, JSON.stringify(normalizar({ ...org, versao: 2 }), null, 1))
  await trocar(temp, caminho)
}

// No Windows, a troca falha (EPERM) enquanto outra leitura tem o ficheiro aberto, por exemplo o
// estado pedido a cada 3 s: tenta outra vez, com pausas curtas, antes de desistir.
async function trocar(temp, caminho, tentativas = 8) {
  for (let i = 1; ; i++) {
    try {
      return await rename(temp, caminho)
    } catch (erro) {
      if (i >= tentativas || !['EPERM', 'EACCES', 'EBUSY'].includes(erro?.code)) throw erro
      await new Promise(resolver => setTimeout(resolver, 15 * i))
    }
  }
}
