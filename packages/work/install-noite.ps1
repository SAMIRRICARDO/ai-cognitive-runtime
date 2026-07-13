# VRAXIA WORK — Registra o modo noturno no Windows Task Scheduler
# Execute como Administrador (necessário para WakeToRun e RunLevel Highest)
# Uso: powershell -ExecutionPolicy Bypass -File install-noite.ps1

param(
    [string]$HoraInicio = "00:01",   # Hora de disparo (formato HH:mm)
    [switch]$IniciarAgora             # Inicia a tarefa imediatamente após registrar
)

$TaskName   = "VRAXIA-WORK-Noturno"
$ScriptPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "NOITE.ps1"
$WorkDir    = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Test-Path $ScriptPath)) {
    Write-Error "NOITE.ps1 não encontrado em: $ScriptPath"
    exit 1
}

# Remove tarefa anterior
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask  -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Tarefa anterior removida."
}

# ── Ação ──────────────────────────────────────────────────────────────────────
$action = New-ScheduledTaskAction `
    -Execute    "powershell.exe" `
    -Argument   "-NonInteractive -ExecutionPolicy Bypass -File `"$ScriptPath`"" `
    -WorkingDirectory $WorkDir

# ── Trigger: diário às $HoraInicio ───────────────────────────────────────────
$hora  = [int]$HoraInicio.Split(':')[0]
$min   = [int]$HoraInicio.Split(':')[1]
$at    = (Get-Date -Hour $hora -Minute $min -Second 0)
# Se o horário já passou hoje, agenda para amanhã
if ($at -lt (Get-Date)) { $at = $at.AddDays(1) }

$trigger = New-ScheduledTaskTrigger -Daily -At $at

# ── Configurações ─────────────────────────────────────────────────────────────
$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit        (New-TimeSpan -Hours 8) `
    -WakeToRun `
    -StartWhenAvailable `
    -RestartCount              2 `
    -RestartInterval           (New-TimeSpan -Minutes 5) `
    -MultipleInstances         IgnoreNew `
    -RunOnlyIfNetworkAvailable

# ── Principal ─────────────────────────────────────────────────────────────────
$principal = New-ScheduledTaskPrincipal `
    -UserId    $env:USERNAME `
    -LogonType Interactive `
    -RunLevel  Highest

# ── Registrar ─────────────────────────────────────────────────────────────────
Register-ScheduledTask `
    -TaskName   $TaskName `
    -Action     $action `
    -Trigger    $trigger `
    -Settings   $settings `
    -Principal  $principal `
    -Description "VRAXIA WORK: modo noturno — 3 rodadas × 8 candidaturas no LinkedIn. Dispara às $HoraInicio." `
    -Force | Out-Null

Write-Host ""
Write-Host "✅ Tarefa '$TaskName' registrada!" -ForegroundColor Green
Write-Host "   → Disparo diário às $HoraInicio" -ForegroundColor Cyan
Write-Host "   → WakeToRun: liga o PC do standby para executar" -ForegroundColor Cyan
Write-Host "   → Tempo máximo: 8 horas (3 rodadas × 2h + margem)" -ForegroundColor Cyan
Write-Host "   → Reinicia até 2× em caso de falha (intervalo 5min)" -ForegroundColor Cyan
Write-Host ""

if ($IniciarAgora) {
    Write-Host "Iniciando agora..." -ForegroundColor Yellow
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "Executando! Acompanhe o log:" -ForegroundColor Green
    Write-Host "   Get-Content '$WorkDir\.vraxia-work\noite.log' -Wait -Tail 20" -ForegroundColor Gray
} else {
    Write-Host "Para iniciar agora (sem esperar meia-noite):" -ForegroundColor Yellow
    Write-Host "   Start-ScheduledTask -TaskName '$TaskName'" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Para acompanhar o log ao vivo:" -ForegroundColor Yellow
    Write-Host "   Get-Content '$WorkDir\.vraxia-work\noite.log' -Wait -Tail 20" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Para remover:" -ForegroundColor Yellow
    Write-Host "   Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false" -ForegroundColor Gray
}
Write-Host ""
