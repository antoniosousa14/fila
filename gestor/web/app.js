// Gestor de chats: busca /api/estado a cada 3 s e desenha o painel do protótipo v2.
// Sem framework; todo o texto que vem dos chats passa por esc().
const INTERVALO = 3000
const MAX_RECENTES_FECHADO = 12
const MIME_NO = 'application/x-fila-no'

const $ = id => document.getElementById(id)
const app = $('app')

let estado = null
let selecionado = null // local (ou sessao) do chat na ficha
let vista = { tipo: 'painel' } // ou { tipo: 'seccao', id } (um grupo do Claude ou uma pasta do gestor), ou { tipo: 'consumo' }
let recentesTodos = false
let primeiraVez = true
const abertas = new Set() // secções que a pessoa abriu
const fechadas = new Set() // secções com espera que a pessoa fechou à mão
let edicao = null // { tipo: 'renomear', id } ou { tipo: 'criar', pai }
let menu = null // id do grupo ou da pasta com o menu aberto
let arrastar = null // { tipo: 'grupo' | 'pasta', id }
let verEscondidos = false // lista dos grupos escondidos do gestor aberta
let chatDe = new Map()
let projetos = null // { geradoEm, projetos[] } de /api/projetos: ponto de situação por grupo
let projetosPedidoEm = 0
let detalheChat = new Map() // local → o que se sabe de onde o chat ficou (de projetos)
let diasConsumo = 7 // 7 ou 30 dias nas barras do consumo
const desenhado = new Map() // último HTML de cada contentor, para não mexer no DOM sem razão

const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const dois = n => String(n).padStart(2, '0')
const chave = x => x.local || x.sessao

const DIAS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB']
const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ']
const DIAS_LONGOS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const ESFORCO_CURTO = { segundos: '5s', minutos: '2m', longo: 'longo' }
const TIPO = { aprovacao: 'aprovação', decisao: 'decisão', revisao: 'revisão', info: 'informação' }

function idade(ms) {
  const m = Math.max(0, Math.floor(ms / 60_000))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h${dois(m % 60)}`

  return `${Math.floor(h / 24)}d`
}

function relogio(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))

  return `${dois(Math.floor(s / 3600))}:${dois(Math.floor(s / 60) % 60)}:${dois(s % 60)}`
}

const hora = t => { const d = new Date(t); return `${dois(d.getHours())}:${dois(d.getMinutes())}` }
const quando = t => {
  const d = new Date(t)

  return d.toDateString() === new Date().toDateString() ? hora(t) : `${dois(d.getDate())} ${MESES[d.getMonth()]} ${hora(t)}`
}
const pasta = cwd => (cwd ?? '').replace(/^[A-Za-z]:\\Users\\[^\\]+/, '~')
// As duas últimas pastas do caminho, para caber numa linha ("…\loja_aurora\cliente-01").
const pastaCurta = cwd => {
  const partes = pasta(cwd).split('\\').filter(Boolean)

  return partes.length > 2 ? `…\\${partes.slice(-2).join('\\')}` : pasta(cwd)
}
// O pedido vem cru do mod e pode trazer avisos do sistema; fica só o texto.
const limparPedido = t => (t ?? '').replace(/<(system-reminder|task-notification)>[\s\S]*?(<\/\1>|$)/g, ' ').replace(/<[^>]*>?/g, ' ').replace(/\s+/g, ' ').trim()
const onde = x => x.caminho || x.projeto || 'sem pasta'

function tracosImp(n, sinal) {
  const cor = sinal ? ' style="background:var(--sinal)"' : ''

  return `<span class="imp">${[0, 1, 2, 3, 4].map(i => (i < n ? `<i class="c"${cor}></i>` : '<i></i>')).join('')}</span>`
}

function segmentos(feitos, total, max = 10) {
  const n = Math.min(total, max)
  const cheios = Math.round((feitos / total) * n)

  return Array.from({ length: n }, (_, i) => (i < cheios ? '<i class="c"></i>' : i === cheios && feitos < total ? '<i class="a"></i>' : '<i></i>')).join('')
}

function por(id, html) {
  if (desenhado.get(id) === html) return
  desenhado.set(id, html)
  $(id).innerHTML = html
}

// Os chats não se arrastam aqui: mudam de grupo na barra lateral do Claude.
const arrastavel = () => ''

// ——— partes do painel ———

function htmlFaixa(e) {
  const n = e.numeros
  const fig = (rot, num, nota, sinal) =>
    `<div class="fig"><span class="rot">${rot}</span><div class="num${sinal ? ' sinal' : ''}">${dois(num)}</div><small>${nota}</small></div>`
  const notaEspera = n.espera
    ? `${n.urgentes ? `${n.urgentes} urgente${n.urgentes > 1 ? 's' : ''}` : 'nada urgente'} · mais antigo ${idade(e.geradoEm - n.esperaMaisAntiga)}`
    : 'nada à tua espera'
  const t = e.trabalho[0]
  const notaTrabalho = !t ? 'nenhum chat a trabalhar' : t.total ? `${esc(t.titulo)} no passo ${esc(Math.min(t.feitos + 1, t.total))}/${esc(t.total)}` : esc(t.titulo)

  const semana = e.consumo?.semana
  const quarta = semana
    ? `<div class="fig"><span class="rot">Semana usada</span><div class="num${semana.antesDoReset ? ' sinal' : ''}">${Math.round(semana.percent)}<span style="font-size:.5em;color:var(--dim)">%</span></div><small>reset ${diaHora(semana.resetsAt)}</small></div>`
    : fig('Ativos hoje', n.ativosHoje, `de ${n.chats} chats abertos`)

  return fig('À tua espera', n.espera, notaEspera, n.espera > 0)
    + fig('A trabalhar', n.trabalho, notaTrabalho)
    + fig('Turnos hoje', n.turnosHoje, semana ? `${n.ativosHoje} de ${n.chats} chats ativos hoje` : 'chats com turno registado hoje')
    + quarta
}

function htmlEspera(e) {
  if (!e.espera.length) return '<div class="vazio">Nada à tua espera.</div>'

  return e.espera.map((x, i) => `
    <div class="lin${x.urgente ? ' urg' : ''}${chave(x) === selecionado ? ' sel' : ''}" style="--i:${i}" role="button" tabindex="0" data-sel="${esc(chave(x))}"${arrastavel(x.local)}>
      <span class="pos">${dois(x.numero)}</span>
      <div><div class="t">${esc(x.titulo)}</div><div class="s">${esc([onde(x), x.rotulo].filter(Boolean).join(' · '))}</div></div>
      <div class="pr" title="${esc(x.precisa)}">${esc(x.precisa || '—')}</div>
      ${tracosImp(x.importancia)}
      <span class="q">${[ESFORCO_CURTO[x.esforco], idade(e.geradoEm - x.desde)].filter(Boolean).join(' · ')}</span>
    </div>`).join('')
}

function htmlTrabalho(e) {
  if (!e.trabalho.length) return '<div class="vazio">Nenhum chat a trabalhar.</div>'

  return e.trabalho.map((t, i) => {
    const pedido = limparPedido(t.pedido)
    const acao = [t.ultima, `${Number(t.ferramentas) || 0} ferramenta${t.ferramentas === 1 ? '' : 's'}`].filter(Boolean).join(' · ')

    return `
    <div class="trab${chave(t) === selecionado ? ' sel' : ''}" style="--i:${i}" role="button" tabindex="0" data-sel="${esc(chave(t))}"${arrastavel(t.local)}>
      <div class="l1"><b style="font-weight:500">${esc(t.titulo)}</b><span class="s" style="color:var(--faint);font-size:12px">${esc(onde(t))}</span><span class="q">${idade(e.geradoEm - t.desde)}</span></div>
      ${pedido ? `<div class="ped" title="${esc(pedido)}">${esc(pedido)}</div>` : ''}
      ${t.total ? `<div class="seg">${segmentos(t.feitos, t.total)}<span>${esc(t.feitos)}/${esc(t.total)}${t.atual ? ` · ${esc(t.atual)}` : ''}</span></div>` : ''}
      <div class="acao">${esc(acao)}</div>
    </div>`
  }).join('')
}

// ——— controlos: filtrar, ordenar e procurar ———
// Os mesmos para os projetos (ao abrir uma pasta) e para os Recentes. O filtro e a ordem ficam
// guardados no navegador; a pesquisa não. Os números nos filtros contam o que cada um mostra.

const CTRL_CHAVE = 'fila.controlos'

const FILTROS = {
  proj: [
    { id: 'todos', rot: 'Todos', quando: () => true },
    { id: 'tua-vez', rot: 'À tua vez', sinal: true, quando: p => p.tuaVez > 0 },
    { id: 'esquecidos', rot: 'Esquecidos', sinal: true, quando: p => p.esquecido },
    { id: 'hoje', rot: 'Ativos hoje', quando: p => p.ritmo === 'hoje' },
    { id: 'arrefecer', rot: 'A arrefecer', quando: p => p.ritmo === 'arrefecer' },
    { id: 'parados', rot: 'Parados', quando: p => p.ritmo === 'parado' },
    { id: 'sem-importancia', rot: 'Sem importância', quando: p => p.semImportancia },
  ],
  rec: [
    { id: 'todos', rot: 'Todos', quando: () => true },
    { id: 'espera', rot: 'À espera', sinal: true, quando: r => r.espera },
    { id: 'trabalho', rot: 'A trabalhar', quando: r => r.trabalho },
    { id: 'parados', rot: 'Parados', quando: r => !r.espera && !r.trabalho },
  ],
}

const ORDENS = {
  // `cmp: null` deixa a ordem que vem do servidor (a «atenção», nos projetos; a última mensagem, nos recentes).
  proj: [
    { id: 'atencao', rot: 'Pede mais atenção', cmp: null },
    { id: 'recente', rot: 'Mexidos há menos tempo', cmp: (a, b) => b.ultimaEm - a.ultimaEm },
    { id: 'parado', rot: 'Parados há mais tempo', cmp: (a, b) => a.ultimaEm - b.ultimaEm },
    { id: 'porfazer', rot: 'Mais coisas por fazer', cmp: (a, b) => (b.porFazer.length + b.maisPorFazer) - (a.porFazer.length + a.maisPorFazer) || b.atencao - a.atencao },
    { id: 'prioridade', rot: 'Prioridade mais alta', cmp: (a, b) => (b.porFazer[0]?.prioridade ?? 0) - (a.porFazer[0]?.prioridade ?? 0) || (b.porFazer[0]?.pontos ?? 0) - (a.porFazer[0]?.pontos ?? 0) },
    { id: 'nome', rot: 'Nome (A–Z)', cmp: (a, b) => a.nome.localeCompare(b.nome, 'pt') },
  ],
  rec: [
    { id: 'recente', rot: 'Última mensagem', cmp: null },
    { id: 'antigo', rot: 'Mais antigos primeiro', cmp: (a, b) => a.mensagemEm - b.mensagemEm },
    { id: 'nome', rot: 'Nome (A–Z)', cmp: (a, b) => a.titulo.localeCompare(b.titulo, 'pt') },
    { id: 'grupo', rot: 'Grupo (A–Z)', cmp: (a, b) => (a.caminho ?? '').localeCompare(b.caminho ?? '', 'pt') || b.mensagemEm - a.mensagemEm },
  ],
}

const CTRL_PADRAO = { proj: { filtro: 'todos', ordem: 'atencao' }, rec: { filtro: 'todos', ordem: 'recente' } }

function carregarControlos() {
  let guardado = {}
  try { guardado = JSON.parse(localStorage.getItem(CTRL_CHAVE) ?? '{}') } catch {}
  const valido = (ns, campo, lista) => (lista.some(x => x.id === guardado?.[ns]?.[campo]) ? guardado[ns][campo] : CTRL_PADRAO[ns][campo])

  return Object.fromEntries(['proj', 'rec'].map(ns => [ns, {
    filtro: valido(ns, 'filtro', FILTROS[ns]), ordem: valido(ns, 'ordem', ORDENS[ns]), busca: '',
  }]))
}

const ctrl = carregarControlos()
let escreverNaBusca = false // o redesenho pedido por quem escreve na pesquisa (o resto não mexe no campo em foco)

function guardarControlos() {
  try { localStorage.setItem(CTRL_CHAVE, JSON.stringify(Object.fromEntries(Object.entries(ctrl).map(([ns, c]) => [ns, { filtro: c.filtro, ordem: c.ordem }])))) } catch {}
}

// A barra de controlos: os filtros (com quantos mostra cada um), a ordem e a pesquisa. `lista` é o
// que se filtra, sem a pesquisa.
function htmlControlos(ns, lista) {
  const c = ctrl[ns]
  const filtros = FILTROS[ns].map(f => {
    const n = lista.filter(f.quando).length
    if (!n && f.id !== 'todos' && f.id !== c.filtro) return ''

    return `<button class="filtro${f.id === c.filtro ? ' on' : ''}${f.sinal ? ' sinal' : ''}" type="button" data-acao="filtro" data-ns="${ns}" data-filtro="${f.id}" aria-pressed="${f.id === c.filtro}">${f.rot}<b>${dois(n)}</b></button>`
  }).join('')
  const ordens = ORDENS[ns].map(o => `<option value="${o.id}"${o.id === c.ordem ? ' selected' : ''}>${o.rot}</option>`).join('')

  return `<div class="ctrl" data-ctrl="${ns}">
    <div class="filtros" role="group" aria-label="Filtrar">${filtros}</div>
    <div class="ctrl-dir">
      <label class="ctrl-o"><span class="rot">Ordenar</span><select data-ordem-ns="${ns}" aria-label="Ordenar">${ordens}</select></label>
      <input class="ctrl-busca" type="search" data-busca-ns="${ns}" placeholder="Procurar…" value="${esc(c.busca)}" aria-label="Procurar" autocomplete="off">
    </div>
  </div>`
}

// O que sobra depois de filtrar, procurar e ordenar. `textoDe` diz onde se procura em cada um.
function aplicarControlos(ns, lista, textoDe) {
  const c = ctrl[ns]
  const filtro = FILTROS[ns].find(f => f.id === c.filtro) ?? FILTROS[ns][0]
  const ordem = ORDENS[ns].find(o => o.id === c.ordem) ?? ORDENS[ns][0]
  const termo = semAcentos(c.busca.trim())
  let r = lista.filter(filtro.quando)
  if (termo) r = r.filter(x => semAcentos(textoDe(x)).includes(termo))

  return ordem.cmp ? [...r].sort(ordem.cmp) : r
}

const controlosAtivos = ns => ctrl[ns].filtro !== CTRL_PADRAO[ns].filtro || ctrl[ns].busca.trim() !== ''

// Redesenha e, se foi a escrever na pesquisa, devolve-lhe o foco e o cursor.
function redesenharControlos(ns, cursor) {
  escreverNaBusca = true
  desenhado.delete('vista-seccao')
  desenhado.delete('recentes-ctrl')
  if (estado) desenhar()
  escreverNaBusca = false
  const campo = cursor === undefined ? null : document.querySelector(`[data-busca-ns="${ns}"]`)
  if (campo) {
    campo.focus()
    campo.setSelectionRange(cursor, cursor)
  }
}

// ——— projetos: ponto de situação e onde ficaste, por grupo do Claude ———
// Não expira como a fila: um projeto parado há semanas continua aqui, com o que estava a fazer.
// Vem de /api/projetos (resumos da app e fim das transcrições), de 15 em 15 s.

const MAX_FALTA_CARTAO = 4
const MAX_FEITO_CARTAO = 3

async function atualizarProjetos(forcar = false) {
  if (!forcar && projetos && Date.now() - projetosPedidoEm < 15_000) return
  projetosPedidoEm = Date.now()
  try {
    const r = await fetch('/api/projetos', { cache: 'no-store' })
    if (r.ok) {
      projetos = await r.json()
      detalheChat = new Map(projetos.projetos.flatMap(p => [p.principal, ...p.outros]).map(c => [c.local, c]))
    }
  } catch {}
  if (estado) desenhar()
}

function glifoEstado(c) {
  return c.estado === 'espera' ? '<span class="sinal-pt"></span>' : c.estado === 'trabalho' ? '◌' : c.aMeio ? '◐' : ''
}

// O ritmo do projeto: quando mexeste nele pela última vez. «Esquecido» é parado há 7 dias ou mais
// e com coisas por fazer.
function chipRitmo(p) {
  if (p.dispensado) return '<span class="pj-chip" title="Dispensado até haver uma mensagem nova num chat do projeto">dispensado</span>'
  if (p.semImportancia) return '<span class="pj-chip" title="Marcado sem importância: sem alertas de esquecido">sem importância</span>'
  if (p.esquecido) return `<span class="pj-chip sinal" title="Sem mexer há ${p.diasParado} dias e com coisas por fazer">esquecido · ${p.diasParado}d</span>`
  if (p.ritmo === 'hoje') return '<span class="pj-chip ok" title="Mexeste nas últimas 24 horas">ativo hoje</span>'
  if (p.ritmo === 'ativo') return `<span class="pj-chip" title="Última mensagem há ${p.diasParado} dia${p.diasParado === 1 ? '' : 's'}">há ${p.diasParado}d</span>`
  if (p.ritmo === 'arrefecer') return `<span class="pj-chip aviso" title="Sem mexer há ${p.diasParado} dias">a arrefecer · ${p.diasParado}d</span>`

  return `<span class="pj-chip" title="Sem mexer há ${p.diasParado} dias">parado · ${p.diasParado}d</span>`
}

// As mensagens que escreveste neste projeto em cada um dos últimos 14 dias (o último é hoje).
function htmlRitmo(p) {
  const maximo = Math.max(1, ...p.atividade)
  const barras = p.atividade.map((n, i) => {
    const altura = n ? Math.max(3, Math.round((n / maximo) * 14)) : 2
    const dias = p.atividade.length - 1 - i

    return `<i${n ? ' class="c"' : ''} style="height:${altura}px" title="${dias === 0 ? 'hoje' : dias === 1 ? 'ontem' : `há ${dias} dias`}: ${n} mensage${n === 1 ? 'm' : 'ns'}"></i>`
  }).join('')

  return `<span class="pj-ritmo" role="img" aria-label="Mensagens tuas por dia nos últimos 14 dias">${barras}</span>`
}

// O quadrado do projeto: só texto, sem chats. O que ficou feito e o que falta (por prioridade agora,
// a tua vez à frente); o × dispensa-o até haver novidades (como na fila) e carregar no quadrado
// mostra tudo (dialogoProjeto).
function htmlProjeto(e, p) {
  const feito = p.feito.slice(0, MAX_FEITO_CARTAO)
  const falta = p.porFazer.slice(0, MAX_FALTA_CARTAO)
  const maisFalta = p.porFazer.length + p.maisPorFazer - falta.length
  const lista = (itens, vazio) => (itens.length ? `<ul>${itens.join('')}</ul>` : `<p class="pj-nada">${vazio}</p>`)

  return `
    <article class="pj${p.tuaVez ? ' esp' : ''}${p.esquecido ? ' esq' : ''}${p.semImportancia || p.dispensado ? ' sem' : ''}" role="button" tabindex="0" data-acao="projeto" data-id="${esc(p.id)}" title="Ver mais sobre ${esc(p.nome)}">
      <div class="pj-cab"><span class="rot">${esc(p.caminho)}</span>${chipRitmo(p)}${p.dispensado ? '' : `<button class="pj-x" type="button" data-acao="projeto-dispensar" data-id="${esc(p.id)}" data-desde="${p.ultimaEm}" title="Dispensar até haver novidades" aria-label="Dispensar ${esc(p.nome)} até haver novidades">×</button>`}</div>
      <h3 class="pj-nome">${esc(p.nome)}</h3>
      <div class="pj-sec feito"><div class="rot">Feito</div>${lista(feito.map(f => `<li>${esc(f.texto)}</li>`), 'Nada registado ainda.')}</div>
      <div class="pj-sec"><div class="rot">Falta</div>${lista(falta.map(i => `<li${i.tuaVez ? ' class="tua"' : ''}>${esc(i.texto)}</li>`), 'Nada por fazer registado.')}${maisFalta > 0 ? `<p class="pj-resto">e mais ${maisFalta}</p>` : ''}</div>
    </article>`
}

// Tudo sobre o projeto: o que falta por prioridade (com a origem), o que ficou feito, o ritmo e os
// chats do grupo; e o que se pode fazer com ele (dispensar, sem importância, esconder linhas). Só
// aparece ao carregar no quadrado do projeto.
function dialogoProjeto(id) {
  const p = projetos?.projetos.find(x => x.id === id)
  if (!p || !estado) return
  const chats = [p.principal, ...p.outros]
  const esconder = texto => `<button class="x" type="button" data-acao="projeto-linha" data-id="${esc(p.id)}" data-texto="${esc(texto)}" title="Esconder esta linha (já não vale)" aria-label="Esconder esta linha">×</button>`
  const falta = p.porFazer.map(i => `
      <div class="pjd-l${i.tuaVez ? ' tua' : ''}${i.emCurso ? ' curso' : ''}">
        ${tracosImp(i.prioridade, i.prioridade >= 4)}
        <span class="t">${esc(i.texto)}</span>
        <span class="m">${i.tuaVez ? 'tua vez' : i.emCurso ? 'em curso' : ''}</span>
        <button class="c" type="button" data-acao="projeto-chat" data-local="${esc(i.chat.local)}" title="Ver o chat">${esc(i.chat.titulo)}</button>
        ${esconder(i.texto)}
      </div>`).join('')
  const feito = p.feito.map(f => `
      <div class="pjd-l feito">
        <span class="g">✓</span>
        <span class="t">${esc(f.texto)}</span>
        <span class="m" title="${esc(quando(f.em))}">há ${idade(estado.geradoEm - f.em)}</span>
        <button class="c" type="button" data-acao="projeto-chat" data-local="${esc(f.chat.local)}" title="Ver o chat">${esc(f.chat.titulo)}</button>
        ${esconder(f.texto)}
      </div>`).join('')
  const linhasChats = chats.map(o => {
    const est = o.aMeio && o.plano ? `${o.plano.feitos}/${o.plano.total} · ${o.plano.atual}` : o.precisa || o.respondeu

    return `<button class="pjd-c" type="button" data-acao="projeto-chat" data-local="${esc(o.local)}"><span class="glifo">${glifoEstado(o)}</span><span class="nome">${esc(o.titulo)}</span><span class="est${o.estado === 'espera' ? ' sinal' : ''}">${esc(est)}</span><span class="n">${idade(estado.geradoEm - o.mensagemEm)}</span></button>`
  }).join('')
  const dispensar = p.dispensado
    ? `<button class="btn" type="button" data-acao="projeto-repor" data-id="${esc(p.id)}" title="Voltar a mostrar o projeto">Repor</button>`
    : `<button class="btn" type="button" data-acao="projeto-dispensar" data-id="${esc(p.id)}" data-desde="${p.ultimaEm}" title="Esconder até haver uma mensagem nova num chat do projeto">Dispensar</button>`
  $('dialogo').classList.add('largo')
  abrirDialogo(`
    <div class="pjd-cab"><span class="rot">${esc(p.caminho)}</span>${chipRitmo(p)}${htmlRitmo(p)}</div>
    <h2 id="dialogo-titulo">${esc(p.nome)}</h2>
    <div class="pjd-sec"><div class="rot">Falta <span class="nota">por prioridade agora · a tua vez à frente</span></div>${falta || '<p class="pj-nada">Nada por fazer registado.</p>'}</div>
    <div class="pjd-sec"><div class="rot">Feito recentemente</div>${feito || '<p class="pj-nada">Nada registado ainda.</p>'}</div>
    <div class="pjd-sec"><div class="rot">Chats do grupo · ${p.total}</div>${linhasChats}${p.maisChats ? `<p class="pj-resto">e mais ${p.maisChats} no grupo</p>` : ''}</div>
    ${p.linhasEscondidas ? `<p class="nota-d">${p.linhasEscondidas} linha${p.linhasEscondidas === 1 ? '' : 's'} escondida${p.linhasEscondidas === 1 ? '' : 's'}. <button class="ligacao" type="button" data-acao="projeto-repor-linhas" data-id="${esc(p.id)}">Repor</button></p>` : ''}
    <div class="pjd-acoes">
      ${dispensar}
      <button class="btn${p.semImportancia ? ' on' : ''}" type="button" data-acao="projeto-importancia" data-id="${esc(p.id)}" data-sem="${p.semImportancia ? '1' : ''}" title="${p.semImportancia ? 'Voltar a avisar quando ficar esquecido' : 'Fica à vista mas em último, sem avisos de esquecido'}">${p.semImportancia ? 'Dar importância' : 'Sem importância'}</button>
    </div>
    <div class="botoes-d"><button class="btn" type="button" data-acao="fechar-dialogo" autofocus>Fechar</button><button class="btn" type="button" data-acao="projeto-grupo" data-id="${esc(p.id)}">Ver o grupo</button><button class="btn cheio" type="button" data-acao="abrir" data-local="${esc(p.principal.local)}" title="${esc(p.principal.titulo)}">Abrir o último chat ↗</button></div>`)
}

// Põe uma marca num projeto (dispensar, sem importância, esconder uma linha…) e volta a desenhar.
// Dispensar fecha o detalhe; as outras voltam a abri-lo já com a marca.
async function marcarProjeto(corpo, { fechar = false } = {}) {
  try {
    await pedir('/api/projeto', corpo)
  } catch (erro) {
    avisar(`Não deu: ${erro.message}`)
  }
  await atualizarProjetos(true)
  if (fechar) fecharDialogo()
  else if (dialogoAberto()) dialogoProjeto(corpo.grupo)
}

// Os grupos de uma pasta, por subpasta (a ordem da árvore). Cada secção traz os grupos que estão
// diretamente nessa pasta; só tem título quando há mais de uma.
function secoesDeGrupos(pasta) {
  const secoes = []
  const andar = (no, trilho) => {
    const grupos = no.filhas.filter(f => f.tipo === 'grupo').map(g => g.id)
    if (grupos.length) secoes.push({ titulo: trilho.join(' / '), grupos })
    for (const f of no.filhas.filter(f => f.tipo === 'pasta')) andar(f, [...trilho, f.nome])
  }
  andar(pasta, [pasta.nome])

  return secoes
}

// Onde se procura num projeto: o nome, o caminho e o texto do que falta e do que ficou feito.
const textoDoProjeto = p => [p.nome, p.caminho, ...p.porFazer.map(i => i.texto), ...p.feito.map(f => f.texto)].join(' ')

// Os quadrados dos projetos de uma pasta principal, organizados pelas subpastas da árvore à esquerda,
// com os controlos para filtrar, ordenar e procurar. Só aparecem aqui, ao abrir a pasta: o Painel
// não os mostra.
function projetosDaPasta(e, pasta) {
  if (!projetos) return '<section class="sec"><div class="vazio">A reunir o ponto de situação de cada projeto…</div></section>'
  const porId = new Map(projetos.projetos.map(p => [p.id, p]))
  const secoes = secoesDeGrupos(pasta)
    .map(s => ({ ...s, projetos: s.grupos.map(id => porId.get(id)).filter(Boolean) }))
    .filter(s => s.projetos.length)
  const todos = secoes.flatMap(s => s.projetos)
  if (!todos.length) return ''
  const escondidos = todos.filter(p => p.dispensado)
  const visiveis = todos.filter(p => !p.dispensado)
  const ordenados = aplicarControlos('proj', visiveis, textoDoProjeto)
  const blocos = secoes.map(s => {
    const lista = ordenados.filter(p => s.grupos.includes(p.id))
    if (!lista.length) return ''

    return `<div class="pj-pasta">${secoes.length > 1 ? `<div class="rot pj-pasta-t">${esc(s.titulo)}</div>` : ''}<div class="projetos">${lista.map(p => htmlProjeto(e, p)).join('')}</div></div>`
  }).join('')
  const vazio = ordenados.length ? '' : `<div class="vazio">Nenhum projeto com este filtro. ${controlosAtivos('proj') ? '<button class="ligacao" type="button" data-acao="limpar-filtros" data-ns="proj">Limpar</button>' : ''}</div>`
  const dispensados = escondidos.length
    ? `<div class="pj-dispensados"><div class="rot">Dispensados · ${escondidos.length} <span class="nota">voltam sozinhos quando houver uma mensagem nova</span></div>${escondidos.map(p => `<div class="pj-d"><span class="nome">${esc(p.nome)}</span><span class="n">${esc(p.caminho)}</span><button class="mais rot" type="button" data-acao="projeto-repor" data-id="${esc(p.id)}">repor</button></div>`).join('')}</div>`
    : ''

  return `<section class="sec"><div class="sec-cab"><h2>Projetos</h2><span class="rot nota">carrega num para ver mais</span></div>${htmlControlos('proj', visiveis)}${vazio}${blocos}${dispensados}</section>`
}

// ——— consumo: limites da conta (sessão de 5 h e semana) que o mod regista em cada turno ———

const diaHora = t => { const d = new Date(t); return `${DIAS[d.getDay()].toLowerCase()} ${hora(t)}` }
const diaHoraLongo = t => { const d = new Date(t); return `${DIAS_LONGOS[d.getDay()]} às ${hora(t)}` }
const pct = p => `${Math.round(p)}%`
const decimal = (n, casas = 1) => n.toLocaleString('pt-PT', { maximumFractionDigits: casas })

function duracao(ms) {
  const h = ms / 3_600_000
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`
  if (h < 24) return `${Math.round(h)} h`
  const d = Math.round(h / 12) / 2

  return d === 1 ? 'um dia' : d === 1.5 ? 'um dia e meio' : `${decimal(d)} dias`
}

function tokens(n) {
  if (n >= 1e6) return `${decimal(n / 1e6)} M`
  if (n >= 1e3) return `${Math.round(n / 1e3)} mil`

  return String(n)
}

function tracos(p, sinal) {
  const cheios = Math.round(Math.min(100, Math.max(0, p)) / 5)

  return `<div class="tracos" aria-hidden="true">${Array.from({ length: 20 }, (_, i) => (i < cheios ? `<i class="${sinal ? 's' : 'c'}"></i>` : '<i></i>')).join('')}</div>`
}

function htmlMedidor(e) {
  const { sessao, semana } = e.consumo ?? {}
  const med = (rot, valor, sinal, nota, p) =>
    `<div class="med"><div class="topo"><span class="rot">${rot}</span><span class="v"${sinal ? ' style="color:var(--sinal)"' : ''}>${valor}</span></div>${tracos(p, sinal)}<small>${nota}</small></div>`
  const notaSemana = !semana ? 'sem leitura ainda'
    : semana.antesDoReset ? `ao ritmo atual acaba ${diaHora(semana.chegaEm)}`
      : `reset ${diaHora(semana.resetsAt)}`

  return med('Sessão 5h', sessao ? pct(sessao.percent) : '—', false, sessao ? `reset ${hora(sessao.resetsAt)}` : 'sem leitura ainda', sessao?.percent ?? 0)
    + med('Semana', semana ? pct(semana.percent) : '—', Boolean(semana?.antesDoReset), notaSemana, semana?.percent ?? 0)
}

// Curva da semana como no protótipo: ritmo ideal (diagonal), real (leituras) e projeção.
function svgCurva(e, s) {
  const L = 320
  const x = t => Math.max(0, Math.min(L, ((t - s.inicio) / (s.resetsAt - s.inicio)) * L))
  const y = p => 112 - Math.max(0, Math.min(100, p))
  const f = n => Math.round(n * 10) / 10
  const real = [[s.inicio, 0], ...s.pontos].map(([t, p]) => `${f(x(t))},${f(y(p))}`).join(' ')
  const agora = e.geradoEm
  const xa = f(x(agora))
  let projecao = ''
  if (s.ritmoH > 0) {
    if (s.antesDoReset) {
      const xc = f(x(s.chegaEm))
      projecao = `<polyline points="${xa},${f(y(s.percent))} ${xc},12" fill="none" stroke="var(--sinal)" stroke-width="1.8" stroke-dasharray="4 3"/>`
        + `<rect x="${xc - 4}" y="8" width="8" height="8" fill="var(--sinal)" transform="rotate(45 ${xc} 12)"/>`
        + `<text x="${Math.min(Math.max(xc, 30), L - 30)}" y="30" fill="var(--sinal)" font-family="Martian Mono" font-size="8" text-anchor="middle">${esc(diaHora(s.chegaEm).toUpperCase())}</text>`
    } else {
      const noReset = s.percent + s.ritmoH * ((s.resetsAt - agora) / 3_600_000)
      projecao = `<polyline points="${xa},${f(y(s.percent))} ${L},${f(y(noReset))}" fill="none" stroke="var(--dim)" stroke-width="1.5" stroke-dasharray="4 3"/>`
    }
  }
  const ultimo = s.pontos[s.pontos.length - 1] ?? [agora, s.percent]
  const dia = t => DIAS[new Date(t).getDay()]

  return `<svg viewBox="0 0 ${L} 132" role="img" aria-label="Curva de consumo semanal: ${esc(pct(s.percent))} usado, reset ${esc(diaHora(s.resetsAt))}">
    <line x1="0" y1="12" x2="${L}" y2="12" stroke="var(--line2)" stroke-dasharray="2 4"/>
    <line x1="0" y1="112" x2="${L}" y2="112" stroke="var(--line)"/>
    <text x="0" y="8" fill="var(--faint)" font-family="Martian Mono" font-size="8">LIMITE 100%</text>
    <line x1="0" y1="112" x2="${L}" y2="12" stroke="var(--faint)" stroke-width="1" stroke-dasharray="1 3"/>
    <polyline points="${real}" fill="none" stroke="var(--ink)" stroke-width="1.8" stroke-linejoin="round"/>
    ${projecao}
    <line x1="${xa}" y1="20" x2="${xa}" y2="112" stroke="var(--line2)"/>
    <rect x="${f(x(ultimo[0])) - 4}" y="${f(y(ultimo[1])) - 4}" width="8" height="8" fill="var(--bg)" stroke="var(--ink)" stroke-width="1.5"/>
    <text x="${Math.min(Math.max(xa, 16), L - 16)}" y="126" fill="var(--faint)" font-family="Martian Mono" font-size="8" text-anchor="middle">AGORA</text>
    ${xa > 34 ? `<text x="0" y="126" fill="var(--faint)" font-family="Martian Mono" font-size="8">${dia(s.inicio)}</text>` : ''}
    ${xa < L - 34 ? `<text x="${L}" y="126" fill="var(--faint)" font-family="Martian Mono" font-size="8" text-anchor="end">${dia(s.resetsAt)}</text>` : ''}
  </svg>`
}

function avisoConsumo(e, s) {
  if (s.percent >= 100) return { sinal: true, texto: `Chegaste ao limite da semana. Volta a haver margem no reset, <b>${esc(diaHoraLongo(s.resetsAt))}</b>.` }
  if (!(s.ritmoH > 0)) return { sinal: false, texto: 'Sem subida nas últimas 24 h: a este ritmo não chegas ao limite antes do reset.' }
  if (s.antesDoReset) {
    const folga = duracao(s.resetsAt - s.chegaEm)
    const abrandar = s.abrandar ? ` Abrandar ~${s.abrandar}% chega até ${DIAS_LONGOS[new Date(s.resetsAt).getDay()]}.` : ''

    return { sinal: true, texto: `Ao ritmo atual chegas ao limite <b>${esc(diaHoraLongo(s.chegaEm))}</b>, ${folga} antes do reset.${abrandar}` }
  }
  const noReset = Math.min(100, s.percent + s.ritmoH * ((s.resetsAt - e.geradoEm) / 3_600_000))

  return { sinal: false, texto: `Ao ritmo atual chegas ao reset (${esc(diaHoraLongo(s.resetsAt))}) com ~${Math.round(noReset)}% usados.` }
}

function htmlBarras(dias) {
  const lista = dias.slice(-diasConsumo)
  const maximo = Math.max(10, ...lista.map(d => d.pontos))
  const largura = 320 / lista.length
  const barras = lista.map((d, i) => {
    const h = Math.round((d.pontos / maximo) * 52 * 10) / 10
    const data = new Date(`${d.dia}T12:00:00`)
    const titulo = `${DIAS[data.getDay()].toLowerCase()} ${dois(data.getDate())} ${MESES[data.getMonth()].toLowerCase()} · ${decimal(d.pontos)} pp da semana · ${tokens(d.tokens)} tokens · ${d.turnos} turno${d.turnos === 1 ? '' : 's'}`
    const hoje = i === lista.length - 1

    return `<g><title>${esc(titulo)}</title><rect x="${i * largura + largura * 0.18}" y="${60 - Math.max(h, 1)}" width="${largura * 0.64}" height="${Math.max(h, 1)}" fill="${hoje ? 'var(--ink)' : d.pontos ? 'var(--dim)' : 'var(--line2)'}"/>`
      + (diasConsumo <= 7 ? `<text x="${i * largura + largura / 2}" y="74" fill="var(--faint)" font-family="Martian Mono" font-size="8" text-anchor="middle">${DIAS[data.getDay()]}</text>` : '')
      + '</g>'
  }).join('')
  const ativos = lista.filter(d => d.turnos > 0)
  const media = ativos.length ? ativos.reduce((n, d) => n + d.pontos, 0) / ativos.length : 0
  const hoje = lista[lista.length - 1]

  return `
    <div class="por-dia">
      <div class="l1"><span class="rot">Por dia</span><span class="nota-c">hoje ${decimal(hoje?.pontos ?? 0)} pp · média ${decimal(media)} pp/dia · ${tokens(hoje?.tokens ?? 0)} tokens hoje</span>
        <span class="alternar"><button type="button" data-dias="7"${diasConsumo === 7 ? ' class="on"' : ''}>7D</button><button type="button" data-dias="30"${diasConsumo === 30 ? ' class="on"' : ''}>30D</button></span></div>
      <svg viewBox="0 0 320 ${diasConsumo <= 7 ? 78 : 62}" role="img" aria-label="Pontos percentuais da semana gastos por dia, últimos ${diasConsumo} dias">${barras}</svg>
    </div>`
}

function htmlConsumo(e) {
  const c = e.consumo
  const s = c?.semana
  if (!s) {
    return `
    <div class="curva">
      <div class="l1"><span class="grande" style="color:var(--faint)">—</span><span style="color:var(--dim)">sem leituras dos limites</span></div>
      <div class="fase">O mod regista os limites da conta no fim de cada turno de qualquer chat; a curva aparece com a primeira leitura.</div>
      ${c?.dias?.some(d => d.turnos) ? htmlBarras(c.dias) : ''}
    </div>`
  }
  const aviso = avisoConsumo(e, s)

  return `
    <div class="curva">
      <div class="l1"><span class="grande"${s.antesDoReset ? ' style="color:var(--sinal)"' : ''}>${pct(s.percent)}</span><span style="color:var(--dim)">usado${c.sessao ? ` · ${pct(c.sessao.percent)} da sessão de 5h` : ''}</span><span class="lida" title="Última leitura">leitura há ${idade(e.geradoEm - s.lidaEm)}</span></div>
      ${svgCurva(e, s)}
      <div class="leg"><span>ritmo ideal</span><span class="real">real</span><span class="proj">projeção</span></div>
      <div class="aviso" style="margin-top:10px">${aviso.sinal ? '<span class="sinal-pt"></span>' : '<span class="glifo">·</span>'}<div>${aviso.texto}</div></div>
      ${htmlBarras(c.dias)}
    </div>`
}

function htmlLinhaRec(e, r) {
  const glifo = r.espera ? '<span class="sinal-pt"></span>' : r.trabalho ? '◌' : ''
  const estadoTxt = r.trabalho ? 'A trabalhar' : r.resumo
  const precisa = r.trabalho ? '' : r.precisa

  return `
    <div class="rec${r.espera ? ' esp' : ''}${r.local === selecionado ? ' sel' : ''}" role="button" tabindex="0" data-sel="${esc(r.local)}"${arrastavel(r.local)}>
      <span class="glifo">${glifo}</span>
      <div class="c1"><div class="t" title="${esc(r.titulo)}">${esc(r.titulo)}</div><div class="s" title="${esc(pasta(r.cwd))}">${esc(onde(r))}</div></div>
      <div class="c2">${precisa ? `<div class="pr" title="${esc(precisa)}">${esc(precisa)}</div>` : ''}${estadoTxt ? `<div class="s" title="${esc(estadoTxt)}">${esc(estadoTxt)}</div>` : ''}${!precisa && !estadoTxt ? '<div class="s">—</div>' : ''}</div>
      <span class="q" title="${esc(quando(r.mensagemEm))}">${idade(e.geradoEm - r.mensagemEm)}</span>
      <button class="btn q abrir" type="button" data-acao="abrir" data-local="${esc(r.local)}" title="Abrir na app">↗</button>
    </div>`
}

// Onde se procura num chat recente: o título, o grupo, o estado e o que precisa de ti.
const textoDoRecente = r => [r.titulo, r.caminho, r.projeto, r.resumo, r.precisa].join(' ')
const recentesFiltrados = e => aplicarControlos('rec', e.recentes, textoDoRecente)

function htmlRecentes(e) {
  if (!e.recentes.length) return '<div class="vazio">Nenhum chat aberto.</div>'
  const filtrados = recentesFiltrados(e)
  if (!filtrados.length) return `<div class="vazio">Nenhum chat com este filtro. ${controlosAtivos('rec') ? '<button class="ligacao" type="button" data-acao="limpar-filtros" data-ns="rec">Limpar</button>' : ''}</div>`
  const lista = recentesTodos ? filtrados : filtrados.slice(0, MAX_RECENTES_FECHADO)

  return lista.map(r => htmlLinhaRec(e, r)).join('')
}

function rotuloRecentes(e) {
  const filtrados = recentesFiltrados(e).length
  const total = filtrados === e.recentes.length ? dois(filtrados) : `${dois(filtrados)} de ${dois(e.recentes.length)}`
  if (filtrados <= MAX_RECENTES_FECHADO) return total

  return `${total} · ${recentesTodos ? 'mostrar menos' : 'mostrar todos'}`
}

// ——— árvore: os grupos da barra lateral do Claude, com pastas-mãe do gestor ———
// Os grupos, os nomes e os chats de cada grupo vêm do Claude e mudam-se lá; o gestor só junta
// grupos em pastas (criar, renomear, apagar, arrastar um grupo para uma pasta).

const SEM_GRUPO = 'sem-grupo'

function acharNo(nos, id) {
  for (const n of nos) {
    if (n.id === id) return n
    const dentro = acharNo(n.filhas, id)
    if (dentro) return dentro
  }

  return undefined
}

const chatsDaSubarvore = n => [...n.chats, ...n.filhas.flatMap(chatsDaSubarvore)]
const nosEmOrdem = (nos, nivel = 0) => nos.flatMap(n => [{ ...n, nivel }, ...nosEmOrdem(n.filhas, nivel + 1)])

function contagem(n) {
  if (n.espera) return `<span class="n sinal" title="${n.espera} à tua espera">${dois(n.espera)}</span>`

  return `<span class="n" title="${n.total} chat${n.total === 1 ? '' : 's'}">${dois(n.total)}</span>`
}

// Um ponto ao lado do nome de uma pasta ou grupo que tem um projeto esquecido (parado há 7 dias ou
// mais e com coisas por fazer), para não ficar esquecido sem ninguém ver.
function temEsquecido(n) {
  if (!projetos) return false
  if (n.tipo === 'grupo') return projetos.projetos.some(p => p.id === n.id && p.esquecido)

  return n.filhas.some(temEsquecido)
}

const marcaEsquecido = n => (temEsquecido(n) ? '<span class="esq-pt" title="Tem um projeto esquecido" aria-label="projeto esquecido"></span>' : '')

function linhaChat(e, local) {
  const c = chatDe.get(local)
  if (!c) return ''
  const glifo = c.espera ? '<span class="sinal-pt"></span>' : c.trabalho ? '◌' : ''

  return `<button class="it chat${c.local === selecionado ? ' on' : ''}" type="button" data-sel="${esc(c.local)}" title="${esc(c.titulo)}"><span class="glifo">${glifo}</span><span class="nome">${esc(c.titulo)}</span><span class="n">${idade(e.geradoEm - c.mensagemEm)}</span></button>`
}

const htmlCriar = () => '<div class="it criar"><span class="seta"></span><input class="ed" data-ed="criar" placeholder="Nome da pasta" maxlength="60" aria-label="Nome da nova pasta"></div>'

function htmlMenu(n) {
  if (n.tipo === 'pasta') {
    return `<div class="menu" role="menu">
      <button type="button" role="menuitem" data-acao="nova-subpasta" data-id="${esc(n.id)}">Nova pasta dentro</button>
      <button type="button" role="menuitem" data-acao="renomear-pasta" data-id="${esc(n.id)}">Renomear</button>
      <button type="button" role="menuitem" class="perigo" data-acao="apagar-pasta" data-id="${esc(n.id)}">Apagar pasta…</button>
    </div>`
  }

  const outroNome = n.nomeClaude && n.nomeClaude !== n.nome

  return `<div class="menu" role="menu">
    <button type="button" role="menuitem" data-acao="renomear-grupo" data-id="${esc(n.id)}">Renomear no gestor</button>
    ${outroNome ? `<button type="button" role="menuitem" data-acao="nome-claude" data-id="${esc(n.id)}">Voltar a «${esc(n.nomeClaude)}»</button>` : ''}
    <button type="button" role="menuitem" data-acao="por-na-pasta" data-id="${esc(n.id)}">Pôr numa pasta…</button>
    <button type="button" role="menuitem" class="perigo" data-acao="esconder-grupo" data-id="${esc(n.id)}">Esconder do gestor</button>
    <div class="menu-nota">Isto só muda o gestor. No Claude o grupo, o nome e os chats ficam iguais.</div>
  </div>`
}

// Grupos escondidos do gestor, no fundo da árvore, para os voltar a mostrar.
function htmlEscondidos(e) {
  const escondidos = e.organizacao.grupos.filter(g => g.escondido)
  if (!escondidos.length) return ''
  const lista = verEscondidos
    ? escondidos.map(g => `<div class="it esc-g"><span class="nome" title="${esc(g.nome)}">${esc(g.nome)}</span><button class="mostrar" type="button" data-acao="mostrar-grupo" data-id="${esc(g.id)}">Mostrar</button></div>`).join('')
    : ''

  return `<div class="escondidos"><button class="it esc-t" type="button" data-acao="ver-escondidos" aria-expanded="${verEscondidos}"><span class="seta">${verEscondidos ? '▾' : '▸'}</span><span class="nome">Escondidos do gestor</span><span class="n">${dois(escondidos.length)}</span></button>${lista}</div>`
}

function htmlNo(e, n, pai) {
  const real = n.id !== SEM_GRUPO
  const temDentro = n.filhas.length > 0 || n.chats.length > 0
  const aberto = abertas.has(n.id) || (n.espera > 0 && !fechadas.has(n.id)) || (edicao?.tipo === 'criar' && edicao.pai === n.id)
  const aRenomear = edicao?.tipo === 'renomear' && edicao.id === n.id
  const nome = aRenomear
    ? `<input class="ed" data-ed="renomear" value="${esc(n.nome)}" maxlength="60" aria-label="Novo nome de ${esc(n.nome)}">`
    : `<button class="nome" type="button" data-ver="${esc(n.id)}" title="${esc(n.tipo === 'pasta' ? `Pasta do gestor: ${n.nome}` : n.nomeClaude && n.nomeClaude !== n.nome ? `${n.nome} · no Claude: ${n.nomeClaude}` : n.nome)}">${n.tipo === 'pasta' ? '<span class="pasta-g" aria-hidden="true">▤</span>' : ''}${esc(n.nome)}</button>`
  const linha = `<div class="it sec-l${n.tipo === 'pasta' ? ' e-pasta' : ''}${aberto ? '' : ' fechada'}${vista.tipo === 'seccao' && vista.id === n.id ? ' on' : ''}" data-no="${esc(n.id)}" data-tipo="${n.tipo}" data-pai="${esc(pai ?? '')}"${real && !aRenomear ? ' draggable="true"' : ''}>`
    + `<button class="seta" type="button" data-alternar="${esc(n.id)}" aria-expanded="${aberto}" aria-label="${aberto ? 'Fechar' : 'Abrir'} ${esc(n.nome)}"${temDentro ? '' : ' tabindex="-1"'}>${temDentro ? '▾' : ''}</button>`
    + nome + marcaEsquecido(n) + contagem(n)
    + (real ? `<button class="mais-s" type="button" data-menu="${esc(n.id)}" aria-label="Opções de ${esc(n.nome)}" title="Opções">⋯</button>` : '')
    + '</div>'
  const criarAqui = edicao?.tipo === 'criar' && edicao.pai === n.id ? htmlCriar() : ''
  const dentro = aberto ? `<div class="filhos">${criarAqui}${n.filhas.map(f => htmlNo(e, f, n.id)).join('')}${n.chats.map(l => linhaChat(e, l)).join('')}</div>` : ''

  return `<div class="no">${linha}${menu === n.id ? htmlMenu(n) : ''}${dentro}</div>`
}

function htmlArvore(e) {
  const erro = e.organizacao.erroGrupos ? `<div class="aviso-arvore">Não consegui ler os grupos do Claude (${esc(e.organizacao.erroGrupos)}): os chats continuam nos Recentes.</div>` : ''
  const topo = edicao?.tipo === 'criar' && edicao.pai === null ? htmlCriar() : ''

  return erro + e.arvore.map(n => htmlNo(e, n, null)).join('') + topo + htmlEscondidos(e)
}

function desenharArvore(forcar = false) {
  if (!estado || (!forcar && (edicao || arrastar))) return
  if (forcar) desenhado.delete('arvore')
  por('arvore', htmlArvore(estado))
  const ed = $('arvore').querySelector('.ed')
  if (ed && document.activeElement !== ed) {
    ed.focus()
    ed.select()
  }
}

// ——— vista de um grupo ou de uma pasta ———

// O cartão «onde ficaste» do grupo, na vista dele (as pastas do gestor não têm: são só um agrupador).
function pontoDeSituacao(e, n) {
  const p = n.tipo === 'grupo' ? projetos?.projetos.find(x => x.id === n.id) : undefined
  if (!p) return ''

  return `<section class="sec"><div class="sec-cab"><h2>Ponto de situação</h2><span class="rot nota">onde ficaste</span></div><div class="projetos">${htmlProjeto(e, p)}</div></section>`
}

function htmlVistaSeccao(e, n) {
  const chats = chatsDaSubarvore(n).map(l => chatDe.get(l)).filter(Boolean).sort((a, b) => b.mensagemEm - a.mensagemEm)
  const ultima = chats[0]?.mensagemEm
  const fig = (rot, num, nota, sinal) =>
    `<div class="fig"><span class="rot">${rot}</span><div class="num${sinal ? ' sinal' : ''}">${num}</div><small>${nota}</small></div>`
  const ePasta = n.tipo === 'pasta'
  const grupos = nosEmOrdem(n.filhas).filter(f => f.tipo === 'grupo')
  const nota = ePasta
    ? 'Pasta do gestor: junta grupos do Claude. Arrasta grupos para cá na árvore, ou usa «Pôr numa pasta…» no menu de um grupo.'
    : n.id === SEM_GRUPO
      ? 'Chats sem grupo na barra lateral do Claude. Para os arrumar, arrasta-os para um grupo lá.'
      : 'Grupo da barra lateral do Claude: o nome e os chats mudam-se lá e aparecem aqui sozinhos.'
  const filhas = n.filhas.length
    ? n.filhas.map(f => `<button class="ficha-sec" type="button" data-ver="${esc(f.id)}"><span>${f.tipo === 'pasta' ? '▤ ' : ''}${esc(f.nome)}</span>${contagem(f)}</button>`).join('')
    : '<div class="vazio">Ainda sem grupos: arrasta um grupo da árvore para esta pasta.</div>'

  return `
    <div class="faixa">
      ${fig('À tua espera', dois(n.espera), n.espera ? (ePasta ? 'nos grupos desta pasta' : 'neste grupo') : 'nada à tua espera', n.espera > 0)}
      ${fig('Chats', dois(n.total), ePasta ? `em ${grupos.length} grupo${grupos.length === 1 ? '' : 's'}` : 'neste grupo')}
      ${fig(ePasta ? 'Grupos' : 'A trabalhar', dois(ePasta ? grupos.length : chats.filter(c => c.trabalho).length), ePasta ? esc(grupos.map(g => g.nome).slice(0, 3).join(', ') || 'nenhum') : 'chats deste grupo')}
      ${fig('Última mensagem', ultima ? idade(e.geradoEm - ultima) : '—', ultima ? esc(quando(ultima)) : 'sem chats')}
    </div>
    <p class="nota-vista">${nota}</p>
    ${ePasta ? projetosDaPasta(e, n) : pontoDeSituacao(e, n)}
    ${ePasta ? `<section class="sec"><div class="sec-cab"><h2>Dentro desta pasta</h2><button class="mais rot" type="button" data-acao="nova-subpasta" data-id="${esc(n.id)}">+ pasta</button></div><div class="fichas-sec">${filhas}</div></section>` : ''}
    <section class="sec">
      <div class="sec-cab"><h2>Chats</h2><span class="rot nota">pela última mensagem</span></div>
      <div class="cab-rec"><span></span><span class="rot">Chat</span><span class="rot">Estado · precisa de ti</span><span class="rot">Há</span><span></span></div>
      <div class="quadro">${chats.length ? chats.map(r => htmlLinhaRec(e, r)).join('') : '<div class="vazio">Sem chats.</div>'}</div>
    </section>`
}

// ——— ficha ———

function procurar(e, k) {
  const espera = e.espera.find(x => chave(x) === k)
  const trabalho = e.trabalho.find(x => chave(x) === k)
  const chat = e.recentes.find(c => c.local === k)

  return espera || trabalho || chat ? { espera, trabalho, chat } : undefined
}

function htmlFicha(e, f) {
  const { espera, trabalho, chat } = f
  const base = espera ?? trabalho ?? chat
  const agora = e.geradoEm
  const local = base.local || chat?.local || ''
  const cwd = base.cwd || chat?.cwd || ''

  let cab
  if (espera) cab = `<span class="sinal-pt"></span><span class="rot" style="color:var(--sinal)">À tua espera · ${dois(espera.numero)}</span>`
  else if (trabalho) cab = '<span class="glifo">◌</span><span class="rot">A trabalhar</span>'
  else cab = `<span class="glifo">↺</span><span class="rot">Última mensagem há ${idade(agora - (chat?.mensagemEm ?? 0))}</span>`

  const precisa = espera?.precisa || (!trabalho && chat?.precisa) || ''
  const linhas = []
  const linha = (dt, dd, mono) => linhas.push(`<dt>${dt}</dt><dd${mono ? ' class="mono"' : ''}>${dd}</dd>`)
  if (espera) {
    if (espera.pediste) linha('Pediste', esc(espera.pediste))
    if (espera.fez) linha('Fez', esc(espera.fez))
    linha('Imp.', `${tracosImp(espera.importancia, espera.urgente).replace('class="imp"', 'class="imp" style="vertical-align:-1px"')} <span class="mono" style="color:var(--dim)">${esc(espera.importancia)}/5${espera.tipo ? ` · ${TIPO[espera.tipo] ?? esc(espera.tipo)}` : ''}</span>`)
    if (espera.esforco) linha('Esforço', `${esc(espera.esforco)}${espera.desbloqueia ? ' · desbloqueia o chat' : ''}`)
    linha('Espera', relogio(agora - espera.desde), true)
  }
  if (trabalho) {
    const pedido = limparPedido(trabalho.pedido)
    if (pedido) linha('Pediste', esc(pedido))
    if (trabalho.total) linha('Tarefas', `<span class="seg" style="display:inline-flex">${segmentos(trabalho.feitos, trabalho.total)}</span> <span class="mono" style="color:var(--dim)">${esc(trabalho.feitos)}/${esc(trabalho.total)}</span>`)
    linha('Ferram.', `${esc(trabalho.ferramentas)}${trabalho.ultima ? ` · ${esc(trabalho.ultima)}` : ''}`)
    linha('Há', relogio(agora - trabalho.desde), true)
  }
  if (!espera && !trabalho) {
    const det = detalheChat.get(local)
    if (det?.pedi) linha('Pediste', esc(det.pedi))
    const ultimo = det?.respondeu || chat?.resumo
    if (ultimo) linha('Último estado', esc(ultimo))
    if (det?.plano) linha('Tarefas', `<span class="seg" style="display:inline-flex">${segmentos(det.plano.feitos, det.plano.total)}</span> <span class="mono" style="color:var(--dim)">${esc(det.plano.feitos)}/${esc(det.plano.total)}</span>${det.plano.feitos < det.plano.total && det.plano.atual ? ` · ficou em ${esc(det.plano.atual)}` : ''}`)
  }
  const grupo = chat?.grupo ?? base.grupo
  if (grupo) linha('Grupo', `<button class="ligacao" type="button" data-ver="${esc(grupo)}">${esc(chat?.caminho ?? base.caminho)}</button><small class="dica">muda-se na barra lateral do Claude</small>`)
  if (cwd) linha('Pasta', `<span style="color:var(--dim)">${esc(pasta(cwd))}</span>`, true)

  const eventos = []
  if (chat?.criadoEm) eventos.push({ t: chat.criadoEm, texto: 'Chat criado' })
  if (trabalho) eventos.push({ t: trabalho.desde, texto: trabalho.atual ? `A trabalhar · ${esc(trabalho.atual)}` : 'Começou a trabalhar' })
  else if (espera) eventos.push({ t: espera.desde, texto: 'Acabou o turno e ficou à tua espera', sinal: true })
  else if (chat?.mensagemEm) eventos.push({ t: chat.mensagemEm, texto: 'Última mensagem' })
  eventos.sort((a, b) => a.t - b.t)
  const tempo = eventos.map((ev, i) => `<div${i === eventos.length - 1 && !ev.sinal ? ' class="neutro"' : ''}><span class="h">${quando(ev.t)}</span>${ev.texto}</div>`).join('')

  const passos = (trabalho?.passos ?? []).map(p => {
    const [classe, g] = p.estado === 'completed' ? ['c', '✓'] : p.estado === 'in_progress' ? ['a', '▸'] : ['', '·']

    return `<div class="${classe}"><span class="g">${g}</span><span>${esc(p.texto)}</span></div>`
  }).join('')

  return `
    <div class="det-cab">${cab}<span class="esp"></span><button class="btn q" type="button" data-acao="fechar" title="Fechar (Esc)">✕</button></div>
    <div class="det-corpo">
      <div><span class="rot">${esc(onde(chat ?? base))}</span><h3>${esc(base.titulo)}</h3></div>
      ${precisa ? `<div class="precisa">${esc(precisa)}</div>` : ''}
      <div class="acoes">
        <button class="btn cheio" type="button" data-acao="abrir" data-local="${esc(local)}"${local ? '' : ' disabled'}>Abrir na app</button>
        <button class="btn" type="button" data-ver="${esc(grupo ?? '')}"${grupo ? '' : ' disabled'} title="Ver os chats do mesmo grupo">Ver grupo</button>
        <button class="btn" type="button" data-acao="dispensar"${espera ? '' : trabalho ? ' title="Esconde este chat de «a trabalhar» até ao próximo turno (para quando fica preso)"' : ' disabled title="Só os chats à tua espera ou a trabalhar se dispensam"'}>Dispensar</button>
      </div>
      ${linhas.length ? `<dl class="ficha">${linhas.join('')}</dl>` : ''}
      ${passos ? `<div><div class="rot" style="margin-bottom:12px">Tarefas</div><div class="passos">${passos}</div></div>` : ''}
      ${tempo ? `<div><div class="rot" style="margin-bottom:12px">Linha do tempo</div><div class="tempo">${tempo}</div></div>` : ''}
    </div>`
}

// ——— diálogo ———

function abrirDialogo(html) {
  $('dialogo').innerHTML = html
  $('veu').hidden = false
  const foco = $('dialogo').querySelector('[autofocus]') ?? $('dialogo').querySelector('input, button')
  foco?.focus()
}

function fecharDialogo() {
  $('veu').hidden = true
  $('dialogo').innerHTML = ''
  $('dialogo').classList.remove('com-paleta', 'largo')
  paleta = null
}

const dialogoAberto = () => !$('veu').hidden

// Pôr um grupo do Claude numa pasta do gestor (ou tirá-lo de lá).
function dialogoPorNaPasta(grupo) {
  const g = estado?.organizacao.grupos.find(x => x.id === grupo)
  if (!g) return
  const pastas = nosEmOrdem(estado.arvore).filter(n => n.tipo === 'pasta')
  const opcoes = pastas.map(p => `
    <button class="op${p.id === g.pasta ? ' atual' : ''}" type="button" data-mover-para="${esc(p.id)}" data-grupo="${esc(grupo)}" data-filtro="${esc(semAcentos(p.nome))}" style="padding-left:${12 + p.nivel * 18}px">
      <span>▤ ${esc(p.nome)}</span>${p.id === g.pasta ? '<span class="rot">agora</span>' : ''}
    </button>`).join('')
  abrirDialogo(`
    <h2 id="dialogo-titulo">Pôr «${esc(g.nome)}» numa pasta</h2>
    <p class="nota-d">As pastas são do gestor e só servem para juntar grupos. O grupo continua igual no Claude.</p>
    ${pastas.length > 6 ? '<input class="filtro" type="search" placeholder="Filtrar pastas" aria-label="Filtrar pastas" data-filtrar="op" autofocus>' : ''}
    <div class="ops">${opcoes || '<div class="vazio">Ainda não há pastas: cria uma com o + ao lado de «Grupos do Claude».</div>'}
      ${g.pasta ? `<button class="op" type="button" data-mover-para="" data-grupo="${esc(grupo)}" data-filtro="fora"><span>Fora de pastas</span><span class="rot">no topo, pela ordem do Claude</span></button>` : ''}
    </div>
    <div class="botoes-d"><button class="btn" type="button" data-acao="fechar-dialogo">Cancelar</button></div>`)
}

function dialogoApagarPasta(id) {
  const p = estado?.organizacao.pastas.find(x => x.id === id)
  const n = estado && acharNo(estado.arvore, id)
  if (!p || !n) return
  const mae = p.pai ? estado.organizacao.pastas.find(x => x.id === p.pai) : null
  abrirDialogo(`
    <h2 id="dialogo-titulo">Apagar a pasta «${esc(p.nome)}»?</h2>
    <p class="nota-d">${n.filhas.length ? `O que está dentro (${n.filhas.length}) passa para ${mae ? `«${esc(mae.nome)}»` : 'o topo da árvore'}. ` : ''}Os grupos e os chats do Claude não mudam.</p>
    <div class="botoes-d"><button class="btn" type="button" data-acao="fechar-dialogo" autofocus>Cancelar</button><button class="btn perigo" type="button" data-acao="confirmar-apagar-pasta" data-id="${esc(id)}">Apagar pasta</button></div>`)
}

// Para filtrar sem olhar a acentos.
const semAcentos = t => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

// ——— novo chat: abre o ecrã de chat novo da app numa pasta ———

function pastasConhecidas(e) {
  const vistas = new Map()
  for (const c of e.recentes) {
    if (!c.cwd || /\\scratch-\d{4}-\d{2}-\d{2}/i.test(c.cwd) || !/^[a-z]:\\[^\\]+\\/i.test(c.cwd) || vistas.has(c.cwd.toLowerCase())) continue
    vistas.set(c.cwd.toLowerCase(), { pasta: c.cwd, nota: `${c.caminho} · «${c.titulo}»` })
  }

  return [...vistas.values()]
}

// Em dois passos: primeiro o tópico (uma pasta ou um grupo da árvore), depois a pasta do disco,
// entre as dos chats desse tópico (a mais recente primeiro) ou uma nova escrita à mão.
// Com um grupo ou pasta aberto no ecrã, começa logo no segundo passo.
function dialogoNovoChat() {
  if (!estado) return
  if (vista.tipo === 'seccao' && acharNo(estado.arvore, vista.id)) return passoPastaDoChat(vista.id)
  passoTopicoDoChat()
}

function passoTopicoDoChat() {
  const ops = nosEmOrdem(estado.arvore).map(n => `
    <button class="op op-no" type="button" data-nc-no="${esc(n.id)}" data-filtro="${esc(semAcentos(n.nome))}" style="padding-left:${12 + n.nivel * 18}px">
      <span class="${n.tipo === 'pasta' ? 'e-pasta' : ''}">${n.tipo === 'pasta' ? '▤ ' : ''}${esc(n.nome)}</span><span class="rot">${dois(n.total)}</span>
    </button>`).join('')
  abrirDialogo(`
    <h2 id="dialogo-titulo">Novo chat <span class="passo-d">1 de 2 · onde</span></h2>
    <p class="nota-d">Em que tópico vais trabalhar? A seguir escolhes a pasta do projeto.</p>
    <input class="filtro" type="search" placeholder="Procurar tópico" aria-label="Procurar tópico" data-filtrar="op" autofocus>
    <div class="ops">${ops}
      <button class="op" type="button" data-nc-no="" data-filtro="outro sitio qualquer pasta"><span>Outro sítio</span><span class="rot">qualquer pasta</span></button>
    </div>
    <div class="botoes-d"><button class="btn" type="button" data-acao="fechar-dialogo">Cancelar</button></div>`)
}

// As pastas do disco dos chats de um tópico, sem as pastas temporárias dos chats rápidos.
function pastasDoTopico(id) {
  const no = id ? acharNo(estado.arvore, id) : null
  if (!no) return pastasConhecidas(estado).map(p => ({ pasta: p.pasta, nota: p.nota }))
  const porPasta = new Map()
  for (const c of chatsDaSubarvore(no).map(l => chatDe.get(l)).filter(Boolean)) {
    if (!c.cwd || /\\scratch-\d{4}/i.test(c.cwd)) continue
    const chave = c.cwd.toLowerCase()
    const p = porPasta.get(chave) ?? { pasta: c.cwd, chats: 0, ultima: 0 }
    p.chats++
    p.ultima = Math.max(p.ultima, c.mensagemEm)
    porPasta.set(chave, p)
  }

  return [...porPasta.values()].sort((a, b) => b.ultima - a.ultima)
    .map(p => ({ pasta: p.pasta, nota: `${p.chats} chat${p.chats === 1 ? '' : 's'} · ${idade(estado.geradoEm - p.ultima)}` }))
}

function passoPastaDoChat(id) {
  const no = id ? acharNo(estado.arvore, id) : null
  const lista = pastasDoTopico(id)
  const onde = no ? (estado.organizacao.grupos.find(g => g.id === id) ?? estado.organizacao.pastas.find(p => p.id === id))?.caminho ?? no.nome : 'Outro sítio'
  const ops = lista.map((p, i) => `
    <button class="op${i === 0 ? ' atual' : ''}" type="button" data-pasta="${esc(p.pasta)}" title="${esc(p.pasta)}"><span class="mono">${esc(pastaCurta(p.pasta))}</span><span class="rot">${esc(p.nota)}</span></button>`).join('')
  abrirDialogo(`
    <h2 id="dialogo-titulo">Novo chat <span class="passo-d">2 de 2 · pasta</span></h2>
    <p class="nota-d"><button class="ligacao" type="button" data-acao="nc-voltar">← ${esc(onde)}</button></p>
    <div class="ops ops-curtas">${ops || '<div class="vazio">Ainda não há chats com pasta neste tópico: escreve a pasta abaixo.</div>'}</div>
    <input class="filtro mono" id="nc-pasta" type="text" value="${esc(lista[0]?.pasta ?? '')}" placeholder="C:\\Users\\…\\pasta do projeto (ou outra nova)" aria-label="Pasta do chat novo" spellcheck="false">
    <textarea class="texto-d" id="nc-texto" rows="3" maxlength="2000" placeholder="Primeira mensagem (opcional)" aria-label="Primeira mensagem" autofocus></textarea>
    <p class="nota-d">Abre o chat novo na app, com a mensagem já escrita. Nada é enviado: és tu que a envias. Depois põe-no no grupo certo na barra lateral do Claude.</p>
    <div class="botoes-d"><button class="btn" type="button" data-acao="fechar-dialogo">Cancelar</button><button class="btn cheio" type="button" data-acao="criar-chat">Abrir na app</button></div>`)
}

async function criarChat() {
  const pastaEscolhida = $('nc-pasta').value.trim()
  try {
    await pedir('/api/novo-chat', { pasta: pastaEscolhida, texto: $('nc-texto').value.trim() })
    fecharDialogo()
    avisar('A abrir o chat novo na app…')
  } catch (erro) {
    avisar(`Não abriu: ${erro.message}`)
  }
}

// ——— paleta de comandos (Ctrl+K) ———

let paleta = null // { itens, ativo }

function acoesDaPaleta() {
  const e = estado
  const lista = [
    { rotulo: 'Painel', sub: 'ir para o painel', fazer: () => { vista = { tipo: 'painel' }; desenhar(); $('corpo').scrollTo({ top: 0 }) } },
    { rotulo: 'Novo chat', sub: 'N', fazer: dialogoNovoChat },
    { rotulo: 'À tua espera', sub: `${e.numeros.espera} chats`, fazer: () => { vista = { tipo: 'painel' }; desenhar(); $('sec-espera').scrollIntoView({ block: 'start' }) } },
    { rotulo: 'Recentes', sub: `${e.recentes.length} chats`, fazer: () => { vista = { tipo: 'painel' }; recentesTodos = true; desenhar(); $('sec-recentes').scrollIntoView({ block: 'start' }) } },
    { rotulo: 'Consumo', sub: `tokens, custo na API, horas e limites${e.consumo?.semana ? ` · ${pct(e.consumo.semana.percent)} da semana` : ''}`, fazer: abrirConsumo },
    { rotulo: 'Nova pasta', sub: 'para juntar grupos do Claude', fazer: () => comecarEdicao({ tipo: 'criar', pai: null }) },
    { rotulo: 'Mudar o tema', sub: 'escuro ou claro', fazer: () => $('tema').click() },
  ]
  if (e.orquestrador) lista.splice(3, 0, { rotulo: 'Abrir o orquestrador', sub: 'O', fazer: () => agir($('orquestrador')) })

  return lista.map(a => ({ ...a, tipo: 'acao', filtro: semAcentos(`${a.rotulo} ${a.sub}`) }))
}

function itensDaPaleta(termo) {
  const partes = semAcentos(termo).split(/\s+/).filter(Boolean)
  const bate = x => partes.every(p => x.filtro.includes(p))
  const acoes = acoesDaPaleta().filter(bate)
  const caminhos = new Map([...estado.organizacao.grupos, ...estado.organizacao.pastas].map(x => [x.id, x.caminho]))
  const seccoes = nosEmOrdem(estado.arvore).map(n => ({
    tipo: 'seccao', rotulo: n.nome, sub: `${n.tipo === 'pasta' ? 'pasta' : 'grupo'} · ${caminhos.get(n.id) ?? n.nome}`, filtro: semAcentos(caminhos.get(n.id) ?? n.nome), fazer: () => verSeccao(n.id),
  })).filter(bate)
  const chats = estado.recentes.map(c => ({
    tipo: 'chat', rotulo: c.titulo, sub: [onde(c), c.espera ? 'à tua espera' : c.trabalho ? 'a trabalhar' : `há ${idade(estado.geradoEm - c.mensagemEm)}`].join(' · '),
    filtro: semAcentos(`${c.titulo} ${c.caminho} ${c.projeto} ${c.resumo}`), sinal: c.espera, local: c.local,
    fazer: () => { if (vista.tipo !== 'painel' && !chatsDaSubarvore(acharNo(estado.arvore, vista.id) ?? { chats: [], filhas: [] }).includes(c.local)) vista = { tipo: 'painel' }; selecionar(c.local) },
  })).filter(bate)

  return partes.length
    ? [...acoes.slice(0, 4), ...chats.slice(0, 24), ...seccoes.slice(0, 8)]
    : [...acoes, ...chats.slice(0, 8)]
}

function desenharPaleta() {
  const grupos = { acao: 'Ações', chat: 'Chats', seccao: 'Grupos e pastas' }
  let atual = ''
  const html = paleta.itens.map((it, i) => {
    const cab = it.tipo !== atual ? `<div class="pal-gr rot">${grupos[it.tipo]}</div>` : ''
    atual = it.tipo

    return `${cab}<button class="pal-it${i === paleta.ativo ? ' on' : ''}" type="button" role="option" aria-selected="${i === paleta.ativo}" data-pal="${i}">
      ${it.tipo === 'chat' ? (it.sinal ? '<span class="sinal-pt"></span>' : '<span class="glifo">·</span>') : it.tipo === 'seccao' ? '<span class="glifo">▤</span>' : '<span class="glifo">›</span>'}
      <span class="pal-t">${esc(it.rotulo)}</span><span class="pal-s">${esc(it.sub)}</span></button>`
  }).join('')
  $('pal-res').innerHTML = html || '<div class="vazio">Nada encontrado.</div>'
  $('pal-res').querySelector('.pal-it.on')?.scrollIntoView({ block: 'nearest' })
}

function abrirPaleta() {
  if (!estado) return
  abrirDialogo(`
    <div class="paleta">
      <input class="filtro pal-in" id="pal-in" type="search" placeholder="Procurar chats, grupos e ações" aria-label="Procurar" aria-controls="pal-res" autofocus>
      <div class="pal-res" id="pal-res" role="listbox"></div>
      <div class="pal-rodape rot">↑↓ escolher · Enter abrir · Ctrl+Enter abrir o chat na app · Esc fechar</div>
    </div>`)
  $('dialogo').classList.add('com-paleta')
  paleta = { itens: itensDaPaleta(''), ativo: 0 }
  desenharPaleta()
}

function correrPaleta(i, naApp = false) {
  const it = paleta?.itens[i]
  if (!it) return
  fecharDialogo()
  if (naApp && it.local) return pedir('/api/abrir', { local: it.local }).then(() => avisar('A abrir na app…'), () => avisar('Não abriu'))
  it.fazer()
}

// ——— aba Consumo: histórico das transcrições, custo equivalente na API, horas, ponta e API ———

let historicoDados = null // a última resposta de /api/historico
let historicoPedidoEm = 0
let abaConsumo = 'resumo' // resumo ou ponta
let repConsumo = 'pastas' // repartição: pastas, modelos, chats ou discos
let totalCustoConsumo = 0 // custo de todo o histórico, para a % de cada linha
let diasGrafico = 30 // 30, 90 ou 0 (tudo)
let editarMensal = false
const gruposAbertosConsumo = new Set()

const dinheiro = v => (v === null || v === undefined ? '—' : Math.abs(v) >= 100 ? `$${Math.round(v).toLocaleString('pt-PT')}` : `$${v.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
const euros = v => (v === null || v === undefined ? '—' : `${(Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100).toLocaleString('pt-PT', { minimumFractionDigits: Math.abs(v) >= 100 || Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })} €`)
const naMoeda = (v, moeda) => (moeda === 'EUR' ? euros(v) : dinheiro(v))
// O custo na API vem em USD; com a taxa (1 € = x USD) mostra-se também em euros, sempre à vista.
const usdEmEur = usd => (historicoDados?.usdPorEur > 0 ? usd / historicoDados.usdPorEur : null)
const duasMoedas = usd => { const e = usdEmEur(usd); return e === null ? dinheiro(usd) : `${dinheiro(usd)} · ${euros(e)}` }
const horas = ms => { const m = Math.round(ms / 60_000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${dois(m % 60)}` }
const diaCurto = dia => { const d = new Date(`${dia}T12:00:00`); return `${DIAS[d.getDay()].toLowerCase()} ${dois(d.getDate())} ${MESES[d.getMonth()].toLowerCase()}` }
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const nomeDoMes = mes => { const [a, m] = mes.split('-').map(Number); return `${MESES_LONGOS[m - 1]} ${a}` }
const pctFmt = x => `${Math.round(x * 100)}%`

// Famílias de modelos para as cores dos gráficos (sem a cor de sinal, que é só para o que precisa de ti).
const FAMILIAS = [
  { nome: 'Opus', cor: 'var(--ink)', bate: m => m.includes('opus') },
  { nome: 'Sonnet', cor: 'var(--frio)', bate: m => m.includes('sonnet') },
  { nome: 'Fable / Mythos', cor: 'var(--dim)', bate: m => m.includes('fable') || m.includes('mythos') },
  { nome: 'Haiku', cor: 'var(--faint)', bate: m => m.includes('haiku') },
  { nome: 'Outros', cor: 'var(--line2)', bate: () => true },
]
const familiaDe = modelo => FAMILIAS.find(f => f.bate(modelo))
const nomeDoModelo = chave => historicoDados?.modelos.find(m => m.chave === chave)?.nome ?? chave

async function atualizarHistorico(forcar = false) {
  const pronto = historicoDados?.pronto
  if (!forcar && pronto && Date.now() - historicoPedidoEm < 30_000) return
  historicoPedidoEm = Date.now()
  try {
    const r = await fetch('/api/historico', { cache: 'no-store' })
    if (r.ok) historicoDados = await r.json()
  } catch {}
  if (estado) desenhar()
}

// Barras empilhadas por dia, em SVG, com uma grelha em três níveis. `partes(d)` dá [{ v, cor, nome }] de cada dia.
function svgBarras(dias, partes, formato, rotulo) {
  const L = 320
  const A = 110
  const totais = dias.map(d => partes(d).reduce((s, p) => s + p.v, 0))
  const maximo = Math.max(...totais, 1e-9)
  const largura = L / Math.max(dias.length, 1)
  const grelha = [0.5, 1].map(f => `<line x1="0" y1="${(A - f * (A - 14)).toFixed(1)}" x2="${L}" y2="${(A - f * (A - 14)).toFixed(1)}" stroke="var(--line)" stroke-dasharray="2 3"/><text x="${L}" y="${(A - f * (A - 14) - 3).toFixed(1)}" fill="var(--faint)" font-family="Martian Mono" font-size="7.5" text-anchor="end">${esc(formato(maximo * f))}</text>`).join('')
  const barras = dias.map((d, i) => {
    let y = A
    const blocos = partes(d).filter(p => p.v > 0).map(p => {
      const h = (p.v / maximo) * (A - 14)
      y -= h

      return `<rect x="${(i * largura + largura * 0.14).toFixed(2)}" y="${y.toFixed(2)}" width="${(largura * 0.72).toFixed(2)}" height="${Math.max(h, 0.4).toFixed(2)}" fill="${p.cor}"/>`
    }).join('')
    const titulo = `${diaCurto(d.dia)} · ${partes(d).filter(p => p.v > 0).map(p => `${p.nome} ${formato(p.v)}`).join(' · ') || 'nada'}`

    return `<g class="col"><title>${esc(titulo)}</title><rect x="${(i * largura).toFixed(2)}" y="0" width="${largura.toFixed(2)}" height="${A}" fill="transparent"/>${blocos}</g>`
  }).join('')
  const marcas = dias.length > 1
    ? `<text x="0" y="${A + 13}" fill="var(--faint)" font-family="Martian Mono" font-size="7.5">${esc(diaCurto(dias[0].dia).toUpperCase())}</text><text x="${L}" y="${A + 13}" fill="var(--faint)" font-family="Martian Mono" font-size="7.5" text-anchor="end">HOJE</text>`
    : ''

  return `<svg viewBox="0 0 ${L} ${A + 18}" role="img" aria-label="${esc(rotulo)}">
    ${grelha}<line x1="0" y1="${A}" x2="${L}" y2="${A}" stroke="var(--line2)"/>
    ${barras}${marcas}
  </svg>`
}

function linhaTabela(nome, sub, x, maximo, extra = '', nivel = 0) {
  const parte = totalCustoConsumo > 0 ? x.custo / totalCustoConsumo : 0

  return `<div class="tab-l${nivel ? ` nivel-${nivel}` : ''}"${extra}>
    <div class="c1"><div class="t" title="${esc(nome)}">${esc(nome)}</div>${sub ? `<div class="s" title="${esc(sub)}">${esc(sub)}</div>` : ''}</div>
    <span class="num">${tokens(x.tokens)}</span>
    <span class="num forte">${x.custo || !x.semPreco ? dinheiro(x.custo) : 'sem preço'}</span>
    <span class="quota"><i class="barra" style="--p:${maximo ? Math.max(0.02, x.custo / maximo).toFixed(3) : 0}"></i><span class="pc">${parte >= 0.995 ? '100%' : parte >= 0.01 ? `${Math.round(parte * 100)}%` : parte > 0 ? '<1%' : '—'}</span></span>
  </div>`
}

// O corpo de uma tabela de repartição: cabeçalho de colunas e as linhas.
function corpoTabela(linhas, desenharLinha, colunaCusto = 'Custo API') {
  const maximo = Math.max(...linhas.map(l => l.custo), 0)

  return `<div class="cab-tab"><span class="rot">Nome</span><span class="rot">Tokens</span><span class="rot">${colunaCusto}</span><span class="rot">% do total</span></div>
    <div class="quadro">${linhas.length ? linhas.map(l => desenharLinha(l, maximo)).join('') : '<div class="vazio">Sem dados.</div>'}</div>`
}

// ——— subscrição, em euros ou dólares, com a taxa de câmbio à vista ———

function linhaTaxa(h) {
  if (!(h.usdPorEur > 0)) return '<span class="taxa">sem taxa de câmbio: os valores ficam só em dólares</span>'

  return `<span class="taxa">1 € = ${h.usdPorEur.toLocaleString('pt-PT', { maximumFractionDigits: 4 })} USD · ${esc(h.taxaFonte ?? 'manual')}${h.taxaData ? `, ${esc(diaCurto(h.taxaData))}` : ''}</span>`
}

// O formulário da subscrição (valor, moeda e taxa de câmbio); o resumo está em htmlDestaque.
function htmlSubscricao(h) {
  return `<div class="sub-form">
      <label for="sub-mensal"><b>Quanto pagas por mês pela subscrição?</b><small>A Fila não deteta o teu plano: escreve o valor que pagas (com IVA). O custo na API está em dólares e converte-se com a taxa abaixo.</small></label>
      <div class="sub-linha">
        <input id="sub-mensal" class="filtro mono" type="number" min="0" max="100000" step="0.01" inputmode="decimal" value="${h.mensal ?? ''}" placeholder="0,00" aria-label="Valor mensal">
        <select id="sub-moeda" class="filtro" aria-label="Moeda"><option value="EUR"${h.moeda !== 'USD' ? ' selected' : ''}>€ por mês</option><option value="USD"${h.moeda === 'USD' ? ' selected' : ''}>$ por mês</option></select>
        <label class="taxa-l">1 € = <input id="sub-taxa" class="filtro mono" type="number" min="0.2" max="5" step="0.0001" inputmode="decimal" value="${h.usdPorEur ?? ''}" placeholder="1,1179" aria-label="Dólares por euro"> USD</label>
        <button class="btn" type="button" data-acao="taxa-bce" title="Taxa de referência do dia do Banco Central Europeu">Taxa do BCE</button>
        <button class="btn cheio" type="button" data-acao="gravar-mensal">Gravar</button>${h.mensal !== null ? '<button class="btn" type="button" data-acao="cancelar-mensal">Cancelar</button>' : ''}
      </div>
      ${linhaTaxa(h)}
      <details class="sub-meses"${Object.keys(h.mensalPorMes ?? {}).length ? ' open' : ''}>
        <summary>Meses em que pagaste outro valor</summary>
        <p class="def">Deixa em branco os meses em que pagaste o valor de cima. Se mudaste de plano, escreve o que pagaste nesse mês (por exemplo, 22 em junho e em julho).</p>
        <div class="sub-meses-g">${h.meses.map(m => `<label><span>${esc(nomeDoMes(m.mes))}</span><input class="filtro mono" type="number" min="0" max="100000" step="0.01" inputmode="decimal" data-mes-preco="${esc(m.mes)}" value="${h.mensalPorMes?.[m.mes] ?? ''}" placeholder="${h.mensal ?? ''}" aria-label="Quanto pagaste em ${esc(nomeDoMes(m.mes))}"></label>`).join('')}</div>
      </details>
    </div>`
}

// ——— resumo: pastas do gestor › grupos do Claude › chats ———

function htmlArvoreConsumo(h) {
  const org = h.organizacao ?? { pastas: [], grupos: [] }
  const porGrupo = new Map(h.grupos.map(g => [g.id, g]))
  const vazio = () => ({ custo: 0, tokens: 0, semPreco: 0 })
  const somaDe = ids => ids.reduce((s, id) => { const g = porGrupo.get(id); return g ? { custo: s.custo + g.custo, tokens: s.tokens + g.tokens, semPreco: s.semPreco + g.semPreco } : s }, vazio())
  const gruposDe = pasta => org.grupos.filter(g => (g.pasta ?? null) === pasta).map(g => g.id)
  const subpastas = pai => org.pastas.filter(p => (p.pai ?? null) === pai)
  const todosOsGrupos = pasta => [...gruposDe(pasta), ...subpastas(pasta).flatMap(p => todosOsGrupos(p.id))]
  const linhas = []
  const maximo = Math.max(...org.pastas.filter(p => !p.pai).map(p => somaDe(todosOsGrupos(p.id)).custo), ...gruposDe(null).map(id => porGrupo.get(id)?.custo ?? 0), ...['sem-grupo', 'fora-da-app'].map(id => porGrupo.get(id)?.custo ?? 0), 0)
  const linhaGrupo = (id, nivel) => {
    const g = porGrupo.get(id) ?? { ...vazio(), nome: org.grupos.find(x => x.id === id)?.nome ?? id }
    const nome = org.grupos.find(x => x.id === id)?.nome ?? g.nome
    const aberto = gruposAbertosConsumo.has(id)
    const chats = h.chatsPorGrupo?.[id] ?? []
    linhas.push({ custo: g.custo, html: linhaTabela(`${chats.length ? (aberto ? '▾ ' : '▸ ') : ''}${nome}`, chats.length ? `${chats.length === 5 ? 'os 5 chats que mais gastam' : `${chats.length} chat${chats.length === 1 ? '' : 's'}`}` : '', g, maximo, chats.length ? ` role="button" tabindex="0" data-grupo-consumo="${esc(id)}"` : '', nivel) })
    if (aberto) for (const c of chats) linhas.push({ html: linhaTabela(c.titulo, c.local && !chatDe.has(c.local) ? 'arquivado' : '', c, maximo, c.local && chatDe.has(c.local) ? ` role="button" tabindex="0" data-sel="${esc(c.local)}"` : '', nivel + 1) })
  }
  const andar = (pasta, nivel) => {
    const filhos = [
      ...subpastas(pasta).map(p => ({ tipo: 'pasta', p, soma: somaDe(todosOsGrupos(p.id)) })),
      ...gruposDe(pasta).map(id => ({ tipo: 'grupo', id, soma: porGrupo.get(id) ?? vazio() })),
    ].sort((a, b) => b.soma.custo - a.soma.custo)
    for (const f of filhos) {
      if (f.tipo === 'pasta') {
        linhas.push({ html: linhaTabela(`▤ ${f.p.nome}`, 'pasta do gestor', f.soma, maximo, '', nivel).replace('class="tab-l', 'class="tab-l e-pasta') })
        andar(f.p.id, nivel + 1)
      } else linhaGrupo(f.id, nivel)
    }
  }
  andar(null, 0)
  for (const id of ['sem-grupo', 'fora-da-app']) if (porGrupo.has(id)) linhaGrupo(id, 0)

  return `<div class="cab-tab"><span class="rot">Nome</span><span class="rot">Tokens</span><span class="rot">Custo API</span><span class="rot">% do total</span></div>
    <div class="quadro">${linhas.map(l => l.html).join('') || '<div class="vazio">Sem dados.</div>'}</div>`
}

// A última linha de «Por mês»: tudo somado desde o primeiro mês. Uma soma só se mostra se todos os meses a têm.
function linhaTotalMeses(h) {
  const soma = campo => (h.meses.every(m => m[campo] !== null && m[campo] !== undefined) ? h.meses.reduce((s, m) => s + m[campo], 0) : null)
  const dinheiroDe = v => (v === null ? '—' : naMoeda(v, h.moeda))
  const custo = soma('custoNaMoeda')
  const poupanca = soma('poupanca')

  return `<div class="mes-l total"><span>Total</span><span class="num">${tokens(h.meses.reduce((s, m) => s + m.tokens, 0))}</span><span class="num">${horas(h.meses.reduce((s, m) => s + m.ativoMs, 0))}</span><span class="num">${dinheiroDe(soma('subscricao'))}</span><span class="num forte">${custo === null ? dinheiro(h.totais.total.custo) : dinheiroDe(custo)}</span><span class="num${poupanca !== null && poupanca < 0 ? ' alerta' : ''}">${dinheiroDe(poupanca)}</span></div>`
}

// O valor principal na moeda da subscrição (se houver taxa) e o outro em letra pequena.
function valorPrincipal(usd, h) {
  const eur = usdEmEur(usd)

  return h.moeda === 'EUR' && eur !== null ? euros(eur) : dinheiro(usd)
}

function valorSecundario(usd, h) {
  const eur = usdEmEur(usd)
  if (eur === null) return ''

  return h.moeda === 'EUR' ? dinheiro(usd) : euros(eur)
}

// O destaque: quanto poupas este mês face ao que pagas, com as duas barras lado a lado, e o uso por período.
function htmlDestaque(h) {
  const T = h.totais
  const mes = h.meses.at(-1)
  // O que se paga este mês (pode ser um valor próprio do mês) e o que o uso custaria na API.
  const paga = mes?.subscricao ?? h.mensal
  const tem = paga !== null && paga !== undefined && mes?.custoNaMoeda !== null && mes?.custoNaMoeda !== undefined
  const usado = mes?.custoNaMoeda
  const maximo = Math.max(paga ?? 0, usado ?? 0, 1e-9)
  const negativo = tem && mes.poupanca < 0
  const vezes = tem && paga > 0 ? usado / paga : null
  const semTaxa = h.mensal !== null && h.mensal !== undefined && !tem
  const frase = semTaxa
    ? 'Falta a taxa de câmbio para comparar em euros: edita a subscrição e carrega em «Taxa do BCE».'
    : !tem
    ? 'Diz quanto pagas pela subscrição e mostro quanto poupas face ao que o teu uso custaria na API.'
    : negativo
      ? `Pagas <b>${naMoeda(paga, h.moeda)}</b> e o que usaste custaria só <b>${naMoeda(usado, h.moeda)}</b> na API.`
      : `Pagas <b>${naMoeda(paga, h.moeda)}</b> pela subscrição e o que usaste custaria <b>${naMoeda(usado, h.moeda)}</b> na API${vezes ? `, <b>${vezes.toLocaleString('pt-PT', { maximumFractionDigits: 1 })}×</b> o que pagas` : ''}.`
  const barra = (nome, v, cls) => `<div class="comp-l ${cls}"><span>${nome}</span><i style="--p:${Math.max(0.02, v / maximo).toFixed(3)}"></i><b class="mono">${naMoeda(v, h.moeda)}</b></div>`
  const bloco = (rot, x, nota) => `<div class="bloco"><span class="rot">${rot}</span><div class="v mono">${valorPrincipal(x.custo, h)}</div><div class="v2 mono">${valorSecundario(x.custo, h) || '&nbsp;'}</div><small>${tokens(x.tokens)} tokens · ${horas(x.ativoMs)} ativo${nota ? ` · ${nota}` : ''}</small></div>`

  return `<section class="destaque">
    <div class="d-poupa">
      <span class="rot">${mes ? esc(nomeDoMes(mes.mes)) : 'Este mês'}${tem ? (negativo ? ' · pagas a mais' : ' · poupas') : ''}</span>
      <div class="d-num mono${negativo ? ' alerta' : ''}">${tem ? naMoeda(Math.abs(mes.poupanca), h.moeda) : '—'}</div>
      <p class="d-frase">${frase}</p>
      ${tem ? `<div class="comp">${barra('Subscrição', paga, 'paga')}${barra('Na API', usado, 'api')}</div>` : ''}
      <div class="d-pe">${linhaTaxa(h)}<button class="mais rot" type="button" data-acao="editar-mensal">${tem ? 'editar subscrição' : 'definir subscrição'}</button></div>
    </div>
    <div class="d-periodos">
      ${bloco('Hoje', T.hoje)}
      ${bloco('Últimos 7 dias', T.semana)}
      ${bloco(`Em ${MESES_LONGOS[new Date().getMonth()]}`, T.mes)}
      ${bloco(`Desde ${h.desde ? diaCurto(h.desde) : '—'}`, T.total, `${T.total.dias} dias com uso`)}
    </div>
  </section>`
}

// Uma tabela de cada vez (pastas, modelos, chats ou pastas do disco), em vez de quatro empilhadas.
function htmlRepartir(h) {
  const separadores = [['pastas', 'Pastas e grupos'], ['modelos', 'Modelos'], ['chats', 'Chats'], ['discos', 'Pastas do disco']]
  const nota = {
    pastas: 'as tuas pastas do gestor › grupos do Claude › chats; clica num grupo para ver os que mais gastam',
    modelos: 'todo o histórico, com a leitura de cache de cada modelo',
    chats: 'os 25 que mais gastam; clica para ver a ficha',
    discos: 'a pasta onde cada chat trabalha',
  }[repConsumo]
  const corpo = repConsumo === 'modelos'
    ? corpoTabela(h.modelos, (m, max) => linhaTabela(m.nome, `${tokens(m.leitura)} lidos da cache · ${m.respostas} respostas`, m, max))
    : repConsumo === 'chats'
      ? corpoTabela(h.chats, (c, max) => {
        // Só os chats abertos têm ficha; os arquivados ficam só com o nome.
        const aberto = c.local && chatDe.has(c.local)

        return linhaTabela(c.titulo, `${c.caminho}${c.local && !aberto ? ' · arquivado' : ''} · último dia ${diaCurto(c.ultimo)}`, c, max, aberto ? ` role="button" tabindex="0" data-sel="${esc(c.local)}"` : '')
      })
      : repConsumo === 'discos'
        ? corpoTabela(h.projetos, (p, max) => linhaTabela(p.nome, '', p, max))
        : htmlArvoreConsumo(h)

  return `<section class="sec"><div class="sec-cab"><h2>Para onde vai</h2><span class="rot nota">${esc(nota)}</span></div>
    <div class="sub-abas rep" role="tablist">${separadores.map(([id, nome]) => `<button type="button" role="tab" aria-selected="${repConsumo === id}" data-rep-consumo="${id}"${repConsumo === id ? ' class="on"' : ''}>${nome}</button>`).join('')}</div>
    ${corpo}</section>`
}

function htmlResumoConsumo(e, h) {
  totalCustoConsumo = h.totais.total.custo
  const dias = diasGrafico ? h.dias.slice(-diasGrafico) : h.dias
  const partesCusto = d => FAMILIAS.map(f => ({ nome: f.nome, cor: f.cor, v: Object.entries(d.custos ?? {}).filter(([m]) => familiaDe(m) === f).reduce((s, [, v]) => s + v, 0) }))
  const partesHoras = d => [{ nome: 'ativo', cor: 'var(--ink)', v: d.ativoMs }, { nome: 'passivo', cor: 'var(--frio)', v: d.passivoMs }]
  const alternar = `<span class="alternar">${[[30, '30D'], [90, '90D'], [0, 'TUDO']].map(([n, r]) => `<button type="button" data-dias-hist="${n}"${diasGrafico === n ? ' class="on"' : ''}>${r}</button>`).join('')}</span>`
  const totalPeriodo = dias.reduce((s, d) => ({ custo: s.custo + d.custo, ativo: s.ativo + d.ativoMs, passivo: s.passivo + d.passivoMs }), { custo: 0, ativo: 0, passivo: 0 })
  const familiasUsadas = FAMILIAS.filter(f => dias.some(d => Object.keys(d.custos ?? {}).some(m => familiaDe(m) === f)))
  const semPreco = h.modelos.filter(m => !m.temPreco)
  const meses = [...h.meses].reverse()

  return `
    ${h.mensal === null || editarMensal ? `<section class="sec">${htmlSubscricao(h)}</section>` : ''}
    ${htmlDestaque(h)}
    <section class="sec"><div class="sec-cab"><h2>Evolução</h2><span class="rot nota">${duasMoedas(totalPeriodo.custo)} · ${horas(totalPeriodo.ativo)} ativo · ${horas(totalPeriodo.passivo)} passivo</span>${alternar}</div>
      <div class="duas">
        <div class="grafico"><div class="g-t"><b>Custo por dia</b><span class="rot">a preços da API</span></div>${svgBarras(dias, partesCusto, dinheiro, 'Custo equivalente na API por dia, por família de modelo')}
          <div class="leg-c">${familiasUsadas.map(f => `<span><i style="background:${f.cor}"></i>${f.nome}</span>`).join('')}</div></div>
        <div class="grafico"><div class="g-t"><b>Horas por dia</b><span class="rot">uso ativo e passivo</span></div>${svgBarras(dias, partesHoras, horas, 'Horas de uso ativo e passivo por dia')}
          <div class="leg-c"><span><i style="background:var(--ink)"></i>ativo</span><span><i style="background:var(--frio)"></i>passivo</span></div></div>
      </div>
      <p class="def">${esc(h.definicoes.ativo)} ${esc(h.definicoes.passivo)}</p>
    </section>
    <div class="duas">
      <section class="sec"><div class="sec-cab"><h2>Limites e previsão</h2><span class="rot nota">da conta, registados pelo mod em cada turno</span></div>${htmlConsumo(e)}</section>
      <section class="sec"><div class="sec-cab"><h2>Por mês</h2><span class="rot nota">custo na API face à subscrição (${h.moeda === 'EUR' ? 'em euros' : 'em dólares'})</span></div>
      <div class="cab-mes"><span class="rot">Mês</span><span class="rot">Tokens</span><span class="rot">Ativo</span><span class="rot">Paga</span><span class="rot">Custo API</span><span class="rot">Poupança</span></div>
      <div class="quadro">${meses.map(m => `<div class="mes-l"><span>${esc(nomeDoMes(m.mes))}</span><span class="num">${tokens(m.tokens)}</span><span class="num">${horas(m.ativoMs)}</span><span class="num${h.mensalPorMes?.[m.mes] !== undefined ? ' proprio' : ''}" title="${h.mensalPorMes?.[m.mes] !== undefined ? 'valor pago só neste mês' : 'valor atual da subscrição'}">${m.subscricao === null || m.subscricao === undefined ? '—' : naMoeda(m.subscricao, h.moeda)}</span><span class="num forte" title="${esc(dinheiro(m.custo))}">${m.custoNaMoeda === null || m.custoNaMoeda === undefined ? dinheiro(m.custo) : naMoeda(m.custoNaMoeda, h.moeda)}</span><span class="num${m.poupanca !== null && m.poupanca < 0 ? ' alerta' : ''}">${m.poupanca === null ? '—' : naMoeda(m.poupanca, h.moeda)}</span></div>`).join('')}${linhaTotalMeses(h)}</div>
      </section>
    </div>
    ${htmlRepartir(h)}
    <p class="def rodape">${esc(h.definicoes.tokens)} Preços: <a href="${esc(h.precos.fonte)}" target="_blank" rel="noopener noreferrer">página oficial da Anthropic</a>, lida a ${esc(h.precos.lidoEm ?? '—')}, em ${esc(h.precos.moeda)}; em euros com a taxa ${h.usdPorEur > 0 ? `1 € = ${h.usdPorEur.toLocaleString('pt-PT', { maximumFractionDigits: 4 })} USD (${esc(h.taxaFonte ?? 'manual')}${h.taxaData ? `, ${esc(h.taxaData)}` : ''})` : 'que ainda não definiste'}.${semPreco.length ? ` Sem preço conhecido: ${esc(semPreco.map(m => m.nome).join(', '))} (não entram no custo).` : ''} O histórico vem das transcrições do Claude Code (só contagens, horas e pastas, nunca o texto) e atualiza-se de 2 em 2 min.</p>`
}

// ——— horas de ponta ———

const DIAS_SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']

function svgMapaCalor(p) {
  const L = 320
  const esq = 22
  const topo = 4
  const cel = (L - esq) / 24
  const alt = cel * 0.9
  // Segunda primeiro, como no calendário português.
  const linhas = [1, 2, 3, 4, 5, 6, 0].map(d => p.mapa[d])
  const maximo = Math.max(...linhas.flat().map(c => c.custo), 1e-9)
  const celulas = linhas.map((linha, i) => linha.map((c, hora) => {
    const x = esq + hora * cel
    const y = topo + i * (alt + 2)
    const f = c.custo / maximo

    return `<g><title>${esc(`${DIAS_SEMANA[i].toLowerCase()} ${dois(hora)}h · ${dinheiro(c.custo)} · ${tokens(c.tokens)} tokens${c.ponta ? ' · janela de ponta' : ''}`)}</title>`
      + `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(cel - 1.5).toFixed(2)}" height="${alt.toFixed(2)}" rx="1.5" fill="var(--ink)" fill-opacity="${c.custo ? (0.08 + 0.92 * f).toFixed(3) : 0}" stroke="${c.ponta ? 'var(--sinal)' : 'var(--line)'}" stroke-width="${c.ponta ? 1 : 0.5}"/></g>`
  }).join('')).join('')
  const rotDias = DIAS_SEMANA.map((d, i) => `<text x="0" y="${(topo + i * (alt + 2) + alt * 0.75).toFixed(2)}" fill="var(--faint)" font-family="Martian Mono" font-size="7">${d.toUpperCase()}</text>`).join('')
  const rotHoras = [0, 6, 12, 18, 23].map(hh => `<text x="${(esq + hh * cel + cel / 2).toFixed(2)}" y="${(topo + 7 * (alt + 2) + 8).toFixed(2)}" fill="var(--faint)" font-family="Martian Mono" font-size="7" text-anchor="middle">${dois(hh)}H</text>`).join('')

  return `<svg viewBox="0 0 ${L} ${(topo + 7 * (alt + 2) + 12).toFixed(0)}" role="img" aria-label="Mapa de calor do custo por dia da semana e hora, com a janela de ponta marcada">${celulas}${rotDias}${rotHoras}</svg>`
}

function htmlExcesso(x) {
  const nome = x.kind === 'five_hour' ? 'Sessão de 5 h' : 'Semana'
  const lado = (rot, l) => `<div class="exc-l"><span>${rot}</span><span class="num">${l.intervalos}</span><span class="num">${l.pp.toLocaleString('pt-PT', { maximumFractionDigits: 1 })} pp</span><span class="num">${dinheiro(l.custo)}</span><span class="num forte">${l.porDolar === null ? '—' : (l.porDolar * 100).toLocaleString('pt-PT', { maximumFractionDigits: 1 })}</span></div>`
  const conclusao = x.suficiente
    ? x.diferenca > 0.05
      ? `Em ponta, o limite sobe <b>${pctFmt(x.diferenca)} mais</b> por dólar gasto. Estimativa do que gastaste a mais: <b>${x.excessoPp.toLocaleString('pt-PT', { maximumFractionDigits: 1 })} pp</b> do limite, o equivalente a ${duasMoedas(x.excessoUsd)} de uso fora de ponta.`
      : x.diferenca < -0.05
        ? `Em ponta, o limite sobe ${pctFmt(-x.diferenca)} menos por dólar: não há sinal de penalização.`
        : 'Dentro e fora de ponta, o limite sobe praticamente igual por dólar gasto.'
    : `Ainda há poucas leituras: ${x.leituras} do mod, com ${x.ponta.intervalos} intervalos em ponta e ${x.fora.intervalos} fora. Preciso de pelo menos 10 de cada lado (e $5 gastos em cada) para comparar; a estimativa melhora com o tempo.`

  return `<div class="exc">
    <div class="exc-cab"><b>${nome}</b><span class="rot">leituras do mod: ${x.leituras}</span></div>
    <div class="exc-l cab"><span class="rot"></span><span class="rot">Intervalos</span><span class="rot">Subiu</span><span class="rot">Gasto</span><span class="rot" title="Pontos percentuais do limite por cada $100 de custo na API">pp por $100</span></div>
    ${lado('Em ponta', x.ponta)}${lado('Fora de ponta', x.fora)}
    <p class="nota-d">${conclusao}</p>
  </div>`
}

function htmlPonta(h) {
  const p = h.ponta
  if (!p) return '<div class="vazio">Sem dados de ponta.</div>'
  const j = p.janela
  // As horas locais da janela, numa segunda-feira desta semana (Lisboa muda com a hora de verão).
  const horasLocais = p.mapa[1].map((c, hora) => (c.ponta ? hora : null)).filter(x => x !== null)
  const janelaLocal = horasLocais.length ? `${dois(horasLocais[0])}–${dois(horasLocais.at(-1) + 1)} h em Lisboa` : 'fora do teu dia'
  const modelos = [...new Set([...p.porModelo.ponta, ...p.porModelo.fora].map(m => m.modelo))].map(modelo => {
    const em = p.porModelo.ponta.find(m => m.modelo === modelo) ?? { custo: 0, tokens: 0 }
    const fora = p.porModelo.fora.find(m => m.modelo === modelo) ?? { custo: 0, tokens: 0 }

    return { modelo, em, fora, total: em.custo + fora.custo }
  }).sort((a, b) => b.total - a.total)
  const fontes = p.fontes.map(f => `<li><a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.titulo)}</a> <span class="etiqueta${f.oficial ? ' oficial' : ''}">${f.oficial ? 'oficial' : 'não oficial'}</span> <span class="rot">${esc(diaCurto(f.data))}</span><div class="def">${esc(f.diz)}</div></li>`).join('')
  const partilha = p.partilha30

  return `
    <section class="sec regra">
      <div class="aviso-regra"><span class="sinal-pt"></span><div><b>${p.regraOficial ? 'Regra oficial em vigor' : 'Não há regra oficial clara em vigor.'}</b> ${esc(p.resumo)}</div></div>
      ${j ? `<p class="nota-d">Para comparar, uso a janela que vigorou de ${esc(diaCurto(j.desde))} a ${esc(diaCurto(j.ate))}: <b>dias úteis, ${dois(j.inicio)}–${dois(j.fim)} h em Los Angeles</b> (${janelaLocal}), marcada a laranja no mapa. ${esc(j.nota)}</p>` : ''}
      <ul class="fontes">${fontes}</ul>
      <p class="def">Fontes lidas a ${esc(diaCurto(p.lidoEm))}.</p>
    </section>
    <div class="faixa">
      <div class="fig"><span class="rot">Em ponta · 30 dias</span><div class="num">${pctFmt(partilha.fracao)}</div><small>${duasMoedas(partilha.ponta)} do teu custo na janela</small></div>
      <div class="fig"><span class="rot">Fora de ponta</span><div class="num">${pctFmt(1 - partilha.fracao)}</div><small>${duasMoedas(partilha.total - partilha.ponta)}</small></div>
      ${p.excesso.map(x => `<div class="fig"><span class="rot">${x.kind === 'five_hour' ? 'Sessão 5 h em ponta' : 'Semana em ponta'}</span><div class="num${x.suficiente && x.diferenca > 0.05 ? ' sinal' : ''}">${x.suficiente && x.diferenca !== null ? `${x.diferenca >= 0 ? '+' : '−'}${pctFmt(Math.abs(x.diferenca))}` : '—'}</div><small>${x.suficiente ? 'subida do limite por dólar, face a fora' : `${x.leituras} leituras; a estimativa melhora com o tempo`}</small></div>`).join('')}
    </div>
    <div class="duas">
      <section class="sec"><div class="sec-cab"><h2>Quando usas</h2><span class="rot nota">custo por dia e hora (Lisboa) · ${p.semanas} semanas</span></div>
        <div class="grafico">${svgMapaCalor(p)}<div class="leg-c"><span><i style="background:var(--ink)"></i>mais custo</span><span><i class="contorno"></i>janela de ponta</span></div></div></section>
      <section class="sec"><div class="sec-cab"><h2>Quanto gastas a mais</h2><span class="rot nota">pelas tuas leituras dos limites</span></div>
        ${p.excesso.map(htmlExcesso).join('')}
        <p class="def">Como medi: para cada par de leituras seguidas do mesmo limite (a menos de 3 h e sem reset pelo meio), quanto subiu a % e quanto custou na API o que gastaste entre elas. Compara-se a subida por dólar dentro e fora da janela; a diferença dá o excesso.</p></section>
    </div>
    <section class="sec"><div class="sec-cab"><h2>Modelos em ponta e fora</h2><span class="rot nota">custo equivalente na API, todo o histórico</span></div>
      <div class="cab-pm"><span class="rot">Modelo</span><span class="rot">Em ponta</span><span class="rot">Fora</span><span class="rot">% em ponta</span></div>
      <div class="quadro">${modelos.map(m => `<div class="pm-l"><span class="t">${esc(nomeDoModelo(m.modelo))}</span><span class="num">${dinheiro(m.em.custo)}</span><span class="num">${dinheiro(m.fora.custo)}</span><span class="num forte">${m.total ? pctFmt(m.em.custo / m.total) : '—'}</span></div>`).join('') || '<div class="vazio">Sem dados.</div>'}</div>
    </section>`
}

function htmlVistaConsumo(e) {
  const h = historicoDados
  const abas = `<div class="sub-abas" role="tablist">${[['resumo', 'Resumo'], ['ponta', 'Horas de ponta']].map(([id, nome]) => `<button type="button" role="tab" aria-selected="${abaConsumo === id}" data-aba-consumo="${id}"${abaConsumo === id ? ' class="on"' : ''}>${nome}</button>`).join('')}</div>`
  if (!h) return `${abas}<div class="vazio carregar">A pedir o histórico ao gestor…</div>`
  if (!h.pronto) {
    const p = h.progresso ?? {}

    return `${abas}<div class="vazio carregar">A ler as transcrições do Claude Code: ${p.lidos ?? 0} de ${p.total || '…'} ficheiros. A primeira leitura demora uns segundos; depois só se lê o que cresceu.</div>`
  }

  return abas + (abaConsumo === 'ponta' ? htmlPonta(h) : htmlResumoConsumo(e, h))
}

// A linha do Painel: semana e sessão de 5 h com a previsão; clicar abre a aba Consumo.
function htmlLinhaConsumo(e) {
  const { semana, sessao } = e.consumo ?? {}
  const hoje = historicoDados?.pronto ? historicoDados.totais.hoje.custo : null
  // Só spans: a linha inteira é um botão.
  const parte = (rot, x, sinal) => `<span class="lc-p"><span class="rot">${rot}</span><b class="mono${sinal ? ' sinal' : ''}">${x ? pct(x.percent) : '—'}</b><span class="lc-barra${sinal ? ' sinal' : ''}" style="--p:${Math.min(100, Math.max(0, x?.percent ?? 0)) / 100}"></span></span>`
  const previsao = !semana ? 'sem leituras dos limites ainda'
    : semana.antesDoReset ? `ao ritmo atual a semana acaba ${diaHora(semana.chegaEm)}`
      : `chegas ao reset ${diaHora(semana.resetsAt)}`

  return `${parte('Semana', semana, Boolean(semana?.antesDoReset))}${parte('Sessão 5 h', sessao, false)}<span class="lc-prev">${esc(previsao)}</span>${hoje === null ? '' : `<span class="lc-hoje mono">hoje ${dinheiro(hoje)}</span>`}<span class="lc-ir">Consumo →</span>`
}

async function gravarMensal() {
  const v = $('sub-mensal').value.trim()
  const taxa = $('sub-taxa').value.trim()
  const mensal = v === '' ? null : Number(v.replace(',', '.'))
  const usdPorEur = taxa === '' ? null : Number(taxa.replace(',', '.'))
  // Só vão os meses com valor próprio; em branco é o valor de cima.
  const meses = {}
  for (const campo of document.querySelectorAll('[data-mes-preco]')) {
    const bruto = campo.value.trim()
    if (bruto !== '') meses[campo.dataset.mesPreco] = Number(bruto.replace(',', '.'))
  }
  try {
    await pedir('/api/consumo/config', { mensal, meses, moeda: $('sub-moeda').value, usdPorEur })
    editarMensal = false
    document.activeElement?.blur()
    await atualizarHistorico(true)
  } catch (erro) {
    avisar(`Não gravou: ${erro.message}`)
  }
}

async function taxaBce(botao) {
  try {
    const r = await pedir('/api/consumo/taxa-bce', {})
    if ($('sub-taxa')) $('sub-taxa').value = r.usdPorEur
    avisar(`Taxa do BCE de ${diaCurto(r.taxaData)}: 1 € = ${r.usdPorEur} USD`)
    await atualizarHistorico(true)
  } catch (erro) {
    avisarNoBotao(botao, 'Falhou')
    avisar(`Não deu: ${erro.message}`)
  }
}

// ——— desenho ———

function desenhar() {
  const e = estado
  chatDe = new Map(e.recentes.map(c => [c.local, c]))
  const d = new Date(e.geradoEm)
  $('data').textContent = `${DIAS[d.getDay()]} ${dois(d.getDate())} ${MESES[d.getMonth()]} · ${hora(e.geradoEm)}`
  $('n-espera').textContent = dois(e.numeros.espera)
  $('n-trabalho').textContent = dois(e.numeros.trabalho)
  $('n-recentes').textContent = dois(e.recentes.length)
  $('r-trabalho').textContent = dois(e.numeros.trabalho)
  $('r-recentes').textContent = rotuloRecentes(e)
  // Com a pesquisa em foco, as atualizações não redesenham o campo por baixo de quem escreve.
  const aEscrever = !escreverNaBusca && document.activeElement?.matches?.('[data-busca-ns]')
  $('orquestrador').disabled = !e.orquestrador
  $('orquestrador').dataset.local = e.orquestrador ?? ''

  // À primeira, com espaço para a ficha, mostra logo o primeiro à espera (como no protótipo).
  if (primeiraVez && !selecionado && e.espera.length && innerWidth > 1180) selecionado = chave(e.espera[0])

  const ficha = selecionado && procurar(e, selecionado)
  if (selecionado && !ficha) selecionado = null
  app.classList.toggle('fechado', !ficha)

  const no = vista.tipo === 'seccao' && acharNo(e.arvore, vista.id)
  if (vista.tipo === 'seccao' && !no) vista = { tipo: 'painel' }
  $('painel').hidden = vista.tipo !== 'painel'
  $('vista-seccao').hidden = vista.tipo !== 'seccao'
  $('vista-consumo').hidden = vista.tipo !== 'consumo'
  $('titulo').textContent = no ? no.nome : vista.tipo === 'consumo' ? 'Consumo' : 'Painel'
  $('ir-painel').classList.toggle('on', vista.tipo === 'painel')
  $('ir-consumo').classList.toggle('on', vista.tipo === 'consumo')
  $('n-consumo').textContent = e.consumo?.semana ? pct(e.consumo.semana.percent) : '—'

  if (vista.tipo === 'consumo') {
    // Com um campo da subscrição em foco, não se redesenha por cima do que a pessoa escreve.
    if (!['sub-mensal', 'sub-moeda', 'sub-taxa'].includes(document.activeElement?.id)) por('vista-consumo', htmlVistaConsumo(e))
  } else if (no) {
    if (!(aEscrever && document.activeElement.dataset.buscaNs === 'proj')) por('vista-seccao', htmlVistaSeccao(e, no))
  }
  else {
    por('faixa', htmlFaixa(e))
    por('linha-consumo', htmlLinhaConsumo(e))
    por('espera', htmlEspera(e))
    por('trabalho', htmlTrabalho(e))
    if (!(aEscrever && document.activeElement.dataset.buscaNs === 'rec')) por('recentes-ctrl', htmlControlos('rec', e.recentes))
    por('recentes', htmlRecentes(e))
  }
  desenharArvore()
  por('medidor', htmlMedidor(e))
  por('ficha', ficha ? htmlFicha(e, ficha) : '')

  // Depois da primeira vez, as linhas já não voltam a entrar com animação a cada atualização.
  if (primeiraVez) requestAnimationFrame(() => setTimeout(() => $('corpo').classList.add('ja'), 1200))
  primeiraVez = false
}

async function atualizar() {
  if (document.hidden && estado) return
  try {
    const r = await fetch('/api/estado', { cache: 'no-store' })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    estado = await r.json()
    $('caido').hidden = true
    // O histórico também serve a linha do Painel (custo de hoje); depois de pronto, pede-se de 30 em 30 s.
    atualizarHistorico()
    atualizarProjetos()
  } catch {
    $('caido').hidden = false
  }
  if (estado) desenhar()
}

// ——— ações ———

async function pedir(caminho, corpo) {
  const r = await fetch(caminho, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) })
  const dados = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(dados.erro || `HTTP ${r.status}`)

  return dados
}

function avisar(texto) {
  const aviso = $('aviso')
  aviso.textContent = texto
  aviso.hidden = false
  clearTimeout(avisar.t)
  avisar.t = setTimeout(() => { aviso.hidden = true }, 4000)
}

function avisarNoBotao(botao, texto) {
  const antes = botao.textContent
  botao.textContent = texto
  setTimeout(() => { botao.textContent = antes }, 1600)
}

async function organizar(corpo) {
  try {
    const r = await pedir('/api/organizacao', corpo)
    await atualizar()

    return r
  } catch (erro) {
    avisar(`Não deu: ${erro.message}`)
    await atualizar()

    return undefined
  }
}

function selecionar(k) {
  selecionado = k
  if (estado) desenhar()
}

function abrirConsumo() {
  vista = { tipo: 'consumo' }
  menu = null
  $('corpo').scrollTo({ top: 0 })
  atualizarHistorico(true)
  if (estado) desenhar()
}

function verSeccao(id) {
  vista = { tipo: 'seccao', id }
  menu = null
  $('corpo').scrollTo({ top: 0 })
  if (estado) desenhar()
}

function comecarEdicao(nova) {
  edicao = nova
  menu = null
  if (nova.tipo === 'criar' && nova.pai) abertas.add(nova.pai)
  desenharArvore(true)
}

async function acabarEdicao(gravar) {
  const atual = edicao
  if (!atual) return
  const input = $('arvore').querySelector('.ed')
  const nome = input?.value.trim() ?? ''
  edicao = null
  if (gravar && nome) {
    if (atual.tipo === 'criar') {
      const r = await organizar({ acao: 'criar-pasta', nome, pai: atual.pai })
      if (r?.id && atual.pai) abertas.add(atual.pai)
    } else {
      const grupo = estado?.organizacao.grupos.find(g => g.id === atual.id)
      if (grupo) {
        if (nome !== grupo.nome) await organizar({ acao: 'renomear-grupo', grupo: atual.id, nome })
      } else {
        const antes = estado?.organizacao.pastas.find(p => p.id === atual.id)?.nome
        if (nome !== antes) await organizar({ acao: 'renomear-pasta', id: atual.id, nome })
      }
    }
  }
  desenharArvore(true)
}

async function agir(botao) {
  const acao = botao.dataset.acao
  const id = botao.dataset.id
  if (acao === 'fechar') return selecionar(null)
  if (acao === 'fechar-dialogo') return fecharDialogo()
  if (acao === 'abrir') {
    try {
      await pedir('/api/abrir', { local: botao.dataset.local })
      avisarNoBotao(botao, botao.classList.contains('abrir') ? '✓' : 'A abrir…')
    } catch {
      avisarNoBotao(botao, botao.classList.contains('abrir') ? '!' : 'Não abriu')
    }
  }
  if (acao === 'dispensar') {
    const x = estado?.espera.find(item => chave(item) === selecionado) ?? estado?.trabalho.find(item => chave(item) === selecionado)
    if (!x) return
    try {
      await pedir('/api/dispensar', { sessao: x.sessao, desde: x.desde })
      await atualizar()
    } catch {
      avisarNoBotao(botao, 'Falhou')
    }
  }
  if (acao === 'filtro') {
    ctrl[botao.dataset.ns].filtro = botao.dataset.filtro
    guardarControlos()
    return redesenharControlos(botao.dataset.ns)
  }
  if (acao === 'limpar-filtros') {
    ctrl[botao.dataset.ns].filtro = CTRL_PADRAO[botao.dataset.ns].filtro
    ctrl[botao.dataset.ns].busca = ''
    guardarControlos()
    return redesenharControlos(botao.dataset.ns)
  }
  if (acao === 'projeto') return dialogoProjeto(id)
  if (acao === 'projeto-grupo') { fecharDialogo(); return verSeccao(id) }
  if (acao === 'projeto-chat') { fecharDialogo(); return selecionar(botao.dataset.local) }
  if (acao === 'projeto-dispensar') return marcarProjeto({ acao: 'dispensar', grupo: id, desde: Number(botao.dataset.desde) }, { fechar: true })
  if (acao === 'projeto-repor') return marcarProjeto({ acao: 'repor', grupo: id })
  if (acao === 'projeto-importancia') return marcarProjeto({ acao: botao.dataset.sem ? 'com-importancia' : 'sem-importancia', grupo: id })
  if (acao === 'projeto-linha') return marcarProjeto({ acao: 'esconder-linha', grupo: id, texto: botao.dataset.texto })
  if (acao === 'projeto-repor-linhas') return marcarProjeto({ acao: 'repor-linhas', grupo: id })
  if (acao === 'nova-pasta') return comecarEdicao({ tipo: 'criar', pai: null })
  if (acao === 'nova-subpasta') return comecarEdicao({ tipo: 'criar', pai: id })
  if (acao === 'renomear-pasta') return comecarEdicao({ tipo: 'renomear', id })
  if (acao === 'apagar-pasta') { menu = null; desenharArvore(true); return dialogoApagarPasta(id) }
  if (acao === 'por-na-pasta') { menu = null; desenharArvore(true); return dialogoPorNaPasta(id) }
  if (acao === 'renomear-grupo') return comecarEdicao({ tipo: 'renomear', id })
  if (acao === 'nome-claude') { menu = null; return organizar({ acao: 'renomear-grupo', grupo: id, nome: null }) }
  if (acao === 'esconder-grupo') {
    menu = null
    if (vista.tipo === 'seccao' && vista.id === id) vista = { tipo: 'painel' }
    return organizar({ acao: 'esconder-grupo', grupo: id })
  }
  if (acao === 'mostrar-grupo') return organizar({ acao: 'mostrar-grupo', grupo: id })
  if (acao === 'ver-escondidos') { verEscondidos = !verEscondidos; return desenharArvore(true) }
  if (acao === 'novo-chat') return dialogoNovoChat()
  if (acao === 'nc-voltar') return passoTopicoDoChat()
  if (acao === 'criar-chat') return criarChat()
  if (acao === 'paleta') return abrirPaleta()
  if (acao === 'gravar-mensal') return gravarMensal()
  if (acao === 'taxa-bce') return taxaBce(botao)
  if (acao === 'editar-mensal' || acao === 'cancelar-mensal') {
    editarMensal = acao === 'editar-mensal'
    // Sem isto, o campo ainda em foco travava o redesenho (ver desenhar()).
    document.activeElement?.blur()
    desenhado.delete('vista-consumo')
    desenhar()
    return editarMensal && $('sub-mensal')?.focus()
  }
  if (acao === 'confirmar-apagar-pasta') {
    fecharDialogo()
    if (vista.tipo === 'seccao' && vista.id === id) vista = { tipo: 'painel' }
    return organizar({ acao: 'apagar-pasta', id })
  }
}

document.addEventListener('click', ev => {
  if (menu && !ev.target.closest('.menu, [data-menu]')) { menu = null; desenharArvore(true) }
  if (ev.target === $('veu')) return fecharDialogo()
  const alvo = ev.target.closest('[data-acao], [data-sel], [data-alternar], [data-ver], [data-menu], [data-mover-para], [data-dias], [data-dias-hist], [data-aba-consumo], [data-rep-consumo], [data-grupo-consumo], [data-vista], [data-pasta], [data-nc-no], [data-pal], [data-ir]')
  if (!alvo || alvo.disabled) return
  if (alvo.dataset.acao) return agir(alvo)
  if (alvo.dataset.pal) return correrPaleta(Number(alvo.dataset.pal), ev.ctrlKey)
  if ('ncNo' in alvo.dataset) return passoPastaDoChat(alvo.dataset.ncNo || null)
  if (alvo.dataset.pasta) {
    $('nc-pasta').value = alvo.dataset.pasta
    alvo.parentElement.querySelectorAll('.op.atual').forEach(op => op.classList.remove('atual'))
    alvo.classList.add('atual')
    return $('nc-texto').focus()
  }
  if ('moverPara' in alvo.dataset) {
    fecharDialogo()
    if (alvo.dataset.moverPara) abertas.add(alvo.dataset.moverPara)
    return organizar({ acao: 'mover-grupo', grupo: alvo.dataset.grupo, pasta: alvo.dataset.moverPara || null })
  }
  if (alvo.dataset.sel) return selecionar(alvo.dataset.sel)
  if (alvo.dataset.ver) return verSeccao(alvo.dataset.ver)
  if (alvo.dataset.menu) {
    menu = menu === alvo.dataset.menu ? null : alvo.dataset.menu
    desenharArvore(true)
    return $('arvore').querySelector('.menu')?.scrollIntoView({ block: 'nearest' })
  }
  if (alvo.dataset.alternar) {
    const id = alvo.dataset.alternar
    const linha = alvo.closest('.sec-l')
    if (linha.classList.contains('fechada')) { abertas.add(id); fechadas.delete(id) } else { abertas.delete(id); fechadas.add(id) }
    return desenharArvore(true)
  }
  if (alvo.dataset.dias) {
    diasConsumo = Number(alvo.dataset.dias)
    return estado && desenhar()
  }
  if (alvo.dataset.diasHist) {
    diasGrafico = Number(alvo.dataset.diasHist)
    return estado && desenhar()
  }
  if (alvo.dataset.repConsumo) {
    repConsumo = alvo.dataset.repConsumo
    return desenhar()
  }
  if (alvo.dataset.abaConsumo) {
    abaConsumo = alvo.dataset.abaConsumo
    document.activeElement?.blur()
    return estado && desenhar()
  }
  if (alvo.dataset.grupoConsumo) {
    const id = alvo.dataset.grupoConsumo
    if (!gruposAbertosConsumo.delete(id)) gruposAbertosConsumo.add(id)
    return estado && desenhar()
  }
  if (alvo.dataset.vista) return abrirConsumo()
  if (alvo.dataset.ir) {
    if (vista.tipo !== 'painel') { vista = { tipo: 'painel' }; if (estado) desenhar() }
    if (alvo.dataset.ir === 'topo') $('corpo').scrollTo({ top: 0, behavior: 'smooth' })
    else $(alvo.dataset.ir)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
})

document.addEventListener('input', ev => {
  const nsBusca = ev.target.dataset?.buscaNs
  if (nsBusca) {
    ctrl[nsBusca].busca = ev.target.value
    return redesenharControlos(nsBusca, ev.target.selectionStart ?? ev.target.value.length)
  }
  if (ev.target.id === 'pal-in') {
    paleta.itens = itensDaPaleta(ev.target.value)
    paleta.ativo = 0
    return desenharPaleta()
  }
  const f = ev.target.closest?.('[data-filtrar]')
  if (!f) return
  const termo = semAcentos(f.value.trim())
  for (const op of $('dialogo').querySelectorAll(`.${f.dataset.filtrar}`)) op.hidden = Boolean(termo) && !op.dataset.filtro?.includes(termo)
})

document.addEventListener('change', ev => {
  const nsOrdem = ev.target.dataset?.ordemNs
  if (nsOrdem) {
    ctrl[nsOrdem].ordem = ev.target.value
    guardarControlos()
    return redesenharControlos(nsOrdem)
  }
})

document.addEventListener('keydown', ev => {
  if (['sub-mensal', 'sub-taxa'].includes(ev.target.id) && ev.key === 'Enter') return gravarMensal()
  const ed = ev.target.closest?.('.ed')
  if (ed) {
    if (ev.key === 'Enter') { ev.preventDefault(); acabarEdicao(true) }
    if (ev.key === 'Escape') { ev.preventDefault(); acabarEdicao(false) }
    return
  }
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') {
    ev.preventDefault()
    return paleta ? fecharDialogo() : abrirPaleta()
  }
  if (paleta && ev.target.id === 'pal-in') {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault()
      paleta.ativo = (paleta.ativo + (ev.key === 'ArrowDown' ? 1 : -1) + paleta.itens.length) % Math.max(1, paleta.itens.length)
      return desenharPaleta()
    }
    if (ev.key === 'Enter') {
      ev.preventDefault()
      return correrPaleta(paleta.ativo, ev.ctrlKey || ev.metaKey)
    }
  }
  if (ev.key === 'Escape') {
    if (dialogoAberto()) return fecharDialogo()
    if (menu) { menu = null; return desenharArvore(true) }
    if (selecionado) return selecionar(null)
    if (vista.tipo !== 'painel') { vista = { tipo: 'painel' }; return estado && desenhar() }
  }
  if (dialogoAberto() || ev.target.closest?.('input, textarea')) return
  if (ev.key.toLowerCase() === 'o' && !ev.ctrlKey && !ev.altKey && !ev.metaKey && !$('orquestrador').disabled) return agir($('orquestrador'))
  if (ev.key.toLowerCase() === 'n' && !ev.ctrlKey && !ev.altKey && !ev.metaKey) return dialogoNovoChat()
  const alvo = ev.target.closest?.('[role="button"]')
  if (alvo && (ev.key === 'Enter' || ev.key === ' ')) {
    ev.preventDefault()
    alvo.click()
  }
})

// Sair do campo de nome grava (como num explorador de ficheiros); Esc cancela antes disto.
document.addEventListener('focusout', ev => {
  if (ev.target.closest?.('.ed') && edicao) setTimeout(() => { if (edicao) acabarEdicao(true) }, 0)
})

// ——— arrastar grupos e pastas ———
// Largar na borda de cima ou de baixo de uma linha põe antes ou depois dela (a ordem fica guardada
// no gestor); largar no meio de uma pasta põe lá dentro; largar em «Grupos do Claude» tira para o
// topo. A ordem e as pastas são só do gestor: no Claude não muda nada.

let marcado = null
let marcadoZona = null
let abrirAoPairar = null
const CLASSE_ZONA = { topo: 'alvo', dentro: 'alvo-dentro', antes: 'alvo-antes', depois: 'alvo-depois' }

function limparMarca() {
  marcado?.classList.remove('alvo-dentro', 'alvo', 'alvo-antes', 'alvo-depois')
  marcado = null
  marcadoZona = null
  clearTimeout(abrirAoPairar)
}

function zonaDeLargar(ev) {
  if (!arrastar) return undefined
  const cab = ev.target.closest?.('.gr')
  if (cab) return { el: cab, zona: 'topo' }
  const linha = ev.target.closest?.('.sec-l[data-no]')
  if (!linha || linha.dataset.no === arrastar.id) return undefined
  // Uma pasta não vai para dentro de si própria nem para perto do que tem dentro.
  if (arrastar.tipo === 'pasta' && document.querySelector(`.sec-l[data-no="${CSS.escape(arrastar.id)}"]`)?.closest('.no')?.contains(linha)) return undefined
  const caixa = linha.getBoundingClientRect()
  const y = (ev.clientY - caixa.top) / caixa.height
  const ePasta = linha.dataset.tipo === 'pasta'
  const zona = ePasta ? (y < 0.28 ? 'antes' : y > 0.72 ? 'depois' : 'dentro') : (y < 0.5 ? 'antes' : 'depois')

  return { el: linha, zona, id: linha.dataset.no, pai: linha.dataset.pai || null }
}

// A ordem dos irmãos tal como fica no ecrã depois de largar `quem` antes ou depois de `alvo`.
function irmaosDepoisDeLargar(pai, alvo, quem, zona) {
  const nos = pai ? acharNo(estado.arvore, pai)?.filhas ?? [] : estado.arvore
  const ids = nos.map(n => n.id).filter(id => id !== quem)
  const i = ids.indexOf(alvo)
  ids.splice(i < 0 ? ids.length : zona === 'antes' ? i : i + 1, 0, quem)

  return ids
}

document.addEventListener('dragstart', ev => {
  const linha = ev.target.closest?.('.sec-l[draggable="true"]')
  if (!linha) return
  arrastar = { tipo: linha.dataset.tipo, id: linha.dataset.no }
  ev.dataTransfer.setData(MIME_NO, arrastar.id)
  ev.dataTransfer.effectAllowed = 'move'
  document.body.classList.add('a-arrastar')
})

document.addEventListener('dragover', ev => {
  const z = zonaDeLargar(ev)
  if (!z) return limparMarca()
  ev.preventDefault()
  ev.dataTransfer.dropEffect = 'move'
  if (marcado !== z.el || marcadoZona !== z.zona) {
    limparMarca()
    marcado = z.el
    marcadoZona = z.zona
    marcado.classList.add(CLASSE_ZONA[z.zona])
    // Pairar sobre uma pasta fechada abre-a, para se poder largar numa pasta lá dentro.
    if (z.zona === 'dentro' && z.el.classList.contains('fechada')) {
      abrirAoPairar = setTimeout(() => { abertas.add(z.id); desenharArvore(true) }, 700)
    }
  }
})

document.addEventListener('drop', async ev => {
  const z = zonaDeLargar(ev)
  const quem = arrastar
  limparMarca()
  if (!z || !quem) return
  ev.preventDefault()
  arrastar = null
  document.body.classList.remove('a-arrastar')
  if (z.zona === 'antes' || z.zona === 'depois') {
    if (z.pai) abertas.add(z.pai)

    return organizar({ acao: 'posicionar', tipo: quem.tipo, no: quem.id, pai: z.pai, irmaos: irmaosDepoisDeLargar(z.pai, z.id, quem.id, z.zona) })
  }
  const destino = z.zona === 'topo' ? null : z.id
  if (destino) abertas.add(destino)
  if (quem.tipo === 'pasta') return organizar({ acao: 'mover-pasta', id: quem.id, pai: destino })

  return organizar({ acao: 'mover-grupo', grupo: quem.id, pasta: destino })
})

document.addEventListener('dragend', () => {
  limparMarca()
  if (!arrastar) return
  arrastar = null
  document.body.classList.remove('a-arrastar')
  desenharArvore(true)
})

$('r-recentes').onclick = () => {
  recentesTodos = !recentesTodos
  if (estado) desenhar()
}

function aplicarTema(tema) {
  document.documentElement.dataset.theme = tema
}
try { aplicarTema(localStorage.getItem('fila-tema') || 'dark') } catch {}
$('tema').onclick = () => {
  const tema = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
  aplicarTema(tema)
  try { localStorage.setItem('fila-tema', tema) } catch {}
}

// Largura da barra lateral: arrasta-se a borda; duplo clique repõe. Fica guardada neste browser.
const LADO = { min: 220, max: 520, padrao: 300 }
function porLargura(px) {
  const largura = Math.round(Math.min(LADO.max, Math.max(LADO.min, px)))
  document.documentElement.style.setProperty('--side-w', `${largura}px`)

  return largura
}
try { const guardada = Number(localStorage.getItem('fila-lado')); if (guardada) porLargura(guardada) } catch {}
$('puxador').addEventListener('pointerdown', ev => {
  ev.preventDefault()
  const puxador = ev.currentTarget
  puxador.setPointerCapture(ev.pointerId)
  document.body.classList.add('a-redimensionar')
  let largura = null
  const mover = e => { largura = porLargura(e.clientX) }
  const largar = () => {
    puxador.removeEventListener('pointermove', mover)
    document.body.classList.remove('a-redimensionar')
    if (largura) try { localStorage.setItem('fila-lado', String(largura)) } catch {}
  }
  puxador.addEventListener('pointermove', mover)
  puxador.addEventListener('pointerup', largar, { once: true })
  puxador.addEventListener('pointercancel', largar, { once: true })
})
$('puxador').addEventListener('dblclick', () => {
  porLargura(LADO.padrao)
  try { localStorage.removeItem('fila-lado') } catch {}
})

document.addEventListener('visibilitychange', () => { if (!document.hidden) atualizar() })
setInterval(atualizar, INTERVALO)
atualizar()
