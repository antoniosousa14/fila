import { caminhos, montarArvore, SEM_GRUPO, vazia } from './organizacao.mjs'

const H = 3_600_000

// Igual ao do mod: um "a trabalhar" com mais de 3 h é de um chat fechado a meio de um turno
// (mod/src/vista.ts, TRABALHO_MAX_MS).
export const TRABALHO_MAX_MS = 3 * H

export function meiaNoiteLocal(agora) {
  const d = new Date(agora)

  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

// Um "a trabalhar" cuja sessão do CLI a app já largou (um /clear a meio do turno, por exemplo) está
// morto: o mod nunca chega a escrever o fim do turno e o item ficava preso até às 3 h.
export const trabalhoMorto = (sessao, t) => (sessao?.clisSaidos?.[t.sessao] ?? -1) >= t.desde

function porChave(lista, chave) {
  const mapa = new Map()
  for (const x of lista ?? []) if (x?.[chave]) mapa.set(x[chave], x)

  return mapa
}

// Junta as sessões da app (todos os chats) com a fila do mod (itens + barra.json) na vista do painel.
// A ordem da espera é a da IA (barra.json); as dispensas filtram-se aqui porque o barra.json só é
// reescrito no próximo turno de algum chat (a barra faz o mesmo). A árvore é a dos grupos da barra
// lateral do Claude (`grupos`, `atribuicoes`), com as pastas-mãe do gestor (`organizacao`).
export function montarEstado({ sessoes = [], itens = [], barra, dispensados = {}, agora, meiaNoite, organizacao = vazia(), grupos = [], atribuicoes = {}, erroGrupos, foco, orquestrador }) {
  const sessaoDe = porChave(sessoes, 'local')
  const itemDe = porChave(itens, 'sessao')
  const modelo = barra?.modelo?.vazia === false ? barra.modelo : undefined
  const chips = [...(modelo?.chips ?? []), ...(modelo?.extra ?? [])]

  // Um chat arquivado na app deixa de contar, mesmo que o mod ainda tenha o item (dura 7 dias).
  const arquivado = local => sessaoDe.get(local)?.arquivado === true

  const importanciaDe = chip => itemDe.get(chip.sessao)?.classificacao?.importancia ?? 3

  // O mod esconde do barra.json o chat onde a pessoa escreveu por último (o foco: já o está a ver), mas o
  // gestor serve para ver tudo o que espera por ela: esse chat entra aqui pela ordem da importância. Um item
  // de uma sessão do CLI que o /clear deixou para trás (há outro mais novo do mesmo chat) não conta.
  const doFoco = itemDe.get(foco)
  const chipDoFoco = doFoco && doFoco.estado === 'a-espera' && Number.isFinite(doFoco.desde)
    && doFoco.local !== orquestrador && !arquivado(doFoco.local) && dispensados[doFoco.sessao] !== doFoco.desde
    && !chips.some(chip => chip.sessao === doFoco.sessao)
    && !itens.some(i => i.local === doFoco.local && i.sessao !== doFoco.sessao && i.desde > doFoco.desde)
    ? { sessao: doFoco.sessao, local: doFoco.local, desde: doFoco.desde, texto: `${doFoco.projeto ?? ''} · ${doFoco.titulo ?? ''}`, silenciado: false }
    : undefined
  const comFoco = [...chips]
  if (chipDoFoco) {
    const antes = comFoco.findIndex(chip => importanciaDe(chip) < importanciaDe(chipDoFoco))
    comFoco.splice(antes === -1 ? comFoco.length : antes, 0, chipDoFoco)
  }

  const espera = comFoco
    .filter(chip => dispensados[chip.sessao] !== chip.desde && !arquivado(chip.local))
    .map((chip, i) => {
      const s = sessaoDe.get(chip.local)
      const c = itemDe.get(chip.sessao)?.classificacao
      const importancia = c?.importancia ?? 3

      return {
        numero: i + 1,
        sessao: chip.sessao,
        local: chip.local ?? '',
        titulo: s?.titulo ?? itemDe.get(chip.sessao)?.titulo ?? chip.texto,
        projeto: s?.projeto ?? itemDe.get(chip.sessao)?.projeto ?? '',
        cwd: s?.cwd ?? '',
        desde: chip.desde,
        rotulo: c?.rotulo ?? '',
        precisa: c?.cartao?.precisa ?? s?.precisa ?? '',
        pediste: c?.cartao?.pediste ?? '',
        fez: c?.cartao?.fez ?? '',
        importancia,
        tipo: c?.tipo ?? '',
        esforco: c?.esforco ?? '',
        desbloqueia: c?.desbloqueia ?? false,
        silenciado: chip.silenciado === true,
        urgente: importancia >= 4 && chip.silenciado !== true,
      }
    })

  // Dispensar um "a trabalhar" (para quando fica preso) vale só para esse turno: um turno novo traz-o de volta.
  const trabalho = (barra?.trabalho ?? [])
    .filter(t => agora - t.desde < TRABALHO_MAX_MS && !arquivado(t.local) && dispensados[t.sessao] !== t.desde && !trabalhoMorto(sessaoDe.get(t.local), t))
    .map(t => {
      const s = sessaoDe.get(t.local)

      return {
        ...t,
        local: t.local ?? '',
        titulo: s?.titulo ?? t.titulo,
        projeto: s?.projeto ?? t.projeto ?? '',
        cwd: s?.cwd ?? '',
        passos: itemDe.get(t.sessao)?.progresso?.passos ?? [],
      }
    })

  const vivas = sessoes.filter(s => !s.arquivado)
  const esperaDe = porChave(espera, 'local')
  const aTrabalhar = new Set(trabalho.map(t => t.local))

  // Recentes: todos os chats abertos, do último a que chegou uma mensagem para o mais antigo.
  const recentes = [...vivas]
    .sort((a, b) => b.mensagemEm - a.mensagemEm)
    .map(s => ({
      local: s.local, titulo: s.titulo, projeto: s.projeto, cwd: s.cwd, criadoEm: s.criadoEm,
      atividadeEm: s.atividadeEm, mensagemEm: s.mensagemEm, resumo: s.resumo,
      precisa: esperaDe.get(s.local)?.precisa || s.precisa,
      espera: esperaDe.has(s.local), trabalho: aTrabalhar.has(s.local),
    }))

  const arvore = montarArvore({ org: organizacao, grupos, atribuicoes, chats: recentes })
  const nomes = caminhos(arvore)
  const existe = new Set(grupos.map(g => g.id))
  const comGrupo = x => {
    const grupo = existe.has(atribuicoes[x.local]) ? atribuicoes[x.local] : SEM_GRUPO

    return { ...x, grupo, caminho: nomes.get(grupo) ?? 'Sem grupo' }
  }

  return {
    geradoEm: agora,
    numeros: {
      espera: espera.length,
      urgentes: espera.filter(e => e.urgente).length,
      esperaMaisAntiga: espera.length ? Math.min(...espera.map(e => e.desde)) : null,
      trabalho: trabalho.length,
      turnosHoje: itens.filter(item => item.desde >= meiaNoite).length,
      ativosHoje: vivas.filter(s => s.atividadeEm >= meiaNoite).length,
      chats: vivas.length,
    },
    espera: espera.map(comGrupo),
    trabalho: trabalho.map(comGrupo),
    recentes: recentes.map(comGrupo),
    arvore,
    organizacao: {
      erroGrupos: erroGrupos ?? null,
      pastas: organizacao.pastas.map(p => ({ id: p.id, nome: p.nome, pai: p.pai, caminho: nomes.get(p.id) ?? p.nome })),
      grupos: grupos.map(g => ({
        id: g.id, nome: organizacao.nomes?.[g.id] ?? g.nome, nomeClaude: g.nome, pasta: organizacao.grupos[g.id] ?? null,
        escondido: (organizacao.ocultos ?? []).includes(g.id), caminho: nomes.get(g.id) ?? g.nome,
      })),
    },
  }
}
