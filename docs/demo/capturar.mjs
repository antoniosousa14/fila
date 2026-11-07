#!/usr/bin/env node
// Tira as capturas do README com os dados de demonstração (docs/demo/gerar-demo.mjs).
//
//   node docs/demo/capturar.mjs --demo <pasta-da-demo> --saida docs/capturas [--exe <NextUp.exe>]
//
// Precisa de um gestor a correr com as variáveis NEXTUP_* da demonstração (o `gerar-demo.mjs` imprime-as;
// a porta lê-se de <pasta-da-demo>\nextup\gestor.json) e do Microsoft Edge. O Edge corre sem janela,
// com um perfil novo e à parte, e é guiado pelo protocolo de depuração (sem dependências). Com --exe
// (um NextUp.exe) tira também a pílula e o quadro com `NextUp.exe --previsao`, que só lê o barra.json
// da demonstração e escreve dois PNG: não mexe no mutex, no guardião nem nos dados reais.
import { execFile, spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const executar = promisify(execFile)
const argumentos = Object.fromEntries(process.argv.slice(2).reduce((l, x, i, a) => (x.startsWith('--') ? [...l, [x.slice(2), a[i + 1]]] : l), []))
if (!argumentos.demo || !argumentos.saida) {
  console.error('Uso: node docs/demo/capturar.mjs --demo <pasta-da-demo> --saida <pasta-das-imagens> [--exe <NextUp.exe>] [--edge <msedge.exe>]')
  process.exit(1)
}
const demo = resolve(argumentos.demo)
const saida = resolve(argumentos.saida)
const LARGURA = 1440
const ALTURA = 900
const pausa = ms => new Promise(r => setTimeout(r, ms))

const edge = argumentos.edge ?? [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(existsSync)
if (!edge) throw new Error('Não encontrei o Microsoft Edge: indica-o com --edge')

const { porta } = JSON.parse(await readFile(join(demo, 'nextup', 'gestor.json'), 'utf8'))
const base = `http://127.0.0.1:${porta}`
await mkdir(saida, { recursive: true })

// ——— Edge sem janela, guiado pelo protocolo de depuração ———

const perfil = await mkdtemp(join(tmpdir(), 'nextup-captura-'))
const portaCdp = 9333 + Math.floor(Math.random() * 500)
const navegador = spawn(edge, [
  '--headless=new', `--remote-debugging-port=${portaCdp}`, `--user-data-dir=${perfil}`, '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check', `--window-size=${LARGURA},${ALTURA}`, 'about:blank',
], { stdio: 'ignore' })

async function pagina() {
  for (let i = 0; i < 60; i++) {
    try {
      const alvos = await (await fetch(`http://127.0.0.1:${portaCdp}/json`)).json()
      const alvo = alvos.find(a => a.type === 'page')
      if (alvo) return alvo.webSocketDebuggerUrl
    } catch { /* o Edge ainda está a arrancar */ }
    await pausa(250)
  }
  throw new Error('O Edge não respondeu')
}

async function ligar(url) {
  const ws = new WebSocket(url)
  const pendentes = new Map()
  let n = 0
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data)
    const p = pendentes.get(m.id)
    if (!p) return
    pendentes.delete(m.id)
    if (m.error) p.rejeitar(new Error(m.error.message))
    else p.resolver(m.result)
  }
  await new Promise((ok, falha) => { ws.onopen = ok; ws.onerror = falha })

  return {
    cmd: (metodo, params = {}) => new Promise((resolver, rejeitar) => {
      const id = ++n
      pendentes.set(id, { resolver, rejeitar })
      ws.send(JSON.stringify({ id, method: metodo, params }))
    }),
    fechar: () => ws.close(),
  }
}

try {
  const cdp = await ligar(await pagina())
  const avaliar = async expressao => {
    const r = await cdp.cmd('Runtime.evaluate', { expression: expressao, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(`${expressao}\n${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)

    return r.result.value
  }
  const esperar = async (condicao, ms = 20_000) => {
    for (const inicio = Date.now(); Date.now() - inicio < ms;) {
      if (await avaliar(`Boolean(${condicao})`).catch(() => false)) return
      await pausa(150)
    }
    throw new Error(`Esgotou o tempo à espera de: ${condicao}`)
  }
  const clicar = seletor => avaliar(`document.querySelector(${JSON.stringify(seletor)}).click()`)
  const foto = async nome => {
    await avaliar('document.fonts.ready.then(() => true)')
    await pausa(500)
    const { data } = await cdp.cmd('Page.captureScreenshot', { format: 'png' })
    await writeFile(join(saida, nome), Buffer.from(data, 'base64'))
    console.log(`  ${nome}`)
  }

  await cdp.cmd('Page.enable')
  await cdp.cmd('Emulation.setDeviceMetricsOverride', { width: LARGURA, height: ALTURA, deviceScaleFactor: 1, mobile: false })
  await cdp.cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
  await cdp.cmd('Page.navigate', { url: base })
  await esperar('document.querySelectorAll("#espera .lin").length > 0')
  // O fundo do gestor tem um grão de ruído quase invisível (body::before) que faz os PNG passar dos
  // 600 KB; sem ele ficam abaixo dos 400 KB e a leitura é igual.
  await avaliar('document.head.append(Object.assign(document.createElement("style"), { textContent: "body::before{display:none!important}" })), true')
  // A primeira vez as linhas entram com animação; a ficha do primeiro à espera abre sozinha.
  await pausa(2500)
  const estado = await (await fetch(`${base}/api/estado`)).json()
  const projetos = (await (await fetch(`${base}/api/projetos`)).json()).projetos
  const fecharFicha = () => avaliar('document.querySelector("#ficha [data-acao=fechar]")?.click(), true')

  console.log('Capturas do gestor:')
  // Painel, sem a ficha, para a fila e os chats a trabalhar terem a largura toda.
  await fecharFicha()
  await esperar('document.querySelector("#app").classList.contains("fechado")')
  await foto('painel.png')

  // Ficha de um chat à espera (o primeiro da fila): o cartão da IA, a importância, o esforço…
  await clicar('#espera .lin')
  await esperar('document.querySelector("#ficha .det-corpo")')
  await foto('ficha.png')
  await fecharFicha()

  // Projetos: abrir a pasta de topo mostra um quadrado por projeto, organizados pelas subpastas.
  const pasta = estado.arvore.find(n => n.tipo === 'pasta')
  await clicar(`[data-ver="${pasta.id}"]`)
  await esperar(`document.querySelectorAll(".projetos article.pj").length === ${projetos.length}`)
  await pausa(600)
  await avaliar('document.querySelector(".pj-pasta")?.scrollIntoView({ block: "start" }), document.getElementById("corpo").scrollBy(0, -86), true')
  await foto('projetos.png')

  // O detalhe de um quadrado: o projeto esquecido (parado há mais de 7 dias, com coisas por fazer).
  const esquecido = projetos.find(p => p.esquecido) ?? projetos[0]
  await clicar(`article.pj[data-id="${esquecido.id}"]`)
  await esperar('!document.getElementById("veu").hidden')
  await foto('projeto-detalhe.png')
  await clicar('[data-acao="fechar-dialogo"]')

  // Consumo: histórico, subscrição, limites e previsão.
  await avaliar('document.getElementById("corpo").scrollTo(0, 0), true')
  await clicar('#ir-consumo')
  await esperar('document.querySelector("#vista-consumo .destaque")')
  await pausa(800)
  await foto('consumo.png')

  cdp.fechar()
} finally {
  // Só o Edge que arrancámos: o processo lançado sai logo e o navegador real fica noutro PID, por
  // isso procura-se pelo perfil novo (única pasta temporária) e mata-se essa árvore, nunca outro Edge.
  const procurar = `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${perfil.replace(/'/g, "''")}*' -and $_.CommandLine -notlike '*--type=*' } | ForEach-Object { taskkill /PID $_.ProcessId /T /F | Out-Null }`
  await executar('powershell', ['-NoProfile', '-Command', procurar]).catch(() => {})
  navegador.kill()
  await rm(perfil, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => {})
}

// ——— pílula e quadro: NextUp.exe --previsao <pasta> <barra.json> ———

if (argumentos.exe) {
  console.log('Pílula e quadro:')
  const temp = await mkdtemp(join(tmpdir(), 'nextup-previsao-'))
  try {
    await executar(resolve(argumentos.exe), ['--previsao', temp, join(demo, 'nextup', 'barra.json')], { timeout: 60_000 })
    for (const nome of ['pilula.png', 'quadro.png']) {
      await copyFile(join(temp, nome), join(saida, nome))
      console.log(`  ${nome}`)
    }
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(() => {})
  }
}
