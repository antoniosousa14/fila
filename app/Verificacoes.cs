using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;

namespace NextUp
{
    // Testes internos, sem Windows pelo meio: `NextUp.exe --autoteste`. O resultado fica em
    // %LOCALAPPDATA%\NextUp\autoteste.txt e o código de saída é o número de falhas.
    static class Verificacoes
    {
        static readonly List<string> linhas = new List<string>();
        static int falhas;

        static void Verificar(string nome, bool ok, string detalhe = "")
        {
            if (!ok) falhas++;
            linhas.Add((ok ? "ok    " : "FALHA ") + nome + (ok || detalhe == "" ? "" : " — " + detalhe));
        }

        public static int Correr()
        {
            try
            {
                Tecla();
                Texto();
            }
            catch (Exception e)
            {
                falhas++;
                linhas.Add("FALHA exceção: " + e);
            }
            Directory.CreateDirectory(Caminhos.Dados);
            linhas.Add(falhas == 0 ? "tudo ok" : falhas + " falha(s)");
            File.WriteAllLines(Path.Combine(Caminhos.Dados, "autoteste.txt"), linhas);
            return falhas;
        }

        static void Tecla()
        {
            // Um toque: largar antes do tempo de segurar dá um Toque e nenhuma Segurada.
            int toques = 0, seguradas = 0;
            var tecla = new TeclaNextUp(0x5D, 200);
            tecla.Toque += () => Interlocked.Increment(ref toques);
            tecla.Segurada += () => Interlocked.Increment(ref seguradas);
            tecla.Evento(true);
            Thread.Sleep(40);
            tecla.Evento(false);
            Thread.Sleep(300);
            Verificar("toque: um Toque", toques == 1, "toques=" + toques);
            Verificar("toque: nenhuma Segurada", seguradas == 0, "seguradas=" + seguradas);

            // Segurar: avisa ao fim do tempo, sem esperar pela largada, e a largada não é um toque.
            // A repetição da tecla presa (vários "desce") não conta como outro toque nem outra segurada.
            toques = 0; seguradas = 0;
            tecla.Evento(true);
            for (int i = 0; i < 12; i++) { Thread.Sleep(40); tecla.Evento(true); }
            Verificar("segurar: a Segurada chega antes de largar", seguradas == 1, "seguradas=" + seguradas);
            tecla.Evento(false);
            Thread.Sleep(300);
            Verificar("segurar: largar não dá Toque", toques == 0, "toques=" + toques);
            Verificar("segurar: repetição não duplica", seguradas == 1, "seguradas=" + seguradas);

            // Dois toques seguidos são dois toques.
            toques = 0; seguradas = 0;
            for (int i = 0; i < 2; i++)
            {
                tecla.Evento(true);
                Thread.Sleep(30);
                tecla.Evento(false);
                Thread.Sleep(30);
            }
            Verificar("dois toques", toques == 2, "toques=" + toques);

            // Uma largada que se perdeu (o gancho trocado, o ecrã bloqueado) não pode engolir o
            // toque seguinte: depois de 1 s sem eventos a pressão seguinte é uma pressão nova.
            toques = 0; seguradas = 0;
            tecla.Evento(true);   // sem largada
            Thread.Sleep(1150);
            seguradas = 0;
            tecla.Evento(true);
            Thread.Sleep(30);
            tecla.Evento(false);
            Thread.Sleep(30);
            Verificar("largada perdida: o toque seguinte conta", toques == 1, "toques=" + toques);
        }

        static void Texto()
        {
            Verificar("há 0 min", Pilula.HaQuanto(20000) == "há 0 min", Pilula.HaQuanto(20000));
            Verificar("há 59 min", Pilula.HaQuanto(59 * 60000) == "há 59 min", Pilula.HaQuanto(59 * 60000));
            Verificar("há 1h05", Pilula.HaQuanto(65 * 60000) == "há 1h05", Pilula.HaQuanto(65 * 60000));
            Verificar("há 26h00", Pilula.HaQuanto(26 * 3600000.0) == "há 26h00", Pilula.HaQuanto(26 * 3600000.0));
            Verificar("há (negativo) não rebenta", Pilula.HaQuanto(-5000) == "há 0 min");
        }
    }
}
