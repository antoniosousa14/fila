using System;
using System.IO;
using System.Text;

namespace Fila
{
    // Registo em ficheiro (app.log, ao lado dos outros da fila). Nunca lança: registar não pode
    // deitar abaixo a app. Passa de 512 KB e o ficheiro vira app.log.1 (só fica uma cópia).
    static class Registo
    {
        const long MAXIMO = 512 * 1024;
        static readonly object trinco = new object();
        static readonly UTF8Encoding utf8 = new UTF8Encoding(false);
        static readonly int processo = Environment.ProcessId;
        public static string Etiqueta = "app";

        public static void Info(string texto) { Escrever("INFO", texto); }
        public static void Aviso(string texto) { Escrever("AVISO", texto); }

        public static void Erro(string texto, Exception e = null)
        {
            Escrever("ERRO", e == null ? texto : texto + ": " + e);
        }

        static void Escrever(string nivel, string texto)
        {
            try
            {
                lock (trinco)
                {
                    Directory.CreateDirectory(Caminhos.Raiz);
                    var ficheiro = new FileInfo(Caminhos.Registo);
                    if (ficheiro.Exists && ficheiro.Length > MAXIMO)
                    {
                        File.Move(Caminhos.Registo, Caminhos.Registo + ".1", true);
                    }
                    File.AppendAllText(Caminhos.Registo,
                        DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + " [" + nivel + "] " + Etiqueta + "#" + processo + " " + texto + Environment.NewLine,
                        utf8);
                }
            }
            catch
            {
                // sem sítio onde escrever: não há nada a fazer
            }
        }
    }
}
