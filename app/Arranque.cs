using System;
using System.IO;

namespace Fila
{
    // O atalho "Fila.lnk" na pasta de arranque do Windows: é ele que põe a Fila a correr quando a
    // pessoa inicia sessão. Aponta para este .exe (sem argumentos: arranca o guardião, que por sua
    // vez arranca e vigia a app). Até à 1.0.1 chamava-se "Fila de atencao.lnk": Migrar() passa-o
    // para o nome novo sem desligar o arranque.
    static class Arranque
    {
        static string Pasta
        {
            get { return Environment.GetFolderPath(Environment.SpecialFolder.Startup); }
        }

        static string Atalho
        {
            get { return Path.Combine(Pasta, "Fila.lnk"); }
        }

        static string AtalhoAntigo
        {
            get { return Path.Combine(Pasta, "Fila de atencao.lnk"); }
        }

        // Ligado se existir o atalho, com o nome novo ou (ainda por migrar) com o antigo.
        public static bool Ativo
        {
            get { return File.Exists(Atalho) || File.Exists(AtalhoAntigo); }
        }

        // O programa para onde o atalho aponta (para ver se ainda é este).
        public static string Alvo()
        {
            return LerAlvo(File.Exists(Atalho) ? Atalho : AtalhoAntigo);
        }

        static string LerAlvo(string atalho)
        {
            try
            {
                if (!File.Exists(atalho)) return null;
                dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
                dynamic ligacao = shell.CreateShortcut(atalho);
                return (string)ligacao.TargetPath;
            }
            catch (Exception e)
            {
                Registo.Aviso("arranque: não consegui ler o atalho: " + e.Message);
                return null;
            }
        }

        static void Criar(string exe)
        {
            dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
            dynamic ligacao = shell.CreateShortcut(Atalho);
            ligacao.TargetPath = exe;
            ligacao.Arguments = "";
            ligacao.WorkingDirectory = Caminhos.Perfil;
            ligacao.WindowStyle = 7;
            ligacao.Description = "Fila";
            ligacao.IconLocation = exe + ",0";
            ligacao.Save();
        }

        // Passa o atalho do nome antigo para "Fila.lnk", mantendo o programa para onde apontava. Só
        // tira o antigo depois de o novo existir: se algo falhar, a Fila continua a arrancar com o
        // Windows como antes. Não faz nada se não houver atalho antigo.
        public static void Migrar()
        {
            try
            {
                if (!File.Exists(AtalhoAntigo)) return;
                if (!File.Exists(Atalho))
                {
                    string alvo = LerAlvo(AtalhoAntigo);
                    Criar(string.IsNullOrEmpty(alvo) ? Caminhos.Exe : alvo);
                    if (!File.Exists(Atalho)) throw new IOException("o atalho novo não ficou criado");
                }
                File.Delete(AtalhoAntigo);
                Registo.Info("arranque com o Windows: o atalho passou de \"Fila de atencao\" para \"Fila\"");
            }
            catch (Exception e)
            {
                Registo.Erro("arranque: não consegui migrar o atalho", e);
            }
        }

        public static void Definir(bool ativo)
        {
            try
            {
                if (!ativo)
                {
                    if (File.Exists(Atalho)) File.Delete(Atalho);
                    if (File.Exists(AtalhoAntigo)) File.Delete(AtalhoAntigo);
                    Registo.Info("arranque com o Windows: desligado");
                    return;
                }
                Criar(Caminhos.Exe);
                if (File.Exists(AtalhoAntigo)) File.Delete(AtalhoAntigo);
                Registo.Info("arranque com o Windows: ligado (" + Caminhos.Exe + ")");
            }
            catch (Exception e)
            {
                Registo.Erro("arranque: não consegui mudar o atalho", e);
            }
        }
    }
}
