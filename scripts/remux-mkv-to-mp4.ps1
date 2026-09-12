# Remuxa .mkv -> .mp4 SEM reencodar (troca só o "envelope" do arquivo).
#
# Por que isso é necessário: os vídeos já estão em H.264 + AAC, que todo
# navegador toca. O que nenhum navegador toca é o CONTÊINER Matroska (.mkv):
# o Safari não demuxa Matroska de jeito nenhum, e o Chrome só aceita o
# subconjunto WebM (VP8/VP9/AV1), então H.264 dentro de .mkv também é
# recusado lá. Trocar o contêiner pra MP4 resolve de vez — e como as faixas
# de vídeo/áudio são copiadas bit a bit (-c copy), não há perda de qualidade
# nem reencodificação: roda na velocidade do disco, poucos segundos por
# episódio.
#
# -movflags +faststart move o índice (moov) pro início do arquivo, que é o
# que permite começar a tocar antes de baixar tudo e buscar (seek) direito
# num player de navegador.
#
# Uso:
#   .\remux-mkv-to-mp4.ps1 -Path "C:\caminho\com\os\videos"
#   .\remux-mkv-to-mp4.ps1 -Path "C:\videos" -Recurse
#   .\remux-mkv-to-mp4.ps1 -Path "C:\videos" -DeleteOriginal
#
# Precisa do ffmpeg no PATH (winget install Gyan.FFmpeg).

param(
  [Parameter(Mandatory = $true)][string]$Path,
  [switch]$Recurse,
  [switch]$DeleteOriginal
)

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
  Write-Error "ffmpeg nao encontrado no PATH. Instale com: winget install Gyan.FFmpeg"
  exit 1
}

$files = Get-ChildItem -Path $Path -Filter *.mkv -File -Recurse:$Recurse
if ($files.Count -eq 0) {
  Write-Host "Nenhum .mkv encontrado em $Path"
  exit 0
}

Write-Host "$($files.Count) arquivo(s) .mkv encontrado(s).`n"
$ok = 0
$fail = 0

foreach ($f in $files) {
  $out = [System.IO.Path]::ChangeExtension($f.FullName, ".mp4")
  if (Test-Path $out) {
    Write-Host "[pula] ja existe: $([System.IO.Path]::GetFileName($out))"
    continue
  }

  Write-Host "[remux] $($f.Name)"
  # -c copy: copia as faixas como estao (sem reencodar).
  # Se o audio nao for AAC (ex: AC3/DTS, que o navegador tambem nao toca),
  # troque por: -c:v copy -c:a aac -b:a 192k
  & ffmpeg -v error -stats -i $f.FullName -c copy -movflags +faststart $out
  if ($LASTEXITCODE -eq 0) {
    $ok++
    if ($DeleteOriginal) { Remove-Item $f.FullName -Force }
  } else {
    $fail++
    Write-Warning "falhou: $($f.Name) (se o audio nao for AAC, veja o comentario acima)"
    if (Test-Path $out) { Remove-Item $out -Force }
  }
}

Write-Host "`nPronto. Convertidos: $ok | Falhas: $fail"
if ($ok -gt 0) {
  Write-Host "Suba os .mp4 pro Drive (e remova os .mkv correspondentes) e atualize o catalogo no app."
}
