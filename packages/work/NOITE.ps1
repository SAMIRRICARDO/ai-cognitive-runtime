# VRAXIA WORK — Modo Noturno
# Executa rodadas de candidaturas enquanto você dorme.
# Limites anti-ban: 8 por rodada, 24 por noite, 2h entre rodadas, stop imediato em CAPTCHA/ban.
#
# Uso: powershell -ExecutionPolicy Bypass -File NOITE.ps1
# Para personalizar: powershell -File NOITE.ps1 -LimiteNoite 16 -PausaHoras 3

param(
    [int]$LimitePorRodada = 8,
    [int]$LimiteNoite     = 24,
    [int]$PausaHoras      = 2,
    [string]$Platform     = "linkedin"
)

$ErrorActionPreference = "Continue"

# ── Paths ─────────────────────────────────────────────────────────────────────
$RootDir = "C:\AI-LAB\ai-cognitive-runtime"
$WorkDir = "$RootDir\packages\work"
$DataDir = "$WorkDir\.vraxia-work"
$LogFile = "$DataDir\noite.log"

New-Item -ItemType Directory -Force $DataDir | Out-Null

# ── Logging ───────────────────────────────────────────────────────────────────
function Log {
    param([string]$Msg, [string]$Color = "White")
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Msg"
    Write-Host $line -ForegroundColor $Color
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

# ── Carregar .env (Task Scheduler não herda variáveis do shell) ───────────────
foreach ($envPath in @("$RootDir\.env", "$WorkDir\.env")) {
    if (-not (Test-Path $envPath)) { continue }
    Get-Content $envPath | ForEach-Object {
        if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
            $k = $Matches[1]; $v = $Matches[2].Trim('"').Trim("'").Trim()
            if ($k -and -not [System.Environment]::GetEnvironmentVariable($k, 'Process')) {
                [System.Environment]::SetEnvironmentVariable($k, $v, 'Process')
            }
        }
    }
}

# ── Telegram ──────────────────────────────────────────────────────────────────
function Send-Telegram {
    param([string]$Text)
    $token = $env:TELEGRAM_BOT_TOKEN
    $chat  = $env:TELEGRAM_CHAT_ID
    if (-not $token -or -not $chat) {
        Log "WARN: TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID não configurados." Yellow
        return
    }
    try {
        $body = @{ chat_id = $chat; text = $Text; parse_mode = "HTML" } | ConvertTo-Json -Compress
        Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/sendMessage" `
            -Method POST -ContentType "application/json; charset=utf-8" `
            -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) | Out-Null
    } catch {
        Log "WARN Telegram falhou: $_" Yellow
    }
}

# ── Checar cooldown (gravado pelo daily-runner em caso de ban) ─────────────────
function Test-Cooldown {
    $f = "$DataDir\cooldown.json"
    if (-not (Test-Path $f)) { return $false }
    try {
        $cd = Get-Content $f -Raw | ConvertFrom-Json
        return ([datetime]$cd.until -gt (Get-Date))
    } catch { return $false }
}

function Get-CooldownInfo {
    $f = "$DataDir\cooldown.json"
    try { return Get-Content $f -Raw | ConvertFrom-Json } catch { return $null }
}

# ── Estatísticas via API local ────────────────────────────────────────────────
function Get-TodayApplied {
    try {
        $daily = Invoke-RestMethod "http://localhost:3001/api/work/chart/daily" -TimeoutSec 5
        return [int]($daily.applied[-1])
    } catch { return 0 }
}

function Get-StatsLine {
    try {
        $s        = Invoke-RestMethod "http://localhost:3001/api/work/stats" -TimeoutSec 5
        $applied  = if ($s.byStatus.applied)     { $s.byStatus.applied }     else { 0 }
        $filtered = if ($s.byStatus.filtered_out){ $s.byStatus.filtered_out } else { 0 }
        $errors   = if ($s.byStatus.error)       { $s.byStatus.error }       else { 0 }
        $costVal  = if ($null -ne $s.estimatedCostUsd) { $s.estimatedCostUsd } else { 0 }
        $cost     = [math]::Round($costVal, 5)
        return "Aplicadas: $applied | Filtradas: $filtered | Erros: $errors | Custo: `$$cost"
    } catch { return "(stats indisponíveis)" }
}

# ── Iniciar API server (se não estiver rodando) ────────────────────────────────
function Start-ApiServer {
    $alive = try {
        Invoke-RestMethod "http://localhost:3001/api/work/health" -TimeoutSec 3 | Out-Null; $true
    } catch { $false }

    if ($alive) {
        Log "API server já rodando em :3001." Green
        return
    }

    Log "Iniciando API server..." Cyan
    Start-Process powershell.exe `
        -ArgumentList "-NoExit -WindowStyle Hidden -Command `"Set-Location '$WorkDir'; npx tsx src/api/server.ts`"" `
        -PassThru | Out-Null

    # Aguarda até 15s para o servidor responder
    for ($i = 0; $i -lt 5; $i++) {
        Start-Sleep -Seconds 3
        $ok = try { Invoke-RestMethod "http://localhost:3001/api/work/health" -TimeoutSec 2 | Out-Null; $true } catch { $false }
        if ($ok) { Log "API server online." Green; return }
    }
    Log "WARN: API server pode não ter iniciado — continuando mesmo assim." Yellow
}

# ── Verificar validade da sessão LinkedIn ─────────────────────────────────────
function Test-LinkedInSession {
    $cookiesPath = "$DataDir\session\cookies.json"
    if (-not (Test-Path $cookiesPath)) {
        Log "WARN: Arquivo de sessão não encontrado: $cookiesPath" Yellow
        return $false
    }
    $age = (Get-Date) - (Get-Item $cookiesPath).LastWriteTime
    if ($age.TotalDays -gt 30) {
        Log "WARN: Arquivo de sessão com $([math]::Round($age.TotalDays)) dias — verificando li_at na sequência." Yellow
    }
    # Verificação leve: testa se o cookie 'li_at' existe (token de sessão LinkedIn)
    try {
        $cookies = Get-Content $cookiesPath -Raw | ConvertFrom-Json
        $liAt = $cookies | Where-Object { $_.name -eq 'li_at' }
        if (-not $liAt) {
            Log "WARN: Cookie li_at ausente — sessão inválida." Yellow
            return $false
        }
        # li_at tem expiração em epoch seconds
        if ($liAt.expires -and $liAt.expires -gt 0) {
            $expDate = [DateTimeOffset]::FromUnixTimeSeconds([long]$liAt.expires).LocalDateTime
            if ($expDate -lt (Get-Date)) {
                Log "WARN: Cookie li_at expirado em $($expDate.ToString('dd/MM/yyyy HH:mm'))." Yellow
                return $false
            }
            Log "Sessão válida até $($expDate.ToString('dd/MM/yyyy HH:mm')) (arquivo: $([math]::Round($age.TotalDays, 1))d)." Green
        }
        return $true
    } catch {
        Log "WARN: Falha ao verificar cookies: $_" Yellow
        return $false
    }
}

# ── Executar uma rodada do hunt ────────────────────────────────────────────────
function Invoke-Round {
    param([int]$Num, [int]$Limit)

    Log "━━━ RODADA $Num — plataforma: $Platform | limite: $Limit ━━━" Cyan

    # Resolve npx explicitamente para garantir PATH correto no contexto do Task Scheduler
    $npxPath = (Get-Command npx -ErrorAction SilentlyContinue).Source
    if (-not $npxPath) {
        # Fallback: procura Node.js em locais comuns
        foreach ($nodePath in @("$env:APPDATA\npm\npx.cmd", "C:\Program Files\nodejs\npx.cmd", "C:\Program Files (x86)\nodejs\npx.cmd")) {
            if (Test-Path $nodePath) { $npxPath = $nodePath; break }
        }
    }
    if (-not $npxPath) {
        Log "ERRO: npx não encontrado no PATH. Verifique instalação do Node.js." Red
        return @{ exitCode = 127; durationSec = 0; appliedJobs = @() }
    }

    $huntArgs = @("tsx", "src/cli/hunt.ts", "--platform", $Platform, "--limit", "$Limit")
    if ($env:OBSIDIAN_VAULT) { $huntArgs += @("--vault", $env:OBSIDIAN_VAULT) }
    if ($env:RESUME_PATH)    { $huntArgs += @("--resume", $env:RESUME_PATH) }

    $start = Get-Date

    Push-Location $WorkDir
    try {
        # Tee-Object no PS 5.1: -FilePath e -Variable são parameter sets exclusivos — não combinar.
        # Solução: atribuir o output do pipeline (passa por Tee-Object que só escreve no arquivo).
        # A atribuição à $roundLines captura o que Tee-Object pass-through.
        $roundLines = & $npxPath @huntArgs 2>&1 | Tee-Object -FilePath $LogFile -Append
        $code = $LASTEXITCODE
    } finally {
        Pop-Location
    }

    $dur = [int]((Get-Date) - $start).TotalSeconds

    # Detectar falha de login (sessão expirada) pelo output
    $sessionExpired = $roundLines | Where-Object { "$_" -match "Falha no login LinkedIn|login failed|autenticação falhou" }
    if ($sessionExpired -or ($dur -lt 10 -and $code -ne 0)) {
        Log "WARN: Sessão pode ter expirado (saída em ${dur}s, exit $code). Notificando..." Yellow
        Send-Telegram "⚠️ <b>VRAXIA NOITE — Sessão LinkedIn expirada</b>`nRodada $Num finalizou em ${dur}s (exit: $code).`nRenovação necessária: rode <code>npm run session:renew</code>"
    }

    # Parseia vagas aplicadas com sucesso no output desta rodada
    # Detecta: "Aplicado!" (Catho/Gupy/Greenhouse) e "Candidatura CONFIRMADA" (LinkedIn Easy Apply)
    $appliedJobs = [System.Collections.Generic.List[string]]::new()
    $lastTitle   = ""
    foreach ($line in $roundLines) {
        $s = "$line".Trim()
        if ($s -match ' @ ' -and $s -notmatch '^Score:' -and $s -notmatch 'Aplicando' -and $s -notmatch 'Aplicado' -and $s -notmatch '━') {
            $lastTitle = $s
        }
        $isSuccess = ($s -match '^Aplicado!' -and $s -notmatch 'simulado') -or ($s -match 'Candidatura CONFIRMADA')
        if ($isSuccess -and $lastTitle) {
            $appliedJobs.Add($lastTitle)
            $lastTitle = ""
        }
    }

    Log "Rodada $Num finalizada — exit: $code | duração: ${dur}s | aplicadas: $($appliedJobs.Count)" $(if ($code -eq 0) { "Green" } else { "Yellow" })
    return @{ exitCode = $code; durationSec = $dur; appliedJobs = $appliedJobs }
}

# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════
$maxRodadas = [math]::Ceiling($LimiteNoite / $LimitePorRodada)

Log "" White
Log "╔══════════════════════════════════════════╗" Cyan
Log "║   VRAXIA WORK — MODO NOTURNO             ║" Cyan
Log "║   $maxRodadas rodadas × $LimitePorRodada aplicações = $LimiteNoite máx/noite     ║" Cyan
Log "║   Pausa: $PausaHoras h entre rodadas                  ║" Cyan
Log "╚══════════════════════════════════════════╝" Cyan
Log "" White

# Guard: domingo é descanso
if ((Get-Date).DayOfWeek -eq "Sunday") {
    Log "Domingo é dia de descanso. Encerrando." Yellow
    Send-Telegram "🛑 VRAXIA NOITE — Domingo é descanso. Não executado."
    exit 0
}

# Guard: cooldown ativo
if (Test-Cooldown) {
    $cd = Get-CooldownInfo
    Log "Cooldown ativo até $($cd.until). Motivo: $($cd.reason). Encerrando." Red
    Send-Telegram "⛔ VRAXIA NOITE — Cooldown ativo até $($cd.until).`nMotivo: $($cd.reason)"
    exit 0
}

# Guard: sessão LinkedIn válida (evita rodadas de 0s em silêncio)
if ($Platform -eq "linkedin" -or $Platform -eq "all") {
    if (-not (Test-LinkedInSession)) {
        Log "ERRO: Sessão LinkedIn expirada ou inválida — abortando modo noturno." Red
        Send-Telegram "⚠️ <b>VRAXIA NOITE — Sessão LinkedIn expirada!</b>`nO modo noturno foi cancelado para evitar tentativas inúteis.`n`nPara renovar: <code>npm run session:renew</code> (com browser visível)`nOu execute manualmente: <code>npx tsx src/cli/renew-session.ts</code>"
        exit 1
    }
}

Start-ApiServer

Send-Telegram "🌙 <b>VRAXIA WORK — Modo Noturno iniciado</b>`nPlataforma: $Platform`nPlanejado: $maxRodadas rodadas × $LimitePorRodada = $LimiteNoite candidaturas`nInício: $(Get-Date -Format 'HH:mm dd/MM')"

$totalNoite = 0
$rodada = 0

while ($totalNoite -lt $LimiteNoite -and $rodada -lt $maxRodadas) {

    # Re-checar cooldown antes de cada rodada
    if (Test-Cooldown) {
        $cd = Get-CooldownInfo
        Log "Cooldown ativado entre rodadas. Encerrando." Red
        Send-Telegram "⛔ VRAXIA NOITE — Cooldown ativado (rodada $($rodada + 1)). Motivo: $($cd.reason)"
        break
    }

    # Checar limite diário no DB (segurança extra)
    $dbHoje = Get-TodayApplied
    if (($dbHoje + $totalNoite) -ge $LimiteNoite) {
        Log "Limite diário atingido no DB ($dbHoje no banco + $totalNoite nesta noite). Encerrando." Yellow
        break
    }

    $rodada++
    $result = Invoke-Round -Num $rodada -Limit $LimitePorRodada

    # Ban detectado — exit code 2 sinalizado pelo hunt.ts
    if ($result.exitCode -eq 2) {
        Log "BAN DETECTADO (exit 2) — encerrando imediatamente." Red
        Send-Telegram "⛔ <b>VRAXIA NOITE — BAN na rodada $rodada!</b>`nEncerrando. Cooldown ativado pelo scheduler."
        exit 2
    }

    $totalNoite += $LimitePorRodada
    $statsLine  = Get-StatsLine

    # Monta lista de vagas aplicadas nesta rodada
    $jobList = if ($result.appliedJobs -and $result.appliedJobs.Count -gt 0) {
        $items = ($result.appliedJobs | ForEach-Object { "  • $_" }) -join "`n"
        "`n`n📋 <b>Vagas desta rodada:</b>`n$items"
    } else {
        "`n`n📋 Nenhuma candidatura nesta rodada."
    }

    Log "Total noite: $totalNoite/$LimiteNoite | $statsLine" Green
    Send-Telegram "✅ <b>Rodada $rodada/$maxRodadas concluída</b> (${$result.durationSec}s)`n$statsLine`n📊 Total noite: $totalNoite/$LimiteNoite$jobList"

    # Pausa entre rodadas
    if ($totalNoite -lt $LimiteNoite -and $rodada -lt $maxRodadas) {
        $proxima = (Get-Date).AddHours($PausaHoras)
        Log "Próxima rodada em $PausaHoras h — às $($proxima.ToString('HH:mm'))." Yellow
        Send-Telegram "⏳ Próxima rodada às <b>$($proxima.ToString('HH:mm'))</b>"
        Start-Sleep -Seconds ($PausaHoras * 3600)
    }
}

# ── Relatório final ────────────────────────────────────────────────────────────
$statsLine = Get-StatsLine
Log "" White
Log "╔══════════════════════════════════════════╗" Green
Log "║   MODO NOTURNO CONCLUÍDO                 ║" Green
Log "║   Rodadas: $rodada/$maxRodadas | Aplicações: $totalNoite/$LimiteNoite    ║" Green
Log "╚══════════════════════════════════════════╝" Green

Send-Telegram "🌅 <b>VRAXIA WORK — Noite concluída!</b>`n📊 $statsLine`n🎯 Rodadas: $rodada/$maxRodadas`n📨 Total: $totalNoite/$LimiteNoite`n🕐 $(Get-Date -Format 'HH:mm dd/MM')"
