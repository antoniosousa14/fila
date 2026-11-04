# Barra da fila de atenção: mostra quantos chats esperam por ti.
# A tecla de menu (a que abre o menu de contexto, ao lado da Copilot):
#   toque          abre o gestor de chats (janela Edge maximizada); outro toque fecha-o (esconde-o, sem fechar)
#   segurar ~1 s   mostra ou esconde a pílula (que abre um quadro ao passar o rato)
# Com o gestor aberto a pílula sai do ecrã e volta quando ele fecha. Fechar a janela do gestor
# conta como fechá-lo. O gestor (gestor/servidor.mjs) arranca com a barra.
# Enquanto a barra corre, essa tecla não faz mais nada (nem com Shift, Ctrl, Alt ou Win).
# Arrasta-se para qualquer sítio e lembra-se da posição, da pílula e do gestor.
# Desenha o barra.json que o mod (mod/hooks/register.tsx) escreve em cada evento de cada chat.
# Correr: powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -STA -File bar\fila-barra.ps1
# Pré-visualizar sem a correr: ... -File bar\fila-barra.ps1 -Previsao <pasta> [-Dados <barra.json>]
# grava pilula.png e quadro.png nessa pasta e sai.
param([string]$Previsao, [string]$Dados)

$ErrorActionPreference = 'Stop'
$ATALHO_TECLA = 0x5D   # VK_APPS, a tecla de menu
$SEGURAR_MS = 900   # segurar a tecla isto (ou mais) mostra ou esconde a pílula
$TITULO_GESTOR = 'Fila · gestor de chats'   # o <title> de gestor/web/index.html
$MAX_LINHAS = 6
$MAX_TRABALHO = 4

$raiz = Join-Path $env:USERPROFILE '.claude\fila-atencao'
$ficheiroBarra = if ($Dados) { $Dados } else { Join-Path $raiz 'barra.json' }
$ficheiroPosicao = Join-Path $raiz 'barra-posicao.json'
$ficheiroGestor = Join-Path $raiz 'gestor.json'
$pastaItens = Join-Path $raiz 'itens'
$registoErros = Join-Path $raiz 'barra-erros.log'
$servidorGestor = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\gestor\servidor.mjs'))
$perfilGestor = Join-Path $env:LOCALAPPDATA 'fila-gestor'

if (-not $Previsao) {
  $unica = New-Object System.Threading.Mutex($false, 'Local\fila-atencao-barra')
  if (-not $unica.WaitOne(0)) { exit }
}

Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
# Gancho de teclado de baixo nível: engole todas as pressões da tecla (com ou sem Shift,
# Ctrl, Alt, Win), para ela não fazer mais nada enquanto a barra corre. Distingue um toque
# (largar antes de SEGURAR_MS) de segurar a tecla (avisa logo ao fim de SEGURAR_MS, sem
# esperar que a larguem); a repetição de tecla presa não conta como outro toque.
# O gancho corre num fio só seu: o Windows tira em silêncio um gancho que demore a responder, e
# no fio da interface isso acontecia quando a tecla chegava com a barra ocupada (ao arrancar).
Add-Type -ReferencedAssemblies ([System.Windows.Threading.Dispatcher].Assembly.Location) -TypeDefinition @'
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Threading;

public class TeclaFila {
  delegate IntPtr Gancho(int codigo, IntPtr mensagem, IntPtr dados);
  [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr janela; public uint mensagem; public IntPtr w, l; public uint hora; public int x, y; }
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int tipo, Gancho funcao, IntPtr modulo, uint fio);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr gancho);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr gancho, int codigo, IntPtr mensagem, IntPtr dados);
  [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string nome);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr janela, uint de, uint ate);
  [DllImport("user32.dll")] static extern bool PostThreadMessage(uint fio, uint mensagem, IntPtr w, IntPtr l);
  const int WH_KEYBOARD_LL = 13;
  const int WM_KEYDOWN = 0x100;
  const int WM_SYSKEYDOWN = 0x104;
  const uint WM_QUIT = 0x12;

  readonly uint tecla;
  readonly int segurarMs;
  readonly Gancho funcao;
  readonly Dispatcher interfaceUi;
  readonly Timer segurar;
  readonly object trinco = new object();
  IntPtr gancho;
  uint fioGancho;
  bool premida;
  bool segurada;
  public event EventHandler Toque;
  public event EventHandler Segurada;

  // Criar no fio da interface: é para lá que vão os avisos.
  public TeclaFila(uint tecla, int segurarMs) {
    this.tecla = tecla;
    this.segurarMs = segurarMs;
    funcao = Tratar;
    interfaceUi = Dispatcher.CurrentDispatcher;
    segurar = new Timer(_ => {
      lock (trinco) {
        if (!premida || segurada) return;
        segurada = true;
      }
      Avisar(Segurada);
    }, null, Timeout.Infinite, Timeout.Infinite);
  }

  void Avisar(EventHandler evento) {
    if (evento != null) interfaceUi.BeginInvoke((Action)(() => evento(this, EventArgs.Empty)));
  }

  public bool Instalar() {
    bool instalado = false;
    var pronto = new ManualResetEvent(false);
    var fio = new Thread(() => {
      gancho = SetWindowsHookEx(WH_KEYBOARD_LL, funcao, GetModuleHandle(null), 0);
      instalado = gancho != IntPtr.Zero;
      fioGancho = GetCurrentThreadId();
      pronto.Set();
      if (!instalado) return;
      MSG m;
      while (GetMessage(out m, IntPtr.Zero, 0, 0) > 0) { }
      UnhookWindowsHookEx(gancho);
    });
    fio.IsBackground = true;
    fio.Start();
    pronto.WaitOne();
    return instalado;
  }

  public void Remover() {
    if (fioGancho != 0) PostThreadMessage(fioGancho, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
  }

  IntPtr Tratar(int codigo, IntPtr mensagem, IntPtr dados) {
    if (codigo >= 0 && (uint)Marshal.ReadInt32(dados) == tecla) {
      int tipo = (int)mensagem;
      bool desce = tipo == WM_KEYDOWN || tipo == WM_SYSKEYDOWN;
      bool toque = false;
      lock (trinco) {
        if (desce && !premida) {
          premida = true;
          segurada = false;
          segurar.Change(segurarMs, Timeout.Infinite);
        } else if (!desce && premida) {
          premida = false;
          segurar.Change(Timeout.Infinite, Timeout.Infinite);
          toque = !segurada;
        }
      }
      if (toque) Avisar(Toque);
      return (IntPtr)1;
    }
    return CallNextHookEx(gancho, codigo, mensagem, dados);
  }
}

// Avisa (no fio da interface) quando um ficheiro da pasta da fila muda: é assim que o servidor do
// gestor pede para pôr o Claude à frente. Uma escrita dispara vários avisos, por isso junta-os.
public class SinalFila {
  readonly FileSystemWatcher vigia;
  readonly Dispatcher fio;
  DateTime ultimo;
  public event EventHandler Recebido;

  public SinalFila(string pasta, string ficheiro) {
    fio = Dispatcher.CurrentDispatcher;
    Directory.CreateDirectory(pasta);
    vigia = new FileSystemWatcher(pasta, ficheiro);
    vigia.NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName | NotifyFilters.Size;
    vigia.Changed += Mudou;
    vigia.Created += Mudou;
    vigia.Renamed += (origem, e) => Mudou(origem, e);
    vigia.EnableRaisingEvents = true;
  }

  void Mudou(object origem, FileSystemEventArgs e) {
    fio.BeginInvoke((Action)(() => {
      if ((DateTime.UtcNow - ultimo).TotalMilliseconds < 400) return;
      ultimo = DateTime.UtcNow;
      EventHandler avisar = Recebido;
      if (avisar != null) avisar(this, EventArgs.Empty);
    }));
  }
}

// A janela Edge --app do gestor: encontrá-la pelo título, mostrá-la maximizada à frente e escondê-la.
// Também encontra a janela principal da app do Claude, para a pôr à frente quando se abre um chat.
public static class JanelaGestor {
  delegate bool Enumerar(IntPtr janela, IntPtr dados);
  [DllImport("user32.dll")] static extern bool EnumWindows(Enumerar funcao, IntPtr dados);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr janela, System.Text.StringBuilder texto, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr janela, System.Text.StringBuilder texto, int max);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr janela, int comando);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr janela);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr janela);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr janela, IntPtr processo);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint de, uint para, bool ligar);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr janela, IntPtr depois, int x, int y, int largura, int altura, uint flags);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr janela);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr janela);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr janela);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr janela);
  [DllImport("user32.dll", EntryPoint = "GetWindowThreadProcessId")] static extern uint ProcessoDaJanela(IntPtr janela, out uint processo);
  const int SW_SHOWMAXIMIZED = 3, SW_SHOW = 5, SW_RESTORE = 9;
  const uint SWP_NOSIZE = 0x1, SWP_NOMOVE = 0x2, SWP_NOZORDER = 0x4, SWP_NOACTIVATE = 0x10, SWP_HIDEWINDOW = 0x80;
  static readonly IntPtr TOPO = new IntPtr(-1), SEM_TOPO = new IntPtr(-2);

  public static IntPtr Procurar(string titulo) {
    IntPtr achada = IntPtr.Zero;
    EnumWindows((janela, dados) => {
      var texto = new System.Text.StringBuilder(256);
      GetWindowText(janela, texto, texto.Capacity);
      if (texto.ToString() != titulo) return true;
      var classe = new System.Text.StringBuilder(64);
      GetClassName(janela, classe, classe.Capacity);
      if (classe.ToString() != "Chrome_WidgetWin_1") return true;
      achada = janela;
      return false;
    }, IntPtr.Zero);
    return achada;
  }

  public static void Esconder(IntPtr janela) {
    SetWindowPos(janela, IntPtr.Zero, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_HIDEWINDOW);
  }

  // Maximizada e à frente. Uma janela minimizada (ou acabada de criar pelo Edge) tem de ser
  // restaurada antes de maximizar, senão fica fora do ecrã.
  public static void Mostrar(IntPtr janela) {
    if (IsIconic(janela)) ShowWindow(janela, SW_RESTORE);
    ShowWindow(janela, SW_SHOWMAXIMIZED);
    Focar(janela);
  }

  // A janela está à vista: visível e não minimizada. Minimizá-la conta como fechá-la.
  public static bool Aberta(IntPtr janela) {
    return IsWindowVisible(janela) && !IsIconic(janela);
  }

  // Verdade se a janela está maximizada e não minimizada (para confirmar depois de a mostrar).
  public static bool Maximizada(IntPtr janela) {
    return !IsIconic(janela) && IsZoomed(janela);
  }

  // A janela visível com título do processo Claude (a app desktop; o CLI não tem janelas).
  public static IntPtr ProcurarClaude() {
    IntPtr achada = IntPtr.Zero;
    EnumWindows((janela, dados) => {
      if (!IsWindowVisible(janela) || GetWindowTextLength(janela) == 0) return true;
      var classe = new System.Text.StringBuilder(64);
      GetClassName(janela, classe, classe.Capacity);
      if (classe.ToString() != "Chrome_WidgetWin_1") return true;
      uint processo;
      ProcessoDaJanela(janela, out processo);
      try {
        if (!Process.GetProcessById((int)processo).ProcessName.Equals("claude", StringComparison.OrdinalIgnoreCase)) return true;
      } catch (ArgumentException) {
        return true;
      }
      achada = janela;
      return false;
    }, IntPtr.Zero);
    return achada;
  }

  public static void PorAFrente(IntPtr janela) {
    ShowWindow(janela, IsIconic(janela) ? SW_RESTORE : SW_SHOW);
    Focar(janela);
  }

  // O Windows só deixa pôr à frente quem recebeu o último input (aqui a tecla foi apanhada pelo
  // gancho, ou o clique foi noutra janela), por isso liga-se por instantes à fila de input da
  // janela que está à frente.
  static void Focar(IntPtr janela) {
    uint eu = GetCurrentThreadId();
    uint frente = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
    bool ligado = frente != 0 && frente != eu && AttachThreadInput(eu, frente, true);
    // Por cima de tudo, mesmo que o Windows não deixe tirar o foco a quem o tem.
    SetWindowPos(janela, TOPO, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
    SetWindowPos(janela, SEM_TOPO, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
    BringWindowToTop(janela);
    SetForegroundWindow(janela);
    if (ligado) AttachThreadInput(eu, frente, false);
  }
}
'@

# As cores do gestor (gestor/web/estilo.css, tema escuro).
$PALETA = @{
  fundo = '#F5111110'; linha = '#2E2E2A'; fraca = '#22221F'; hover = '#1C1C1A'
  tinta = '#ECEBE6'; dim = '#9A9993'; fraco = '#5F5E59'; sinal = '#FF7A1A'; frio = '#7FA7C9'
}
$IMPORTANCIA = @{ '#E24B4A' = 3; '#EF9F27' = 2; '#888780' = 1 }   # mod/src/barra.ts COR

$estilos = [System.Windows.Markup.XamlReader]::Parse(@'
<ResourceDictionary xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
                    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">
  <Style x:Key="Linha" TargetType="Button">
    <Setter Property="Foreground" Value="#ECEBE6"/>
    <Setter Property="Background" Value="Transparent"/>
    <Setter Property="Padding" Value="8,7"/>
    <Setter Property="Cursor" Value="Hand"/>
    <Setter Property="HorizontalContentAlignment" Value="Stretch"/>
    <Setter Property="Template">
      <Setter.Value>
        <ControlTemplate TargetType="Button">
          <Border x:Name="fundo" Background="{TemplateBinding Background}" CornerRadius="6" Padding="{TemplateBinding Padding}">
            <ContentPresenter HorizontalAlignment="{TemplateBinding HorizontalContentAlignment}" VerticalAlignment="Center"/>
          </Border>
          <ControlTemplate.Triggers>
            <Trigger Property="IsMouseOver" Value="True">
              <Setter TargetName="fundo" Property="Background" Value="#1C1C1A"/>
            </Trigger>
          </ControlTemplate.Triggers>
        </ControlTemplate>
      </Setter.Value>
    </Setter>
  </Style>
  <Style x:Key="Fechar" TargetType="Button" BasedOn="{StaticResource Linha}">
    <Setter Property="Foreground" Value="#5F5E59"/>
    <Setter Property="Padding" Value="7,4"/>
    <Setter Property="FontSize" Value="14"/>
    <Style.Triggers>
      <Trigger Property="IsMouseOver" Value="True">
        <Setter Property="Foreground" Value="#ECEBE6"/>
      </Trigger>
    </Style.Triggers>
  </Style>
  <Style x:Key="Fantasma" TargetType="Button">
    <Setter Property="Foreground" Value="#ECEBE6"/>
    <Setter Property="Cursor" Value="Hand"/>
    <Setter Property="FontSize" Value="11.5"/>
    <Setter Property="Template">
      <Setter.Value>
        <ControlTemplate TargetType="Button">
          <Border x:Name="fundo" Background="Transparent" BorderBrush="#2E2E2A" BorderThickness="1" CornerRadius="6" Padding="9,4">
            <ContentPresenter VerticalAlignment="Center"/>
          </Border>
          <ControlTemplate.Triggers>
            <Trigger Property="IsMouseOver" Value="True">
              <Setter TargetName="fundo" Property="BorderBrush" Value="#5F5E59"/>
            </Trigger>
          </ControlTemplate.Triggers>
        </ControlTemplate>
      </Setter.Value>
    </Setter>
  </Style>
  <Style x:Key="Primario" TargetType="Button">
    <Setter Property="Foreground" Value="#111110"/>
    <Setter Property="Cursor" Value="Hand"/>
    <Setter Property="HorizontalContentAlignment" Value="Stretch"/>
    <Setter Property="Template">
      <Setter.Value>
        <ControlTemplate TargetType="Button">
          <Border x:Name="fundo" Background="#ECEBE6" CornerRadius="7" Padding="12,9">
            <ContentPresenter HorizontalAlignment="{TemplateBinding HorizontalContentAlignment}" VerticalAlignment="Center"/>
          </Border>
          <ControlTemplate.Triggers>
            <Trigger Property="IsMouseOver" Value="True">
              <Setter TargetName="fundo" Property="Background" Value="#FFFFFF"/>
            </Trigger>
          </ControlTemplate.Triggers>
        </ControlTemplate>
      </Setter.Value>
    </Setter>
  </Style>
</ResourceDictionary>
'@)

$conversor = New-Object System.Windows.Media.BrushConverter
function Get-Pincel([string]$hex) { $conversor.ConvertFromString($hex) }
$fonteMono = New-Object System.Windows.Media.FontFamily('Cascadia Mono, Consolas')
$negrito = [System.Windows.FontWeights]::SemiBold

function Format-HaQuanto([double]$ms) {
  $minutos = [Math]::Max(0, [Math]::Floor($ms / 60000))
  if ($minutos -lt 60) { return "há $minutos min" }
  return 'há {0}h{1:00}' -f [Math]::Floor($minutos / 60), ($minutos % 60)
}

function Get-Agora { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }

function Read-Barra {
  if (-not (Test-Path $ficheiroBarra)) { return $null }
  try { return [IO.File]::ReadAllText($ficheiroBarra, [Text.Encoding]::UTF8) | ConvertFrom-Json } catch { return $null }
}

function Get-Dispensados {
  $dispensados = @{}
  Get-ChildItem $pastaItens -Filter '*.dispensado.json' -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $dispensados[$_.Name -replace '\.dispensado\.json$', ''] = [long]([IO.File]::ReadAllText($_.FullName) | ConvertFrom-Json).desde
    } catch {}
  }
  return $dispensados
}

function Read-Guardado {
  try { return [IO.File]::ReadAllText($ficheiroPosicao) | ConvertFrom-Json } catch { return $null }
}

function Read-Posicao {
  $area = [System.Windows.SystemParameters]::WorkArea
  $padrao = @(($area.Right - 8), ($area.Bottom - 8))
  try {
    $guardada = Read-Guardado
    $direita = [double]$guardada.direita
    $fundo = [double]$guardada.fundo
    $ecra = New-Object System.Windows.Rect([System.Windows.SystemParameters]::VirtualScreenLeft, [System.Windows.SystemParameters]::VirtualScreenTop, [System.Windows.SystemParameters]::VirtualScreenWidth, [System.Windows.SystemParameters]::VirtualScreenHeight)
    if ($ecra.Contains((New-Object System.Windows.Point(($direita - 20), ($fundo - 10))))) { return @($direita, $fundo) }
  } catch {}
  return $padrao
}

function Save-Posicao {
  if ($Previsao) { return }
  # `modo` fica pelo resumo (e pelos scripts de teste); a barra lê `pilula` e `gestor`.
  $modo = if ($script:gestorAberto) { 'completa' } elseif ($script:pilulaVisivel) { 'pequena' } else { 'escondida' }
  [IO.File]::WriteAllText($ficheiroPosicao, (@{ direita = $script:direita; fundo = $script:fundo; pilula = $script:pilulaVisivel; gestor = $script:gestorAberto; modo = $modo } | ConvertTo-Json -Compress))
}

function Set-Ancora {
  $janela.Left = $script:direita - $janela.ActualWidth
  $janela.Top = $script:fundo - $janela.ActualHeight
}

function Set-Aberto([bool]$aberto) {
  if ($script:aberto -eq $aberto -and $borda.Child) { return }
  $script:aberto = $aberto
  if ($aberto) {
    $borda.Padding = '14,12,14,14'
    $borda.CornerRadius = 12
    $borda.Child = $quadro
    $entrada = New-Object System.Windows.Media.Animation.DoubleAnimation(0, 1, (New-Object System.Windows.Duration([TimeSpan]::FromMilliseconds(140))))
    $quadro.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $entrada)
  } else {
    $borda.Padding = '11,8,12,8'
    $borda.CornerRadius = 10
    $borda.Child = $pilula
  }
}

# A porta do gestor se o processo de gestor.json ainda for um node vivo.
function Get-PortaGestor {
  try {
    $gestor = [IO.File]::ReadAllText($ficheiroGestor) | ConvertFrom-Json
    if ((Get-Process -Id ([int]$gestor.pid) -ErrorAction Stop).ProcessName -eq 'node') { return [int]$gestor.porta }
  } catch {}
  return $null
}

function Start-Gestor {
  $porta = Get-PortaGestor
  if ($porta) { return $porta }
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $node) { $node = Join-Path $env:ProgramFiles 'nodejs\node.exe' }
  if (-not (Test-Path $node) -or -not (Test-Path $servidorGestor)) {
    Add-Content $registoErros "$(Get-Date -Format s) sem node ($node) ou sem $servidorGestor"
    return $null
  }
  # Pasta de trabalho fora do projeto, para os processos não prenderem a pasta da app.
  Start-Process -FilePath $node -ArgumentList ('"{0}"' -f $servidorGestor) -WorkingDirectory $env:USERPROFILE -WindowStyle Hidden
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 100
    $porta = Get-PortaGestor
    if ($porta) { return $porta }
  }
  Add-Content $registoErros "$(Get-Date -Format s) o gestor não arrancou (ver gestor-erros.log)"
  return $null
}

function Show-Gestor {
  # Primeiro o servidor (pode ter morrido com a janela aberta; a página volta sozinha em 3 s).
  $porta = Start-Gestor
  $janelaGestor = [JanelaGestor]::Procurar($TITULO_GESTOR)
  if ($janelaGestor -ne [IntPtr]::Zero) {
    [JanelaGestor]::Mostrar($janelaGestor)
    $script:confirmarGestor = 3
    $confirmaGestor.Start()
    return
  }
  if ($procuraGestor.IsEnabled -or -not $porta) { return }
  $edge = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
  if (-not (Test-Path $edge)) { $edge = 'msedge' }
  Start-Process -FilePath $edge -WorkingDirectory $env:USERPROFILE -ArgumentList @(
    "--app=http://127.0.0.1:$porta/",
    "--user-data-dir=`"$perfilGestor`"",
    '--start-maximized',
    '--no-first-run',
    '--no-default-browser-check'
  )
  $script:esperasGestor = 0
  $procuraGestor.Start()
}

function Hide-Gestor {
  $janelaGestor = [JanelaGestor]::Procurar($TITULO_GESTOR)
  if ($janelaGestor -ne [IntPtr]::Zero) { [JanelaGestor]::Esconder($janelaGestor) }
}

# A pílula vê-se se a pessoa a quer visível e o gestor está fechado: com o gestor aberto (ecrã
# inteiro) sai, para não ficar por cima dele, e volta quando ele fecha.
function Update-Pilula {
  # Esconder já com a pílula: uma janela transparente reaparece com a última imagem que
  # desenhou, e o quadro grande piscava antes de dar lugar à pílula.
  Set-Aberto $false
  if ($script:pilulaVisivel -and -not $script:gestorAberto) {
    if ($janela.IsVisible) { return }
    $janela.Opacity = 0
    $janela.Show()
    $janela.UpdateLayout()
    Set-Ancora
    [void]$janela.Dispatcher.BeginInvoke([System.Windows.Threading.DispatcherPriority]::Loaded, [action]{ $janela.Opacity = 1 })
  } else {
    $janela.UpdateLayout()
    $janela.Hide()
  }
}

# Toque na tecla: abre ou fecha o gestor.
function Set-Gestor([bool]$aberto) {
  $script:gestorAberto = $aberto
  Update-Pilula
  # Um erro com o gestor não pode deitar abaixo a barra.
  try {
    if ($aberto) { Show-Gestor } else { Hide-Gestor }
  } catch {
    Add-Content $registoErros "$(Get-Date -Format s) gestor: $_"
  }
  Save-Posicao
}

# Segurar a tecla: mostra ou esconde a pílula (com o gestor aberto, só fica para quando ele fechar).
function Switch-Pilula {
  $script:pilulaVisivel = -not $script:pilulaVisivel
  Update-Pilula
  Save-Posicao
}

# O gestor está à vista agora? (à espera de o Edge o criar também conta como aberto.)
function Test-GestorAberto {
  if ($procuraGestor.IsEnabled) { return $true }
  $janelaGestor = [JanelaGestor]::Procurar($TITULO_GESTOR)

  return ($janelaGestor -ne [IntPtr]::Zero) -and [JanelaGestor]::Aberta($janelaGestor)
}

# Se fecharem ou minimizarem a janela do gestor, conta como fechado e a pílula volta (se estava
# visível). Sem isto a barra achava o gestor aberto, a pílula ficava escondida e o primeiro toque
# da tecla só fechava o que já não se via.
function Watch-Gestor {
  if (-not $script:gestorAberto -or $procuraGestor.IsEnabled -or $confirmaGestor.IsEnabled) { return }
  if (-not (Test-GestorAberto)) { Set-Gestor $false }
}

# Põe a app do Claude à frente depois de lhe mandar um link (ela própria não consegue: o Windows
# só deixa vir para a frente quem recebeu o último clique). Tenta durante 3 s, porque com a app
# fechada na bandeja a janela só aparece depois de a app tratar o link.
function Show-Claude {
  $script:tentativasClaude = 0
  $frenteClaude.Stop()
  $frenteClaude.Start()
}

function Open-Chat($chip) {
  if ($chip.local) {
    Start-Process "claude://claude.ai/epitaxy/$($chip.local)"
    Show-Claude
  }
  Set-Aberto $false
}

function Hide-Chip($chip) {
  [IO.File]::WriteAllText((Join-Path $pastaItens "$($chip.sessao).dispensado.json"), '{"desde":' + [long]$chip.desde + '}')
  $script:assinatura = ''
  Update-Conteudo
}

function New-Texto([string]$texto, [string]$cor = $PALETA.dim, [double]$tamanho = 12.5, [switch]$Mono, [switch]$Forte) {
  $bloco = New-Object System.Windows.Controls.TextBlock
  $bloco.Text = $texto
  $bloco.Foreground = Get-Pincel $cor
  $bloco.FontSize = $tamanho
  if ($Mono) { $bloco.FontFamily = $fonteMono }
  if ($Forte) { $bloco.FontWeight = $negrito }
  $bloco.VerticalAlignment = 'Center'
  $bloco.TextTrimming = 'CharacterEllipsis'
  return $bloco
}

function New-Botao($conteudo, $etiqueta, [string]$estilo, [scriptblock]$acao) {
  $botao = New-Object System.Windows.Controls.Button
  $botao.Style = $estilos[$estilo]
  $botao.Content = $conteudo
  $botao.Tag = $etiqueta
  $botao.Add_Click($acao)
  return $botao
}

function New-Pilha([string]$orientacao = 'Horizontal') {
  $pilha = New-Object System.Windows.Controls.StackPanel
  $pilha.Orientation = $orientacao
  return $pilha
}

function Add-Coluna($grelha, [string]$largura) {
  $coluna = New-Object System.Windows.Controls.ColumnDefinition
  $coluna.Width = $largura
  [void]$grelha.ColumnDefinitions.Add($coluna)
}

function Add-Em($grelha, $filho, [int]$coluna) {
  [System.Windows.Controls.Grid]::SetColumn($filho, $coluna)
  [void]$grelha.Children.Add($filho)
}

# O logo (gestor/logo.svg): três barras inclinadas e o bloco de sinal, aceso quando há espera.
function New-Marca([bool]$aceso, [double]$tamanho = 16) {
  $tela = New-Object System.Windows.Controls.Canvas
  $tela.Width = 32
  $tela.Height = 32
  $partes = @(
    @('M5 7h14.5l-2.2 4.6H5z', $PALETA.tinta, 1),
    @('M5 14.2h10.6l-2.2 4.6H5z', $PALETA.tinta, 0.6),
    @('M5 21.4h6.2L9 26H5z', $PALETA.tinta, 0.32),
    @('M22.4 7H27l-2.2 4.6h-4.6z', $(if ($aceso) { $PALETA.sinal } else { $PALETA.fraco }), 1)
  )
  foreach ($parte in $partes) {
    $caminho = New-Object System.Windows.Shapes.Path
    $caminho.Data = [System.Windows.Media.Geometry]::Parse($parte[0])
    $caminho.Fill = Get-Pincel $parte[1]
    $caminho.Opacity = $parte[2]
    [void]$tela.Children.Add($caminho)
  }
  $caixa = New-Object System.Windows.Controls.Viewbox
  $caixa.Width = $tamanho
  $caixa.Height = $tamanho
  $caixa.Child = $tela
  $caixa.VerticalAlignment = 'Center'
  return $caixa
}

function New-Bloco([string]$cor, [double]$largura = 6, [double]$altura = 6) {
  $bloco = New-Object System.Windows.Shapes.Rectangle
  $bloco.Width = $largura
  $bloco.Height = $altura
  $bloco.Fill = Get-Pincel $cor
  $bloco.RenderTransform = New-Object System.Windows.Media.SkewTransform(-18, 0)
  $bloco.RenderTransformOrigin = New-Object System.Windows.Point(0.5, 0.5)
  $bloco.VerticalAlignment = 'Center'
  return $bloco
}

# Importância em três traços, como no quadro do gestor; a alta acende o sinal.
function New-Tracos([int]$nivel) {
  $tracos = New-Pilha
  $tracos.VerticalAlignment = 'Center'
  for ($i = 1; $i -le 3; $i++) {
    $cor = if ($i -gt $nivel) { $PALETA.linha } elseif ($nivel -eq 3) { $PALETA.sinal } else { $PALETA.dim }
    $traco = New-Bloco $cor 3 10
    $traco.Margin = '1.5,0,1.5,0'
    [void]$tracos.Children.Add($traco)
  }
  return $tracos
}

function New-Rotulo([string]$texto) {
  $rotulo = New-Texto $texto.ToUpper() $PALETA.fraco 9.5 -Mono
  $rotulo.Margin = '8,0,0,6'
  return $rotulo
}

function New-Linha($chip, [int]$indice) {
  $partes = $chip.texto -split ' · ', 2
  $projeto = $partes[0]
  $rotulo = if ($partes.Count -gt 1) { $partes[1] } else { $chip.texto }

  $conteudo = New-Object System.Windows.Controls.Grid
  Add-Coluna $conteudo '26'
  Add-Coluna $conteudo '*'
  Add-Coluna $conteudo 'Auto'
  Add-Em $conteudo (New-Texto ('{0:00}' -f $indice) $PALETA.fraco 11 -Mono) 0
  $textos = New-Pilha 'Vertical'
  [void]$textos.Children.Add((New-Texto $rotulo $PALETA.tinta 13))
  [void]$textos.Children.Add((New-Texto "$projeto · $(Format-HaQuanto ((Get-Agora) - [long]$chip.desde))" $PALETA.dim 11.5))
  Add-Em $conteudo $textos 1
  $direita = New-Pilha
  $direita.Margin = '10,0,0,0'
  if ($chip.numero -gt 0 -and $chip.nota) {
    $esforco = New-Texto $chip.nota $PALETA.fraco 10.5 -Mono
    $esforco.Margin = '0,0,8,0'
    [void]$direita.Children.Add($esforco)
  }
  $nivel = if ($IMPORTANCIA.ContainsKey([string]$chip.cor)) { $IMPORTANCIA[[string]$chip.cor] } else { 1 }
  [void]$direita.Children.Add((New-Tracos $nivel))
  Add-Em $conteudo $direita 2

  $botao = New-Botao $conteudo $chip 'Linha' { param($origem) Open-Chat $origem.Tag }
  if ($chip.silenciado) { $botao.Opacity = 0.45 }
  if ($chip.cartao) { $botao.ToolTip = @($chip.cartao) -join "`n" }

  $linha = New-Object System.Windows.Controls.Grid
  Add-Coluna $linha '*'
  Add-Coluna $linha 'Auto'
  Add-Em $linha $botao 0
  $fechar = New-Botao ([string][char]0x00D7) $chip 'Fechar' { param($origem) Hide-Chip $origem.Tag }
  $fechar.ToolTip = 'Dispensar até haver novidades'
  $fechar.VerticalAlignment = 'Center'
  Add-Em $linha $fechar 1
  return $linha
}

function New-Trabalho($trabalho) {
  $caixa = New-Pilha 'Vertical'
  $caixa.Margin = '8,4,8,6'
  $topo = New-Object System.Windows.Controls.Grid
  Add-Coluna $topo '26'
  Add-Coluna $topo '*'
  Add-Coluna $topo 'Auto'
  $bloco = New-Bloco $PALETA.frio
  $bloco.HorizontalAlignment = 'Left'
  $bloco.Margin = '2,0,0,0'
  Add-Em $topo $bloco 0
  Add-Em $topo (New-Texto $trabalho.titulo $PALETA.tinta 12.5) 1
  $total = [int]$trabalho.total
  if ($total -gt 0) {
    $conta = New-Texto "$([int]$trabalho.feitos)/$total" $PALETA.fraco 10.5 -Mono
    $conta.Margin = '10,0,0,0'
    Add-Em $topo $conta 2
  }
  [void]$caixa.Children.Add($topo)
  $agora = if ($trabalho.atual) { $trabalho.atual } elseif ($trabalho.ultima) { $trabalho.ultima } else { $trabalho.projeto }
  if ($agora) {
    $passo = New-Texto $agora $PALETA.dim 11.5
    $passo.Margin = '26,1,0,0'
    [void]$caixa.Children.Add($passo)
  }
  if ($total -gt 0) {
    # Um segmento por passo do plano (no máximo 16, em proporção).
    $segmentos = [Math]::Min($total, 16)
    $cheios = [Math]::Round([int]$trabalho.feitos / $total * $segmentos)
    $barra = New-Object System.Windows.Controls.Primitives.UniformGrid
    $barra.Rows = 1
    $barra.Columns = $segmentos
    $barra.Margin = '26,5,0,0'
    for ($i = 0; $i -lt $segmentos; $i++) {
      $segmento = New-Object System.Windows.Shapes.Rectangle
      $segmento.Height = 3
      $segmento.Margin = '0,0,2,0'
      $segmento.Fill = Get-Pincel $(if ($i -lt $cheios) { $PALETA.frio } else { $PALETA.linha })
      [void]$barra.Children.Add($segmento)
    }
    [void]$caixa.Children.Add($barra)
  }
  return $caixa
}

function New-Divisoria {
  $divisoria = New-Object System.Windows.Shapes.Rectangle
  $divisoria.Height = 1
  $divisoria.Fill = Get-Pincel $PALETA.fraca
  $divisoria.Margin = '0,10,0,10'
  return $divisoria
}

function Update-Conteudo {
  $barra = Read-Barra
  $dispensados = Get-Dispensados
  $minuto = [Math]::Floor((Get-Agora) / 60000)
  $nova = "$($barra | ConvertTo-Json -Depth 8 -Compress)|$(($dispensados.GetEnumerator() | Sort-Object Key | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ',')|$minuto"
  if ($nova -eq $script:assinatura) { return }
  $script:assinatura = $nova

  $modelo = $barra.modelo
  $mostrar = { param($chip) -not ($dispensados.ContainsKey($chip.sessao) -and $dispensados[$chip.sessao] -eq [long]$chip.desde) }
  $chips = @()
  if ($modelo -and -not $modelo.vazia) {
    $chips = @(@($modelo.chips) + @($modelo.extra) | Where-Object { $_ -and (& $mostrar $_) })
  }
  $trabalhos = @($barra.trabalho | Where-Object { $_ })
  $total = $chips.Count
  $proximo = @($chips | Where-Object { -not $_.silenciado }) | Select-Object -First 1

  # Pílula: logo, quantos esperam e quantos estão a trabalhar.
  $pilula.Children.Clear()
  [void]$pilula.Children.Add((New-Marca ($total -gt 0)))
  if ($total -gt 0) {
    $numero = New-Texto "$total" $PALETA.tinta 14 -Mono -Forte
    $numero.Margin = '9,0,0,0'
    [void]$pilula.Children.Add($numero)
    $legenda = New-Texto 'à espera' $PALETA.dim 11.5
    $legenda.Margin = '6,0,0,0'
    [void]$pilula.Children.Add($legenda)
  } else {
    $legenda = New-Texto 'em dia' $PALETA.dim 11.5
    $legenda.Margin = '8,0,0,0'
    [void]$pilula.Children.Add($legenda)
  }
  if ($trabalhos.Count -gt 0) {
    $separador = New-Object System.Windows.Shapes.Rectangle
    $separador.Width = 1
    $separador.Height = 12
    $separador.Fill = Get-Pincel $PALETA.linha
    $separador.Margin = '10,0,10,0'
    [void]$pilula.Children.Add($separador)
    [void]$pilula.Children.Add((New-Bloco $PALETA.frio))
    $aTrabalhar = New-Texto "$($trabalhos.Count)" $PALETA.frio 12.5 -Mono
    $aTrabalhar.Margin = '6,0,0,0'
    $aTrabalhar.ToolTip = 'a trabalhar'
    [void]$pilula.Children.Add($aTrabalhar)
  }

  # Quadro: cabeça, os que esperam (como o quadro de partidas do gestor), os que trabalham, próximo.
  $quadro.Children.Clear()
  $cabeca = New-Object System.Windows.Controls.Grid
  Add-Coluna $cabeca 'Auto'
  Add-Coluna $cabeca '*'
  Add-Coluna $cabeca 'Auto'
  $marca = New-Pilha
  [void]$marca.Children.Add((New-Marca ($total -gt 0) 18))
  $nome = New-Texto 'Fila' $PALETA.tinta 13.5 -Forte
  $nome.Margin = '8,0,0,0'
  [void]$marca.Children.Add($nome)
  $contagem = New-Texto ('{0:00} à espera' -f $total) $(if ($total -gt 0) { $PALETA.sinal } else { $PALETA.fraco }) 10.5 -Mono
  $contagem.Margin = '10,1,0,0'
  [void]$marca.Children.Add($contagem)
  Add-Em $cabeca $marca 0
  Add-Em $cabeca (New-Botao "Gestor $([char]0x2197)" $null 'Fantasma' { Set-Gestor $true }) 2
  [void]$quadro.Children.Add($cabeca)
  if ($modelo.cabeca -like 'Foco:*') {
    $foco = New-Texto $modelo.cabeca $PALETA.sinal 11.5
    $foco.Margin = '0,6,0,0'
    [void]$quadro.Children.Add($foco)
  }
  [void]$quadro.Children.Add((New-Divisoria))

  if ($total -eq 0) {
    $vazio = New-Texto 'Nada à tua espera.' $PALETA.dim 12.5
    $vazio.Margin = '8,0,0,4'
    [void]$quadro.Children.Add($vazio)
  } else {
    [void]$quadro.Children.Add((New-Rotulo 'À espera de ti'))
    $indice = 0
    foreach ($chip in ($chips | Select-Object -First $MAX_LINHAS)) {
      $indice++
      [void]$quadro.Children.Add((New-Linha $chip $indice))
    }
    if ($total -gt $MAX_LINHAS) {
      $mais = New-Botao (New-Texto "+$($total - $MAX_LINHAS) no gestor" $PALETA.dim 11.5) $null 'Linha' { Set-Gestor $true }
      $mais.Padding = '8,5'
      [void]$quadro.Children.Add($mais)
    }
  }

  if ($trabalhos.Count -gt 0) {
    [void]$quadro.Children.Add((New-Divisoria))
    [void]$quadro.Children.Add((New-Rotulo "A trabalhar · $($trabalhos.Count)"))
    foreach ($trabalho in ($trabalhos | Select-Object -First $MAX_TRABALHO)) {
      [void]$quadro.Children.Add((New-Trabalho $trabalho))
    }
  }

  if ($proximo) {
    $partes = $proximo.texto -split ' · ', 2
    $conteudo = New-Object System.Windows.Controls.Grid
    Add-Coluna $conteudo 'Auto'
    Add-Coluna $conteudo '*'
    Add-Coluna $conteudo 'Auto'
    Add-Em $conteudo (New-Texto 'Próximo' '#111110' 12.5 -Forte) 0
    $alvo = New-Texto $partes[-1] '#5F5E59' 12.5
    $alvo.Margin = '10,0,10,0'
    Add-Em $conteudo $alvo 1
    Add-Em $conteudo (New-Texto ([string][char]0x2192) '#111110' 13 -Forte) 2
    $botao = New-Botao $conteudo $proximo 'Primario' { param($origem) Open-Chat $origem.Tag }
    $botao.Margin = '0,12,0,0'
    [void]$quadro.Children.Add($botao)
  }
}

# Desenha a pílula e o quadro em PNG (2x) sobre um fundo neutro, para ver o desenho sem correr a barra.
function Save-Previsao([string]$pasta) {
  New-Item -ItemType Directory -Force $pasta | Out-Null
  $janela.Content = $null
  $fundo = New-Object System.Windows.Controls.Border
  $fundo.Background = Get-Pincel '#FF2A2F38'
  $fundo.Padding = 24
  $fundo.Child = $borda
  foreach ($estado in @(@('pilula', $false), @('quadro', $true))) {
    Set-Aberto $estado[1]
    $quadro.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $null)
    $quadro.Opacity = 1
    $fundo.Measure((New-Object System.Windows.Size([double]::PositiveInfinity, [double]::PositiveInfinity)))
    $fundo.Arrange((New-Object System.Windows.Rect($fundo.DesiredSize)))
    $fundo.UpdateLayout()
    $imagem = New-Object System.Windows.Media.Imaging.RenderTargetBitmap([int]($fundo.ActualWidth * 2), [int]($fundo.ActualHeight * 2), 192, 192, [System.Windows.Media.PixelFormats]::Pbgra32)
    $imagem.Render($fundo)
    $png = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
    $png.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($imagem))
    $saida = [IO.File]::Create((Join-Path $pasta "$($estado[0]).png"))
    try { $png.Save($saida) } finally { $saida.Dispose() }
  }
}

try {
  $script:assinatura = ''
  $script:aberto = $false
  $script:direita, $script:fundo = Read-Posicao
  $guardado = Read-Guardado
  # Ao arrancar, o gestor fica fechado; a pílula como estava (do formato antigo, só `modo`).
  $script:gestorAberto = $false
  $script:pilulaVisivel = if ($null -ne $guardado.pilula) { [bool]$guardado.pilula } else { $guardado.modo -ne 'escondida' }

  $janela = New-Object System.Windows.Window
  $janela.Title = 'Fila de atenção'
  $janela.WindowStyle = 'None'
  $janela.AllowsTransparency = $true
  $janela.Background = [System.Windows.Media.Brushes]::Transparent
  $janela.Topmost = $true
  $janela.ShowInTaskbar = $false
  $janela.ResizeMode = 'NoResize'
  $janela.SizeToContent = 'WidthAndHeight'
  $janela.FontFamily = New-Object System.Windows.Media.FontFamily('Segoe UI Variable Text, Segoe UI')
  $janela.FontSize = 12.5
  [System.Windows.Media.TextOptions]::SetTextFormattingMode($janela, 'Display')

  $sombra = New-Object System.Windows.Media.Effects.DropShadowEffect
  $sombra.BlurRadius = 22
  $sombra.ShadowDepth = 3
  $sombra.Direction = 270
  $sombra.Opacity = 0.45

  $borda = New-Object System.Windows.Controls.Border
  $borda.Background = Get-Pincel $PALETA.fundo
  $borda.BorderBrush = Get-Pincel $PALETA.linha
  $borda.BorderThickness = 1
  $borda.Margin = 14
  $borda.Effect = $sombra
  $borda.Cursor = [System.Windows.Input.Cursors]::SizeAll
  $janela.Content = $borda

  $pilula = New-Pilha
  $pilula.Height = 18
  $quadro = New-Pilha 'Vertical'
  $quadro.Width = 372
  $quadro.Cursor = [System.Windows.Input.Cursors]::Arrow

  if ($Previsao) {
    Update-Conteudo
    Save-Previsao $Previsao
    exit
  }

  $janela.Add_SizeChanged({ Set-Ancora })
  $janela.Add_MouseLeftButtonDown({
    $abre.Stop()
    try { $janela.DragMove() } catch {}
    $script:direita = $janela.Left + $janela.ActualWidth
    $script:fundo = $janela.Top + $janela.ActualHeight
    Save-Posicao
  })

  # Abre com um pequeno atraso (passar o rato de raspão não abre) e fecha depois de sair.
  $abre = New-Object System.Windows.Threading.DispatcherTimer
  $abre.Interval = [TimeSpan]::FromMilliseconds(220)
  $abre.Add_Tick({ $abre.Stop(); if ($janela.IsMouseOver) { Set-Aberto $true } })
  $fecho = New-Object System.Windows.Threading.DispatcherTimer
  $fecho.Interval = [TimeSpan]::FromMilliseconds(600)
  $fecho.Add_Tick({
    $fecho.Stop()
    if (-not $janela.IsMouseOver) { Set-Aberto $false }
  })
  $janela.Add_MouseEnter({ $fecho.Stop(); if (-not $script:aberto) { $abre.Start() } })
  $janela.Add_MouseLeave({ $abre.Stop(); $fecho.Start() })

  # Depois de lançar o Edge, espera pela janela do gestor (até 30 s: depois de o Edge ser fechado à força, o primeiro arranque é lento) para a pôr à frente.
  $script:esperasGestor = 0
  $procuraGestor = New-Object System.Windows.Threading.DispatcherTimer
  $procuraGestor.Interval = [TimeSpan]::FromMilliseconds(250)
  $procuraGestor.Add_Tick({
    try {
      $script:esperasGestor++
      $janelaGestor = [JanelaGestor]::Procurar($TITULO_GESTOR)
      if ($janelaGestor -ne [IntPtr]::Zero) {
        $procuraGestor.Stop()
        if ($script:gestorAberto) { [JanelaGestor]::Mostrar($janelaGestor); $script:confirmarGestor = 3; $confirmaGestor.Start() } else { [JanelaGestor]::Esconder($janelaGestor) }
      } elseif ($script:esperasGestor -ge 120) {
        $procuraGestor.Stop()
        Add-Content $registoErros "$(Get-Date -Format s) a janela do gestor não apareceu"
      }
    } catch {
      $procuraGestor.Stop()
      Add-Content $registoErros "$(Get-Date -Format s) gestor: $_"
    }
  })

  # O Edge acaba de compor a janela depois de ela aparecer: confirma (até 3 vezes) que ficou
  # maximizada e à frente, e volta a mostrá-la se não.
  $script:confirmarGestor = 0
  $confirmaGestor = New-Object System.Windows.Threading.DispatcherTimer
  $confirmaGestor.Interval = [TimeSpan]::FromMilliseconds(900)
  $confirmaGestor.Add_Tick({
    try {
      $script:confirmarGestor--
      $janelaGestor = [JanelaGestor]::Procurar($TITULO_GESTOR)
      if ($script:confirmarGestor -le 0 -or -not $script:gestorAberto -or $janelaGestor -eq [IntPtr]::Zero) { $confirmaGestor.Stop(); return }
      if (-not [JanelaGestor]::Maximizada($janelaGestor)) { [JanelaGestor]::Mostrar($janelaGestor) }
    } catch {
      $confirmaGestor.Stop()
      Add-Content $registoErros "$(Get-Date -Format s) confirmar gestor: $_"
    }
  })

  $script:tentativasClaude = 0
  $frenteClaude = New-Object System.Windows.Threading.DispatcherTimer
  $frenteClaude.Interval = [TimeSpan]::FromMilliseconds(200)
  $frenteClaude.Add_Tick({
    try {
      $script:tentativasClaude++
      $claude = [JanelaGestor]::ProcurarClaude()
      if ($claude -ne [IntPtr]::Zero) {
        $frenteClaude.Stop()
        [JanelaGestor]::PorAFrente($claude)
      } elseif ($script:tentativasClaude -ge 15) {
        $frenteClaude.Stop()
      }
    } catch {
      $frenteClaude.Stop()
      Add-Content $registoErros "$(Get-Date -Format s) claude à frente: $_"
    }
  })
  # O Abrir e o Novo chat do gestor deixam este sinal depois de mandarem o link à app.
  $sinalClaude = New-Object SinalFila($raiz, 'claude-a-frente.json')
  $sinalClaude.Add_Recebido({ Show-Claude })

  # O servidor do gestor arranca com a barra; a janela só quando se abre o gestor.
  try { [void](Start-Gestor) } catch { Add-Content $registoErros "$(Get-Date -Format s) gestor: $_" }

  $atalho = New-Object TeclaFila([uint32]$ATALHO_TECLA, $SEGURAR_MS)
  # O toque decide pelo estado real da janela, não pelo que a barra julga: se está à vista fecha, senão abre.
  $atalho.Add_Toque({ Set-Gestor (-not (Test-GestorAberto)) })
  $atalho.Add_Segurada({ Switch-Pilula })
  if (-not $atalho.Instalar()) {
    Add-Content $registoErros "$(Get-Date -Format s) não foi possível apanhar a tecla de menu"
  }

  Update-Conteudo
  $relogio = New-Object System.Windows.Threading.DispatcherTimer
  $relogio.Interval = [TimeSpan]::FromSeconds(2)
  $relogio.Add_Tick({
    try { Update-Conteudo; Watch-Gestor } catch { Add-Content $registoErros "$(Get-Date -Format s) $_" }
  })
  $relogio.Start()

  # Show/Hide em vez de ShowDialog: esconder uma janela modal fechava-a.
  $aplicacao = New-Object System.Windows.Application
  $aplicacao.ShutdownMode = 'OnExplicitShutdown'
  Set-Gestor $false
  [void]$aplicacao.Run()
  $atalho.Remover()
} catch {
  Add-Content $registoErros "$(Get-Date -Format s) $_"
  throw
}
