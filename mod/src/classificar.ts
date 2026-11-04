import type { Classificacao, Esforco, Falta, Importancia, TipoEspera } from '../types'

export const MODELO = 'claude-haiku-5-5'

const TIPOS: TipoEspera[] = ['aprovacao', 'decisao', 'revisao', 'info']
const ESFORCOS: Esforco[] = ['segundos', 'minutos', 'longo']

export const SISTEMA = `Classificas o que um chat de trabalho precisa da pessoa, agora que acabou um turno, e resumes onde o trabalho está.
Responde só com JSON, sem texto à volta, neste formato:
{"importancia":1,"tipo":"aprovacao|decisao|revisao|info","esforco":"segundos|minutos|longo","desbloqueia":true,"rotulo":"até 4 palavras","cartao":{"pediste":"até 10 palavras","fez":"até 10 palavras","precisa":"até 10 palavras"},"feito":["até 10 palavras"],"falta":[{"texto":"até 10 palavras","prioridade":1}]}
importancia vai de 1 a 5 e é da tarefa concreta, não do projeto: produção, dados de clientes, prazos e bloqueios sobem; estilo, curiosidade e informação descem.
desbloqueia é true quando a resposta da pessoa põe o chat a trabalhar outra vez.
esforco é o tempo que a pessoa demora a responder.
feito é o que ficou concluído neste turno (não o que foi só tentado), no máximo 3 coisas; [] se nada ficou concluído.
falta é o que ainda falta fazer neste trabalho, no máximo 4 coisas, da mais para a menos importante agora, incluindo o que só a pessoa pode fazer; [] se nada falta. prioridade vai de 1 a 5: 5 é para já (bloqueia, tem prazo ou é produção), 1 pode esperar.
Escreve em português de Portugal.`

export function montarPrompt(projeto: string, pedido: string, resposta: string): string {
  return `Projeto: ${projeto}\n\nPedido da pessoa:\n${pedido.slice(0, 2000)}\n\nÚltima resposta do chat:\n${resposta.slice(-4000)}`
}

const limitarPrioridade = (n: number): Importancia => Math.min(5, Math.max(1, Math.round(n))) as Importancia

function lerFeito(bruto: unknown): string[] {
  if (!Array.isArray(bruto)) return []

  return bruto.map(x => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, 100)).filter(Boolean).slice(0, 3)
}

function lerFalta(bruto: unknown): Falta[] {
  if (!Array.isArray(bruto)) return []
  const lista: Falta[] = []
  for (const x of bruto) {
    const texto = String((x as { texto?: unknown } | undefined)?.texto ?? (typeof x === 'string' ? x : '')).replace(/\s+/g, ' ').trim().slice(0, 100)
    if (!texto) continue
    const prioridade = Number((x as { prioridade?: unknown } | undefined)?.prioridade)
    lista.push({ texto, prioridade: limitarPrioridade(Number.isFinite(prioridade) ? prioridade : 3) })
  }

  return lista.slice(0, 4)
}

export function lerClassificacao(texto: string): Classificacao | undefined {
  const inicio = texto.indexOf('{')
  const fim = texto.lastIndexOf('}')
  if (inicio < 0 || fim <= inicio) return undefined
  let bruto: Record<string, any>
  try {
    bruto = JSON.parse(texto.slice(inicio, fim + 1))
  } catch {
    return undefined
  }
  const importancia = Math.round(Number(bruto.importancia))
  if (!Number.isFinite(importancia)) return undefined
  const cartao = bruto.cartao ?? {}

  return {
    importancia: Math.min(5, Math.max(1, importancia)) as Importancia,
    tipo: TIPOS.includes(bruto.tipo) ? bruto.tipo : 'info',
    esforco: ESFORCOS.includes(bruto.esforco) ? bruto.esforco : 'minutos',
    desbloqueia: bruto.desbloqueia === true,
    rotulo: String(bruto.rotulo ?? '').slice(0, 40),
    cartao: {
      pediste: String(cartao.pediste ?? '').slice(0, 80),
      fez: String(cartao.fez ?? '').slice(0, 80),
      precisa: String(cartao.precisa ?? '').slice(0, 80),
    },
    // Só vêm se o modelo os devolveu: sem eles a situação do chat fica como estava.
    ...(Array.isArray(bruto.feito) ? { feito: lerFeito(bruto.feito) } : {}),
    ...(Array.isArray(bruto.falta) ? { falta: lerFalta(bruto.falta) } : {}),
  }
}
