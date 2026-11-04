import type { Passo } from '../types'

export const FERRAMENTA_PLANO = 'mcp__ccd_turn__update_plan'
const IGNORADAS = new Set([FERRAMENTA_PLANO, 'mcp__ccd_turn__wrap_up'])
const ESTADOS: Passo['estado'][] = ['pending', 'in_progress', 'completed']

// Reconstrói a lista de tarefas que a app mostra por baixo das mensagens, a partir das
// chamadas a update_plan: `items` substitui tudo, `advance` passa ao seguinte,
// `done` (1-based) conclui e `start` (1-based) começa.
export function aplicarPlano(passos: Passo[], entrada: Record<string, unknown>): Passo[] {
  if (Array.isArray(entrada.items)) {
    return entrada.items.map((bruto: any) => ({
      texto: String(bruto?.content ?? ''),
      estado: ESTADOS.includes(bruto?.status) ? bruto.status : 'pending',
    }))
  }
  const novos = passos.map(p => ({ ...p }))
  if (Array.isArray(entrada.done)) {
    for (const n of entrada.done) if (novos[Number(n) - 1]) novos[Number(n) - 1].estado = 'completed'
  }
  if (typeof entrada.start === 'number' && novos[entrada.start - 1]) novos[entrada.start - 1].estado = 'in_progress'
  if (entrada.advance === true) {
    const atual = novos.findIndex(p => p.estado === 'in_progress')
    if (atual >= 0) novos[atual].estado = 'completed'
    const seguinte = novos.findIndex((p, i) => i > atual && p.estado === 'pending')
    if (seguinte >= 0) novos[seguinte].estado = 'in_progress'
  }

  return novos
}

export function resumoDosPassos(passos: Passo[]): { feitos: number; total: number; atual?: string } {
  return {
    feitos: passos.filter(p => p.estado === 'completed').length,
    total: passos.length,
    atual: passos.find(p => p.estado === 'in_progress')?.texto,
  }
}

export function contaComoAcao(ferramenta: string): boolean {
  return !IGNORADAS.has(ferramenta)
}

// "Edit register.tsx", "Bash npm test", "list_sessions": o nome curto e o pormenor mais útil.
export function descreverFerramenta(ferramenta: string, entrada: Record<string, unknown>): string {
  const nome = ferramenta.startsWith('mcp__') ? (ferramenta.split('__').pop() ?? ferramenta) : ferramenta
  const caminho = typeof entrada.file_path === 'string' ? entrada.file_path.split(/[\\/]/).pop() : undefined
  const detalhe = [caminho, entrada.command, entrada.pattern, entrada.url, entrada.query, entrada.description].find(
    v => typeof v === 'string' && v.trim() !== '',
  ) as string | undefined

  return `${nome} ${(detalhe ?? '').replace(/\s+/g, ' ').trim()}`.trim().slice(0, 60)
}
