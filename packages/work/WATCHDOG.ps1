# VRAXIA WORK — Watchdog
# Mantém servidor API + túnel Cloudflare sempre ativos.
# Reinicia qualquer um que cair automaticamente.

$WorkDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogFile    = Join-Path $WorkDir ".vraxia-work\watchdog.log"
$TunnelFile = Join-Path $WorkDir ".vraxia-work\tunnel-url.txt"
$NpxCmd     = "C:\Program Files\nodejs\npx.cmd"
$CheckEvery = 20   # segundos entre verificações

$LockFile   = Join-Path $WorkDir ".vraxia-work\watchdog.lock"

New-Item -ItemType Directory -Force (Split-Path $LogFile) | Out-Null

# ── Lock: garante instância única ─────────────────────────────────────────────
if (Test-Path $LockFile) {
    $lockedPid = (Get-Content $LockFile -Raw).Trim()
    if ($lockedPid -and (Get-Process -Id $lockedPid -ErrorAction SilentlyContinue)) {
        Write-Host "[Watchdog] Já existe uma instância rodando (PID $lockedPid). Encerrando."
        exit 0
    }
    Remove-Item $LockFile -ErrorAction SilentlyContinue
}
$PID | Set-Content $LockFile -Encoding UTF8

function Log($msg) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Write-Host $line
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

function IsServerAlive {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:3001/api/work/health" `
             -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        return $r.StatusCode -eq 200
    } catch { return $false }
}

function IsProcessAlive($pid) {
    if (-not $pid) { return $false }
    return $null -ne (Get-Process -Id $pid -ErrorAction SilentlyContinue)
}

function KillProcess($pid) {
    if (-not $pid) { return }
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
}

function StartServer {
    Log "Iniciando servidor API..."
    $env:ENABLE_MEMORY = "false"
    $p = Start-Process -FilePath $NpxCmd `
        -ArgumentList "tsx","src/api/server.ts" `
        -WorkingDirectory $WorkDir `
        -RedirectStandardOutput "$WorkDir\.vraxia-work\server.log" `
        -RedirectStandardError  "$WorkDir\.vraxia-work\server-err.log" `
        -PassThru -WindowStyle Hidden
    Log "Servidor iniciado (PID $($p.Id))"
    return $p.Id
}

function StartTunnel {
    Log "Iniciando túnel cloudflared..."
    # Limpa URL antiga para detectar nova URL
    Remove-Item $TunnelFile -ErrorAction SilentlyContinue
    $p = Start-Process -FilePath $NpxCmd `
        -ArgumentList "tsx","src/tunnel/start-tunnel.ts" `
        -WorkingDirectory $WorkDir `
        -RedirectStandardOutput "$WorkDir\.vraxia-work\tunnel.log" `
        -RedirectStandardError  "$WorkDir\.vraxia-work\tunnel-err.log" `
        -PassThru -WindowStyle Hidden
    Log "Túnel iniciado (PID $($p.Id))"
    return $p.Id
}

function WaitForServer($maxSecs = 30) {
    for ($i = 0; $i -lt $maxSecs; $i += 2) {
        if (IsServerAlive) { return $true }
        Start-Sleep 2
    }
    return $false
}

function WaitForTunnelUrl($maxSecs = 45) {
    for ($i = 0; $i -lt $maxSecs; $i += 2) {
        if (Test-Path $TunnelFile) {
            $url = (Get-Content $TunnelFile -Raw).Trim()
            if ($url -match "^https://") { Log "Túnel URL: $url"; return }
        }
        Start-Sleep 2
    }
    Log "WARN: URL do túnel não detectada em ${maxSecs}s"
}

# ── Limpa lock ao encerrar ────────────────────────────────────────────────────
Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action { Remove-Item $LockFile -ErrorAction SilentlyContinue } | Out-Null

# ── Aguarda rede na inicialização ─────────────────────────────────────────────
Log "=== VRAXIA WORK Watchdog iniciado ==="
for ($i = 0; $i -lt 15; $i++) {
    try { $null = Test-Connection "1.1.1.1" -Count 1 -ErrorAction Stop; break }
    catch { Start-Sleep 4 }
}

# ── Mata processos antigos orphans ────────────────────────────────────────────
Get-Process -Name "node" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 2

# ── Primeira subida ───────────────────────────────────────────────────────────
$serverPid = StartServer
if (-not (WaitForServer 40)) {
    Log "ERRO: servidor nao respondeu em 40s"
}
$tunnelPid = StartTunnel
WaitForTunnelUrl 45

# ── Loop watchdog ─────────────────────────────────────────────────────────────
while ($true) {
    Start-Sleep $CheckEvery

    $serverOk = IsServerAlive
    $tunnelOk = IsProcessAlive $tunnelPid

    if (-not $serverOk) {
        Log "ALERTA: servidor morto — reiniciando servidor + tunel"
        KillProcess $tunnelPid
        KillProcess $serverPid
        Start-Sleep 3
        $serverPid = StartServer
        if (WaitForServer 40) {
            $tunnelPid = StartTunnel
            WaitForTunnelUrl 45
        } else {
            Log "ERRO: servidor nao subiu apos restart"
        }
        continue
    }

    if (-not $tunnelOk) {
        Log "ALERTA: tunel morto — reiniciando tunel"
        $tunnelPid = StartTunnel
        WaitForTunnelUrl 45
        continue
    }
}
