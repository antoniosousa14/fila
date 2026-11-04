import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Iguais a mod/src/armazem.ts e mod/src/janela.ts.
const SUFIXO_DISPENSA = '.dispensado.json'
export const VALIDADE_MS = 7 * 24 * 3_600_000

export async function lerJson(caminho) {
  try {
    return JSON.parse(await readFile(caminho, 'utf8'))
  } catch {
    return undefined
  }
}

// Os itens e as dispensas escritos pelo mod, ignorando o que tem mais de 7 dias.
export async function lerFila(pastaItens, agora) {
  const itens = []
  const dispensados = {}
  for (const nome of await readdir(pastaItens).catch(() => [])) {
    if (!nome.endsWith('.json')) continue
    const caminho = join(pastaItens, nome)
    const info = await stat(caminho).catch(() => undefined)
    if (!info?.isFile() || agora - info.mtimeMs > VALIDADE_MS) continue
    if (nome.endsWith(SUFIXO_DISPENSA)) {
      const dispensa = await lerJson(caminho)
      if (typeof dispensa?.desde === 'number') dispensados[nome.slice(0, -SUFIXO_DISPENSA.length)] = dispensa.desde
    } else {
      const item = await lerJson(caminho)
      if (item?.sessao) itens.push(item)
    }
  }

  return { itens, dispensados }
}

// O mesmo ficheiro que a barra e o mod escrevem ao dispensar. `sessao` já vem validada.
export async function dispensar(pastaItens, sessao, desde) {
  await writeFile(join(pastaItens, `${sessao}${SUFIXO_DISPENSA}`), JSON.stringify({ desde }))
}
