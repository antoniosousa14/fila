using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace NextUp
{
    // Cuida do servidor do gestor (gestor\servidor.mjs, Node): adota o que já estiver a correr e
    // saudável, senão arranca um, e volta a arrancá-lo se morrer ou deixar de responder.
    // O servidor escreve a porta e o pid em gestor.json; /api/saude responde com o pid.
    sealed class Servidor
    {
        const int MAX_SEM_RESPOSTA = 4;
        static readonly HttpClient http = new HttpClient { Timeout = TimeSpan.FromMilliseconds(3000) };
        readonly object trinco = new object();
        string node;
        string script;
        int falhas;
        int semResposta;
        DateTime ultimoArranque = DateTime.MinValue;
        int porta;

        // A porta do servidor saudável, ou 0.
        public int Porta { get { return porta; } }
        public string Url { get { return porta > 0 ? "http://127.0.0.1:" + porta + "/" : null; } }
        public bool Saudavel { get { return porta > 0; } }

        // Para saber quando a porta muda (o servidor reiniciou noutra porta) ou aparece.
        public event Action Mudou;

        public Servidor()
        {
            script = Caminhos.Servidor();
            if (script == null) Registo.Erro("não encontrei gestor\\servidor.mjs (defina NEXTUP_PROJETO)");
        }

        static string ProcurarNode()
        {
            string path = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (string pasta in path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
            {
                try
                {
                    string f = Path.Combine(pasta.Trim().Trim('"'), "node.exe");
                    if (File.Exists(f)) return f;
                }
                catch (ArgumentException) { }
            }
            foreach (var raiz in new[] { Environment.SpecialFolder.ProgramFiles, Environment.SpecialFolder.ProgramFilesX86, Environment.SpecialFolder.LocalApplicationData })
            {
                string f = Path.Combine(Environment.GetFolderPath(raiz), "nodejs", "node.exe");
                if (File.Exists(f)) return f;
            }
            return null;
        }

        static JsonElement? LerGestor()
        {
            try
            {
                using (var doc = JsonDocument.Parse(File.ReadAllText(Caminhos.Gestor)))
                {
                    return doc.RootElement.Clone();
                }
            }
            catch
            {
                return null;
            }
        }

        const int OCUPADO = -1;

        // O servidor de gestor.json está vivo, é um node e responde? Devolve a porta; 0 se não há
        // servidor; OCUPADO se o processo existe mas não responde (pode estar só a trabalhar).
        static int Verificar()
        {
            var g = LerGestor();
            if (g == null) return 0;
            int p;
            try
            {
                int pid = g.Value.GetProperty("pid").GetInt32();
                p = g.Value.GetProperty("porta").GetInt32();
                using (var processo = Process.GetProcessById(pid))
                {
                    if (!processo.ProcessName.Equals("node", StringComparison.OrdinalIgnoreCase)) return 0;
                }
            }
            catch
            {
                return 0;
            }
            try
            {
                using (var resposta = http.GetAsync("http://127.0.0.1:" + p + "/api/saude").GetAwaiter().GetResult())
                {
                    return resposta.IsSuccessStatusCode ? p : OCUPADO;
                }
            }
            catch (Exception)
            {
                return OCUPADO;
            }
        }

        void Definir(int nova)
        {
            if (nova == porta) return;
            porta = nova;
            Registo.Info("servidor do gestor " + (nova > 0 ? "na porta " + nova : "indisponível"));
            var aviso = Mudou;
            if (aviso != null) aviso();
        }

        // Garante um servidor saudável (bloqueia até uns 6 s; chamar fora do fio da interface).
        // Um servidor vivo que não responde não é logo morto: pode estar a ler muitas transcrições.
        // Só depois de várias verificações seguidas sem resposta é que é parado e arrancado de novo.
        public bool Garantir()
        {
            lock (trinco)
            {
                int p = Verificar();
                if (p > 0)
                {
                    falhas = 0;
                    semResposta = 0;
                    Definir(p);
                    return true;
                }
                if (p == OCUPADO)
                {
                    semResposta++;
                    if (semResposta < MAX_SEM_RESPOSTA) return porta > 0;
                    Registo.Aviso("o servidor do gestor não responde há " + semResposta + " verificações: vou reiniciá-lo");
                    semResposta = 0;
                    PararSemTrinco();
                }
                else
                {
                    semResposta = 0;
                }
                Definir(0);
                return Arrancar();
            }
        }

        bool Arrancar()
        {
            if (script == null) return false;
            if (node == null) node = ProcurarNode();
            if (node == null)
            {
                Registo.Erro("não encontrei o node.exe (instale o Node.js)");
                return false;
            }
            // Um servidor que morre logo ao arrancar não pode ser reiniciado em ciclo apertado.
            double espera = Math.Min(60, Math.Pow(2, Math.Min(falhas, 6)));
            if ((DateTime.UtcNow - ultimoArranque).TotalSeconds < espera) return false;
            ultimoArranque = DateTime.UtcNow;
            falhas++;
            try
            {
                var arranque = new ProcessStartInfo(node, "\"" + script + "\"")
                {
                    // Pasta de trabalho fora do projeto, para o processo não prender a pasta da app.
                    WorkingDirectory = Caminhos.Perfil,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                };
                using (Process.Start(arranque)) { }
                Registo.Info("servidor do gestor: arrancado (tentativa " + falhas + ")");
            }
            catch (Exception e)
            {
                Registo.Erro("servidor do gestor: não arrancou", e);
                return false;
            }
            for (int i = 0; i < 60; i++)
            {
                Thread.Sleep(100);
                int p = Verificar();
                if (p > 0)
                {
                    falhas = 0;
                    Definir(p);
                    return true;
                }
            }
            Registo.Erro("o servidor do gestor não respondeu em 6 s (ver gestor-erros.log)");
            return false;
        }

        public Task<bool> GarantirAsync()
        {
            return Task.Run(() => Garantir());
        }

        // Pára o servidor (para o reiniciar com código novo, ou ao sair).
        public void Parar()
        {
            lock (trinco)
            {
                PararSemTrinco();
                falhas = 0;
                semResposta = 0;
                ultimoArranque = DateTime.MinValue;
            }
        }

        void PararSemTrinco()
        {
            var g = LerGestor();
            Definir(0);
            if (g == null) return;
            try
            {
                int pid = g.Value.GetProperty("pid").GetInt32();
                using (var processo = Process.GetProcessById(pid))
                {
                    if (processo.ProcessName.Equals("node", StringComparison.OrdinalIgnoreCase))
                    {
                        processo.Kill();
                        processo.WaitForExit(3000);
                        Registo.Info("servidor do gestor: parado (pid " + pid + ")");
                    }
                }
            }
            catch (Exception e)
            {
                Registo.Aviso("servidor do gestor: não consegui parar: " + e.Message);
            }
        }

        public Task ReiniciarAsync()
        {
            return Task.Run(() =>
            {
                Parar();
                Garantir();
            });
        }
    }
}
