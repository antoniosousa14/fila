# Compila a Fila e publica-a em app\publish\Fila.exe (é de lá que o atalho de arranque a corre).
# Se já houver uma Fila a correr dessa pasta, pede-lhe para sair primeiro (ficheiros em uso).
#   powershell -NoProfile -ExecutionPolicy Bypass -File app\publicar.ps1 [-Arrancar]
# -Arrancar volta a pô-la a correr no fim, desligada desta sessão (como o atalho de arranque faria).
param([switch]$Arrancar)
$ErrorActionPreference = 'Stop'
$app = $PSScriptRoot
$saida = Join-Path $app 'publish'
$exe = Join-Path $saida 'Fila.exe'

function Get-FilaViva { @(Get-Process Fila -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe }) }

if (Test-Path $exe) {
  $vivas = Get-FilaViva
  if ($vivas.Count -gt 0) {
    & $exe --sair
    foreach ($p in $vivas) { [void]$p.WaitForExit(10000) }
    $restam = Get-FilaViva
    if ($restam.Count -gt 0) {
      Write-Warning 'a Fila não saiu em 10 s; a terminar o processo'
      $restam | Where-Object { $_.CommandLine -notlike '*--app*' } | Stop-Process -Force -ErrorAction SilentlyContinue
      Get-FilaViva | Stop-Process -Force -ErrorAction SilentlyContinue
    }
  }
}

dotnet publish (Join-Path $app 'Fila.csproj') -c Release -o $saida --nologo
if ($LASTEXITCODE -ne 0) { throw 'a compilação falhou' }
Write-Host "publicada: $exe"

if ($Arrancar) {
  $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ('"{0}"' -f $exe); CurrentDirectory = $env:USERPROFILE }
  Write-Host "arrancada (pid do guardião $($r.ProcessId))"
}
