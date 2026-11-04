using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;

namespace Fila
{
    // O que o atalho de arranque corre: arranca a app (Fila.exe --app) e vigia-a. Se a app morrer
    // por qualquer razão que não seja a pessoa mandar sair (um erro fatal, ser morta no Gestor de
    // Tarefas, o Windows a matar processos), arranca outra. Este processo é pequeno e quase não
    // faz nada, por isso não tem como cair pelas mesmas razões.
    static class Guardiao
    {
        const string MUTEX = @"Local\fila-atencao-guardiao";

        public static int Correr()
        {
            Registo.Etiqueta = "guardiao";
            Excecoes.Instalar();
            bool minha;
            using (var unica = new Mutex(true, MUTEX, out minha))
            {
                if (!minha)
                {
                    Registo.Info("já há um guardião: peço à Fila para abrir o gestor");
                    Sinal.Enviar(Aplicacao.EVENTO_ABRIR);
                    return 0;
                }
                Registo.Info("guardião a arrancar");
                var quedas = new Queue<DateTime>();
                while (true)
                {
                    int codigo;
                    try
                    {
                        var arranque = new ProcessStartInfo(Caminhos.Exe, "--app")
                        {
                            UseShellExecute = false,
                            WorkingDirectory = Caminhos.Perfil,
                        };
                        arranque.Environment["FILA_GUARDIAO"] = "1";
                        using (var app = Process.Start(arranque))
                        {
                            Registo.Info("app arrancada (pid " + app.Id + ")");
                            app.WaitForExit();
                            codigo = app.ExitCode;
                        }
                    }
                    catch (Exception e)
                    {
                        Registo.Erro("guardião: não consegui arrancar a app", e);
                        codigo = -1;
                    }
                    Registo.Info("a app terminou com o código " + codigo);
                    if (codigo == 0) return 0;                       // saída pedida, ou já havia uma Fila
                    if (codigo == Aplicacao.SAIDA_REINICIAR) continue; // reinício pedido na bandeja

                    // Caiu. Volta a arrancá-la, mas sem ciclos apertados: se cair mais de 5 vezes em
                    // 2 minutos, espera um minuto (pode haver um problema que arrancar não resolve).
                    DateTime agora = DateTime.UtcNow;
                    quedas.Enqueue(agora);
                    while (quedas.Count > 0 && (agora - quedas.Peek()).TotalSeconds > 120) quedas.Dequeue();
                    if (quedas.Count > 5)
                    {
                        Registo.Erro("a app caiu " + quedas.Count + " vezes em 2 minutos; espero 60 s");
                        Thread.Sleep(60000);
                        quedas.Clear();
                    }
                    else
                    {
                        Thread.Sleep(Math.Min(10000, 1000 * quedas.Count));
                    }
                }
            }
        }
    }
}
