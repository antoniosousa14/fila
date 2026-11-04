#!/usr/bin/env node
// Dados de demonstração 100 % fictícios para correr o gestor (e a pílula) sem tocar nos dados reais.
//
//   node docs/demo/gerar-demo.mjs <pasta-de-destino>
//
// Escreve em <pasta-de-destino> a mesma estrutura que o Claude e o mod deixam no disco (sessões da
// app, grupos, itens, barra.json, situação, consumo e transcrições) e imprime as variáveis
// FILA_RAIZ, FILA_SESSOES, FILA_CONFIG_APP e FILA_PROJETOS que fazem o gestor ler esta pasta em vez
// dos dados reais. As horas são relativas a Date.now() (um chat à espera há 38 min fica à espera há
// 38 min no momento em que corres o gerador), por isso gera-se de novo antes de cada utilização.
//
// Nada daqui vem de %USERPROFILE%\.claude nem de %APPDATA%\Claude: os projetos (Loja Aurora, App
// Horizonte, Painel Farol, Blog Maré), os chats e os textos são inventados.
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'

const MIN = 60_000
const H = 60 * MIN
const DIA = 24 * H
const MARCA = '.dados-de-demonstracao'
const ESCOPO = 'demo-conta/demo-org'

// ——— argumentos e proteções ———

const casa = process.env.USERPROFILE || homedir()
const PROTEGIDAS = [
  join(casa, '.claude'),
  join(process.env.APPDATA || join(casa, 'AppData', 'Roaming'), 'Claude'),
  join(process.env.LOCALAPPDATA || join(casa, 'AppData', 'Local'), 'Fila'),
]
const dentroDe = (p, pai) => {
  const a = resolve(p).toLowerCase()
  const b = resolve(pai).toLowerCase()

  return a === b || a.startsWith(b + sep)
}

function falhar(texto) {
  console.error(texto)
  process.exit(1)
}

if (!process.argv[2] || process.argv[2].startsWith('-')) {
  falhar('Uso: node docs/demo/gerar-demo.mjs <pasta-de-destino>\n\nA pasta tem de estar vazia (ou ser uma pasta de demonstração de uma execução anterior).')
}
const destino = resolve(process.argv[2])
if (PROTEGIDAS.some(p => dentroDe(destino, p))) falhar(`Recusei: ${destino} está numa pasta de dados reais do Claude ou da Fila. Escolhe outra pasta.`)
const existentes = await readdir(destino).catch(() => null)
if (existentes?.length && !existentes.includes(MARCA)) falhar(`Recusei: ${destino} não está vazia e não é uma pasta de demonstração. Escolhe outra pasta ou uma vazia.`)
for (const nome of existentes ?? []) await rm(join(destino, nome), { recursive: true, force: true })

const pasta = {
  raiz: join(destino, 'fila'),
  sessoes: join(destino, 'sessoes'),
  config: join(destino, 'claude_desktop_config.json'),
  projetos: join(destino, 'projetos'),
}
pasta.itens = join(pasta.raiz, 'itens')
pasta.situacao = join(pasta.raiz, 'situacao')
pasta.consumo = join(pasta.raiz, 'consumo')
pasta.contaOrg = join(pasta.sessoes, ...ESCOPO.split('/'))

// ——— ajudantes ———

const agora = Date.now()
const antes = ms => agora - ms
const iso = ms => new Date(ms).toISOString()
const dois = n => String(n).padStart(2, '0')
const diaLocal = ms => { const d = new Date(ms); return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}` }
const meiaNoite = ms => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() }
const nomeDaPasta = cwd => cwd.split('\\').filter(Boolean).pop()

// Tudo determinístico: os ids e o aspeto dos dados são os mesmos em cada execução.
function uuid(nome) {
  const h = createHash('md5').update(`fila-demo:${nome}`).digest('hex')

  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

function prng(texto) {
  let a = parseInt(createHash('md5').update(`fila-demo:${texto}`).digest('hex').slice(0, 8), 16)

  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const escrever = async (caminho, conteudo) => {
  await mkdir(dirname(caminho), { recursive: true })
  await writeFile(caminho, typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo))
}

// ——— projetos (grupos do Claude), pastas do gestor e chats ———

const PROJETOS = {
  aurora: { nome: 'Loja Aurora', cwd: 'C:\\Demo\\Loja-Aurora', pasta: 'clientes', ordem: 1 },
  horizonte: { nome: 'App Horizonte', cwd: 'C:\\Demo\\App-Horizonte', pasta: 'produtos', ordem: 2 },
  farol: { nome: 'Painel Farol', cwd: 'C:\\Demo\\Painel-Farol', pasta: 'produtos', ordem: 3 },
  mare: { nome: 'Blog Maré', cwd: 'C:\\Demo\\Blog-Mare', pasta: 'clientes', ordem: 4 },
}
const PASTAS = [
  { id: 'p_estudio', nome: 'Estúdio', pai: null },
  { id: 'p_clientes', nome: 'Clientes', pai: 'p_estudio' },
  { id: 'p_produtos', nome: 'Produtos', pai: 'p_estudio' },
]

const OPUS = 'claude-opus-5-5'
const SONNET = 'claude-sonnet-5-5'
const HAIKU = 'claude-haiku-5-5'
const FABLE = 'claude-fable-5-1'

// estado: 'espera' (acabou o turno e espera por ti), 'trabalho' (turno a meio) ou 'parado'.
// pedidoMin: há quantos minutos escreveste o último pedido; fimMin: há quantos minutos o turno acabou.
const CHATS = [
  {
    id: 'A1', projeto: 'aurora', titulo: 'Pagamento com MB Way no checkout', estado: 'espera', criadoDias: 6, peso: 1.2,
    pedidoMin: 47, fimMin: 38, modelos: [[OPUS, 0.85], [HAIKU, 0.15]],
    pedido: 'Liga o checkout ao MB Way pela SIBS Gateway, em ambiente de testes, e garante que o pedido só fica pago quando chega o webhook.',
    resposta: 'O checkout já paga com MB Way em ambiente de testes e o pedido só passa a «pago» quando o webhook da SIBS chega. Os 18 testes novos passam. Falta a tua aprovação para publicar em produção.',
    resumoApp: 'Checkout com MB Way pronto em ambiente de testes.',
    classificacao: {
      importancia: 5, tipo: 'aprovacao', esforco: 'segundos', desbloqueia: true, rotulo: 'Deploy do checkout',
      cartao: {
        pediste: 'Pagar com MB Way no checkout, confirmando o pedido só pelo webhook da SIBS.',
        fez: 'Integrou a SIBS Gateway em testes, validou o webhook e escreveu 18 testes que passam.',
        precisa: 'Aprovar o deploy do checkout com MB Way para produção.',
      },
    },
    plano: [['Ligar a SIBS Gateway em testes', 'completed'], ['Validar a assinatura do webhook', 'completed'], ['Escrever os testes do fluxo de pagamento', 'completed'], ['Publicar em produção', 'pending']],
    feito: [['Integração com a SIBS Gateway em ambiente de testes', 190], ['Webhook de confirmação validado com assinatura', 120], ['18 testes novos para o fluxo de pagamento', 52]],
    falta: [['Testar um reembolso parcial por MB Way', 4], ['Atualizar os termos e condições com o novo método', 2], ['Acompanhar os primeiros pagamentos em produção', 3]],
  },
  {
    id: 'A2', projeto: 'aurora', titulo: 'Importação do catálogo de produtos', estado: 'trabalho', criadoDias: 3, peso: 1.4,
    pedidoMin: 14, modelos: [[SONNET, 0.8], [HAIKU, 0.2]],
    pedido: 'Importa o catálogo novo (um CSV com 1 238 produtos) para a loja, validando preços, IVA e imagens antes de gravar.',
    resposta: 'O esquema do catálogo está desenhado: produto, variante e imagem, com o IVA em cada linha.',
    passos: [['Ler e validar o ficheiro CSV de produtos', 'completed'], ['Corrigir os preços sem IVA', 'completed'], ['Importar os produtos em lotes de 100', 'in_progress'], ['Gerar as miniaturas das imagens', 'pending'], ['Mapear as categorias antigas para as novas', 'pending'], ['Escrever os testes da importação', 'pending']],
    ferramentas: 23, ultima: 'Bash node importar.mjs --lote 4',
    feito: [['Esquema de produto, variante e imagem desenhado', 600], ['Ficheiro CSV lido e validado (1 238 linhas)', 18]],
    falta: [['Importar os produtos em lotes de 100', 5], ['Mapear as categorias antigas para as novas', 4], ['Gerar as miniaturas das imagens', 3], ['Escrever os testes da importação', 3]],
  },
  {
    id: 'A3', projeto: 'aurora', titulo: 'Páginas de categoria e SEO', estado: 'trabalho', criadoDias: 12, peso: 0.9,
    pedidoMin: 21, modelos: [[SONNET, 0.85], [HAIKU, 0.15]],
    pedido: 'Reescreve os títulos e as descrições das categorias para SEO e gera o sitemap.',
    resposta: 'As 14 categorias já têm título e descrição únicos; falta o sitemap e os conteúdos duplicados.',
    passos: [['Auditar os títulos e as descrições atuais', 'completed'], ['Reescrever títulos e descrições das 14 categorias', 'completed'], ['Gerar o sitemap.xml', 'in_progress'], ['Corrigir as páginas com conteúdo duplicado', 'pending'], ['Adicionar dados estruturados de produto', 'pending']],
    ferramentas: 17, ultima: 'Bash npm run sitemap',
    feito: [['Títulos e descrições de 14 categorias reescritos', 15]],
    falta: [['Gerar o sitemap e submetê-lo ao Google', 4], ['Corrigir as páginas com conteúdo duplicado', 3], ['Adicionar dados estruturados de produto', 2]],
  },
  {
    id: 'B1', projeto: 'horizonte', titulo: 'Login com biometria', estado: 'espera', criadoDias: 5, peso: 1,
    pedidoMin: 83, fimMin: 72, modelos: [[OPUS, 0.7], [FABLE, 0.12], [HAIKU, 0.18]],
    pedido: 'Vê como pôr login biométrico na app e diz-me qual é a melhor opção.',
    resposta: 'Comparei as duas opções: a biometria nativa do sistema, com menos código e menos risco, e uma biblioteca própria, com mais controlo mas mais manutenção. Recomendo a nativa.',
    resumoApp: 'Duas opções de login biométrico comparadas.',
    classificacao: {
      importancia: 4, tipo: 'decisao', esforco: 'minutos', desbloqueia: true, rotulo: 'Escolher biometria',
      cartao: {
        pediste: 'Pôr login biométrico na app e saber qual é a melhor opção.',
        fez: 'Testou a biometria nativa em 3 dispositivos e comparou-a com uma biblioteca própria.',
        precisa: 'Escolher entre biometria nativa e biblioteca própria.',
      },
    },
    feito: [['Biometria nativa testada em 3 dispositivos', 85], ['Comparação das duas opções escrita', 75]],
    falta: [['Guardar o token de sessão no cofre do sistema', 4], ['Voltar ao PIN depois de 3 falhas seguidas', 3]],
  },
  {
    id: 'B2', projeto: 'horizonte', titulo: 'Revisão do onboarding', estado: 'espera', criadoDias: 8, peso: 0.9,
    pedidoMin: 139, fimMin: 125, modelos: [[OPUS, 0.8], [HAIKU, 0.2]],
    pedido: 'Redesenha o onboarding da app em quatro ecrãs, mais curtos, com a escolha de interesses no fim.',
    resposta: 'O novo onboarding tem quatro ecrãs: boas-vindas, permissões, interesses e conclusão. Está no ramo onboarding-v2, pronto a rever.',
    resumoApp: 'Novo onboarding em quatro ecrãs pronto a rever.',
    classificacao: {
      importancia: 3, tipo: 'revisao', esforco: 'minutos', desbloqueia: false, rotulo: 'Rever onboarding',
      cartao: {
        pediste: 'Encurtar o onboarding para quatro ecrãs, com a escolha de interesses no fim.',
        fez: 'Redesenhou os quatro ecrãs e abriu o ramo onboarding-v2.',
        precisa: 'Rever os quatro ecrãs e dizer o que mudar.',
      },
    },
    plano: [['Desenhar os quatro ecrãs', 'completed'], ['Ligar o fluxo completo', 'completed'], ['Traduzir os textos para inglês', 'pending']],
    feito: [['Quatro ecrãs do novo onboarding desenhados', 150], ['Ramo onboarding-v2 aberto com o fluxo completo', 128]],
    falta: [['Traduzir os textos do onboarding para inglês', 2], ['Medir quantos utilizadores chegam ao último ecrã', 3]],
  },
  {
    id: 'B3', projeto: 'horizonte', titulo: 'Notificações push', estado: 'trabalho', criadoDias: 2, peso: 1.3, semSituacao: true,
    pedidoMin: 6, modelos: [[SONNET, 0.85], [HAIKU, 0.15]],
    pedido: 'Implementa as notificações push para os lembretes diários, com o horário escolhido pelo utilizador.',
    resposta: 'O ecrã de definições já guarda o horário dos lembretes.',
    passos: [['Configurar o serviço de notificações', 'completed'], ['Guardar o horário escolhido pelo utilizador', 'completed'], ['Agendar o lembrete diário', 'completed'], ['Tratar a permissão negada', 'in_progress'], ['Escrever os testes', 'pending']],
    ferramentas: 31, ultima: 'Edit LembretesService.kt',
  },
  {
    id: 'D1', projeto: 'farol', titulo: 'Relatório de erros semanal', estado: 'espera', criadoDias: 15, peso: 0.8,
    pedidoMin: 4627, fimMin: 4620, modelos: [[HAIKU, 0.45], [SONNET, 0.55]],
    pedido: 'Gera o relatório semanal de erros do painel e resume o que mudou face à semana passada.',
    resposta: 'Esta semana houve 47 erros, menos 12 do que na anterior, e 3 são novos. Nenhum afeta o painel das vendas.',
    resumoApp: 'Relatório semanal de erros gerado.',
    classificacao: {
      importancia: 2, tipo: 'info', esforco: 'segundos', desbloqueia: false, rotulo: 'Relatório de erros',
      cartao: {
        pediste: 'Resumir os erros da semana face à anterior.',
        fez: 'Gerou o relatório: 47 erros, menos 12 do que na semana passada, 3 novos.',
        precisa: 'Ler o resumo; não há nada a decidir.',
      },
    },
    feito: [['Relatório de erros da semana gerado (47 erros, 3 novos)', 4622]],
    falta: [['Silenciar os erros de rede já conhecidos', 2], ['Enviar o relatório para o canal da equipa', 3]],
  },
  {
    id: 'D2', projeto: 'farol', titulo: 'Exportar vendas para CSV', estado: 'parado', criadoDias: 14, peso: 0.8,
    pedidoMin: 5880, fimMin: 5874, modelos: [[SONNET, 0.85], [HAIKU, 0.15]],
    pedido: 'Cria a exportação de vendas para CSV, por dia, com o total e o IVA.',
    resposta: 'A exportação diária já funciona e gera um ficheiro por dia com o total e o IVA. Falta a exportação por categoria e aguentar ficheiros grandes.',
    resumoApp: 'Exportação diária de vendas a funcionar; faltam as categorias.',
    plano: [['Exportação de vendas por dia', 'completed'], ['Total e IVA em cada linha', 'completed'], ['Exportação por categoria', 'pending'], ['Ficheiros com mais de 100 000 linhas', 'pending']],
    feito: [['Exportação CSV de vendas por dia', 5890], ['Total e IVA em cada linha do ficheiro', 5880]],
    falta: [['Exportar também por categoria', 3], ['Aguentar ficheiros com mais de 100 000 linhas', 4], ['Documentar o formato do ficheiro', 1]],
  },
  {
    id: 'C1', projeto: 'mare', titulo: 'Newsletter semanal', estado: 'parado', criadoDias: 20, peso: 0.7,
    pedidoMin: 13080, fimMin: 13074, modelos: [[SONNET, 0.9], [HAIKU, 0.1]],
    pedido: 'Prepara o modelo da newsletter semanal e importa a lista de subscritores.',
    resposta: 'O modelo de e-mail está criado e importei 312 subscritores. Falta escrever a edição de estreia e ligar o envio automático às terças.',
    resumoApp: 'Modelo da newsletter criado e subscritores importados.',
    plano: [['Criar o modelo de e-mail', 'completed'], ['Importar os subscritores', 'completed'], ['Escrever a edição de estreia', 'pending'], ['Ligar o envio automático às terças', 'pending']],
    feito: [['Modelo de e-mail da newsletter criado', 13100], ['Lista de 312 subscritores importada', 13085]],
    falta: [['Escrever a edição de estreia', 4], ['Configurar o envio automático às terças', 3], ['Testar o modelo no Outlook e no Gmail', 2]],
  },
  {
    id: 'C2', projeto: 'mare', titulo: 'Migração para o tema novo', estado: 'parado', criadoDias: 18, peso: 0.7,
    pedidoMin: 16080, fimMin: 16072, modelos: [[OPUS, 0.7], [HAIKU, 0.3]],
    pedido: 'Instala o tema novo num ambiente de testes e vê o que se parte nos artigos antigos.',
    resposta: 'O tema novo está num ambiente de testes. Dos 38 artigos antigos, 9 têm imagens ou ligações partidas e ainda não os corrigi.',
    resumoApp: 'Tema novo em testes; 9 artigos antigos com problemas.',
    plano: [['Instalar o tema novo em testes', 'completed'], ['Migrar os 38 artigos antigos', 'pending'], ['Corrigir as ligações internas', 'pending'], ['Trocar o tema em produção', 'pending']],
    feito: [['Tema novo instalado num ambiente de testes', 16090]],
    falta: [['Migrar os 38 artigos antigos para o tema novo', 4], ['Rever as ligações internas partidas', 3], ['Trocar o tema em produção', 5]],
  },
]

// ——— transcrições e consumo ———

const precos = JSON.parse(await readFile(join(import.meta.dirname, '..', '..', 'gestor', 'precos.json'), 'utf8')).modelos
const custoDe = (modelo, u) => {
  const p = precos[modelo]

  return ((u.input_tokens * p.entrada) + (u.output_tokens * p.saida) + (u.cache_creation.ephemeral_5m_input_tokens * p.cache5m) + (u.cache_creation.ephemeral_1h_input_tokens * p.cache1h) + (u.cache_read_input_tokens * p.leitura)) / 1e6
}

// Pedidos e respostas genéricos dos turnos antigos (só o fim da transcrição se vê no gestor).
const PEDIDOS = ['Continua a partir daí.', 'Corre os testes e corrige o que falhar.', 'Mostra-me o diff antes de avançares.', 'Faz um commit com o que está pronto.', 'Explica-me o que mudaste e porquê.', 'Procura outros sítios onde isto se repete.', 'Simplifica esta parte sem mudar o comportamento.', 'Vê se há erros no registo e diz-me o que encontraste.']
const RESPOSTAS = ['Feito. Os testes passam e o diff está pronto para rever.', 'Corrigi o que falhava e voltei a correr os testes: tudo verde.', 'Encontrei duas ocorrências parecidas e tratei-as da mesma maneira.', 'Simplifiquei a função e o comportamento mantém-se; os testes confirmam.', 'Fiz o commit com as alterações prontas e deixei o resto por tratar.', 'O registo mostra um aviso antigo, sem relação com o que estamos a fazer.']
const FICHEIROS = ['index.ts', 'servico.ts', 'rotas.ts', 'testes.ts', 'utilidades.ts', 'config.ts']
const COMANDOS = ['npm test', 'git diff --stat', 'npm run lint', 'git status --short']

const sorteio = (r, lista) => lista[Math.floor(r() * lista.length)]
function modeloDe(r, pesos) {
  let x = r() * pesos.reduce((s, [, p]) => s + p, 0)
  for (const [m, p] of pesos) if ((x -= p) <= 0) return m

  return pesos[0][0]
}

// Um ficheiro .jsonl por sessão do CLI; a ordem das chaves é a das transcrições reais (o leitor
// do histórico procura os campos por esta ordem).
class Transcricao {
  constructor(cli, cwd) {
    this.cli = cli
    this.cwd = cwd
    this.linhas = []
    this.ultimo = null
  }

  pessoa(ts, texto) {
    const uuidLinha = uuid(`${this.cli}:${this.linhas.length}`)
    this.linhas.push(JSON.stringify({ parentUuid: this.ultimo, isSidechain: false, type: 'user', message: { role: 'user', content: texto }, uuid: uuidLinha, timestamp: iso(ts), turnOrigin: 'human', cwd: this.cwd, sessionId: this.cli }))
    this.ultimo = uuidLinha
  }

  assistente(ts, modelo, conteudo, parada, uso) {
    const uuidLinha = uuid(`${this.cli}:${this.linhas.length}`)
    this.linhas.push(JSON.stringify({ parentUuid: this.ultimo, isSidechain: false, message: { model: modelo, id: `msg_${uuidLinha.replace(/-/g, '').slice(0, 24)}`, type: 'message', role: 'assistant', content: conteudo, stop_reason: parada, usage: uso }, requestId: `req_${uuidLinha.slice(0, 8)}`, type: 'assistant', uuid: uuidLinha, timestamp: iso(ts), cwd: this.cwd, sessionId: this.cli }))
    this.ultimo = uuidLinha
  }

  texto() {
    return `${this.linhas.join('\n')}\n`
  }
}

// Intensidade geral do uso (multiplica os tokens por resposta). Calibrada para que o custo
// equivalente na API de um mês de trabalho fique bem acima dos 110 € da subscrição.
const INTENSIDADE = 2.6

// Um turno: o pedido e as respostas do Claude (chamadas a ferramentas e, no fim, o texto). Devolve o
// que o mod registaria no fim do turno (tokens, cache e custo) para a aba Consumo.
function turno({ r, t, inicio, fim, pedido, resposta, modelos, plano, terminou = true, ficheiro }) {
  t.pessoa(inicio, pedido)
  const n = Math.min(40, Math.max(4, Math.round((fim - inicio) / 18_000)))
  const passo = (fim - inicio) / (n + 1)
  let leitura = (28_000 + r() * 70_000) * INTENSIDADE
  const total = { tokens: 0, cache: 0, custo: 0 }
  for (let i = 0; i < n; i++) {
    const modelo = modeloDe(r, modelos)
    const haiku = modelo === HAIKU
    const criacao = Math.floor((i === 0 ? 9_000 + r() * 18_000 : r() < 0.65 ? 700 + r() * 9_000 : 0) * INTENSIDADE * (haiku ? 0.3 : 1))
    const saida = Math.floor((120 + r() ** 2 * 2_600) * (haiku ? 0.5 : 1))
    const lida = Math.floor(haiku ? 4_000 + r() * 36_000 : leitura)
    leitura += (2_000 + r() * 5_000) * INTENSIDADE
    const uso = {
      input_tokens: Math.floor(2 + r() * 40),
      output_tokens: saida,
      cache_creation_input_tokens: criacao,
      cache_read_input_tokens: lida,
      cache_creation: { ephemeral_5m_input_tokens: Math.floor(criacao * 0.7), ephemeral_1h_input_tokens: criacao - Math.floor(criacao * 0.7) },
    }
    total.tokens += uso.input_tokens + uso.output_tokens + criacao
    total.cache += lida
    total.custo += custoDe(modelo, uso)
    const ultima = i === n - 1 && terminou
    let conteudo
    if (ultima) conteudo = [{ type: 'text', text: resposta }]
    else if (i === 1 && plano) conteudo = [{ type: 'tool_use', id: `toolu_${uuid(`${t.cli}:plano:${inicio}`).slice(0, 12)}`, name: 'TodoWrite', input: { todos: plano.map(([content, status]) => ({ content, status, activeForm: content })) } }]
    else {
      const x = r()
      const entrada = x < 0.5 ? { file_path: `${t.cwd}\\src\\${ficheiro ?? sorteio(r, FICHEIROS)}` } : { command: sorteio(r, COMANDOS) }
      conteudo = [{ type: 'tool_use', id: `toolu_${uuid(`${t.cli}:${t.linhas.length}`).slice(0, 12)}`, name: x < 0.25 ? 'Read' : x < 0.5 ? 'Edit' : 'Bash', input: entrada }]
    }
    t.assistente(inicio + passo * (i + 1) + (r() - 0.5) * passo * 0.4, modelo, conteudo, ultima ? 'end_turn' : 'tool_use', uso)
  }

  return { em: fim, sessao: t.cli, ...total }
}

// Os turnos antigos de um chat (dias de trabalho entre a criação e o último pedido).
function turnosAntigos(r, chat, limite) {
  const lista = []
  for (let dia = chat.criadoDias; dia >= 0; dia--) {
    const base = meiaNoite(antes(dia * DIA))
    const fimDeSemana = [0, 6].includes(new Date(base).getDay())
    if (r() > (fimDeSemana ? 0.2 : 0.82)) continue
    const quantos = 3 + Math.floor(r() * 7 * chat.peso)
    for (let i = 0; i < quantos; i++) {
      // Trabalha-se em blocos (manhã, tarde e, às vezes, noite): é o que dá horas de uso ativo.
      const bloco = r()
      const hora = bloco < 0.45 ? 9.5 + r() * 3 : bloco < 0.92 ? 14.5 + r() * 4 : 21 + r() * 2
      const inicio = base + hora * H
      const duracao = (3 + r() * 8) * MIN
      if (inicio < antes(chat.criadoDias * DIA) || inicio + duracao > limite) continue
      lista.push({ inicio, fim: inicio + duracao })
    }
  }
  lista.sort((a, b) => a.inicio - b.inicio)
  // Sem turnos sobrepostos no mesmo chat.
  const livres = []
  for (const x of lista) if (!livres.length || x.inicio > livres.at(-1).fim + 3 * MIN) livres.push(x)

  return livres
}

const eventos = []
const ficheiros = []

function transcreverChat(chat) {
  const r = prng(`chat:${chat.id}`)
  const cwd = PROJETOS[chat.projeto].cwd
  const inicioUltimo = antes(chat.pedidoMin * MIN)
  const fimUltimo = chat.estado === 'trabalho' ? antes(40_000) : antes(chat.fimMin * MIN)
  const antigos = turnosAntigos(r, chat, inicioUltimo - 12 * MIN)
  // Um chat com mais de 10 dias já passou por duas sessões do CLI (a app troca-a ao retomar).
  const clis = chat.criadoDias >= 10 ? [uuid(`cli:${chat.id}:0`), uuid(`cli:${chat.id}:1`)] : [uuid(`cli:${chat.id}:1`)]
  const ts = clis.map(c => new Transcricao(c, cwd))
  const corte = clis.length > 1 && antigos.length ? antigos[Math.floor(antigos.length / 2)].inicio : Infinity
  antigos.forEach((x, i) => {
    const t = ts[clis.length > 1 && x.inicio < corte ? 0 : clis.length - 1]
    const ultimoAntigo = i === antigos.length - 1
    // Num chat a trabalhar, o último texto da transcrição é o do turno anterior ao que está a decorrer.
    const resposta = ultimoAntigo && chat.estado === 'trabalho' ? chat.resposta : sorteio(r, RESPOSTAS)
    eventos.push(turno({ r, t, inicio: x.inicio, fim: x.fim, pedido: sorteio(r, PEDIDOS), resposta, modelos: chat.modelos }))
  })
  const atual = ts.at(-1)
  eventos.push(turno({
    r, t: atual, inicio: inicioUltimo, fim: fimUltimo, pedido: chat.pedido, resposta: chat.resposta, modelos: chat.modelos,
    plano: chat.plano, terminou: chat.estado !== 'trabalho',
  }))
  for (const t of ts) ficheiros.push({ cwd, t })

  return { clis, criadoEm: antigos[0]?.inicio ?? inicioUltimo - 5 * MIN, saidaDoPrimeiro: corte === Infinity ? null : corte }
}

// Um uso a partir do terminal, sem chat na app (aparece em «Fora da app» no consumo).
function transcreverTerminal() {
  const r = prng('terminal')
  const t = new Transcricao(uuid('cli:terminal'), 'C:\\Demo\\Ferramentas')
  for (const dia of [9, 8, 5, 2]) {
    for (let i = 0; i < 2; i++) {
      const inicio = meiaNoite(antes(dia * DIA)) + (10 + i * 4 + r()) * H
      eventos.push(turno({ r, t, inicio, fim: inicio + (6 + r() * 8) * MIN, pedido: sorteio(r, PEDIDOS), resposta: sorteio(r, RESPOSTAS), modelos: [[SONNET, 0.7], [HAIKU, 0.3]] }))
    }
  }
  ficheiros.push({ cwd: t.cwd, t })
}

const origem = {}
for (const chat of CHATS) origem[chat.id] = transcreverChat(chat)
transcreverTerminal()

// ——— sessões da app (local_*.json) ———

const idLocal = chat => `local_${uuid(`local:${chat.id}`)}`
const idGrupo = chave => `cg-${uuid(`grupo:${chave}`)}`
const sessaoDe = chat => origem[chat.id].clis.at(-1)

for (const chat of CHATS) {
  const o = origem[chat.id]
  const projeto = PROJETOS[chat.projeto]
  const pedidoEm = antes(chat.pedidoMin * MIN)
  const fim = chat.estado === 'trabalho' ? antes(40_000) : antes(chat.fimMin * MIN)
  const anteriores = o.clis.slice(0, -1)
  await escrever(join(pasta.contaOrg, `${idLocal(chat)}.json`), {
    sessionId: idLocal(chat),
    cliSessionId: sessaoDe(chat),
    priorCliSessionIds: anteriores,
    priorCliSessionLeftAt: Object.fromEntries(anteriores.map(c => [c, o.saidaDoPrimeiro])),
    title: chat.titulo,
    cwd: projeto.cwd,
    createdAt: o.criadoEm,
    lastActivityAt: fim,
    latestUserFrameAt: pedidoEm,
    isArchived: false,
    postTurnSummary: chat.estado === 'trabalho' ? undefined : {
      status_detail: chat.resumoApp,
      needs_action: chat.estado === 'espera' ? chat.classificacao.cartao.precisa : '',
      status_category: chat.estado === 'espera' ? 'needs_input' : 'done',
    },
  })
}

// ——— o que o mod escreve em itens/, situacao/ e barra.json ———

const haQuanto = ms => {
  const minutos = Math.max(0, Math.floor(ms / MIN))

  return minutos < 60 ? `há ${minutos} min` : `há ${Math.floor(minutos / 60)}h${dois(minutos % 60)}`
}
const ESFORCO = { segundos: '5s', minutos: '2 min', longo: 'longo' }
const corDe = n => (n >= 4 ? '#E24B4A' : n === 3 ? '#EF9F27' : '#888780')

for (const chat of CHATS) {
  const base = { sessao: sessaoDe(chat), local: idLocal(chat), titulo: chat.titulo, projeto: nomeDaPasta(PROJETOS[chat.projeto].cwd) }
  if (chat.estado === 'espera') {
    await escrever(join(pasta.itens, `${base.sessao}.json`), { ...base, estado: 'a-espera', desde: antes(chat.fimMin * MIN), classificacao: chat.classificacao, pedido: chat.pedido })
  } else if (chat.estado === 'trabalho') {
    await escrever(join(pasta.itens, `${base.sessao}.json`), {
      ...base, estado: 'a-trabalhar', desde: antes(chat.pedidoMin * MIN), pedido: chat.pedido,
      progresso: { passos: chat.passos.map(([texto, estado]) => ({ texto, estado })), ferramentas: chat.ferramentas, ultima: chat.ultima },
    })
  }
  if (chat.feito) {
    await escrever(join(pasta.situacao, `${base.sessao}.json`), {
      ...base, em: chat.estado === 'trabalho' ? antes(5 * MIN) : antes(chat.fimMin * MIN),
      feito: chat.feito.map(([texto, haMin]) => ({ texto, em: antes(haMin * MIN) })),
      falta: chat.falta.map(([texto, prioridade]) => ({ texto, prioridade })),
    })
  }
}

// A fila ordenada (importância e depois a espera); os três primeiros são os chips, o resto vai para extra.
const espera = CHATS.filter(c => c.estado === 'espera').sort((a, b) => b.classificacao.importancia - a.classificacao.importancia || a.fimMin - b.fimMin)
const chip = (c, numero, nota) => ({
  sessao: sessaoDe(c),
  local: idLocal(c),
  desde: antes(c.fimMin * MIN),
  numero,
  texto: `${nomeDaPasta(PROJETOS[c.projeto].cwd)} · ${c.classificacao.rotulo}`,
  nota,
  cor: corDe(c.classificacao.importancia),
  silenciado: false,
  cartao: [`Pediste: ${c.classificacao.cartao.pediste}`, `Fez: ${c.classificacao.cartao.fez}`, `Precisa de ti: ${c.classificacao.cartao.precisa}`, `À espera ${haQuanto(c.fimMin * MIN)}`],
})
const chips = espera.slice(0, 3).map((c, i) => chip(c, i + 1, ESFORCO[c.classificacao.esforco]))
const resto = espera.slice(3)
const trabalho = CHATS.filter(c => c.estado === 'trabalho').sort((a, b) => b.pedidoMin - a.pedidoMin).map(c => {
  const feitos = c.passos.filter(([, e]) => e === 'completed').length

  return {
    sessao: sessaoDe(c), local: idLocal(c), titulo: c.titulo, projeto: nomeDaPasta(PROJETOS[c.projeto].cwd), desde: antes(c.pedidoMin * MIN), pedido: c.pedido,
    feitos, total: c.passos.length, atual: c.passos.find(([, e]) => e === 'in_progress')?.[0], ferramentas: c.ferramentas, ultima: c.ultima,
  }
})
await escrever(join(pasta.raiz, 'barra.json'), {
  geradaEm: agora,
  modelo: {
    vazia: false, cabeca: `${espera.length} à espera`, chips, mais: resto.length, aTrabalhar: `${trabalho.length} a trabalhar`,
    proximo: chips[0], extra: resto.map(c => chip(c, 0, haQuanto(c.fimMin * MIN))),
  },
  trabalho,
})

// ——— grupos do Claude (barra lateral) e pastas do gestor ———

const grupos = Object.entries(PROJETOS).map(([chave, p]) => ({ chave, id: idGrupo(chave), nome: p.nome, ordem: p.ordem, pasta: p.pasta }))
await escrever(pasta.config, {
  preferences: {
    epitaxyPrefs: {
      'dframe-group-scopes': {
        [ESCOPO]: {
          groups: grupos.map(g => ({ id: g.id, name: g.nome })),
          assignments: Object.fromEntries(CHATS.map(c => [`code:${idLocal(c)}`, idGrupo(c.projeto)])),
        },
      },
      'dframe-code-sections': { [ESCOPO]: { sections: grupos.map(g => ({ id: g.id, kind: 'manual', order: g.ordem })) } },
    },
  },
})
await escrever(join(pasta.raiz, 'organizacao.json'), {
  versao: 2,
  pastas: PASTAS,
  grupos: Object.fromEntries(grupos.map(g => [g.id, `p_${g.pasta}`])),
  nomes: {},
  ocultos: [],
  ordem: {
    raiz: ['p_estudio'],
    p_estudio: ['p_clientes', 'p_produtos'],
    p_clientes: [idGrupo('aurora'), idGrupo('mare')],
    p_produtos: [idGrupo('horizonte'), idGrupo('farol')],
  },
})

// ——— transcrições e registos de consumo ———

for (const { cwd, t } of ficheiros) {
  await escrever(join(pasta.projetos, cwd.replace(/[:\\/]/g, '-'), `${t.cli}.jsonl`), t.texto())
}

// Os limites da conta (janela de 5 h e semana) que o mod regista em cada fim de turno. A percentagem
// é proporcional ao custo acumulado em cada janela; a capacidade de cada uma calibra-se para a
// semana atual ir a ~64 % e a pior janela de 5 h a ~80 %.
eventos.push({ em: antes(90_000), sessao: sessaoDe(CHATS.find(c => c.id === 'A2')), tokens: 0, cache: 0, custo: 0 })
eventos.sort((a, b) => a.em - b.em)
const SEMANA = 7 * DIA
const fimSemana = Math.ceil((agora + 2.8 * DIA) / H) * H
const resetSemana = em => fimSemana - Math.floor((fimSemana - em) / SEMANA) * SEMANA
const janelas = []
let atualCinco = null
for (const e of eventos) {
  if (!atualCinco || e.em >= atualCinco.fim) {
    atualCinco = { inicio: e.em, fim: Math.ceil((e.em + 5 * H) / H) * H, custo: 0 }
    janelas.push(atualCinco)
  }
  atualCinco.custo += e.custo
  e.cinco = atualCinco
  e.custoCinco = atualCinco.custo
}
const custoSemana = new Map()
for (const e of eventos) {
  const reset = resetSemana(e.em)
  custoSemana.set(reset, (custoSemana.get(reset) ?? 0) + e.custo)
  e.resetSemana = reset
  e.custoSemana = custoSemana.get(reset)
}
const capSemana = (custoSemana.get(fimSemana) ?? 1) / 0.64
const capCinco = Math.max(...janelas.map(j => j.custo)) / 0.8
const porDia = new Map()
for (const e of eventos) {
  const registo = {
    em: e.em, sessao: e.sessao, tokens: Math.round(e.tokens), cache: Math.round(e.cache),
    limites: [
      { kind: 'five_hour', percentUsed: Math.round(Math.min(100, (100 * e.custoCinco) / capCinco) * 10) / 10, resetsAt: iso(e.cinco.fim) },
      { kind: 'seven_day', percentUsed: Math.round(Math.min(100, (100 * e.custoSemana) / capSemana) * 10) / 10, resetsAt: iso(e.resetSemana) },
    ],
  }
  const dia = diaLocal(e.em)
  porDia.set(dia, [...(porDia.get(dia) ?? []), registo])
}
for (const [dia, lista] of porDia) await escrever(join(pasta.consumo, `${dia}.json`), lista)

// A subscrição (110 €/mês) e uma taxa de câmbio fixa, para o gestor não ir à rede.
await escrever(join(pasta.raiz, 'consumo-config.json'), { mensal: 110, meses: {}, moeda: 'EUR', usdPorEur: 1.16, taxaData: diaLocal(agora), taxaFonte: 'valor de demonstração', em: agora })
await escrever(join(destino, MARCA), 'Pasta criada por docs/demo/gerar-demo.mjs. Pode ser apagada e regenerada.\n')

// ——— resultado ———

const custoTotal = eventos.reduce((s, e) => s + e.custo, 0)
const variaveis = { FILA_RAIZ: pasta.raiz, FILA_SESSOES: pasta.sessoes, FILA_CONFIG_APP: pasta.config, FILA_PROJETOS: pasta.projetos }
console.log(`Dados fictícios gerados em ${destino}`)
console.log(`${CHATS.length} chats em ${grupos.length} projetos, ${porDia.size} dias de histórico, ~${Math.round(custoTotal)} $ equivalentes na API.\n`)
for (const [nome, valor] of Object.entries(variaveis)) console.log(`${nome}=${valor}`)
console.log('\nPowerShell (corre isto na raiz do projeto e abre o endereço que o gestor imprimir):')
console.log(`${Object.entries(variaveis).map(([nome, valor]) => `$env:${nome} = '${valor}'`).join('; ')}; node gestor\\servidor.mjs`)
