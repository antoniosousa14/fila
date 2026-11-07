using System;
using System.IO;

namespace NextUp
{
    // O atalho "NextUp.lnk" na pasta de arranque do Windows: é ele que põe o NextUp a correr quando a
    // pessoa inicia sessão. Aponta para este .exe (sem argumentos: arranca o guardião, que por sua
    // vez arranca e vigia a app). Até à 1.0.4 a app chamava-se Fila e o atalho "Fila.lnk" (antes
    // disso, "Fila de atencao.lnk"): Migrar() passa-o para o nome novo sem desligar o arranque.
    static class Arranque
    {
        static readonly string[] NOMES_ANTIGOS = { "Fila.lnk", "Fila de atencao.lnk" };

        static string Pasta
        {
            get { return Environment.GetFolderPath(Environment.SpecialFolder.Startup); }
        }

        static string Atalho
        {
            get { return Path.Combine(Pasta, "NextUp.lnk"); }
        }

        // O primeiro atalho com um nome antigo que ainda exista (ou null).
        static string AtalhoAntigo()
        {
            foreach (string nome in NOMES_ANTIGOS)
            {
                string caminho = Path.Combine(Pasta, nome);
                if (File.Exists(caminho)) return caminho;
            }
            return null;
        }

        // Ligado se existir o atalho, com o nome novo ou (ainda por migrar) com um antigo.
        public static bool Ativo
        {
            get { return File.Exists(Atalho) || AtalhoAntigo() != null; }
        }

        // O programa para onde o atalho aponta (para ver se ainda é este).
        public static string Alvo()
        {
            return LerAlvo(File.Exists(Atalho) ? Atalho : AtalhoAntigo());
        }

        static string LerAlvo(string atalho)
        {
            try
            {
                if (atalho == null || !File.Exists(atalho)) return null;
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
            ligacao.Description = "NextUp";
            ligacao.IconLocation = exe + ",0";
            ligacao.Save();
        }

        static void ApagarAntigos()
        {
            foreach (string nome in NOMES_ANTIGOS)
            {
                string caminho = Path.Combine(Pasta, nome);
                if (File.Exists(caminho)) File.Delete(caminho);
            }
        }

        // Passa o atalho do nome antigo para "NextUp.lnk". O programa novo tem outro nome (NextUp.exe),
        // por isso o atalho novo aponta para este .exe e não para onde o antigo apontava. Só tira o
        // antigo depois de o novo existir: se algo falhar, o NextUp continua a arrancar com o Windows
        // como antes. Não faz nada se não houver atalho antigo.
        public static void Migrar()
        {
            try
            {
                string antigo = AtalhoAntigo();
                if (antigo == null) return;
                if (!File.Exists(Atalho))
                {
                    Criar(Caminhos.Exe);
                    if (!File.Exists(Atalho)) throw new IOException("o atalho novo não ficou criado");
                }
                ApagarAntigos();
                Registo.Info("arranque com o Windows: o atalho passou de \"" + Path.GetFileNameWithoutExtension(antigo) + "\" para \"NextUp\"");
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
                    ApagarAntigos();
                    Registo.Info("arranque com o Windows: desligado");
                    return;
                }
                Criar(Caminhos.Exe);
                ApagarAntigos();
                Registo.Info("arranque com o Windows: ligado (" + Caminhos.Exe + ")");
            }
            catch (Exception e)
            {
                Registo.Erro("arranque: não consegui mudar o atalho", e);
            }
        }
    }
}
