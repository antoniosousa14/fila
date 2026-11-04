import type { EngineInterface, FsEntry } from 'claude-code'

import type { Foco, Item, Situacao } from '../types'
import { VALIDADE_MS } from './janela'

export type Caminhos = { raiz: string; itens: string; foco: string; consumo: string; saida: string; situacao: string }

const SUFIXO_DISPENSA = '.dispensado.json'

export async function caminhos($: EngineInterface): Promise<Caminhos> {
  const casa = (await $.env.get('USERPROFILE')) ?? ''
  const raiz = `${casa}/.claude/fila-atencao`

  return { raiz, itens: `${raiz}/itens`, foco: `${raiz}/foco.json`, consumo: `${raiz}/consumo`, saida: `${raiz}/saida`, situacao: `${raiz}/situacao` }
}

export async function garantirPastas($: EngineInterface, c: Caminhos): Promise<void> {
  const pastas = [c.itens, c.consumo, c.saida, c.situacao]
  const faltam: string[] = []
  for (const p of pastas) if (!(await $.fs.exists(p))) faltam.push(p)
  if (!faltam.length) return
  await $.process.run([
    'powershell',
    '-NoProfile',
    '-Command',
    `New-Item -ItemType Directory -Force -Path ${faltam.map(p => `'${p}'`).join(',')} | Out-Null`,
  ])
}

async function lerJson<T>($: EngineInterface, caminho: string): Promise<T | undefined> {
  try {
    return JSON.parse(await $.fs.read(caminho)) as T
  } catch {
    return undefined
  }
}

export function lerItem($: EngineInterface, c: Caminhos, sessao: string): Promise<Item | undefined> {
  return lerJson<Item>($, `${c.itens}/${sessao}.json`)
}

export async function escreverItem($: EngineInterface, c: Caminhos, item: Item): Promise<void> {
  await $.fs.write(`${c.itens}/${item.sessao}.json`, JSON.stringify(item))
}

export function lerSituacao($: EngineInterface, c: Caminhos, sessao: string): Promise<Situacao | undefined> {
  return lerJson<Situacao>($, `${c.situacao}/${sessao}.json`)
}

export async function escreverSituacao($: EngineInterface, c: Caminhos, situacao: Situacao): Promise<void> {
  await $.fs.write(`${c.situacao}/${situacao.sessao}.json`, JSON.stringify(situacao))
}

export async function escreverFoco($: EngineInterface, c: Caminhos, foco: Foco): Promise<void> {
  await $.fs.write(c.foco, JSON.stringify(foco))
}

export async function dispensar($: EngineInterface, c: Caminhos, sessao: string, desde: number): Promise<void> {
  await $.fs.write(`${c.itens}/${sessao}${SUFIXO_DISPENSA}`, JSON.stringify({ desde }))
}

export async function lerTudo(
  $: EngineInterface,
  c: Caminhos,
  agora: number,
): Promise<{ itens: Item[]; dispensados: Record<string, number>; foco?: Foco }> {
  const entradas = await $.fs.list(c.itens).catch(() => [] as FsEntry[])
  const itens: Item[] = []
  const dispensados: Record<string, number> = {}
  for (const entrada of entradas) {
    if (entrada.kind !== 'file' || !entrada.name.endsWith('.json') || agora - entrada.mtimeMs > VALIDADE_MS) continue
    const caminho = `${c.itens}/${entrada.name}`
    if (entrada.name.endsWith(SUFIXO_DISPENSA)) {
      const dispensa = await lerJson<{ desde: number }>($, caminho)
      if (dispensa) dispensados[entrada.name.slice(0, -SUFIXO_DISPENSA.length)] = dispensa.desde
    } else {
      const item = await lerJson<Item>($, caminho)
      if (item) itens.push(item)
    }
  }

  return { itens, dispensados, foco: await lerJson<Foco>($, c.foco) }
}
