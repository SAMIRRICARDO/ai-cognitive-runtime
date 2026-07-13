# VRAXIA WORK — Registrar Watchdog no Windows Task Scheduler
# Execute como Administrador: powershell -ExecutionPolicy Bypass -File install-startup.ps1

$TaskName   = "VRAXIA-WORK-Watchdog"
$ScriptPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "WATCHDOG.ps1"

if (-not (Test-Path $ScriptPath)) {
    Write-Error "Script nao encontrado: $ScriptPath"
    exit 1
}

# Remove tarefas antigas relacionadas
foreach ($old in @("VRAXIA_WORK_Server","VRAXIA-WORK-Watchdog")) {
    if (Get-ScheduledTask -TaskName $old -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $old -Confirm:$false
        Write-Host "Tarefa antiga removida: $old"
    }
}

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$ScriptPath`"" `
    -WorkingDirectory (Split-Path -Parent $ScriptPath)

# Dispara ao fazer login E reinicia automaticamente a cada 1 minuto se morrer
$trigger = New-ScheduledTaskTrigger -AtLogon

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 99 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType Interactive `
    -RunLevel Highest

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "VRAXIA WORK Watchdog: mantém servidor API (3001) + túnel Cloudflare sempre ativos. Auto-reinicia ao cair." `
    -Force | Out-Null

Write-Host ""
Write-Host "Watchdog '$TaskName' registrado!" -ForegroundColor Green
Write-Host "  Inicia: ao fazer login no Windows"
Write-Host "  Reinicia: automaticamente se o processo morrer (intervalo 1 min)"
Write-Host ""
Write-Host "Iniciando agora..." -ForegroundColor Yellow
Start-ScheduledTask -TaskName $TaskName
Start-Sleep 3
$state = (Get-ScheduledTask -TaskName $TaskName).State
Write-Host "Estado: $state" -ForegroundColor Cyan
Write-Host ""
Write-Host "Log: $((Split-Path -Parent $ScriptPath))\.vraxia-work\watchdog.log"
Write-Host ""
