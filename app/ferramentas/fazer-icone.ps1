# Gera app\fila.ico a partir do logo (gestor\logo.svg): três barras inclinadas e o bloco de sinal.
# Correr uma vez (ou quando o logo mudar): powershell -NoProfile -STA -File app\ferramentas\fazer-icone.ps1
Add-Type -AssemblyName PresentationCore, PresentationFramework, WindowsBase
$saida = Join-Path (Split-Path $PSScriptRoot -Parent) 'fila.ico'
$tamanhos = 16, 20, 24, 32, 40, 48, 64, 128, 256

function New-Imagem([int]$lado) {
  $tela = New-Object System.Windows.Controls.Canvas
  $tela.Width = 32; $tela.Height = 32
  $fundo = New-Object System.Windows.Shapes.Rectangle
  $fundo.Width = 32; $fundo.Height = 32; $fundo.RadiusX = 7; $fundo.RadiusY = 7
  $fundo.Fill = [System.Windows.Media.BrushConverter]::new().ConvertFromString('#111110')
  [void]$tela.Children.Add($fundo)
  $partes = @(
    @('M5 7h14.5l-2.2 4.6H5z', '#ECEBE6', 1),
    @('M5 14.2h10.6l-2.2 4.6H5z', '#ECEBE6', 0.6),
    @('M5 21.4h6.2L9 26H5z', '#ECEBE6', 0.32),
    @('M22.4 7H27l-2.2 4.6h-4.6z', '#FF7A1A', 1)
  )
  foreach ($p in $partes) {
    $c = New-Object System.Windows.Shapes.Path
    $c.Data = [System.Windows.Media.Geometry]::Parse($p[0])
    $c.Fill = [System.Windows.Media.BrushConverter]::new().ConvertFromString($p[1])
    $c.Opacity = $p[2]
    [void]$tela.Children.Add($c)
  }
  $caixa = New-Object System.Windows.Controls.Viewbox
  $caixa.Width = $lado; $caixa.Height = $lado; $caixa.Child = $tela
  $caixa.Measure((New-Object System.Windows.Size($lado, $lado)))
  $caixa.Arrange((New-Object System.Windows.Rect(0, 0, $lado, $lado)))
  $caixa.UpdateLayout()
  $bmp = New-Object System.Windows.Media.Imaging.RenderTargetBitmap($lado, $lado, 96, 96, [System.Windows.Media.PixelFormats]::Pbgra32)
  $bmp.Render($caixa)
  $png = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
  $png.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bmp))
  $ms = New-Object System.IO.MemoryStream
  $png.Save($ms)
  return ,$ms.ToArray()
}

$imagens = foreach ($t in $tamanhos) { ,(New-Imagem $t) }
$fs = [System.IO.File]::Create($saida)
$bw = New-Object System.IO.BinaryWriter($fs)
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$tamanhos.Count)
$desvio = 6 + 16 * $tamanhos.Count
for ($i = 0; $i -lt $tamanhos.Count; $i++) {
  $t = $tamanhos[$i]
  $bw.Write([byte]$(if ($t -ge 256) { 0 } else { $t })); $bw.Write([byte]$(if ($t -ge 256) { 0 } else { $t }))
  $bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([uint16]1); $bw.Write([uint16]32)
  $bw.Write([uint32]$imagens[$i].Length); $bw.Write([uint32]$desvio)
  $desvio += $imagens[$i].Length
}
foreach ($img in $imagens) { $bw.Write($img) }
$bw.Dispose(); $fs.Dispose()
"icone gravado: $saida ($((Get-Item $saida).Length) bytes)"
