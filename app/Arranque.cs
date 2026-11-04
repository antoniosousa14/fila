using System;
using System.IO;

namespace Fila
{
    // O atalho "Fila de atencao.lnk" na pasta de arranque do Windows: é ele que põe a Fila a
    // correr quando a pessoa inicia sessão. Aponta para este .exe (sem argumentos: arranca o
    // guardião, que por sua vez arranca e vigia a app).
    static class Arranque
    {
        static string Atalho
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), "Fila de atencao.lnk"); }
        }

        public static bool Ativo
        {
            get { return File.Exists(Atalho); }
        }

        // O programa para onde o atalho aponta (para ver se ainda é este).
        public static string Alvo()
        {
            try
            {
                if (!File.Exists(Atalho)) return null;
                dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
                dynamic ligacao = shell.CreateShortcut(Atalho);
                return (string)ligacao.TargetPath;
            }
            catch (Exception e)
            {
                Registo.Aviso("arranque: não consegui ler o atalho: " + e.Message);
                return null;
            }
        }

        public static void Definir(bool ativo)
        {
            try
            {
                if (!ativo)
                {
                    if (File.Exists(Atalho)) File.Delete(Atalho);
                    Registo.Info("arranque com o Windows: desligado");
                    return;
                }
                dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
                dynamic ligacao = shell.CreateShortcut(Atalho);
                ligacao.TargetPath = Caminhos.Exe;
                ligacao.Arguments = "";
                ligacao.WorkingDirectory = Caminhos.Perfil;
                ligacao.WindowStyle = 7;
                ligacao.Description = "Fila";
                ligacao.IconLocation = Caminhos.Exe + ",0";
                ligacao.Save();
                Registo.Info("arranque com o Windows: ligado (" + Caminhos.Exe + ")");
            }
            catch (Exception e)
            {
                Registo.Erro("arranque: não consegui mudar o atalho", e);
            }
        }
    }
}
