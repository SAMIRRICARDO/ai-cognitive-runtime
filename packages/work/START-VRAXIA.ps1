Write-Host "`nIniciando VRAXIA WORK..." -ForegroundColor Yellow

$ROOT = "C:\AI-LAB\ai-cognitive-runtime"

# Inicia API local (porta 3001)
Start-Process powershell -ArgumentList `
  "-NoExit", "-Command", `
  "cd '$ROOT'; npx tsx packages/work/src/api/server.ts"

Start-Sleep 3

# Inicia tunel cloudflared
Start-Process powershell -ArgumentList `
  "-NoExit", "-Command", `
  "cd '$ROOT'; npx tsx packages/work/src/tunnel/start-tunnel.ts"

Start-Sleep 8

# Mostra URLs
$tunnelFile = "$ROOT\.vraxia-work\tunnel-url.txt"
if (Test-Path $tunnelFile) {
  $tunnelUrl = Get-Content $tunnelFile -ErrorAction SilentlyContinue
  if ($tunnelUrl) {
    Write-Host "`n[OK] API local:    http://localhost:3001/work" -ForegroundColor Green
    Write-Host "[OK] API publica:  $tunnelUrl" -ForegroundColor Cyan
    Write-Host "[OK] Dashboard:    https://vraxia-work-dashboard.vercel.app" -ForegroundColor Cyan
    Write-Host "`n[!] No dashboard Vercel, clique em [?] e configure a API URL:" -ForegroundColor Yellow
    Write-Host "    $tunnelUrl" -ForegroundColor White
  }
} else {
  Write-Host "`n[!] Tunel ainda iniciando... aguarde alguns segundos e verifique:" -ForegroundColor Yellow
  Write-Host "    $ROOT\.vraxia-work\tunnel-url.txt" -ForegroundColor Gray
  Write-Host "`n[OK] API local disponivel em: http://localhost:3001/work" -ForegroundColor Green
}

Write-Host ""
