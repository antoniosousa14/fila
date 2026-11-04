import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extrairGrupos, lerGruposDaApp } from '../lib/grupos.mjs'

const G = n => `cg-${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
const L = n => `local_${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
const ESCOPO = 'conta/org'
const SEGREDO = 'sk-ant-segredo-que-nunca-pode-sair'

const config = {
  mcpServers: { resend: { env: { RESEND_API_KEY: SEGREDO } } },
  preferences: {
    epitaxyPrefs: {
      'dframe-group-scopes': {
        [ESCOPO]: {
          groups: [
            { id: G(1), name: 'MesasOnline', mode: 'code' },
            { id: G(2), name: 'Portfolio', mode: 'code' },
            { id: G(3), name: ' Dinamo\n', mode: 'code' },
            { id: 'cg-mau', name: 'Mau' },
            { id: G(4), name: '', mode: 'code' },
          ],
          assignments: { [`code:${L(1)}`]: G(3), [`code:${L(2)}`]: G(9), [`code:${L(3)}`]: G(1), 'chat:x': G(1), [`code:${L(4)}`]: 'cg-mau' },
        },
      },
      'dframe-code-sections': {
        [ESCOPO]: {
          sections: [
            { id: 'pinned', kind: 'pinned', order: 0 },
            { id: G(8), kind: 'manual', name: 'Aquario', order: 1 },
            { id: G(3), kind: 'manual', name: 'Nome antigo', order: 2 },
            { id: G(1), kind: 'manual', order: 3 },
            { id: G(7), kind: 'manual', order: 4 },
            { id: 'cg-mau', kind: 'manual', name: 'Mau', order: 5 },
          ],
        },
      },
    },
  },
}

test('grupos pela ordem da barra lateral, sem nomes vazios nem ids estranhos; os sem secção no fim', () => {
  const { grupos } = extrairGrupos(config)
  assert.deepEqual(grupos, [{ id: G(8), nome: 'Aquario' }, { id: G(3), nome: 'Dinamo' }, { id: G(1), nome: 'MesasOnline' }, { id: G(2), nome: 'Portfolio' }])
})

test('um grupo sem chats só existe como secção manual e entra na mesma, no lugar dela', () => {
  const soSeccao = { preferences: { epitaxyPrefs: {
    'dframe-group-scopes': { [ESCOPO]: { groups: [{ id: G(1), name: 'ISEP' }], assignments: {} } },
    'dframe-code-sections': { [ESCOPO]: { sections: [{ id: G(5), kind: 'manual', name: 'Video Editing', order: 1 }, { id: G(1), kind: 'manual', name: 'ISEP', order: 2 }, { id: 'pinned', kind: 'pinned', name: 'x', order: 0 }] } },
  } } }
  assert.deepEqual(extrairGrupos(soSeccao).grupos, [{ id: G(5), nome: 'Video Editing' }, { id: G(1), nome: 'ISEP' }])
})

test('atribuições: só chats de código, só para grupos que existem', () => {
  assert.deepEqual(extrairGrupos(config).atribuicoes, { [L(1)]: G(3), [L(3)]: G(1) })
})

test('sem preferências não há grupos, e nada do resto do ficheiro passa', () => {
  assert.deepEqual(extrairGrupos({}), { grupos: [], atribuicoes: {} })
  assert.equal(JSON.stringify(extrairGrupos(config)).includes(SEGREDO), false)
})

test('lerGruposDaApp: cache por mtime; ficheiro estragado ou em falta dá erro sem conteúdo', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'gestor-grupos-'))
  const caminho = join(pasta, 'claude_desktop_config.json')
  assert.equal((await lerGruposDaApp(caminho)).erro, 'sem ficheiro de configuração da app')
  await writeFile(caminho, JSON.stringify(config))
  const cache = new Map()
  const lidos = await lerGruposDaApp(caminho, cache)
  assert.equal(lidos.grupos.length, 4)
  assert.equal(await lerGruposDaApp(caminho, cache), lidos)
  assert.equal(JSON.stringify([...cache.values()]).includes(SEGREDO), false)
  await writeFile(caminho, `{ "mcpServers": "${SEGREDO}"`)
  const estragado = await lerGruposDaApp(caminho, new Map())
  assert.deepEqual(estragado, { grupos: [], atribuicoes: {}, erro: 'não consegui ler os grupos da app' })
})
