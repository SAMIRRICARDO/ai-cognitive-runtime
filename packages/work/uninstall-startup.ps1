# VRAXIA WORK — Remover tarefa de inicialização
$TaskName = "VRAXIA_WORK_Server"

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "✅ Tarefa '$TaskName' removida."
} else {
    Write-Host "Tarefa '$TaskName' não encontrada."
}
