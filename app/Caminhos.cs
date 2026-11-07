using System;
using System.IO;

namespace NextUp
{
    // Onde ficam os ficheiros de que a app depende. A pasta da fila é a mesma da barra antiga
    // (%USERPROFILE%\.claude\nextup): o mod e o servidor do gestor escrevem lá.
    static class Caminhos
    {
        public static readonly string Perfil = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        public static readonly string Raiz = Path.Combine(Perfil, ".claude", "nextup");
        public static readonly string Barra = Path.Combine(Raiz, "barra.json");
        public static readonly string Posicao = Path.Combine(Raiz, "barra-posicao.json");
        public static readonly string Gestor = Path.Combine(Raiz, "gestor.json");
        public static readonly string Itens = Path.Combine(Raiz, "itens");
        public static readonly string ClaudeAFrente = Path.Combine(Raiz, "claude-a-frente.json");
        public static readonly string Registo = Path.Combine(Raiz, "app.log");

        // Dados só da app (perfil do WebView2, onde ficam cookies e armazenamento da página).
        public static readonly string Dados = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NextUp");
        public static readonly string PerfilWeb = Path.Combine(Dados, "webview");

        public static readonly string Exe = Environment.ProcessPath ?? Path.Combine(AppContext.BaseDirectory, "NextUp.exe");

        // gestor\servidor.mjs: procura-se a partir da pasta do .exe para cima (app\publish\NextUp.exe
        // fica dois níveis abaixo da raiz do projeto), com NEXTUP_PROJETO a poder forçar a raiz.
        public static string Servidor()
        {
            string forcada = Environment.GetEnvironmentVariable("NEXTUP_PROJETO");
            if (!string.IsNullOrWhiteSpace(forcada))
            {
                string f = Path.Combine(forcada, "gestor", "servidor.mjs");
                if (File.Exists(f)) return f;
            }
            string pasta = AppContext.BaseDirectory;
            for (int i = 0; i < 6 && !string.IsNullOrEmpty(pasta); i++)
            {
                string f = Path.Combine(pasta, "gestor", "servidor.mjs");
                if (File.Exists(f)) return Path.GetFullPath(f);
                pasta = Path.GetDirectoryName(pasta.TrimEnd(Path.DirectorySeparatorChar));
            }
            return null;
        }
    }
}
