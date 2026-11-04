using System;
using System.IO;
using System.Linq;
using System.Windows;

namespace Fila
{
    static class Program
    {
        // Fila.exe                      guardião: arranca e vigia a app (é o que o atalho de arranque corre)
        // Fila.exe --app [--esperar]    a app, sem guardião
        // Fila.exe --previsao <pasta> [<barra.json>]   desenha pilula.png e quadro.png e sai
        // Fila.exe --arranque on|off    liga ou desliga o atalho de arranque do Windows
        // Fila.exe --sair               pede à Fila que corre para sair (e ao guardião, que acaba)
        // Fila.exe --autoteste          corre os testes internos (resultado em autoteste.txt)
        [STAThread]
        static int Main(string[] args)
        {
            try
            {
                string modo = args.Length > 0 ? args[0] : "";
                switch (modo)
                {
                    case "--app":
                        return Aplicacao.Correr(args.Contains("--esperar"));
                    case "--previsao":
                        return Previsao(args);
                    case "--arranque":
                        Registo.Etiqueta = "arranque";
                        Arranque.Definir(args.Length > 1 && args[1] == "on");
                        return 0;
                    case "--sair":
                        Registo.Etiqueta = "sair";
                        return Sinal.Enviar(Aplicacao.EVENTO_SAIR) ? 0 : 1;
                    case "--autoteste":
                        return Verificacoes.Correr();
                    default:
                        return Guardiao.Correr();
                }
            }
            catch (Exception e)
            {
                Registo.Erro("Main", e);
                return 1;
            }
        }

        static int Previsao(string[] args)
        {
            if (args.Length < 2) return 2;
            var app = new Application();
            var pilula = new Pilula(args.Length > 2 ? args[2] : Caminhos.Barra);
            pilula.Atualizar();
            pilula.GravarPrevisao(args[1]);
            return 0;
        }
    }
}
