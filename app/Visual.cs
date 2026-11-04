using System;
using System.Collections.Generic;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Shapes;

namespace Fila
{
    // As cores do gestor (gestor/web/estilo.css, tema escuro).
    static class Paleta
    {
        public const string Fundo = "#F5111110";
        public const string Linha = "#2E2E2A";
        public const string Fraca = "#22221F";
        public const string Hover = "#1C1C1A";
        public const string Tinta = "#ECEBE6";
        public const string Dim = "#9A9993";
        public const string Fraco = "#5F5E59";
        public const string Sinal = "#FF7A1A";
        public const string Frio = "#7FA7C9";
        public const string Escuro = "#111110";

        static readonly Dictionary<string, Brush> pinceis = new Dictionary<string, Brush>();

        public static Brush Pincel(string hex)
        {
            Brush b;
            if (!pinceis.TryGetValue(hex, out b))
            {
                b = (Brush)new BrushConverter().ConvertFromString(hex);
                b.Freeze();
                pinceis[hex] = b;
            }
            return b;
        }
    }

    // O logo (gestor/logo.svg): três barras inclinadas e o bloco de sinal, aceso quando há espera.
    static class Marca
    {
        static readonly string[] Barras =
        {
            "M5 7h14.5l-2.2 4.6H5z", "M5 14.2h10.6l-2.2 4.6H5z", "M5 21.4h6.2L9 26H5z",
        };
        static readonly double[] Opacidades = { 1, 0.6, 0.32 };
        const string Sinal = "M22.4 7H27l-2.2 4.6h-4.6z";

        static Canvas Tela(bool aceso, bool fundo)
        {
            var tela = new Canvas { Width = 32, Height = 32 };
            if (fundo)
            {
                tela.Children.Add(new Rectangle { Width = 32, Height = 32, RadiusX = 7, RadiusY = 7, Fill = Paleta.Pincel(Paleta.Escuro) });
            }
            for (int i = 0; i < Barras.Length; i++)
            {
                tela.Children.Add(new System.Windows.Shapes.Path
                {
                    Data = Geometry.Parse(Barras[i]),
                    Fill = Paleta.Pincel(Paleta.Tinta),
                    Opacity = Opacidades[i],
                });
            }
            tela.Children.Add(new System.Windows.Shapes.Path
            {
                Data = Geometry.Parse(Sinal),
                Fill = Paleta.Pincel(aceso ? Paleta.Sinal : Paleta.Fraco),
            });
            return tela;
        }

        public static UIElement Criar(bool aceso, double tamanho)
        {
            return new Viewbox
            {
                Width = tamanho,
                Height = tamanho,
                Child = Tela(aceso, false),
                VerticalAlignment = VerticalAlignment.Center,
            };
        }

        // O ícone da bandeja: o logo sobre um quadrado escuro (vê-se com a barra de tarefas clara
        // ou escura).
        public static System.Drawing.Icon Icone(bool aceso, int lado)
        {
            var caixa = new Viewbox { Width = lado, Height = lado, Child = Tela(aceso, true) };
            caixa.Measure(new Size(lado, lado));
            caixa.Arrange(new Rect(0, 0, lado, lado));
            caixa.UpdateLayout();
            var imagem = new RenderTargetBitmap(lado, lado, 96, 96, PixelFormats.Pbgra32);
            imagem.Render(caixa);
            var png = new PngBitmapEncoder();
            png.Frames.Add(BitmapFrame.Create(imagem));
            using (var memoria = new MemoryStream())
            {
                png.Save(memoria);
                memoria.Position = 0;
                using (var bitmap = new System.Drawing.Bitmap(memoria))
                {
                    return System.Drawing.Icon.FromHandle(bitmap.GetHicon());
                }
            }
        }

        // O mesmo logo como imagem WPF (ícone da janela do gestor).
        public static ImageSource Imagem(bool aceso, int lado)
        {
            var caixa = new Viewbox { Width = lado, Height = lado, Child = Tela(aceso, true) };
            caixa.Measure(new Size(lado, lado));
            caixa.Arrange(new Rect(0, 0, lado, lado));
            caixa.UpdateLayout();
            var imagem = new RenderTargetBitmap(lado, lado, 96, 96, PixelFormats.Pbgra32);
            imagem.Render(caixa);
            imagem.Freeze();
            return imagem;
        }
    }
}
