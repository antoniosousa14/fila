// O ritmo de um projeto: quando mexeste nele e quão a frio está, para não deixar projetos
// esquecidos. A atividade conta as mensagens que escreveste, por dia, a partir das transcrições.

export const DIAS_RITMO = 14
const DIA = 86_400_000

// Dias de calendário (locais) entre dois instantes: ontem às 23:59 e hoje às 00:01 são 1 dia.
export function diasEntre(de, ate) {
  const a = new Date(de)
  const b = new Date(ate)

  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DIA)
}

// 'hoje' (menos de 24 h), 'ativo' (menos de 3 dias), 'arrefecer' (3 a 6 dias) ou 'parado' (7 ou mais).
export function ritmoDe(ultimaEm, agora) {
  const h = (agora - ultimaEm) / 3_600_000
  if (!(ultimaEm > 0)) return 'parado'
  if (h < 24) return 'hoje'
  const d = diasEntre(ultimaEm, agora)

  return d < 3 ? 'ativo' : d < 7 ? 'arrefecer' : 'parado'
}

// Mensagens tuas por dia, dos últimos `dias` dias (do mais antigo ao de hoje), de cada chat.
// `estados`: os ficheiros do histórico ({ sessaoDoFicheiro, subagente, humanos[] }); `localDe`:
// sessão do CLI → id local_ do chat. Devolve Map local → number[].
export function atividadeDosChats(estados, localDe, agora, dias = DIAS_RITMO) {
  const mapa = new Map()
  for (const e of estados) {
    if (e.subagente) continue
    const local = localDe.get(e.sessaoDoFicheiro)
    if (!local) continue
    const conta = mapa.get(local) ?? new Array(dias).fill(0)
    for (const ts of e.humanos ?? []) {
      const atras = diasEntre(ts, agora)
      if (atras >= 0 && atras < dias) conta[dias - 1 - atras]++
    }
    mapa.set(local, conta)
  }

  return mapa
}

export const somarAtividade = (listas, dias = DIAS_RITMO) =>
  Array.from({ length: dias }, (_, i) => listas.reduce((n, l) => n + (l?.[i] ?? 0), 0))
