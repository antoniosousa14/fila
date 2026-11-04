// O texto que chega em prompt.submit traz blocos que a app injeta antes do que a pessoa escreveu
// (<system-reminder>, avisos de tarefas de fundo). Ficam de fora do pedido guardado e classificado.
const RE_INJETADO = /<(system-reminder|task-notification)>[\s\S]*?(<\/\1>|$)/g

export function limparPedido(texto: string): string {
  return texto.replace(RE_INJETADO, ' ').replace(/\s+/g, ' ').trim()
}
