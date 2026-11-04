using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

namespace Fila
{
    // Gancho de teclado de baixo nível para a tecla de menu: engole todas as pressões (com ou sem
    // Shift, Ctrl, Alt, Win) para ela não fazer mais nada enquanto a app corre, e distingue um
    // toque (largar antes de segurarMs) de segurar (avisa ao fim de segurarMs, sem esperar que a
    // larguem). A repetição de tecla presa não conta como outro toque.
    //
    // O gancho corre num fio só seu, com o seu ciclo de mensagens: o Windows tira em silêncio um
    // gancho que demore a responder, e no fio da interface isso acontecia com a app ocupada. Por
    // isso a resposta do gancho é só marcar o estado e avisar; quem trata é o fio da interface.
    // Por segurança volta a instalar o gancho de tempos a tempos (ver Reinstalar).
    sealed class TeclaFila
    {
        delegate IntPtr Gancho(int codigo, IntPtr mensagem, IntPtr dados);

        [StructLayout(LayoutKind.Sequential)]
        struct MSG
        {
            public IntPtr janela; public uint mensagem; public IntPtr w, l; public uint hora; public int x, y;
        }

        [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookEx(int tipo, Gancho funcao, IntPtr modulo, uint fio);
        [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr gancho);
        [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr gancho, int codigo, IntPtr mensagem, IntPtr dados);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandle(string nome);
        [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
        [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr janela, uint de, uint ate);
        [DllImport("user32.dll")] static extern bool PeekMessage(out MSG m, IntPtr janela, uint de, uint ate, uint remover);
        [DllImport("user32.dll")] static extern bool PostThreadMessage(uint fio, uint mensagem, IntPtr w, IntPtr l);

        const int WH_KEYBOARD_LL = 13;
        const int WM_KEYDOWN = 0x100;
        const int WM_SYSKEYDOWN = 0x104;
        const uint WM_QUIT = 0x12;
        const uint WM_REINSTALAR = 0x8001;   // WM_APP + 1
        // Uma tecla presa repete a cada ~30 ms; um segundo sem nada é uma tecla que já foi largada
        // sem a app ver (o gancho trocado, o ecrã bloqueado).
        const long SILENCIO_MS = 1000;

        readonly uint tecla;
        readonly int segurarMs;
        readonly Gancho funcao;
        readonly Timer segurar;
        readonly object trinco = new object();
        readonly Stopwatch relogio = Stopwatch.StartNew();
        IntPtr gancho;
        uint fioGancho;
        bool premida;
        bool segurada;
        long ultimoEvento;

        // Chamados no fio do gancho (ou do temporizador): quem os recebe só deve passar o trabalho
        // para o fio da interface.
        public event Action Toque;
        public event Action Segurada;

        public TeclaFila(uint tecla, int segurarMs)
        {
            this.tecla = tecla;
            this.segurarMs = segurarMs;
            funcao = Tratar;
            segurar = new Timer(AoSegurar, null, Timeout.Infinite, Timeout.Infinite);
        }

        void AoSegurar(object estado)
        {
            lock (trinco)
            {
                if (!premida || segurada) return;
                segurada = true;
            }
            Avisar(Segurada);
        }

        static void Avisar(Action evento)
        {
            try
            {
                if (evento != null) evento();
            }
            catch (Exception e)
            {
                Registo.Erro("tecla: o tratador do evento falhou", e);
            }
        }

        // A máquina de estados, sem o Windows pelo meio (é isto que os autotestes exercitam).
        internal void Evento(bool desce)
        {
            bool toque = false;
            lock (trinco)
            {
                long agora = relogio.ElapsedMilliseconds;
                if (premida && agora - ultimoEvento > SILENCIO_MS)
                {
                    // A largada perdeu-se: esta pressão é uma pressão nova.
                    premida = false;
                    segurada = false;
                    segurar.Change(Timeout.Infinite, Timeout.Infinite);
                }
                ultimoEvento = agora;
                if (desce && !premida)
                {
                    premida = true;
                    segurada = false;
                    segurar.Change(segurarMs, Timeout.Infinite);
                }
                else if (!desce && premida)
                {
                    premida = false;
                    segurar.Change(Timeout.Infinite, Timeout.Infinite);
                    toque = !segurada;
                }
            }
            if (toque) Avisar(Toque);
        }

        IntPtr Novo()
        {
            return SetWindowsHookEx(WH_KEYBOARD_LL, funcao, GetModuleHandle(null), 0);
        }

        public bool Instalar()
        {
            bool instalado = false;
            var pronto = new ManualResetEvent(false);
            var fio = new Thread(() =>
            {
                try
                {
                    gancho = Novo();
                    instalado = gancho != IntPtr.Zero;
                    fioGancho = GetCurrentThreadId();
                    MSG m;
                    PeekMessage(out m, IntPtr.Zero, 0, 0, 0);   // cria a fila de mensagens do fio
                    pronto.Set();
                    if (!instalado) return;
                    while (GetMessage(out m, IntPtr.Zero, 0, 0) > 0)
                    {
                        if (m.mensagem == WM_REINSTALAR) Trocar();
                    }
                    UnhookWindowsHookEx(gancho);
                }
                catch (Exception e)
                {
                    Registo.Erro("fio do gancho da tecla", e);
                    pronto.Set();
                }
            });
            fio.IsBackground = true;
            fio.Priority = ThreadPriority.Highest;
            fio.Name = "gancho-tecla";
            fio.Start();
            pronto.WaitOne();
            if (!instalado) Registo.Erro("não foi possível apanhar a tecla de menu (erro " + Marshal.GetLastWin32Error() + ")");
            return instalado;
        }

        // Instala o gancho novo antes de tirar o velho, para nunca haver um instante sem gancho
        // (a tecla de menu abriria o menu de contexto).
        void Trocar()
        {
            IntPtr novo = Novo();
            if (novo == IntPtr.Zero)
            {
                Registo.Aviso("tecla: não consegui reinstalar o gancho; fica o antigo");
                return;
            }
            IntPtr velho = gancho;
            gancho = novo;
            UnhookWindowsHookEx(velho);
        }

        // O Windows tira ganchos em silêncio (se um demorar demais) e não avisa: trocar o gancho
        // de tempos a tempos garante que ele volta, mesmo que isso tenha acontecido.
        public void Reinstalar()
        {
            if (fioGancho != 0) PostThreadMessage(fioGancho, WM_REINSTALAR, IntPtr.Zero, IntPtr.Zero);
        }

        public void Remover()
        {
            if (fioGancho != 0) PostThreadMessage(fioGancho, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
        }

        IntPtr Tratar(int codigo, IntPtr mensagem, IntPtr dados)
        {
            // Uma exceção aqui, num retorno de chamada nativo, deitava a app abaixo.
            try
            {
                if (codigo >= 0 && (uint)Marshal.ReadInt32(dados) == tecla)
                {
                    int tipo = (int)mensagem;
                    Evento(tipo == WM_KEYDOWN || tipo == WM_SYSKEYDOWN);
                    return (IntPtr)1;
                }
            }
            catch (Exception e)
            {
                Registo.Erro("gancho da tecla", e);
            }
            return CallNextHookEx(gancho, codigo, mensagem, dados);
        }
    }
}
