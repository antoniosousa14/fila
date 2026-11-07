using System;
using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Threading;

namespace NextUp
{
    // O NextUp: junta o gancho da tecla de menu, o servidor do gestor, a janela do gestor, a pílula
    // e o ícone da bandeja.
    //   toque na tecla   abre o gestor (maximizado); outro toque esconde-o
    //   segurar ~1 s     mostra ou esconde a pílula
    // Com o gestor aberto a pílula sai e volta quando ele fecha; fechar ou minimizar a janela do
    // gestor conta como fechá-lo. O estado (posição da pílula, pílula e gestor) fica em
    // barra-posicao.json, como na barra antiga.
    sealed class Aplicacao
    {
        const uint TECLA_MENU = 0x5D;            // VK_APPS
        const int SEGURAR_MS = 900;
        public const int SAIDA_REINICIAR = 3;    // o guardião volta a arrancar a app
        public const int SAIDA_CAIU = 4;         // a app desistiu de si mesma (erros em cadeia)
        const string MUTEX = @"Local\nextup-barra";   // o mesmo da barra antiga: nunca correm as duas
        public const string EVENTO_ABRIR = @"Local\nextup-abrir";
        public const string EVENTO_SAIR = @"Local\nextup-sair";

        static readonly Regex IdChat = new Regex(@"^[A-Za-z0-9_\-]{1,80}$", RegexOptions.Compiled);
        static readonly Regex IdSessao = new Regex(@"^[A-Za-z0-9_\-\.]{1,120}$", RegexOptions.Compiled);

        Application wpf;
        Dispatcher ui;
        Posicao estado;
        Servidor servidor;
        GestorJanela gestor;
        Pilula pilula;
        TeclaNextUp tecla;
        Bandeja bandeja;
        DispatcherTimer relogio;
        DispatcherTimer sinal;
        DispatcherTimer frenteClaude;
        DateTime ultimoSinal;
        int tentativasClaude;
        int voltas;
        int verificandoServidor;
        int gestorSemJanela;
        int errosUi;
        DateTime inicioErros = DateTime.UtcNow;
        int saida;
        // Voltas do relógio (2 s) entre reinstalar o gancho e escrever o sinal de vida (10 min);
        // NEXTUP_BATIMENTO serve só para testar.
        readonly int batimento = LerBatimento();

        static int LerBatimento()
        {
            int voltas;
            return int.TryParse(Environment.GetEnvironmentVariable("NEXTUP_BATIMENTO"), out voltas) && voltas > 0 ? voltas : 300;
        }

        // Devolve o código de saída: 0 sair de vez, SAIDA_REINICIAR/SAIDA_CAIU para o guardião
        // arrancar de novo.
        public static int Correr(bool esperar)
        {
            Registo.Etiqueta = "app";
            Excecoes.Instalar();
            bool minha;
            using (var unica = new Mutex(true, MUTEX, out minha))
            {
                if (!minha && esperar)
                {
                    // Um reinício: a instância velha ainda está a sair.
                    minha = unica.WaitOne(10000);
                }
                if (!minha)
                {
                    Registo.Info("já há um NextUp a correr: peço-lhe para abrir o gestor");
                    Sinal.Enviar(Aplicacao.EVENTO_ABRIR);
                    return 0;
                }
                try
                {
                    return new Aplicacao().Executar();
                }
                catch (Exception e)
                {
                    Registo.Erro("a app caiu ao arrancar", e);
                    return SAIDA_CAIU;
                }
                finally
                {
                    try { unica.ReleaseMutex(); } catch (ApplicationException) { }
                }
            }
        }

        int Executar()
        {
            Registo.Info("a arrancar (versão " + typeof(Aplicacao).Assembly.GetName().Version + ", guardião: "
                + (Environment.GetEnvironmentVariable("NEXTUP_GUARDIAO") == "1" ? "sim" : "não") + ")");
            Arranque.Migrar();
            wpf = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
            ui = wpf.Dispatcher;
            Excecoes.Interface(wpf, ContarErroUi);
            wpf.SessionEnding += (o, e) =>
            {
                Registo.Info("a sessão do Windows vai terminar (" + e.ReasonSessionEnding + ")");
                Terminar(0, false);
            };

            estado = Posicao.Ler();
            estado.Gestor = false;   // ao arrancar o gestor fica fechado; a pílula como estava

            servidor = new Servidor();
            servidor.Mudou += () => ui.BeginInvoke(new Action(AtualizarUrl));

            pilula = new Pilula(Caminhos.Barra) { Direita = estado.Direita, Fundo = estado.Fundo };
            pilula.AbrirGestor = () => DefinirGestor(true);
            pilula.AbrirChat = AbrirChat;
            pilula.Dispensar = Dispensar;
            pilula.PosicaoMudou = () =>
            {
                estado.Direita = pilula.Direita;
                estado.Fundo = pilula.Fundo;
                estado.Guardar();
            };

            gestor = new GestorJanela();
            gestor.Fechada = () =>
            {
                if (estado.Gestor) DefinirGestor(false);
            };
            gestor.ClaudeAFrente = ClaudeAFrente;

            bandeja = new Bandeja(
                () => DefinirGestor(!gestor.EstaAberta),
                () => estado.Pilula,
                AlternarPilula,
                () => { var t = servidor.ReiniciarAsync(); },
                () => Terminar(SAIDA_REINICIAR, true),
                () => Terminar(0, true));

            tecla = new TeclaNextUp(TECLA_MENU, SEGURAR_MS);
            // O gancho corre no seu fio: só passa o trabalho para o fio da interface. O toque
            // decide pelo estado real da janela (se está à vista fecha, senão abre).
            tecla.Toque += () => ui.BeginInvoke(new Action(() => DefinirGestor(!gestor.EstaAberta)));
            tecla.Segurada += () => ui.BeginInvoke(new Action(AlternarPilula));
            if (!tecla.Instalar())
            {
                bandeja.Aviso("NextUp", "Não foi possível apanhar a tecla de menu.");
            }

            pilula.Atualizar();
            pilula.DefinirVisivel(estado.Pilula);
            ActualizarBandeja();

            // O servidor do gestor arranca com a app; a janela (já aquecida) só aparece quando se abre o gestor.
            Task.Run(() => servidor.Garantir());
            ui.BeginInvoke(DispatcherPriority.ApplicationIdle, new Action(() => gestor.PreAquecer()));

            ultimoSinal = DataDe(Caminhos.ClaudeAFrente);
            sinal = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(300) };
            sinal.Tick += (o, e) => VerSinal();
            sinal.Start();

            relogio = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2) };
            relogio.Tick += (o, e) => Volta();
            relogio.Start();

            frenteClaude = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(200) };
            frenteClaude.Tick += (o, e) => TentarClaude();

            Sinal.Escutar(EVENTO_ABRIR, () => ui.BeginInvoke(new Action(() => DefinirGestor(true))));
            Sinal.Escutar(EVENTO_SAIR, () => Terminar(0, true));

            estado.Guardar();
            Registo.Info("pronta");
            wpf.Run();
            return saida;
        }

        // ---- estado ----

        void DefinirGestor(bool aberto)
        {
            estado.Gestor = aberto;
            gestorSemJanela = 0;
            pilula.DefinirVisivel(estado.Pilula && !estado.Gestor);
            // Um erro com o gestor não pode deitar abaixo a app.
            try
            {
                if (aberto)
                {
                    gestor.Mostrar();
                    if (!servidor.Saudavel) Task.Run(() => servidor.Garantir());
                }
                else
                {
                    gestor.Esconder();
                }
            }
            catch (Exception e)
            {
                Registo.Erro("gestor", e);
            }
            estado.Guardar();
        }

        void AlternarPilula()
        {
            estado.Pilula = !estado.Pilula;
            pilula.DefinirVisivel(estado.Pilula && !estado.Gestor);
            estado.Guardar();
        }

        void AtualizarUrl()
        {
            if (servidor.Url != null) gestor.DefinirUrl(servidor.Url);
        }

        void ActualizarBandeja()
        {
            bandeja.Atualizar(pilula.Esperam, pilula.Trabalham);
        }

        // ---- o relógio (de 2 em 2 segundos) ----

        void Volta()
        {
            try
            {
                voltas++;
                pilula.Atualizar();
                ActualizarBandeja();
                if (voltas % 5 == 0) pilula.ReforcarTopo();

                // Se a janela do gestor foi escondida sem a app dar por isso, conta como fechada
                // (duas voltas seguidas, para não apanhar o instante em que está a abrir).
                if (estado.Gestor && !gestor.EstaAberta) gestorSemJanela++; else gestorSemJanela = 0;
                if (gestorSemJanela >= 2) DefinirGestor(false);

                // O servidor do gestor, de 6 em 6 segundos.
                if (voltas % 3 == 0 && Interlocked.CompareExchange(ref verificandoServidor, 1, 0) == 0)
                {
                    Task.Run(() =>
                    {
                        try { servidor.Garantir(); }
                        catch (Exception e) { Registo.Erro("servidor do gestor", e); }
                        finally { Interlocked.Exchange(ref verificandoServidor, 0); }
                    });
                }

                // De 10 em 10 minutos: reinstala o gancho (o Windows tira-os em silêncio quando
                // acha que demoram) e deixa um sinal de vida no registo.
                if (voltas % batimento == 0)
                {
                    tecla.Reinstalar();
                    Registo.Info("viva (" + Math.Round(Process.GetCurrentProcess().WorkingSet64 / 1048576.0) + " MB na memória, "
                        + Math.Round(GC.GetTotalMemory(false) / 1048576.0) + " MB geridos, " + GC.CollectionCount(2) + " recolhas, servidor "
                        + (servidor.Saudavel ? "na porta " + servidor.Porta : "em baixo") + ")");
                }
            }
            catch (Exception e)
            {
                Registo.Erro("relógio", e);
            }
        }

        // ---- ligações ao Claude ----

        void AbrirChat(string local)
        {
            if (!IdChat.IsMatch(local ?? "")) return;
            try
            {
                Process.Start(new ProcessStartInfo("claude://claude.ai/epitaxy/" + local) { UseShellExecute = true });
                ClaudeAFrente();
            }
            catch (Exception e)
            {
                Registo.Erro("abrir o chat", e);
            }
        }

        void Dispensar(string sessao, long desde)
        {
            if (!IdSessao.IsMatch(sessao ?? "")) return;
            try
            {
                Directory.CreateDirectory(Caminhos.Itens);
                File.WriteAllText(Path.Combine(Caminhos.Itens, sessao + ".dispensado.json"), "{\"desde\":" + desde + "}");
            }
            catch (Exception e)
            {
                Registo.Erro("dispensar o chat", e);
            }
        }

        // Põe a app do Claude à frente depois de lhe mandar um link (ela própria não consegue: o
        // Windows só deixa vir para a frente quem recebeu o último clique). Tenta durante 3 s,
        // porque com a app fechada na bandeja a janela só aparece depois de a app tratar o link.
        void ClaudeAFrente()
        {
            tentativasClaude = 0;
            frenteClaude.Stop();
            frenteClaude.Start();
        }

        void TentarClaude()
        {
            try
            {
                tentativasClaude++;
                IntPtr claude = Nativo.ProcurarClaude();
                if (claude != IntPtr.Zero)
                {
                    frenteClaude.Stop();
                    Nativo.PorAFrente(claude);
                    Registo.Info("Claude posto à frente (tentativa " + tentativasClaude + ")");
                }
                else if (tentativasClaude >= 15)
                {
                    frenteClaude.Stop();
                    Registo.Aviso("não encontrei a janela do Claude em 3 s");
                }
            }
            catch (Exception e)
            {
                frenteClaude.Stop();
                Registo.Erro("pôr o Claude à frente", e);
            }
        }

        static DateTime DataDe(string ficheiro)
        {
            try { return File.GetLastWriteTimeUtc(ficheiro); }
            catch (Exception) { return DateTime.MinValue; }
        }

        // O Abrir e o Novo chat do gestor deixam este sinal depois de mandarem o link à app.
        void VerSinal()
        {
            DateTime quando = DataDe(Caminhos.ClaudeAFrente);
            if (quando > ultimoSinal)
            {
                ultimoSinal = quando;
                ClaudeAFrente();
            }
        }

        // ---- sair ----

        void ContarErroUi()
        {
            // Erros da interface não matam a app, mas muitos seguidos significam que ficou num
            // estado mau: sai com um código que faz o guardião arrancá-la de novo.
            if ((DateTime.UtcNow - inicioErros).TotalSeconds > 60)
            {
                inicioErros = DateTime.UtcNow;
                errosUi = 0;
            }
            if (++errosUi > 40)
            {
                Registo.Erro("demasiados erros na interface num minuto: vou reiniciar");
                Terminar(SAIDA_CAIU, false);
            }
        }

        void Terminar(int codigo, bool pararServidor)
        {
            if (!ui.CheckAccess())
            {
                ui.BeginInvoke(new Action(() => Terminar(codigo, pararServidor)));
                return;
            }
            Registo.Info("a terminar (código " + codigo + ")");
            saida = codigo;
            try
            {
                sinal.Stop();
                relogio.Stop();
                tecla.Remover();
                bandeja.Dispose();
                if (pararServidor && codigo == 0) servidor.Parar();
                gestor.Terminar();
                pilula.Close();
            }
            catch (Exception e)
            {
                Registo.Erro("ao terminar", e);
            }
            if (codigo == SAIDA_REINICIAR && Environment.GetEnvironmentVariable("NEXTUP_GUARDIAO") != "1")
            {
                // Sem guardião não há quem arranque outra: arranca-se a si própria.
                try
                {
                    Process.Start(new ProcessStartInfo(Caminhos.Exe, "--app --esperar") { UseShellExecute = false, WorkingDirectory = Caminhos.Perfil });
                    saida = 0;
                }
                catch (Exception e)
                {
                    Registo.Erro("reiniciar sem guardião", e);
                }
            }
            wpf.Shutdown(saida);
        }
    }

    // Avisos entre instâncias: outro NextUp (o atalho, um duplo clique no .exe) pede à que já corre
    // para abrir o gestor; `NextUp.exe --sair` pede-lhe para sair.
    static class Sinal
    {
        public static bool Enviar(string nome)
        {
            try
            {
                using (var evento = EventWaitHandle.OpenExisting(nome)) evento.Set();
                return true;
            }
            catch (Exception e)
            {
                Registo.Aviso("não consegui avisar o NextUp que corre (" + nome + "): " + e.Message);
                return false;
            }
        }

        public static void Escutar(string nome, Action quandoChega)
        {
            var evento = new EventWaitHandle(false, EventResetMode.AutoReset, nome);
            var fio = new Thread(() =>
            {
                while (true)
                {
                    try
                    {
                        evento.WaitOne();
                        quandoChega();
                    }
                    catch (Exception e)
                    {
                        Registo.Erro("sinal de abrir", e);
                        Thread.Sleep(1000);
                    }
                }
            });
            fio.IsBackground = true;
            fio.Name = "sinal-abrir";
            fio.Start();
        }
    }

    // Exceções que ninguém tratou: ficam no registo em vez de desaparecerem.
    static class Excecoes
    {
        public static void Instalar()
        {
            AppDomain.CurrentDomain.UnhandledException += (o, e) =>
            {
                Registo.Erro("exceção fatal" + (e.IsTerminating ? " (a app vai fechar)" : ""), e.ExceptionObject as Exception);
            };
            TaskScheduler.UnobservedTaskException += (o, e) =>
            {
                Registo.Erro("tarefa com erro por tratar", e.Exception);
                e.SetObserved();
            };
        }

        public static void Interface(Application app, Action contar)
        {
            app.DispatcherUnhandledException += (o, e) =>
            {
                Registo.Erro("erro na interface", e.Exception);
                e.Handled = true;
                contar();
            };
        }
    }
}
