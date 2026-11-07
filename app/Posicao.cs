using System;
using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Windows;

namespace NextUp
{
    // O que a barra lembra entre arranques: onde a pílula está (o canto inferior direito dela) e
    // se a pílula e o gestor estão à vista. O ficheiro tem o mesmo formato da barra em PowerShell
    // (`modo` fica pelo resumo e pelos scripts de teste; a app lê `pilula` e `gestor`).
    sealed class Posicao
    {
        public double Direita;
        public double Fundo;
        public bool Pilula = true;
        public bool Gestor;

        public string Modo { get { return Gestor ? "completa" : Pilula ? "pequena" : "escondida"; } }

        public static Posicao Ler()
        {
            var estado = new Posicao();
            JsonNode no = null;
            try
            {
                no = JsonNode.Parse(File.ReadAllText(Caminhos.Posicao));
            }
            catch
            {
                // sem ficheiro (primeiro arranque) ou estragado: valores por omissão
            }
            var area = SystemParameters.WorkArea;
            estado.Direita = area.Right - 8;
            estado.Fundo = area.Bottom - 8;
            if (no == null) return estado;
            try
            {
                double direita = (double)no["direita"];
                double fundo = (double)no["fundo"];
                var ecra = new Rect(SystemParameters.VirtualScreenLeft, SystemParameters.VirtualScreenTop,
                    SystemParameters.VirtualScreenWidth, SystemParameters.VirtualScreenHeight);
                if (ecra.Contains(new Point(direita - 20, fundo - 10)))
                {
                    estado.Direita = direita;
                    estado.Fundo = fundo;
                }
            }
            catch
            {
                // posição inválida: fica a por omissão
            }
            try
            {
                var pilula = no["pilula"];
                if (pilula != null) estado.Pilula = (bool)pilula;
                else estado.Pilula = (string)no["modo"] != "escondida";   // formato antigo
            }
            catch
            {
                estado.Pilula = true;
            }
            return estado;
        }

        // Escreve por inteiro num ficheiro temporário e troca: quem lê (os scripts de teste) nunca
        // vê o ficheiro a meio.
        public void Guardar()
        {
            try
            {
                Directory.CreateDirectory(Caminhos.Raiz);
                string json = JsonSerializer.Serialize(new
                {
                    direita = Direita,
                    fundo = Fundo,
                    pilula = Pilula,
                    gestor = Gestor,
                    modo = Modo,
                });
                string temporario = Caminhos.Posicao + ".tmp";
                File.WriteAllText(temporario, json);
                File.Move(temporario, Caminhos.Posicao, true);
            }
            catch (Exception e)
            {
                Registo.Aviso("não consegui guardar a posição: " + e.Message);
            }
        }
    }
}
