using System;
using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;

namespace Fila
{
    // O ícone da Fila junto ao relógio: clique abre ou fecha o gestor; o menu (botão direito)
    // tem o resto. É a única parte visível da app quando a pílula está escondida, por isso é
    // também por aqui que se sai ou se reinicia.
    sealed class Bandeja : IDisposable
    {
        readonly NotifyIcon icone;
        readonly Icon acesa;
        readonly Icon apagada;
        readonly ToolStripMenuItem itemPilula;
        readonly ToolStripMenuItem itemArranque;
        bool estadoAceso;

        public Bandeja(Action alternarGestor, Func<bool> pilulaVisivel, Action alternarPilula,
            Action reiniciarServidor, Action reiniciarApp, Action sair)
        {
            int lado = SystemInformation.SmallIconSize.Width;
            acesa = Marca.Icone(true, lado);
            apagada = Marca.Icone(false, lado);

            var menu = new ContextMenuStrip();
            var abrir = new ToolStripMenuItem("Abrir o gestor") { Font = new Font(SystemFonts.MenuFont, FontStyle.Bold) };
            abrir.Click += (o, e) => alternarGestor();
            itemPilula = new ToolStripMenuItem("Mostrar a pílula");
            itemPilula.Click += (o, e) => alternarPilula();
            var servidor = new ToolStripMenuItem("Reiniciar o servidor do gestor");
            servidor.Click += (o, e) => reiniciarServidor();
            var registo = new ToolStripMenuItem("Ver o registo");
            registo.Click += (o, e) => AbrirRegisto();
            itemArranque = new ToolStripMenuItem("Iniciar com o Windows");
            itemArranque.Click += (o, e) => Arranque.Definir(!Arranque.Ativo);
            var reiniciar = new ToolStripMenuItem("Reiniciar a Fila");
            reiniciar.Click += (o, e) => reiniciarApp();
            var terminar = new ToolStripMenuItem("Sair");
            terminar.Click += (o, e) => sair();
            menu.Items.AddRange(new ToolStripItem[]
            {
                abrir, itemPilula, new ToolStripSeparator(),
                servidor, registo, itemArranque, new ToolStripSeparator(),
                reiniciar, terminar,
            });
            menu.Opening += (o, e) =>
            {
                itemPilula.Checked = pilulaVisivel();
                itemArranque.Checked = Arranque.Ativo;
            };

            icone = new NotifyIcon
            {
                Icon = apagada,
                Text = "Fila de atenção",
                ContextMenuStrip = menu,
                Visible = true,
            };
            icone.MouseClick += (o, e) =>
            {
                if (e.Button == MouseButtons.Left) alternarGestor();
            };
        }

        static void AbrirRegisto()
        {
            try
            {
                Process.Start(new ProcessStartInfo(Caminhos.Registo) { UseShellExecute = true });
            }
            catch (Exception e)
            {
                Registo.Aviso("não abri o registo: " + e.Message);
            }
        }

        // Quantos esperam e quantos trabalham: o ícone acende o sinal quando há espera.
        public void Atualizar(int esperam, int trabalham)
        {
            bool aceso = esperam > 0;
            if (aceso != estadoAceso)
            {
                estadoAceso = aceso;
                icone.Icon = aceso ? acesa : apagada;
            }
            string texto = esperam > 0 ? "Fila · " + esperam + " à espera" : "Fila · em dia";
            if (trabalham > 0) texto += " · " + trabalham + " a trabalhar";
            icone.Text = texto.Length > 63 ? texto.Substring(0, 63) : texto;
        }

        public void Aviso(string titulo, string texto)
        {
            icone.ShowBalloonTip(5000, titulo, texto, ToolTipIcon.Warning);
        }

        public void Dispose()
        {
            icone.Visible = false;
            icone.Dispose();
        }
    }
}
