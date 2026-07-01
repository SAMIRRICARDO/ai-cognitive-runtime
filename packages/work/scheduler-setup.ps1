# scheduler-setup.ps1 — Registra VRAXIA-WORK-Daily no Windows Task Scheduler
# Dispara a cada 4h, Seg-Sex, 24h por dia. Guard no daily-runner impede duplicatas.
# Execute como Administrador: powershell -ExecutionPolicy Bypass -File scheduler-setup.ps1

$TaskName  = "VRAXIA-WORK-Daily"
$WorkDir   = "C:\AI-LAB\ai-cognitive-runtime"
$LogFile   = "$WorkDir\.vraxia-work\scheduler.log"

# Verificar node
$NodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $NodeExe) {
  Write-Error "Node.js nao encontrado no PATH."
  exit 1
}

# Remove tarefa existente
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Tarefa anterior removida."
}

# Criar pasta de log se nao existir
New-Item -ItemType Directory -Force -Path "$WorkDir\.vraxia-work" | Out-Null

# Acao: npx tsx src/scheduler/daily-runner.ts (appenda ao log)
$ScriptArgs = "/c npx tsx packages\work\src\scheduler\daily-runner.ts >> `"$LogFile`" 2>&1"
$Action = New-ScheduledTaskAction `
  -Execute "cmd.exe" `
  -Argument $ScriptArgs `
  -WorkingDirectory $WorkDir

# 6 triggers a cada 4h — compativel com todos os PowerShell 5.x
# Guard no daily-runner garante apenas 1 execucao real por dia (quota 8 candid)
$Trigger = @(
  (New-ScheduledTaskTrigger -Daily -At "00:01AM"),
  (New-ScheduledTaskTrigger -Daily -At "04:01AM"),
  (New-ScheduledTaskTrigger -Daily -At "08:01AM"),
  (New-ScheduledTaskTrigger -Daily -At "12:01PM"),
  (New-ScheduledTaskTrigger -Daily -At "04:01PM"),
  (New-ScheduledTaskTrigger -Daily -At "08:01PM")
)

# Configuracoes de sessao
$Settings = New-ScheduledTaskSettingsSet `
  -ExecutionTimeLimit  (New-TimeSpan -Hours 2) `
  -MultipleInstances   IgnoreNew `
  -StartWhenAvailable `
  -WakeToRun:$false

# Principal: usuario atual, sessao interativa
$Principal = New-ScheduledTaskPrincipal `
  -UserId   ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) `
  -LogonType Interactive `
  -RunLevel Highest

Register-ScheduledTask `
  -TaskName   $TaskName `
  -Action     $Action `
  -Trigger    $Trigger `
  -Settings   $Settings `
  -Principal  $Principal `
  -Description "VRAXIA WORK — Hunt Mode Seg-Sex, 24h/dia, max 8 candidaturas/dia, modo imediato" `
  -Force

Write-Host ""
Write-Host "Tarefa '$TaskName' registrada."
Write-Host "  Ciclo: diario as 00:01 + repeticao a cada 4h (6 disparos/dia)"
Write-Host "  Guard: apenas 1 execucao real por dia (quota 8 candidaturas)"
Write-Host "  Log  : $LogFile"
Write-Host ""

# Disparar imediatamente agora
Write-Host "Iniciando primeira execucao agora..."
Start-ScheduledTask -TaskName $TaskName

Write-Host ""
Write-Host "Para verificar status : Get-ScheduledTask -TaskName '$TaskName' | Select-Object -ExpandProperty State"
Write-Host "Para ver historico    : Get-ScheduledTaskInfo -TaskName '$TaskName'"
Write-Host "Para parar            : Stop-ScheduledTask -TaskName '$TaskName'"
Write-Host "Para remover          : Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
Write-Host "Para ver log          : Get-Content `"$LogFile`" -Tail 50"
