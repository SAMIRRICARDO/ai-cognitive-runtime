# VRAXIA WORK — Startup Script
# Inicia o servidor de API + túnel Cloudflare e grava o log em .vraxia-work\startup.log

$WorkDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogFile  = Join-Path $WorkDir ".vraxia-work\startup.log"
$TunnelFile = Join-Path $WorkDir ".vraxia-work\tunnel-url.txt"

New-Item -ItemType Directory -Force (Split-Path $LogFile) | Out-Null

function Log($msg) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Write-Host $line
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

Log "=== VRAXIA WORK iniciando ==="
Log "WorkDir: $WorkDir"

Set-Location $WorkDir

# Aguarda a rede estar disponível (até 60s)
$net = $false
for ($i = 0; $i -lt 12; $i++) {
    try {
        $null = Test-Connection -ComputerName "1.1.1.1" -Count 1 -ErrorAction Stop
        $net = $true; break
    } catch { Start-Sleep -Seconds 5 }
}
if (-not $net) { Log "WARN: rede indisponível — continuando mesmo assim" }

Log "Iniciando npm run start:full..."
$proc = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c npm run start:full >> `"$LogFile`" 2>&1" `
    -WorkingDirectory $WorkDir `
    -PassThru `
    -WindowStyle Hidden

Log "Processo iniciado (PID $($proc.Id))"

# Aguarda a URL do túnel ser gravada (até 60s)
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    if (Test-Path $TunnelFile) {
        $url = Get-Content $TunnelFile -Raw
        Log "Túnel ativo: $url"
        break
    }
}

Log "=== Startup concluído ==="
