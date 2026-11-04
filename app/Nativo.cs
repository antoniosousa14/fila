using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace Fila
{
    // Chamadas ao Windows que o WPF não dá: pôr janelas à frente, encontrar a janela do Claude,
    // estilos de janela e a barra de título escura.
    static class Nativo
    {
        delegate bool Enumerar(IntPtr janela, IntPtr dados);

        [DllImport("user32.dll")] static extern bool EnumWindows(Enumerar funcao, IntPtr dados);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr janela, StringBuilder texto, int max);
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr janela, int comando);
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr janela);
        [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr janela);
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr janela, IntPtr processo);
        [DllImport("user32.dll", EntryPoint = "GetWindowThreadProcessId")] static extern uint ProcessoDaJanela(IntPtr janela, out uint processo);
        [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
        [DllImport("user32.dll")] static extern bool AttachThreadInput(uint de, uint para, bool ligar);
        [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr janela, IntPtr depois, int x, int y, int largura, int altura, uint flags);
        [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr janela);
        [DllImport("user32.dll")] static extern bool IsIconic(IntPtr janela);
        [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr janela);
        [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr janela, int indice);
        [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] static extern IntPtr SetWindowLongPtr(IntPtr janela, int indice, IntPtr valor);
        [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr janela, int atributo, ref int valor, int tamanho);

        const int SW_SHOW = 5, SW_RESTORE = 9;
        const int GWL_EXSTYLE = -20;
        const long WS_EX_TOOLWINDOW = 0x80, WS_EX_NOACTIVATE = 0x08000000;
        const uint SWP_NOSIZE = 0x1, SWP_NOMOVE = 0x2, SWP_NOACTIVATE = 0x10;
        static readonly IntPtr TOPO = new IntPtr(-1), SEM_TOPO = new IntPtr(-2);

        // A janela principal da app desktop do Claude: visível, com título, classe do Chromium e
        // processo "claude" (o CLI não tem janelas, e o resto do Chromium tem outros nomes).
        public static IntPtr ProcurarClaude()
        {
            IntPtr achada = IntPtr.Zero;
            EnumWindows((janela, dados) =>
            {
                if (!IsWindowVisible(janela) || GetWindowTextLength(janela) == 0) return true;
                var classe = new StringBuilder(64);
                GetClassName(janela, classe, classe.Capacity);
                if (classe.ToString() != "Chrome_WidgetWin_1") return true;
                uint processo;
                ProcessoDaJanela(janela, out processo);
                try
                {
                    using (var p = Process.GetProcessById((int)processo))
                    {
                        if (!p.ProcessName.Equals("claude", StringComparison.OrdinalIgnoreCase)) return true;
                    }
                }
                catch (ArgumentException)
                {
                    return true;
                }
                catch (InvalidOperationException)
                {
                    return true;
                }
                achada = janela;
                return false;
            }, IntPtr.Zero);
            return achada;
        }

        public static void PorAFrente(IntPtr janela)
        {
            ShowWindow(janela, IsIconic(janela) ? SW_RESTORE : SW_SHOW);
            Focar(janela);
        }

        // O Windows só deixa pôr à frente quem recebeu o último input (aqui a tecla foi apanhada
        // pelo gancho), por isso liga-se por instantes à fila de input da janela que está à frente.
        public static void Focar(IntPtr janela)
        {
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

        // Muda a posição e o tamanho de uma janela (em píxeis do ecrã), sem a ativar.
        public static void Mover(IntPtr janela, int x, int y, int largura, int altura)
        {
            SetWindowPos(janela, IntPtr.Zero, x, y, largura, altura, 0x4 | SWP_NOACTIVATE);   // SWP_NOZORDER
        }

        // A janela do Windows que está à frente agora (para saber se o gestor ficou em foco).
        public static IntPtr JanelaAFrente()
        {
            return GetForegroundWindow();
        }

        // Volta a pôr uma janela "sempre à frente" no topo, sem lhe dar o foco: o Windows deixa
        // outras janelas passarem à frente dela (ecrã inteiro, o Explorer a reiniciar).
        public static void ReforcarTopo(IntPtr janela)
        {
            SetWindowPos(janela, TOPO, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
        }

        // Janela que nunca ganha o foco (clicar na pílula não tira o foco ao Claude) e que não
        // aparece no Alt+Tab.
        public static void SemFoco(IntPtr janela)
        {
            long estilo = GetWindowLongPtr(janela, GWL_EXSTYLE).ToInt64();
            SetWindowLongPtr(janela, GWL_EXSTYLE, new IntPtr(estilo | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE));
        }

        // Barra de título escura com as cores do gestor (o Windows 10 só tem o modo escuro).
        public static void TituloEscuro(IntPtr janela)
        {
            int um = 1;
            DwmSetWindowAttribute(janela, 20, ref um, sizeof(int));          // DWMWA_USE_IMMERSIVE_DARK_MODE
            int fundo = 0x00101111;                                           // #111110 (COLORREF: BGR)
            DwmSetWindowAttribute(janela, 35, ref fundo, sizeof(int));        // DWMWA_CAPTION_COLOR
            int borda = 0x002A2E2E;                                           // #2E2E2A
            DwmSetWindowAttribute(janela, 34, ref borda, sizeof(int));        // DWMWA_BORDER_COLOR
            int texto = 0x00E6EBEC;                                           // #ECEBE6
            DwmSetWindowAttribute(janela, 36, ref texto, sizeof(int));        // DWMWA_TEXT_COLOR
        }
    }
}
