using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace Fila
{
    // A janela do gestor: o WebView2 (o motor do Edge, mas dentro desta app) a mostrar a página do
    // servidor local, em ecrã inteiro. Fechá-la ou minimizá-la só a esconde (a página fica
    // carregada, por isso volta já); é a app que decide quando a mostra, com a tecla de menu.
    sealed class GestorJanela : Window
    {
        public const string TituloGestor = "Fila · gestor de chats";
        const string PaginaEspera = "<!doctype html><meta charset=utf-8><title>" + TituloGestor + "</title>"
            + "<body style=\"margin:0;height:100vh;display:grid;place-items:center;background:#111110;color:#9A9993;"
            + "font:15px 'Segoe UI Variable Text','Segoe UI',sans-serif\"><div>A ligar ao gestor…</div>";

        readonly Grid raiz;
        readonly DispatcherTimer repetir;
        readonly DispatcherTimer confirma;
        WebView2 web;
        string url;               // o endereço do servidor, quando o há
        string destino;           // o endereço que a página está a tentar carregar
        bool carregada;           // a página do servidor está carregada
        bool iniciando;
        bool preAquecida;
        bool posicionada;         // já foi posta no ecrã (a janela aquece fora dele)
        bool sair;
        int confirmacoes;

        // A pessoa fechou ou minimizou a janela: conta como fechar o gestor.
        public Action Fechada;
        // Um link claude:// foi aberto a partir da página: a app põe o Claude à frente.
        public Action ClaudeAFrente;

        public GestorJanela()
        {
            Title = TituloGestor;
            Background = Paleta.Pincel(Paleta.Escuro);
            Icon = Marca.Imagem(true, 64);
            ShowInTaskbar = true;
            WindowStartupLocation = WindowStartupLocation.Manual;
            Width = 1200;
            Height = 780;
            MinWidth = 640;
            MinHeight = 420;
            raiz = new Grid { Background = Paleta.Pincel(Paleta.Escuro) };
            Content = raiz;

            // Se a página não carrega (o servidor ainda arranca, ou reinicia), volta a tentar.
            repetir = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2) };
            repetir.Tick += (o, e) =>
            {
                if (url != null && !carregada) Navegar();
            };
            confirma = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(500) };
            confirma.Tick += (o, e) => Confirmar();
        }

        protected override void OnSourceInitialized(EventArgs e)
        {
            base.OnSourceInitialized(e);
            Nativo.TituloEscuro(new WindowInteropHelper(this).Handle);
        }

        public bool EstaAberta { get { return IsVisible && WindowState != WindowState.Minimized; } }

        // ---- mostrar e esconder ----

        // Cria a janela e o WebView2 fora do ecrã e esconde-a, para o primeiro toque na tecla
        // mostrar o gestor já pronto.
        public void PreAquecer()
        {
            if (IsVisible || web != null) return;
            preAquecida = true;
            ShowInTaskbar = false;
            ShowActivated = false;
            var alca = new WindowInteropHelper(this).EnsureHandle();
            Nativo.Mover(alca, -32000, -32000, 1200, 780);
            Show();
            IniciarWeb();
            // Esconde-a quando a página estiver carregada (ou ao fim de 15 s, aconteça o que acontecer).
            var ate = DateTime.UtcNow.AddSeconds(15);
            var espera = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(300) };
            espera.Tick += (o, e) =>
            {
                if (!preAquecida) { espera.Stop(); return; }
                if (carregada || DateTime.UtcNow > ate)
                {
                    espera.Stop();
                    preAquecida = false;
                    Hide();
                    ShowInTaskbar = true;
                    ShowActivated = true;
                }
            };
            espera.Start();
        }

        // Maximizada e à frente, no ecrã onde está o rato.
        public void Mostrar()
        {
            preAquecida = false;
            ShowInTaskbar = true;
            ShowActivated = true;
            var alca = new WindowInteropHelper(this).EnsureHandle();
            if (!IsVisible || !posicionada)
            {
                // Ainda escondida (ou fora do ecrã, a aquecer): põe-na no ecrã do rato antes de
                // a maximizar, para ela maximizar nesse ecrã.
                if (WindowState != WindowState.Normal) WindowState = WindowState.Normal;
                var ecra = System.Windows.Forms.Screen.FromPoint(System.Windows.Forms.Cursor.Position);
                var area = ecra.WorkingArea;
                Nativo.Mover(alca, area.X + 60, area.Y + 60, Math.Max(640, area.Width - 120), Math.Max(420, area.Height - 120));
                posicionada = true;
            }
            else if (WindowState == WindowState.Minimized)
            {
                WindowState = WindowState.Normal;
            }
            WindowState = WindowState.Maximized;
            if (!IsVisible) Show();
            Activate();
            Nativo.Focar(alca);
            if (web == null) IniciarWeb();
            // Confirma (até 3 vezes) que ficou maximizada e à frente, e volta a pedi-lo se não.
            confirmacoes = 3;
            confirma.Start();
        }

        void Confirmar()
        {
            confirmacoes--;
            if (confirmacoes <= 0 || !IsVisible)
            {
                confirma.Stop();
                return;
            }
            var alca = new WindowInteropHelper(this).Handle;
            if (WindowState != WindowState.Maximized) WindowState = WindowState.Maximized;
            if (Nativo.JanelaAFrente() != alca) Nativo.Focar(alca);
        }

        public void Esconder()
        {
            confirma.Stop();
            if (IsVisible) Hide();
        }

        // Fechar de verdade (ao sair da app).
        public void Terminar()
        {
            sair = true;
            try { Close(); } catch (InvalidOperationException) { }
        }

        protected override void OnClosing(CancelEventArgs e)
        {
            if (!sair)
            {
                e.Cancel = true;
                Esconder();
                var aviso = Fechada;
                if (aviso != null) aviso();
            }
            base.OnClosing(e);
        }

        protected override void OnStateChanged(EventArgs e)
        {
            base.OnStateChanged(e);
            // Minimizar conta como fechar: esconde-a (maximizada outra vez para a próxima) e a
            // pílula volta.
            if (WindowState == WindowState.Minimized && !preAquecida)
            {
                Dispatcher.BeginInvoke(new Action(() =>
                {
                    Esconder();
                    WindowState = WindowState.Maximized;
                    var aviso = Fechada;
                    if (aviso != null) aviso();
                }));
            }
        }

        // ---- a página ----

        // O endereço do servidor mudou (ou apareceu). Navega se a página ainda não está nele.
        public void DefinirUrl(string nova)
        {
            if (nova == null || nova == url) return;
            url = nova;
            if (web != null && web.CoreWebView2 != null) Navegar();
        }

        void Navegar()
        {
            try
            {
                destino = url;
                carregada = false;
                web.CoreWebView2.Navigate(url);
                repetir.Start();
            }
            catch (Exception e)
            {
                Registo.Erro("gestor: navegar", e);
            }
        }

        void CriarWeb()
        {
            if (web != null)
            {
                raiz.Children.Remove(web);
                try { web.Dispose(); } catch (Exception) { }
            }
            web = new WebView2
            {
                DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 17, 17, 16),
            };
            raiz.Children.Add(web);
        }

        async void IniciarWeb()
        {
            if (iniciando) return;
            iniciando = true;
            try
            {
                if (web == null) CriarWeb();
                var ambiente = await CoreWebView2Environment.CreateAsync(null, Caminhos.PerfilWeb, new CoreWebView2EnvironmentOptions { Language = "pt-PT" });
                await web.EnsureCoreWebView2Async(ambiente);
                var c = web.CoreWebView2;
                c.Settings.IsStatusBarEnabled = false;
                c.Settings.IsZoomControlEnabled = false;
                c.Settings.IsPasswordAutosaveEnabled = false;
                c.Settings.IsGeneralAutofillEnabled = false;
                c.Settings.IsPinchZoomEnabled = false;
                c.Settings.IsSwipeNavigationEnabled = false;
                c.NewWindowRequested += (o, e) =>
                {
                    e.Handled = true;
                    AbrirFora(e.Uri);
                };
                c.NavigationStarting += (o, e) =>
                {
                    if (!EhLocal(e.Uri) && !e.Uri.StartsWith("data:", StringComparison.OrdinalIgnoreCase) && !e.Uri.StartsWith("about:", StringComparison.OrdinalIgnoreCase))
                    {
                        e.Cancel = true;
                        AbrirFora(e.Uri);
                    }
                };
                c.NavigationCompleted += AoNavegar;
                c.ProcessFailed += AoFalhar;
                c.WindowCloseRequested += (o, e) =>
                {
                    Esconder();
                    var aviso = Fechada;
                    if (aviso != null) aviso();
                };
                Registo.Info("gestor: WebView2 pronto (" + c.Environment.BrowserVersionString + ")");
                if (url != null) Navegar();
                else
                {
                    destino = null;
                    c.NavigateToString(PaginaEspera);
                }
            }
            catch (Exception e)
            {
                Registo.Erro("gestor: o WebView2 não arrancou; abro o gestor no navegador", e);
                AbrirFora(url);
            }
            finally
            {
                iniciando = false;
            }
        }

        void AoNavegar(object origem, CoreWebView2NavigationCompletedEventArgs e)
        {
            if (destino == null) return;   // a página de espera
            if (e.IsSuccess)
            {
                carregada = true;
                repetir.Stop();
                return;
            }
            carregada = false;
            if (e.WebErrorStatus == CoreWebView2WebErrorStatus.OperationCanceled) return;
            Registo.Aviso("gestor: a página não carregou (" + e.WebErrorStatus + "); volto a tentar");
            destino = null;
            web.CoreWebView2.NavigateToString(PaginaEspera);
            repetir.Start();
        }

        void AoFalhar(object origem, CoreWebView2ProcessFailedEventArgs e)
        {
            Registo.Aviso("gestor: falhou um processo do WebView2 (" + e.ProcessFailedKind + ")");
            switch (e.ProcessFailedKind)
            {
                case CoreWebView2ProcessFailedKind.BrowserProcessExited:
                    // O WebView2 morreu por inteiro: cria-se outro.
                    carregada = false;
                    Dispatcher.BeginInvoke(new Action(() =>
                    {
                        CriarWeb();
                        iniciando = false;
                        IniciarWeb();
                    }));
                    break;
                case CoreWebView2ProcessFailedKind.RenderProcessExited:
                case CoreWebView2ProcessFailedKind.RenderProcessUnresponsive:
                    carregada = false;
                    Dispatcher.BeginInvoke(new Action(() =>
                    {
                        try { web.CoreWebView2.Reload(); } catch (Exception ex) { Registo.Erro("gestor: recarregar", ex); }
                    }));
                    break;
            }
        }

        static bool EhLocal(string endereco)
        {
            Uri uri;
            if (!Uri.TryCreate(endereco, UriKind.Absolute, out uri)) return false;
            return (uri.Scheme == Uri.UriSchemeHttp) && (uri.Host == "127.0.0.1" || uri.Host == "localhost");
        }

        // Links para fora do gestor abrem no navegador (ou na app do Claude, se forem claude://).
        void AbrirFora(string endereco)
        {
            Uri uri;
            if (string.IsNullOrEmpty(endereco) || !Uri.TryCreate(endereco, UriKind.Absolute, out uri)) return;
            string esquema = uri.Scheme;
            if (esquema != Uri.UriSchemeHttp && esquema != Uri.UriSchemeHttps && esquema != Uri.UriSchemeMailto && esquema != "claude") return;
            try
            {
                Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
                if (esquema == "claude")
                {
                    var aviso = ClaudeAFrente;
                    if (aviso != null) aviso();
                }
            }
            catch (Exception e)
            {
                Registo.Erro("gestor: não abri " + esquema + " link", e);
            }
        }
    }
}
