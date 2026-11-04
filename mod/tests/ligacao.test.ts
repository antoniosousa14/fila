import { expect, test } from 'claude-code/testing'

import { deFicheiroDaApp, linkDoChat } from '../src/ligacao'

const ficheiro = JSON.stringify({
  sessionId: 'local_abc',
  cliSessionId: 'cli-1',
  priorCliSessionIds: ['cli-0'],
  title: 'Plataforma análise leads Porto',
})

test('encontra pelo id atual', () => {
  expect(deFicheiroDaApp(ficheiro, 'cli-1')?.local).toBe('local_abc')
  expect(deFicheiroDaApp(ficheiro, 'cli-1')?.titulo).toBe('Plataforma análise leads Porto')
})

test('encontra por um id anterior', () => {
  expect(deFicheiroDaApp(ficheiro, 'cli-0')?.local).toBe('local_abc')
})

test('outro id ou JSON inválido dá undefined', () => {
  expect(deFicheiroDaApp(ficheiro, 'cli-9')).toBe(undefined)
  expect(deFicheiroDaApp('{', 'cli-1')).toBe(undefined)
})

test('link do chat', () => {
  expect(linkDoChat('local_abc')).toBe('claude://claude.ai/epitaxy/local_abc')
})
