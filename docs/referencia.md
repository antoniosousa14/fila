# Fila · Referência técnica

O pormenor de cada peça. Para a visão geral, a instalação e o uso, ver o [README](../README.md); para o estado
do projeto, as decisões do dono e as armadilhas, ver [`AGENTS.md`](../AGENTS.md).

- [As peças](#as-peças)
- [Dados em disco](#dados-em-disco)
- [API do gestor](#api-do-gestor)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Dados de demonstração e capturas](#dados-de-demonstração-e-capturas)
- [Linha de comandos da `Fila.exe`](#linha-de-comandos-da-filaexe)
- [Compilar, testar e publicar](#compilar-testar-e-publicar)

## As peças

```
mod/      mod do Claude Code, carregado em todos os chats novos (TypeScript)
app/      Fila.exe: pílula, quadro, janela do gestor, bandeja, tecla de menu (C#, .NET 9, WPF + WebView2)
gestor/   servidor (Node, sem dependências) e interface web
skills/   a skill do orquestrador
bar/      a barra antiga em PowerShell, só como reserva
docs/     esta referência e os desenhos e planos antigos
```

### Mod (`mod/`)

Mod do Claude Code carregado em todos os chats novos. Em cada fim de turno:

- escreve o estado do chat em `%USERPROFILE%\.claude\fila-atencao\itens\`;
- classifica-o com um modelo pequeno (Haiku): importância de 1 a 5, tipo (aprovação, decisão, revisão ou
  informação), esforço (segundos, minutos ou longo), se desbloqueia o chat, um rótulo e o cartão (o que
  pediste, o que fez, o que precisa de ti);
- pede também o que ficou **feito** e o que **falta**, com prioridade, e guarda-o em `situacao\<sessão>.json`
  (não expira, e o feito acumula-se);
- publica a fila ordenada em `barra.json`;
- regista os limites de uso da conta em `consumo\<AAAA-MM-DD>.json`.

No chat orquestrador é também o **carteiro**: entrega as mensagens que o gestor deixa em `saida\` (ver
[Orquestrador](#orquestrador)). O mod já não desenha nada dentro do Claude: a faixa por cima da caixa de
texto saiu; a pílula e o gestor mostram a fila.

O mod recarrega no fim do turno de cada chat (`CLAUDE_CODE_PLUGIN_DIR_WATCH=1`): uma mudança no código ou no
prompt da classificação só se vê no turno seguinte, e os chats abertos antes mantêm o mod antigo até
acabarem um turno. Os itens duram 7 dias.

### App (`Fila.exe`)

App para Windows (C#, .NET 9, WPF e WebView2).

- **Pílula** no canto inferior direito: o logo, quantos esperam e quantos trabalham. Com o rato em cima abre
  um **quadro** com os chats à espera, os que estão a trabalhar com o progresso, e os botões Próximo e
  Gestor. A pílula é uma janela que nunca ganha o foco: clicar nela não tira o foco ao Claude.
- **Gestor numa janela própria**: a página do servidor dentro do WebView2, sem o Edge. O Abrir e o Novo chat
  do gestor põem a app do Claude à frente.
- **Ícone na bandeja**: um clique abre o gestor; o menu tem mostrar a pílula, reiniciar o servidor, ver o
  registo, iniciar com o Windows, reiniciar e sair.
- **Tecla de menu** (`VK_APPS`, ao lado da Copilot): um toque abre o gestor maximizado e outro toque
  esconde-o; segurar cerca de 1 s mostra ou esconde a pílula. Com o gestor aberto a pílula sai do ecrã e
  volta quando ele fecha; fechar ou minimizar a janela do gestor conta como fechá-lo. Enquanto a app corre, a
  tecla de menu não faz mais nada.

**Robustez.** O atalho de arranque corre `Fila.exe` sem argumentos, que é um *guardião*: arranca `Fila.exe
--app` e arranca-a de novo se ela morrer (erro fatal, morta no Gestor de Tarefas), com espera crescente se
cair em ciclo. Sair pela bandeja (ou `Fila.exe --sair`) acaba com ambos. A app cuida do servidor do gestor:
adota o que já corre, arranca outro se faltar e reinicia o que deixar de responder (só depois de 4
verificações seguidas sem resposta). O gancho da tecla corre num fio só seu e é reinstalado de 10 em 10
minutos (o Windows tira ganchos lentos em silêncio). Uma segunda `Fila.exe` só pede à primeira para abrir o
gestor. Os erros e a vida da app ficam em `fila-atencao\app.log` (roda aos 512 KB).

O servidor do gestor é procurado em `gestor\servidor.mjs` a partir da pasta do `.exe` para cima (até 6
níveis); `FILA_PROJETO` força a raiz.

### Gestor (`gestor/`)

`servidor.mjs` (Node, sem dependências, só em `127.0.0.1:4730`; se a porta estiver ocupada usa a seguinte
livre) junta os ficheiros de sessão da app (`%APPDATA%\Claude\claude-code-sessions`, só leitura) com a fila do
mod e serve a interface de `gestor/web/`. A porta e o `pid` ficam em `fila-atencao\gestor.json`; os erros em
`fila-atencao\gestor-erros.log`; `/api/saude` responde ao guardião da app.

#### Painel

À tua espera (ordem da IA: importância, espera, desbloqueio), a trabalhar (com a lista de tarefas e a última
ferramenta), recentes (todos os chats pela última mensagem) e o medidor do consumo (semana, sessão de 5 h,
previsão). Os Recentes têm **filtros** (à espera, a trabalhar, parados), **ordenar** (última mensagem, mais
antigos, nome, grupo) e **procurar**; o filtro e a ordem ficam guardados no navegador.

Cada chat tem uma ficha com Abrir, Mensagem, Ver grupo e **Dispensar**. Dispensar esconde o chat da fila
(ou do «a trabalhar») só até ao turno seguinte. Um «a trabalhar» cuja sessão do CLI a app já largou (um
`/clear` a meio do turno) sai sozinho.

Chats **arquivados** na app nunca contam: nem na fila, nem nos projetos, nem na pílula (a pílula dispensa-os
sozinha).

#### Projetos

Ao abrir uma pasta da árvore da esquerda, o gestor mostra um quadrado por grupo dessa pasta, organizados
pelas subpastas (o Painel não os mostra). No topo há:

- **filtros**: à tua vez, esquecidos, ativos hoje, a arrefecer, parados, sem importância, cada um com quantos
  mostra;
- **ordenar**: o que pede mais atenção, mexidos há menos tempo, parados há mais tempo, mais coisas por fazer,
  prioridade mais alta, nome;
- **procurar**: no nome e no texto do feito e do que falta.

Cada quadrado é só texto, para estares sempre a par e não deixares projetos esquecidos: o que ficou
**feito**, o que **falta** (por prioridade: a tua vez primeiro, depois a prioridade, e o que ficou parado há
mais tempo sobe um pouco) e o **ritmo**: ativo hoje, a arrefecer, parado, ou esquecido (parado há 7 dias ou
mais e com coisas por fazer). A árvore põe um ponto ao lado das pastas e grupos com um projeto esquecido.

Os quadrados não mostram nomes de chats: só ao carregar no quadrado abre o detalhe, com tudo o que falta e o
que ficou feito (com a prioridade e de que chat vem), as tuas mensagens por dia nos últimos 14 dias e os
chats do grupo. O **×** do quadrado dispensa o projeto até haver uma mensagem nova num chat dele (fica em
«Dispensados», onde se repõe). No detalhe há ainda **Sem importância** (fica à vista mas em último e sem
avisos de esquecido) e um × em cada linha para esconder o que já não vale. Estas marcas são só do gestor
(`fila-atencao\projetos-marcas.json`; `POST /api/projeto`).

O feito e o que falta vêm, por ordem de qualidade, da situação que o mod pede à IA em cada fim de turno, da
lista de tarefas do chat (reconstruída do fim da transcrição, `gestor/lib/continuidade.mjs`) e do cartão da
IA e do resumo da app. Só lê os 4 chats mais recentes de cada grupo (`/api/projetos`). Os chats antigos só
ganham feito e falta da IA quando tiverem um turno novo.

#### Organização

A árvore são os **grupos da barra lateral do Claude** (lidos de `%APPDATA%\Claude\claude_desktop_config.json`,
só leitura e só os grupos), com **pastas do gestor** para os juntar e arrastar (`fila-atencao\organizacao.json`).
As pastas e a ordem são só do gestor: no Claude não muda nada, e o gestor não inventa secções.

#### Consumo

A aba Consumo reconstrói o histórico de tokens a partir das transcrições do Claude Code
(`~/.claude/projects`; só contagens, horas e pastas) e mostra:

- o custo equivalente na API (preços em `gestor/precos.json`), em dólares e em euros (taxa do BCE à vista);
- as horas de uso ativo e passivo;
- a poupança face à subscrição (110 €/mês, em `fila-atencao\consumo-config.json`);
- as horas de ponta (`gestor/ponta.json`; não há regra oficial em vigor): mapa de calor e excesso medido com
  as leituras do mod.

#### Chats e mensagens

Novo chat (`claude://code/new`, numa pasta à escolha), mensagens a vários chats com confirmação, e a paleta
de comandos (Ctrl+K) para procurar chats, grupos e ações.

### Orquestrador

Chat dedicado na app que usa a skill [`skills/orquestrar/SKILL.md`](../skills/orquestrar/SKILL.md) (copia-a
para `~/.claude/skills/orquestrar/`): dá pontos de situação e envia mensagens a todos ou a alguns chats,
sempre com confirmação. O seu id está em `fila-atencao\orquestrador.json` e fica fora da fila.

O botão **Mensagem** do gestor deixa o pedido em `saida\` e o mod do orquestrador (o carteiro) tenta
entregá-lo, mas **ainda não entrega nada** (testado a 3 de novembro de 2026): só corre com o chat do
orquestrador aberto, só chega a chats que também estejam abertos, e o modo automático do Claude recusa os
envios que partem de um mod («sem veredicto»). Para enviar a um chat, pede-o ao orquestrador, que o faz com a
própria ferramenta e a tua confirmação.

### Barra antiga (`bar/fila-barra.ps1`)

A barra em PowerShell, só como reserva (faz o mesmo com a janela Edge `--app`; usa o mesmo mutex, por isso
nunca correm as duas). Foi trocada pela `Fila.exe` porque um processo PowerShell com a interface WPF morria
sem deixar rasto.

## Dados em disco

Tudo em `%USERPROFILE%\.claude\fila-atencao\`:

| Ficheiro | O quê |
|---|---|
| `itens\` | um por chat (expira aos 7 dias) e as dispensas `*.dispensado.json` |
| `barra.json` | a fila publicada pelo mod (à espera e a trabalhar) |
| `situacao\<sessão>.json` | o feito e o que falta por chat (não expira) |
| `consumo\` | os limites de uso por dia; `consumo\historico\` é o índice das transcrições |
| `consumo-config.json` | a subscrição, para a poupança |
| `organizacao.json` | as pastas do gestor |
| `projetos-marcas.json` | as marcas dos projetos |
| `saida\` | as mensagens à espera do carteiro |
| `orquestrador.json` | o id do chat orquestrador |
| `gestor.json` | a porta e o `pid` do servidor |
| `claude-a-frente.json` | o sinal para pôr a app do Claude à frente |
| `barra-posicao.json` | onde está a pílula |
| `app.log`, `gestor-erros.log` | os registos |

E `%LOCALAPPDATA%\Fila\` guarda o perfil do WebView2 do gestor.

## API do gestor

Só em `127.0.0.1`. Os `POST` exigem um `Origin` local.

| Rota | O quê |
|---|---|
| `GET /api/saude` | responde ao guardião da app |
| `GET /api/estado` | o painel: à espera, a trabalhar, recentes, árvore, consumo, mensagens |
| `GET /api/projetos` | os quadrados dos projetos |
| `GET /api/historico` | o histórico de consumo |
| `POST /api/abrir` | abre um chat na app do Claude |
| `POST /api/organizacao` | pastas e ordem do gestor |
| `POST /api/projeto` | marcas dos projetos (dispensar, sem importância, esconder linhas) |
| `POST /api/dispensar` | dispensa um chat à espera ou a trabalhar até ao turno seguinte |
| `POST /api/novo-chat` | abre um chat novo |
| `POST /api/mensagens/preparar` e `/enviar` | mensagens a chats |
| `POST /api/consumo/config` e `/taxa-bce` | subscrição e taxa de câmbio |

## Variáveis de ambiente

Para correr o gestor com dados de teste, sem tocar nos reais:

| Variável | O quê |
|---|---|
| `FILA_RAIZ` | a pasta da fila (o servidor escreve lá `gestor.json`, `organizacao.json` e `saida\`) |
| `FILA_SESSOES` | as sessões da app (`claude-code-sessions`) |
| `FILA_CONFIG_APP` | o ficheiro de grupos (`claude_desktop_config.json`) |
| `FILA_PROJETOS` | as transcrições (`~/.claude/projects`) |
| `FILA_PROJETO` | a raiz onde a `Fila.exe` procura `gestor\servidor.mjs` |

Para correr o gestor à mão: `node gestor\servidor.mjs` e abrir `http://127.0.0.1:4730`. Depois de mudar
`servidor.mjs` ou `gestor/lib/`, pára o processo `node` cuja linha de comandos contém `servidor.mjs`; a app
arranca outro em segundos (ou usa «Reiniciar o servidor do gestor» no ícone da bandeja). Mudanças em
`gestor/web/` só precisam de recarregar a página (F5 na janela do gestor).

## Dados de demonstração e capturas

As imagens do README vêm de dados 100 % fictícios (quatro projetos inventados, dez chats, vinte dias de uso), nunca
de chats reais. O `docs/demo/gerar-demo.mjs` (Node, sem dependências) gera-os com a mesma estrutura dos reais:
sessões da app (`local_*.json`), grupos do Claude, `organizacao.json` (pastas do gestor), itens e `barra.json` do
mod, `situacao/`, `consumo/` e transcrições `.jsonl` curtas para a aba Consumo ter histórico. As horas são
relativas a `Date.now()`: gera-se de novo antes de cada utilização.

```powershell
node docs\demo\gerar-demo.mjs $env:TEMP\fila-demo
```

Imprime as variáveis `FILA_RAIZ`, `FILA_SESSOES`, `FILA_CONFIG_APP` e `FILA_PROJETOS` (e uma linha de PowerShell
pronta a copiar). Com elas definidas, `node gestor\servidor.mjs` corre o gestor sobre a demonstração; se a 4730
estiver ocupada, usa a seguinte livre (a porta fica em `<pasta>\fila\gestor.json`). O gerador recusa pastas dentro de
`%USERPROFILE%\.claude`, `%APPDATA%\Claude` e `%LOCALAPPDATA%\Fila`, e pastas não vazias que não sejam de uma execução
anterior dele (marca `.dados-de-demonstracao`). Não ligues a `Fila.exe` real a esta pasta: ela vigia o gestor real.

Para refazer as imagens de `docs/capturas/` (precisa do Microsoft Edge, e da `Fila.exe` para a pílula e o quadro):

```powershell
node docs\demo\capturar.mjs --demo $env:TEMP\fila-demo --saida docs\capturas --exe app\publish\Fila.exe
```

O script guia um Edge sem janela, com perfil novo e à parte, pelo protocolo de depuração (1440×900, tema escuro) e
tira o Painel, a ficha, os projetos (com o detalhe de um) e o Consumo; esconde só o grão de ruído do fundo, para os PNG
ficarem abaixo dos 400 KB. A pílula e o quadro saem de `Fila.exe --previsao`, que só lê o `barra.json` da demonstração e
escreve dois PNG (não mexe no mutex, no guardião nem em `%USERPROFILE%\.claude\fila-atencao`). Antes de publicar uma
imagem, abre-a e confirma que só tem dados fictícios.

## Linha de comandos da `Fila.exe`

| Comando | O quê |
|---|---|
| `Fila.exe` | o guardião (é o que o atalho de arranque corre) |
| `Fila.exe --app` | a app, sem guardião |
| `Fila.exe --sair` | pede à Fila que corre para sair |
| `Fila.exe --arranque on\|off` | liga ou desliga o atalho de arranque do Windows |
| `Fila.exe --previsao <pasta> [<barra.json>]` | desenha `pilula.png` e `quadro.png` |
| `Fila.exe --autoteste` | testes internos da máquina de estados da tecla (resultado em `%LOCALAPPDATA%\Fila\autoteste.txt`) |

## Compilar, testar e publicar

Precisa do SDK .NET 9 (o pacote `Microsoft.Web.WebView2` vem do NuGet) e do Node.js.

```powershell
# testes
$C = (Get-ChildItem "$env:APPDATA\Claude\claude-code\*\*\claude.exe" | Sort-Object LastWriteTime)[-1].FullName
& $C plugin validate mod ; & $C plugin test mod        # o `claude` do PATH não tem `plugin test`
node --test "gestor/test/*.test.mjs"                   # o padrão leva aspas (o Node 24 não expande uma pasta)
app\publish\Fila.exe --autoteste

# compilar, publicar em app\publish\ e voltar a arrancar
powershell -NoProfile -ExecutionPolicy Bypass -File app\publicar.ps1 -Arrancar
```

O `publicar.ps1` pede à Fila que corre para sair, publica e, com `-Arrancar`, volta a pô-la a correr desligada
da sessão (é de `app\publish\Fila.exe` que o atalho de arranque a corre).

