export type Importancia = 1 | 2 | 3 | 4 | 5
export type TipoEspera = 'aprovacao' | 'decisao' | 'revisao' | 'info'
export type Esforco = 'segundos' | 'minutos' | 'longo'

// O que ainda falta fazer num chat, com a prioridade de agora (5 = para já, 1 = pode esperar).
export type Falta = { texto: string; prioridade: Importancia }

export type Classificacao = {
  importancia: Importancia
  tipo: TipoEspera
  esforco: Esforco
  desbloqueia: boolean
  rotulo: string
  cartao: { pediste: string; fez: string; precisa: string }
  // O que ficou concluído neste turno e o que ainda falta: alimentam a situação do projeto.
  feito?: string[]
  falta?: Falta[]
}

export type Feito = { texto: string; em: number }

// A situação de um chat (situacao/<sessão>.json): ao contrário do item da fila não expira, e o
// que ficou feito acumula-se de turno para turno. O gestor junta-as por projeto.
export type Situacao = {
  sessao: string
  local?: string
  titulo: string
  projeto: string
  em: number
  feito: Feito[]
  falta: Falta[]
}

export type EstadoItem = 'a-trabalhar' | 'a-espera'

export type Passo = { texto: string; estado: 'pending' | 'in_progress' | 'completed' }

export type Progresso = { passos: Passo[]; ferramentas: number; ultima?: string }

export type Item = {
  sessao: string
  local?: string
  titulo: string
  projeto: string
  estado: EstadoItem
  desde: number
  classificacao?: Classificacao
  pedido?: string
  progresso?: Progresso
}

export type Trabalho = {
  sessao: string
  local?: string
  titulo: string
  projeto: string
  desde: number
  pedido: string
  feitos: number
  total: number
  atual?: string
  ferramentas: number
  ultima?: string
}

export type Foco = { sessao: string; em: number }

export type Linha = {
  sessao: string
  local?: string
  titulo: string
  projeto: string
  desde: number
  classificacao?: Classificacao
  pontos: number
  silenciado: boolean
}

export type Vista = {
  fila: Linha[]
  antigos: Linha[]
  aTrabalhar: number
  foco?: { titulo: string; importancia: number }
  calculadaEm: number
}
