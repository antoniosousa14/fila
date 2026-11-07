using System;
using System.IO;

namespace NextUp
{
    // Até à 1.0.4 a app chamava-se Fila. Na primeira vez que o NextUp arranca, passa para o nome novo
    // as pastas de dados que a Fila deixou: %USERPROFILE%\.claude\fila-atencao (a fila, a organização,
    // o consumo, as mensagens) e %LOCALAPPDATA%\Fila (o perfil do WebView2 do gestor).
    //
    // Se a pasta nova ainda não existir, move-se a velha inteira. Se já existir (o mod novo escreve lá
    // assim que um chat abre), passa só o que lá ainda não está, pasta a pasta. Nunca apaga nada que já
    // exista na pasta nova, e se não conseguir mover (um ficheiro em uso) deixa o resto como estava.
    static class Migracao
    {
        public static void Executar()
        {
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            Fundir(Path.Combine(Caminhos.Perfil, ".claude", "fila-atencao"), Caminhos.Raiz);
            Fundir(Path.Combine(local, "Fila"), Caminhos.Dados);
        }

        // Passa para `nova` tudo o que lá ainda não existe, pasta a pasta. Quando o ficheiro existe nos dois
        // fica o da pasta nova (é o mais recente: já foi escrito pelo mod novo). Devolve quantos passou.
        static int FundirPasta(string antiga, string nova)
        {
            int movidos = 0;
            Directory.CreateDirectory(nova);
            foreach (string caminho in Directory.GetFileSystemEntries(antiga))
            {
                string destino = Path.Combine(nova, Path.GetFileName(caminho));
                if (Directory.Exists(caminho))
                {
                    if (Directory.Exists(destino)) movidos += FundirPasta(caminho, destino);
                    else if (!File.Exists(destino)) { Directory.Move(caminho, destino); movidos++; }
                }
                else if (!File.Exists(destino) && !Directory.Exists(destino))
                {
                    File.Move(caminho, destino);
                    movidos++;
                }
            }
            try { Directory.Delete(antiga, false); } catch (IOException) { }
            return movidos;
        }

        static void Fundir(string antiga, string nova)
        {
            try
            {
                if (!Directory.Exists(antiga)) return;
                // Um atalho (junction) deixado no nome velho, para o que ainda o usa: não se mexe.
                if ((File.GetAttributes(antiga) & FileAttributes.ReparsePoint) != 0) return;
                if (!Directory.Exists(nova))
                {
                    Directory.Move(antiga, nova);
                    Registo.Info("migração: " + antiga + " passou para " + nova);
                    return;
                }
                int movidos = FundirPasta(antiga, nova);
                Registo.Info("migração: " + movidos + " itens de " + antiga + " passaram para " + nova);
            }
            catch (Exception e)
            {
                Registo.Erro("migração: não consegui mover " + antiga, e);
            }
        }
    }
}
