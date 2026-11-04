using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;
using System.Windows.Media.Imaging;
using System.Windows.Shapes;
using System.Windows.Threading;

namespace Fila
{
    // A pílula (logo, quantos esperam, quantos trabalham) no canto do ecrã e, com o rato em cima,
    // o quadro com os chats à espera, os que trabalham e os botões Próximo e Gestor. Desenha o
    // barra.json que o mod escreve em cada evento de cada chat. Janela sem moldura, transparente,
    // sempre à frente e sem foco: clicar nela não tira o foco ao Claude.
    sealed class Pilula : Window
    {
        const int MAX_LINHAS = 6;
        const int MAX_TRABALHO = 4;
        static readonly Dictionary<string, int> Importancia = new Dictionary<string, int>
        {
            // mod/src/barra.ts COR
            { "#E24B4A", 3 }, { "#EF9F27", 2 }, { "#888780", 1 },
        };

        const string XamlEstilos = """
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
""";

        static ResourceDictionary estilos;
        static ResourceDictionary Estilos
        {
            get { return estilos ?? (estilos = (ResourceDictionary)XamlReader.Parse(XamlEstilos)); }
        }

        static readonly FontFamily FonteMono = new FontFamily("Cascadia Mono, Consolas");

        readonly string ficheiroBarra;
        readonly Border borda;
        readonly StackPanel pilula;
        readonly StackPanel quadro;
        readonly DispatcherTimer abre;
        readonly DispatcherTimer fecho;
        bool aberto;
        string assinatura = "";
        JsonNode ultimaBarra;

        // Onde a pílula está: o canto inferior direito (a pílula cresce para cima e para a esquerda).
        public double Direita;
        public double Fundo;

        // Quantos esperam e quantos trabalham (para o ícone da bandeja).
        public int Esperam;
        public int Trabalham;

        // Pedidos à app; a pílula só desenha.
        public Action AbrirGestor;
        public Action<string> AbrirChat;                 // id local do chat
        public Action<string, long> Dispensar;           // sessão e "desde" do chat
        public Action PosicaoMudou;

        public Pilula(string ficheiroBarra)
        {
            this.ficheiroBarra = ficheiroBarra;
            Title = "Fila";
            WindowStyle = WindowStyle.None;
            AllowsTransparency = true;
            Background = Brushes.Transparent;
            Topmost = true;
            ShowInTaskbar = false;
            ShowActivated = false;
            ResizeMode = ResizeMode.NoResize;
            SizeToContent = SizeToContent.WidthAndHeight;
            FontFamily = new FontFamily("Segoe UI Variable Text, Segoe UI");
            FontSize = 12.5;
            TextOptions.SetTextFormattingMode(this, TextFormattingMode.Display);

            borda = new Border
            {
                Background = Paleta.Pincel(Paleta.Fundo),
                BorderBrush = Paleta.Pincel(Paleta.Linha),
                BorderThickness = new Thickness(1),
                Margin = new Thickness(14),
                Cursor = Cursors.SizeAll,
                Effect = new DropShadowEffect { BlurRadius = 22, ShadowDepth = 3, Direction = 270, Opacity = 0.45 },
            };
            Content = borda;
            pilula = new StackPanel { Orientation = Orientation.Horizontal, Height = 18 };
            quadro = new StackPanel { Orientation = Orientation.Vertical, Width = 372, Cursor = Cursors.Arrow };

            // Abre com um pequeno atraso (passar o rato de raspão não abre) e fecha depois de sair.
            abre = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(220) };
            abre.Tick += (o, e) =>
            {
                abre.Stop();
                if (IsMouseOver) DefinirAberto(true);
            };
            fecho = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(600) };
            fecho.Tick += (o, e) =>
            {
                fecho.Stop();
                if (!IsMouseOver) DefinirAberto(false);
            };
            MouseEnter += (o, e) =>
            {
                fecho.Stop();
                if (!aberto) abre.Start();
            };
            MouseLeave += (o, e) =>
            {
                abre.Stop();
                fecho.Start();
            };
            SizeChanged += (o, e) => Ancorar();
            MouseLeftButtonDown += (o, e) =>
            {
                abre.Stop();
                try { DragMove(); } catch (InvalidOperationException) { }
                Direita = Left + ActualWidth;
                Fundo = Top + ActualHeight;
                var aviso = PosicaoMudou;
                if (aviso != null) aviso();
            };
            DefinirAberto(false);
        }

        protected override void OnSourceInitialized(EventArgs e)
        {
            base.OnSourceInitialized(e);
            Nativo.SemFoco(new WindowInteropHelper(this).Handle);
        }

        // Ancora o canto inferior direito, sem sair do ecrã (uma pílula perto do topo cresce para baixo).
        void Ancorar()
        {
            Left = Math.Max(SystemParameters.VirtualScreenLeft, Direita - ActualWidth);
            Top = Math.Max(SystemParameters.VirtualScreenTop, Fundo - ActualHeight);
        }

        public bool Aberto { get { return aberto; } }

        public void DefinirAberto(bool novo, bool animar = true)
        {
            if (aberto == novo && borda.Child != null) return;
            aberto = novo;
            if (novo)
            {
                borda.Padding = new Thickness(14, 12, 14, 14);
                borda.CornerRadius = new CornerRadius(12);
                borda.Child = quadro;
                if (animar)
                {
                    quadro.BeginAnimation(OpacityProperty, new DoubleAnimation(0, 1, new Duration(TimeSpan.FromMilliseconds(140))));
                }
            }
            else
            {
                borda.Padding = new Thickness(11, 8, 12, 8);
                borda.CornerRadius = new CornerRadius(10);
                borda.Child = pilula;
            }
        }

        // A pílula vê-se se a pessoa a quer visível e o gestor está fechado: com o gestor aberto
        // (ecrã inteiro) sai, para não ficar por cima dele, e volta quando ele fecha.
        public void DefinirVisivel(bool visivel)
        {
            // Fechar já o quadro: uma janela transparente reaparece com a última imagem que
            // desenhou, e o quadro grande piscava antes de dar lugar à pílula.
            DefinirAberto(false);
            if (visivel)
            {
                if (IsVisible) return;
                Opacity = 0;
                Show();
                UpdateLayout();
                Ancorar();
                Dispatcher.BeginInvoke(DispatcherPriority.Loaded, new Action(() => Opacity = 1));
            }
            else
            {
                UpdateLayout();
                Hide();
            }
        }

        // Outras janelas "sempre à frente" (ecrã inteiro, o Explorer a reiniciar) podem passar à
        // frente da pílula: volta a pô-la no topo, sem lhe dar o foco.
        public void ReforcarTopo()
        {
            if (!IsVisible) return;
            var alca = new WindowInteropHelper(this).Handle;
            if (alca != IntPtr.Zero) Nativo.ReforcarTopo(alca);
        }

        // ---- dados ----

        static string Texto(JsonNode no, string chave)
        {
            JsonNode filho = no == null ? null : no[chave];
            return filho == null ? null : filho.ToString();
        }

        static double Numero(JsonNode no, string chave)
        {
            double v;
            return double.TryParse(Texto(no, chave), NumberStyles.Float, CultureInfo.InvariantCulture, out v) ? v : 0;
        }

        static bool Verdade(JsonNode no, string chave)
        {
            return string.Equals(Texto(no, chave), "true", StringComparison.OrdinalIgnoreCase);
        }

        static IEnumerable<JsonNode> Lista(JsonNode no, string chave)
        {
            var matriz = no == null ? null : no[chave] as JsonArray;
            if (matriz == null) yield break;
            foreach (var item in matriz)
            {
                if (item != null) yield return item;
            }
        }

        static long Agora()
        {
            return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        }

        internal static string HaQuanto(double ms)
        {
            double minutos = Math.Max(0, Math.Floor(ms / 60000));
            if (minutos < 60) return "há " + minutos.ToString("0", CultureInfo.InvariantCulture) + " min";
            return "há " + Math.Floor(minutos / 60).ToString("0", CultureInfo.InvariantCulture) + "h"
                + (minutos % 60).ToString("00", CultureInfo.InvariantCulture);
        }

        static Dictionary<string, long> LerDispensados()
        {
            var dispensados = new Dictionary<string, long>();
            try
            {
                if (!Directory.Exists(Caminhos.Itens)) return dispensados;
                foreach (string f in Directory.EnumerateFiles(Caminhos.Itens, "*.dispensado.json"))
                {
                    try
                    {
                        var no = JsonNode.Parse(File.ReadAllText(f));
                        string nome = System.IO.Path.GetFileName(f);
                        dispensados[nome.Substring(0, nome.Length - ".dispensado.json".Length)] = (long)Numero(no, "desde");
                    }
                    catch
                    {
                        // ficheiro a meio de ser escrito ou estragado: ignora
                    }
                }
            }
            catch
            {
                // pasta ilegível: ninguém dispensado
            }
            return dispensados;
        }

        // ---- construção ----

        static TextBlock Bloco(string texto, string cor = Paleta.Dim, double tamanho = 12.5, bool mono = false, bool forte = false)
        {
            var bloco = new TextBlock
            {
                Text = texto,
                Foreground = Paleta.Pincel(cor),
                FontSize = tamanho,
                VerticalAlignment = VerticalAlignment.Center,
                TextTrimming = TextTrimming.CharacterEllipsis,
            };
            if (mono) bloco.FontFamily = FonteMono;
            if (forte) bloco.FontWeight = FontWeights.SemiBold;
            return bloco;
        }

        static Button Botao(object conteudo, object etiqueta, string estilo, Action<object> acao)
        {
            var botao = new Button { Style = (Style)Estilos[estilo], Content = conteudo, Tag = etiqueta };
            botao.Click += (o, e) => acao(((Button)o).Tag);
            return botao;
        }

        static void Coluna(Grid grelha, string largura)
        {
            grelha.ColumnDefinitions.Add(new ColumnDefinition { Width = (GridLength)new GridLengthConverter().ConvertFromString(largura) });
        }

        static void Em(Grid grelha, UIElement filho, int coluna)
        {
            Grid.SetColumn(filho, coluna);
            grelha.Children.Add(filho);
        }

        static Rectangle Quadrado(string cor, double largura = 6, double altura = 6)
        {
            return new Rectangle
            {
                Width = largura,
                Height = altura,
                Fill = Paleta.Pincel(cor),
                RenderTransform = new SkewTransform(-18, 0),
                RenderTransformOrigin = new Point(0.5, 0.5),
                VerticalAlignment = VerticalAlignment.Center,
            };
        }

        // Importância em três traços, como no quadro do gestor; a alta acende o sinal.
        static StackPanel Tracos(int nivel)
        {
            var tracos = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            for (int i = 1; i <= 3; i++)
            {
                string cor = i > nivel ? Paleta.Linha : nivel == 3 ? Paleta.Sinal : Paleta.Dim;
                var traco = Quadrado(cor, 3, 10);
                traco.Margin = new Thickness(1.5, 0, 1.5, 0);
                tracos.Children.Add(traco);
            }
            return tracos;
        }

        static TextBlock Rotulo(string texto)
        {
            var rotulo = Bloco(texto.ToUpperInvariant(), Paleta.Fraco, 9.5, mono: true);
            rotulo.Margin = new Thickness(8, 0, 0, 6);
            return rotulo;
        }

        static Rectangle Divisoria()
        {
            return new Rectangle { Height = 1, Fill = Paleta.Pincel(Paleta.Fraca), Margin = new Thickness(0, 10, 0, 10) };
        }

        static string[] ParteTexto(string texto)
        {
            return (texto ?? "").Split(new[] { " · " }, 2, StringSplitOptions.None);
        }

        UIElement Linha(JsonNode chip, int indice)
        {
            string texto = Texto(chip, "texto") ?? "";
            string[] partes = ParteTexto(texto);
            string projeto = partes[0];
            string rotulo = partes.Length > 1 ? partes[1] : texto;

            var conteudo = new Grid();
            Coluna(conteudo, "26");
            Coluna(conteudo, "*");
            Coluna(conteudo, "Auto");
            Em(conteudo, Bloco(indice.ToString("00", CultureInfo.InvariantCulture), Paleta.Fraco, 11, mono: true), 0);
            var textos = new StackPanel { Orientation = Orientation.Vertical };
            textos.Children.Add(Bloco(rotulo, Paleta.Tinta, 13));
            textos.Children.Add(Bloco(projeto + " · " + HaQuanto(Agora() - Numero(chip, "desde")), Paleta.Dim, 11.5));
            Em(conteudo, textos, 1);
            var direita = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(10, 0, 0, 0) };
            string nota = Texto(chip, "nota");
            if (Numero(chip, "numero") > 0 && !string.IsNullOrEmpty(nota))
            {
                var esforco = Bloco(nota, Paleta.Fraco, 10.5, mono: true);
                esforco.Margin = new Thickness(0, 0, 8, 0);
                direita.Children.Add(esforco);
            }
            int nivel;
            if (!Importancia.TryGetValue(Texto(chip, "cor") ?? "", out nivel)) nivel = 1;
            direita.Children.Add(Tracos(nivel));
            Em(conteudo, direita, 2);

            var botao = Botao(conteudo, chip, "Linha", etiqueta => AbrirDoChip((JsonNode)etiqueta));
            if (Verdade(chip, "silenciado")) botao.Opacity = 0.45;
            var cartao = Lista(chip, "cartao").Select(c => c.ToString()).ToArray();
            if (cartao.Length > 0) botao.ToolTip = string.Join("\n", cartao);

            var linha = new Grid();
            Coluna(linha, "*");
            Coluna(linha, "Auto");
            Em(linha, botao, 0);
            var fechar = Botao("×", chip, "Fechar", etiqueta => DispensarChip((JsonNode)etiqueta));
            fechar.ToolTip = "Dispensar até haver novidades";
            fechar.VerticalAlignment = VerticalAlignment.Center;
            Em(linha, fechar, 1);
            return linha;
        }

        void AbrirDoChip(JsonNode chip)
        {
            string local = Texto(chip, "local");
            DefinirAberto(false);
            var acao = AbrirChat;
            if (!string.IsNullOrEmpty(local) && acao != null) acao(local);
        }

        void DispensarChip(JsonNode chip)
        {
            string sessao = Texto(chip, "sessao");
            var acao = Dispensar;
            if (!string.IsNullOrEmpty(sessao) && acao != null) acao(sessao, (long)Numero(chip, "desde"));
            assinatura = "";
            Atualizar();
        }

        UIElement Trabalho(JsonNode trabalho)
        {
            var caixa = new StackPanel { Orientation = Orientation.Vertical, Margin = new Thickness(8, 4, 8, 6) };
            var topo = new Grid();
            Coluna(topo, "26");
            Coluna(topo, "*");
            Coluna(topo, "Auto");
            var bloco = Quadrado(Paleta.Frio);
            bloco.HorizontalAlignment = HorizontalAlignment.Left;
            bloco.Margin = new Thickness(2, 0, 0, 0);
            Em(topo, bloco, 0);
            Em(topo, Bloco(Texto(trabalho, "titulo") ?? "", Paleta.Tinta, 12.5), 1);
            int total = (int)Numero(trabalho, "total");
            int feitos = (int)Numero(trabalho, "feitos");
            if (total > 0)
            {
                var conta = Bloco(feitos + "/" + total, Paleta.Fraco, 10.5, mono: true);
                conta.Margin = new Thickness(10, 0, 0, 0);
                Em(topo, conta, 2);
            }
            caixa.Children.Add(topo);
            string agora = Texto(trabalho, "atual");
            if (string.IsNullOrEmpty(agora)) agora = Texto(trabalho, "ultima");
            if (string.IsNullOrEmpty(agora)) agora = Texto(trabalho, "projeto");
            if (!string.IsNullOrEmpty(agora))
            {
                var passo = Bloco(agora, Paleta.Dim, 11.5);
                passo.Margin = new Thickness(26, 1, 0, 0);
                caixa.Children.Add(passo);
            }
            if (total > 0)
            {
                // Um segmento por passo do plano (no máximo 16, em proporção).
                int segmentos = Math.Min(total, 16);
                double cheios = Math.Round((double)feitos / total * segmentos, MidpointRounding.AwayFromZero);
                var barra = new UniformGrid { Rows = 1, Columns = segmentos, Margin = new Thickness(26, 5, 0, 0) };
                for (int i = 0; i < segmentos; i++)
                {
                    barra.Children.Add(new Rectangle
                    {
                        Height = 3,
                        Margin = new Thickness(0, 0, 2, 0),
                        Fill = Paleta.Pincel(i < cheios ? Paleta.Frio : Paleta.Linha),
                    });
                }
                caixa.Children.Add(barra);
            }
            return caixa;
        }

        // Relê o barra.json e os chats dispensados e redesenha a pílula e o quadro, se algo mudou.
        public void Atualizar()
        {
            string texto = null;
            JsonNode barra = ultimaBarra;
            try
            {
                if (File.Exists(ficheiroBarra))
                {
                    texto = File.ReadAllText(ficheiroBarra);
                    barra = JsonNode.Parse(texto);
                }
            }
            catch
            {
                // o mod pode estar a escrever o ficheiro: fica o desenho anterior até à próxima volta
                barra = ultimaBarra;
                texto = ultimaBarra == null ? null : ultimaBarra.ToJsonString();
            }
            var dispensados = LerDispensados();
            long minuto = Agora() / 60000;
            string nova = texto + "|" + string.Join(",", dispensados.OrderBy(d => d.Key, StringComparer.Ordinal).Select(d => d.Key + "=" + d.Value)) + "|" + minuto;
            if (nova == assinatura) return;
            assinatura = nova;
            ultimaBarra = barra;
            Desenhar(barra, dispensados);
        }

        void Desenhar(JsonNode barra, Dictionary<string, long> dispensados)
        {
            JsonNode modelo = barra == null ? null : barra["modelo"];
            var chips = new List<JsonNode>();
            if (modelo != null && !Verdade(modelo, "vazia"))
            {
                foreach (var chip in Lista(modelo, "chips").Concat(Lista(modelo, "extra")))
                {
                    long desde;
                    string sessao = Texto(chip, "sessao");
                    if (sessao != null && dispensados.TryGetValue(sessao, out desde) && desde == (long)Numero(chip, "desde")) continue;
                    chips.Add(chip);
                }
            }
            // Um «a trabalhar» dispensado (preso depois de um /clear, por exemplo) fica de fora até haver um turno novo.
            var trabalhos = Lista(barra, "trabalho").Where(t =>
            {
                long desdeT;
                string sessaoT = Texto(t, "sessao");
                return !(sessaoT != null && dispensados.TryGetValue(sessaoT, out desdeT) && desdeT == (long)Numero(t, "desde"));
            }).ToList();
            int total = chips.Count;
            Esperam = total;
            Trabalham = trabalhos.Count;
            JsonNode proximo = chips.FirstOrDefault(c => !Verdade(c, "silenciado"));

            // Pílula: logo, quantos esperam e quantos estão a trabalhar.
            pilula.Children.Clear();
            pilula.Children.Add(Marca.Criar(total > 0, 16));
            if (total > 0)
            {
                var numero = Bloco(total.ToString(CultureInfo.InvariantCulture), Paleta.Tinta, 14, mono: true, forte: true);
                numero.Margin = new Thickness(9, 0, 0, 0);
                pilula.Children.Add(numero);
                var legenda = Bloco("à espera", Paleta.Dim, 11.5);
                legenda.Margin = new Thickness(6, 0, 0, 0);
                pilula.Children.Add(legenda);
            }
            else
            {
                var legenda = Bloco("em dia", Paleta.Dim, 11.5);
                legenda.Margin = new Thickness(8, 0, 0, 0);
                pilula.Children.Add(legenda);
            }
            if (trabalhos.Count > 0)
            {
                pilula.Children.Add(new Rectangle
                {
                    Width = 1,
                    Height = 12,
                    Fill = Paleta.Pincel(Paleta.Linha),
                    Margin = new Thickness(10, 0, 10, 0),
                });
                pilula.Children.Add(Quadrado(Paleta.Frio));
                var aTrabalhar = Bloco(trabalhos.Count.ToString(CultureInfo.InvariantCulture), Paleta.Frio, 12.5, mono: true);
                aTrabalhar.Margin = new Thickness(6, 0, 0, 0);
                aTrabalhar.ToolTip = "a trabalhar";
                pilula.Children.Add(aTrabalhar);
            }

            // Quadro: cabeça, os que esperam (como o quadro de partidas do gestor), os que trabalham, próximo.
            quadro.Children.Clear();
            var cabeca = new Grid();
            Coluna(cabeca, "Auto");
            Coluna(cabeca, "*");
            Coluna(cabeca, "Auto");
            var marca = new StackPanel { Orientation = Orientation.Horizontal };
            marca.Children.Add(Marca.Criar(total > 0, 18));
            var nome = Bloco("Fila", Paleta.Tinta, 13.5, forte: true);
            nome.Margin = new Thickness(8, 0, 0, 0);
            marca.Children.Add(nome);
            var contagem = Bloco(total.ToString("00", CultureInfo.InvariantCulture) + " à espera", total > 0 ? Paleta.Sinal : Paleta.Fraco, 10.5, mono: true);
            contagem.Margin = new Thickness(10, 1, 0, 0);
            marca.Children.Add(contagem);
            Em(cabeca, marca, 0);
            Em(cabeca, Botao("Gestor ↗", null, "Fantasma", etiqueta => PedirGestor()), 2);
            quadro.Children.Add(cabeca);
            string cabecaTexto = modelo == null ? null : Texto(modelo, "cabeca");
            if (cabecaTexto != null && cabecaTexto.StartsWith("Foco:", StringComparison.OrdinalIgnoreCase))
            {
                var foco = Bloco(cabecaTexto, Paleta.Sinal, 11.5);
                foco.Margin = new Thickness(0, 6, 0, 0);
                quadro.Children.Add(foco);
            }
            quadro.Children.Add(Divisoria());

            if (total == 0)
            {
                var vazio = Bloco("Nada à tua espera.", Paleta.Dim, 12.5);
                vazio.Margin = new Thickness(8, 0, 0, 4);
                quadro.Children.Add(vazio);
            }
            else
            {
                quadro.Children.Add(Rotulo("À espera de ti"));
                int indice = 0;
                foreach (var chip in chips.Take(MAX_LINHAS))
                {
                    indice++;
                    quadro.Children.Add(Linha(chip, indice));
                }
                if (total > MAX_LINHAS)
                {
                    var mais = Botao(Bloco("+" + (total - MAX_LINHAS) + " no gestor", Paleta.Dim, 11.5), null, "Linha", etiqueta => PedirGestor());
                    mais.Padding = new Thickness(8, 5, 8, 5);
                    quadro.Children.Add(mais);
                }
            }

            if (trabalhos.Count > 0)
            {
                quadro.Children.Add(Divisoria());
                quadro.Children.Add(Rotulo("A trabalhar · " + trabalhos.Count));
                foreach (var trabalho in trabalhos.Take(MAX_TRABALHO)) quadro.Children.Add(Trabalho(trabalho));
            }

            if (proximo != null)
            {
                string[] partes = ParteTexto(Texto(proximo, "texto"));
                var conteudo = new Grid();
                Coluna(conteudo, "Auto");
                Coluna(conteudo, "*");
                Coluna(conteudo, "Auto");
                Em(conteudo, Bloco("Próximo", Paleta.Escuro, 12.5, forte: true), 0);
                var alvo = Bloco(partes[partes.Length - 1], Paleta.Fraco, 12.5);
                alvo.Margin = new Thickness(10, 0, 10, 0);
                Em(conteudo, alvo, 1);
                Em(conteudo, Bloco("→", Paleta.Escuro, 13, forte: true), 2);
                var botao = Botao(conteudo, proximo, "Primario", etiqueta => AbrirDoChip((JsonNode)etiqueta));
                botao.Margin = new Thickness(0, 12, 0, 0);
                quadro.Children.Add(botao);
            }
        }

        void PedirGestor()
        {
            DefinirAberto(false);
            var acao = AbrirGestor;
            if (acao != null) acao();
        }

        // Desenha a pílula e o quadro em PNG (2x) sobre um fundo neutro, para ver o desenho sem
        // correr a app.
        public void GravarPrevisao(string pasta)
        {
            Directory.CreateDirectory(pasta);
            Content = null;
            var fundo = new Border { Background = Paleta.Pincel("#FF2A2F38"), Padding = new Thickness(24), Child = borda };
            foreach (var estado in new[] { new { Nome = "pilula", Aberto = false }, new { Nome = "quadro", Aberto = true } })
            {
                DefinirAberto(estado.Aberto, animar: false);
                quadro.BeginAnimation(OpacityProperty, null);
                quadro.Opacity = 1;
                fundo.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
                fundo.Arrange(new Rect(fundo.DesiredSize));
                fundo.UpdateLayout();
                var imagem = new RenderTargetBitmap((int)(fundo.ActualWidth * 2), (int)(fundo.ActualHeight * 2), 192, 192, PixelFormats.Pbgra32);
                imagem.Render(fundo);
                var png = new PngBitmapEncoder();
                png.Frames.Add(BitmapFrame.Create(imagem));
                using (var saida = File.Create(System.IO.Path.Combine(pasta, estado.Nome + ".png"))) png.Save(saida);
            }
        }
    }
}
