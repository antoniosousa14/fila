import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// FILA_RAIZ, FILA_SESSOES, FILA_CONFIG_APP e FILA_PROJETOS servem para os testes apontarem para pastas temporárias.
export function pastas(env = process.env) {
  const casa = env.USERPROFILE || homedir()
  const raiz = env.FILA_RAIZ || join(casa, '.claude', 'fila-atencao')
  const appdata = env.APPDATA || join(casa, 'AppData', 'Roaming')

  return {
    raiz,
    itens: join(raiz, 'itens'),
    // A situação de cada chat (o que ficou feito, o que falta), escrita pelo mod; não expira.
    situacao: join(raiz, 'situacao'),
    // As marcas do gestor nos projetos (dispensar, sem importância, linhas escondidas).
    projetosMarcas: join(raiz, 'projetos-marcas.json'),
    barra: join(raiz, 'barra.json'),
    // O chat onde a pessoa escreveu por último ({ sessao, em }), escrito pelo mod; só para leitura.
    foco: join(raiz, 'foco.json'),
    gestor: join(raiz, 'gestor.json'),
    orquestrador: join(raiz, 'orquestrador.json'),
    organizacao: join(raiz, 'organizacao.json'),
    consumo: join(raiz, 'consumo'),
    // Índice e agregados diários do histórico lido das transcrições (lib/historico.mjs).
    historico: join(raiz, 'consumo', 'historico'),
    configConsumo: join(raiz, 'consumo-config.json'),
    saida: join(raiz, 'saida'),
    erros: join(raiz, 'gestor-erros.log'),
    // Sinal para a barra pôr a janela do Claude à frente depois de abrir um link claude://.
    frente: join(raiz, 'claude-a-frente.json'),
    sessoes: env.FILA_SESSOES || join(appdata, 'Claude', 'claude-code-sessions'),
    // Só para leitura: tem segredos de servidores MCP (ver lib/grupos.mjs).
    configApp: env.FILA_CONFIG_APP || join(appdata, 'Claude', 'claude_desktop_config.json'),
    // Transcrições do Claude Code (só leitura: só contagens, horas e pastas).
    projetos: env.FILA_PROJETOS || join(casa, '.claude', 'projects'),
    precos: join(dirname(fileURLToPath(import.meta.url)), '..', 'precos.json'),
    ponta: join(dirname(fileURLToPath(import.meta.url)), '..', 'ponta.json'),
    web: join(dirname(fileURLToPath(import.meta.url)), '..', 'web'),
  }
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const RE_LOCAL = new RegExp(`^local_${UUID}$`)
const RE_UUID = new RegExp(`^${UUID}$`)

// Só ids destes passam para a linha de comandos (abrir) ou para nomes de ficheiro (dispensar).
export const localValido = x => typeof x === 'string' && RE_LOCAL.test(x)
export const uuidValido = x => typeof x === 'string' && RE_UUID.test(x)

// Uma pasta do disco para abrir um chat novo: absoluta e abaixo da raiz do disco.
export function pastaDoDiscoValida(p) {
  if (typeof p !== 'string' || p.length > 400 || /[\u0000-\u001f"]/.test(p)) return false
  const partes = p.replace(/\//g, '\\').split('\\').filter(Boolean)

  return /^[a-z]:$/i.test(partes[0] ?? '') && partes.length >= 2
}
