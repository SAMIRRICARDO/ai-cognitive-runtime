# VRAXIA WORK — Monitor 24-48h
# Exibe estado do sistema a cada 30 minutos e alerta sobre anomalias.
# Uso: powershell -ExecutionPolicy Bypass -File MONITOR.ps1
#      powershell -ExecutionPolicy Bypass -File MONITOR.ps1 -IntervalMinutes 15

param(
    [int]$IntervalMinutes = 30,
    [int]$MaxHours        = 48
)

$RootDir = "C:\AI-LAB\ai-cognitive-runtime"
$WorkDir = "$RootDir\packages\work"
$DataDir = "$WorkDir\.vraxia-work"
$MonitorLog = "$DataDir\monitor.log"

$ErrorActionPreference = "Continue"

function Log {
    param([string]$Msg, [string]$Color = "White")
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Msg"
    Write-Host $line -ForegroundColor $Color
    Add-Content -Path $MonitorLog -Value $line -Encoding UTF8
}

function Get-ApiStats {
    try {
        $s = Invoke-RestMethod "http://localhost:3001/api/work/stats" -TimeoutSec 5
        return $s
    } catch { return $null }
}

function Get-StateStats {
    try {
        $s = Invoke-RestMethod "http://localhost:3001/api/work/state-stats" -TimeoutSec 5
        return $s
    } catch { return $null }
}

function Get-SchedulerStatus {
    $tasks = schtasks /query /fo CSV 2>$null | Select-String "VRAXIA" | ForEach-Object {
        $cols = $_ -replace '"','' -split ','
        [PSCustomObject]@{ Name = $cols[0].Trim('\'); Next = $cols[1]; Status = $cols[2] }
    } | Sort-Object Name -Unique
    return $tasks
}

function Get-SessionAge {
    $cookiesPath = "$DataDir\session\cookies.json"
    if (-not (Test-Path $cookiesPath)) { return "AUSENTE" }
    $age = (Get-Date) - (Get-Item $cookiesPath).LastWriteTime
    return "$([math]::Round($age.TotalHours, 1))h atrás"
}

function Get-EvidenceCount {
    $logsDir = "$DataDir\logs"
    if (-not (Test-Path $logsDir)) { return 0 }
    return (Get-ChildItem $logsDir -Directory | Measure-Object).Count
}

function Get-HealthSummary {
    $logsDir = "$DataDir\logs"
    if (-not (Test-Path $logsDir)) { return "N/A" }
    $reports = Get-ChildItem $logsDir -Filter "health-report.json" -Recurse
    if ($reports.Count -eq 0) { return "0 health checks" }
    $healthy = 0; $unhealthy = 0; $totalScore = 0
    foreach ($r in $reports) {
        try {
            $data = Get-Content $r.FullName -Raw | ConvertFrom-Json
            if ($data.healthy) { $healthy++ } else { $unhealthy++ }
            $totalScore += $data.score
        } catch {}
    }
    $avgScore = if ($reports.Count -gt 0) { [math]::Round($totalScore / $reports.Count, 0) } else { 0 }
    return "$healthy OK / $unhealthy FALHA | Score médio: $avgScore/100"
}

function Get-SchedulerHistory {
    $histPath = "$DataDir\scheduler-history.jsonl"
    if (-not (Test-Path $histPath)) { return "Sem histórico" }
    $lines = Get-Content $histPath | Where-Object { $_.Trim() }
    $last = $lines | Select-Object -Last 1
    try {
        $entry = $last | ConvertFrom-Json
        return "Última: $($entry.date) $($entry.firedAt.Substring(11,5)) (exit: $($entry.exitCode)) | Total: $($lines.Count) entradas"
    } catch { return "Formato inválido" }
}

function Show-Checkpoint {
    param([int]$Iter)

    $stats    = Get-ApiStats
    $states   = Get-StateStats
    $sched    = Get-SchedulerStatus
    $evidence = Get-EvidenceCount
    $health   = Get-HealthSummary
    $history  = Get-SchedulerHistory
    $session  = Get-SessionAge

    $sep = "═" * 60
    Log "" White
    Log $sep Cyan
    Log "  VRAXIA WORK — CHECKPOINT $Iter | $(Get-Date -Format 'HH:mm dd/MM/yyyy')" Cyan
    Log $sep Cyan

    # Candidaturas
    if ($stats) {
        Log "  CANDIDATURAS:" White
        Log "    Total escaneadas : $($stats.totalScanned)" White
        Log "    Aplicadas        : $($stats.totalApplied)" White
        Log "    Filtradas        : $($stats.byStatus.filtered_out)" White
        Log "    Em fila (queued) : $($stats.byStatus.queued)" White
        Log "    Erros            : $($stats.byStatus.error)" White
        Log "    Custo acumulado  : `$$([math]::Round($stats.estimatedCostUsd, 4))" White
    } else {
        Log "  CANDIDATURAS: API indisponível" Yellow
    }

    # Estados (máquina de estados)
    if ($states) {
        Log "  ESTADOS:" White
        Log "    confirmed : $($states.confirmed)" Green
        Log "    failed    : $($states.failed)" $(if ($states.failed -gt 0) { "Yellow" } else { "White" })
        Log "    queued    : $($states.queued)" White
        Log "    cancelled : $($states.cancelled)" White
    }

    # Evidências e health
    Log "  EVIDÊNCIAS:" White
    Log "    Dirs de evidência : $evidence" White
    Log "    Health checks     : $health" White

    # Sessão
    $sessionColor = if ($session -match "^\d+\.?\d*h" -and [double]($session -replace 'h.*','') -gt 336) { "Red" } else { "White" }
    Log "  SESSÃO LinkedIn  : $session" $sessionColor

    # Scheduler
    Log "  SCHEDULER:" White
    Log "    Histórico: $history" White
    foreach ($t in $sched) {
        $color = if ($t.Status -match "execução") { "Cyan" } elseif ($t.Status -match "Pronto") { "Green" } else { "Yellow" }
        Log "    $($t.Name.PadRight(30)) | $($t.Status) | Próx: $($t.Next)" $color
    }

    # Alertas
    $alerts = @()
    if ($stats -and $stats.totalApplied -eq 0) { $alerts += "ALERTA: 0 candidaturas aplicadas — sessão pode estar expirada" }
    if ($evidence -eq 0 -and $stats -and $stats.totalApplied -gt 0) { $alerts += "ALERTA: Nenhum diretório de evidência encontrado — novo pipeline nunca executou" }
    if ($states -and $states.failed -gt 10) { $alerts += "ALERTA: $($states.failed) candidaturas em estado failed — investigar" }

    if ($alerts.Count -gt 0) {
        Log "  ALERTAS:" Red
        foreach ($a in $alerts) { Log "    ⚠ $a" Red }
    } else {
        Log "  Status: OK" Green
    }

    Log $sep Cyan
    Log "" White
}

# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════

$maxIter   = [math]::Ceiling($MaxHours * 60 / $IntervalMinutes)
$intervalS = $IntervalMinutes * 60

Log "VRAXIA WORK Monitor iniciado — intervalo: ${IntervalMinutes}min, duração: ${MaxHours}h" Cyan
Log "Log: $MonitorLog" Cyan

for ($i = 1; $i -le $maxIter; $i++) {
    Show-Checkpoint -Iter $i
    if ($i -lt $maxIter) {
        Log "Próximo checkpoint em ${IntervalMinutes}min..." White
        Start-Sleep -Seconds $intervalS
    }
}

Log "Monitor concluído após $MaxHours horas." Cyan
