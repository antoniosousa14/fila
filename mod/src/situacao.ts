import type { Classificacao, Situacao } from '../types'

// A situação de um chat, para o gestor a juntar por projeto: o que já ficou feito (acumula-se de
// turno para turno) e o que ainda falta, por prioridade (muda a cada turno). Ao contrário do item
// da fila, não expira.

export const MAX_FEITO = 12
export const MAX_FALTA = 5

const normalizar = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim()

type Base = Pick<Situacao, 'sessao' | 'local' | 'titulo' | 'projeto'>

// Junta a classificação de um turno à situação anterior. `undefined` quando o modelo não devolveu
// nem `feito` nem `falta` (nada a escrever: a situação anterior fica como estava).
export function juntarSituacao(anterior: Situacao | undefined, base: Base, classificacao: Classificacao | undefined, em: number): Situacao | undefined {
  if (!classificacao || (classificacao.feito === undefined && classificacao.falta === undefined)) return undefined
  const antigos = anterior?.feito ?? []
  const vistos = new Set(antigos.map(f => normalizar(f.texto)))
  const novos = []
  for (const texto of classificacao.feito ?? []) {
    const chave = normalizar(texto)
    if (!chave || vistos.has(chave)) continue
    vistos.add(chave)
    novos.push({ texto, em })
  }

  return {
    sessao: base.sessao,
    local: base.local ?? anterior?.local,
    titulo: base.titulo || anterior?.titulo || base.projeto,
    projeto: base.projeto,
    em,
    feito: [...novos, ...antigos].slice(0, MAX_FEITO),
    falta: (classificacao.falta ?? anterior?.falta ?? []).slice(0, MAX_FALTA),
  }
}
