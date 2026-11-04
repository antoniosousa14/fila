import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { grupoValido } from './grupos.mjs'

// As marcas que a pessoa põe nos projetos do painel (só do gestor, nada muda no Claude), como a
// dispensa dos chats à espera:
//  - dispensar: o projeto sai da vista até haver novidades (uma mensagem nova em qualquer chat dele);
//  - sem importância: fica à vista, mas por último e sem alertas de «esquecido»;
//  - esconder uma linha do que falta ou do que ficou feito (por já não valer, por exemplo).
// Ficam em projetos-marcas.json; só o servidor do gestor o escreve, um pedido de cada vez.

export const MAX_GRUPOS = 300
export const MAX_LINHAS = 40
const MAX_TEXTO = 160

export const vazias = () => ({ versao: 1, grupos: {}, itens: {} })

// A chave de uma linha de texto: igual aos espaços e maiúsculas, para a mesma linha dar a mesma marca.
export const chaveDe = t => String(t ?? '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, MAX_TEXTO)

// Aceita só o que tem a forma certa (o ficheiro pode estar estragado ou ser de outra versão).
export function limpar(bruto) {
  const marcas = vazias()
  for (const [id, m] of Object.entries(bruto?.grupos ?? {})) {
    if (!grupoValido(id) || typeof m !== 'object' || m === null) continue
    const marca = {}
    if (Number.isFinite(m.dispensadoAte)) marca.dispensadoAte = m.dispensadoAte
    if (m.semImportancia === true) marca.semImportancia = true
    if (Object.keys(marca).length) marcas.grupos[id] = marca
  }
  for (const [id, lista] of Object.entries(bruto?.itens ?? {})) {
    if (!grupoValido(id) || !Array.isArray(lista)) continue
    const itens = lista
      .map(i => ({ chave: chaveDe(i?.chave ?? i?.texto), texto: String(i?.texto ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXTO) }))
      .filter(i => i.chave)
      .slice(0, MAX_LINHAS)
    if (itens.length) marcas.itens[id] = itens
  }

  return marcas
}

export async function lerMarcas(caminho) {
  try {
    return limpar(JSON.parse(await readFile(caminho, 'utf8')))
  } catch {
    return vazias()
  }
}

// Escreve por inteiro num ficheiro temporário e troca: quem lê nunca o vê a meio.
export async function gravarMarcas(caminho, marcas) {
  await mkdir(dirname(caminho), { recursive: true })
  const temp = `${caminho}.${process.pid}.tmp`
  await writeFile(temp, JSON.stringify(marcas))
  await rename(temp, caminho)
}

const ACOES = ['dispensar', 'repor', 'sem-importancia', 'com-importancia', 'esconder-linha', 'repor-linhas']

// Aplica um pedido às marcas (sem as mudar): { marcas } ou { erro }.
export function aplicarAcao(antes, pedido) {
  if (!ACOES.includes(pedido?.acao)) return { erro: 'ação desconhecida' }
  if (!grupoValido(pedido.grupo)) return { erro: 'grupo inválido' }
  const marcas = limpar(antes)
  const id = pedido.grupo
  const marca = { ...(marcas.grupos[id] ?? {}) }
  if (pedido.acao === 'dispensar') {
    if (!Number.isFinite(pedido.desde)) return { erro: 'falta o instante da última mensagem' }
    marca.dispensadoAte = pedido.desde
  } else if (pedido.acao === 'repor') {
    delete marca.dispensadoAte
  } else if (pedido.acao === 'sem-importancia') {
    marca.semImportancia = true
  } else if (pedido.acao === 'com-importancia') {
    delete marca.semImportancia
  } else if (pedido.acao === 'esconder-linha') {
    const chave = chaveDe(pedido.texto)
    if (!chave) return { erro: 'linha vazia' }
    const lista = marcas.itens[id] ?? []
    if (!lista.some(i => i.chave === chave)) {
      if (lista.length >= MAX_LINHAS) return { erro: 'linhas escondidas a mais: repõe algumas' }
      lista.push({ chave, texto: String(pedido.texto).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXTO) })
    }
    marcas.itens[id] = lista
  } else if (pedido.acao === 'repor-linhas') {
    delete marcas.itens[id]
  }
  if (Object.keys(marca).length) marcas.grupos[id] = marca
  else delete marcas.grupos[id]
  if (Object.keys(marcas.grupos).length > MAX_GRUPOS) return { erro: 'marcas a mais' }

  return { marcas }
}
