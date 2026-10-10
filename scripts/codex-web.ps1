param(
    [ValidateSet("start", "stop", "restart", "status", "logs")]
    [string]$Action = "start"
)

$ErrorActionPreference = "Stop"
$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ServerEntry = Join-Path $RootDir "dist-server\index.js"
$RunDir = Join-Path $RootDir ".run"
$PidFile = Join-Path $RunDir "codex-web.pid"
$StdoutLog = Join-Path $RunDir "codex-web.out.log"
$StderrLog = Join-Path $RunDir "codex-web.error.log"

function Read-HarnessPid {
    if (-not (Test-Path $PidFile)) { return $null }
    $raw = (Get-Content $PidFile -Raw).Trim()
    $value = 0
    if ([int]::TryParse($raw, [ref]$value)) { return $value }
    return $null
}

function Get-HarnessProcess {
    $processId = Read-HarnessPid
    if (-not $processId) { return $null }
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if (-not $process) { return $null }
    try {
        $commandLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $processId").CommandLine
        if ($commandLine -and $commandLine.Contains($ServerEntry)) { return $process }
    } catch {
        return $null
    }
    return $null
}

function Start-Harness {
    $existing = Get-HarnessProcess
    if ($existing) {
        Write-Host "Codex Web is already running (PID $($existing.Id))."
        return
    }
    if (-not (Test-Path $ServerEntry)) {
        throw "Production build not found: $ServerEntry`nRun 'npm run build' first."
    }

    $node = (Get-Command node -ErrorAction Stop).Source
    New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    $arguments = @("--max-old-space-size=256", "`"$ServerEntry`"")
    $process = Start-Process -FilePath $node `
        -ArgumentList $arguments `
        -WorkingDirectory $RootDir `
        -WindowStyle Hidden `
        -RedirectStandardOutput $StdoutLog `
        -RedirectStandardError $StderrLog `
        -PassThru
    Set-Content -Path $PidFile -Value $process.Id -NoNewline
    Start-Sleep -Milliseconds 500
    if ($process.HasExited) {
        Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
        throw "Codex Web failed to start. Check $StderrLog"
    }
    Write-Host "Codex Web started in background (PID $($process.Id))."
    Write-Host "Logs: $StdoutLog and $StderrLog"
}

function Stop-Harness {
    $process = Get-HarnessProcess
    if (-not $process) {
        Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
        Write-Host "Codex Web is not running."
        return
    }

    & taskkill.exe /PID $process.Id /T /F | Out-Null
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    Write-Host "Codex Web process tree stopped."
}

function Show-HarnessStatus {
    $process = Get-HarnessProcess
    if ($process) {
        Write-Host "Codex Web is running (PID $($process.Id))."
        return
    }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    Write-Host "Codex Web is not running."
}

function Show-HarnessLogs {
    New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
    if (-not (Test-Path $StdoutLog)) { New-Item -ItemType File -Path $StdoutLog | Out-Null }
    if (-not (Test-Path $StderrLog)) { New-Item -ItemType File -Path $StderrLog | Out-Null }
    Write-Host "Following logs (Ctrl+C only exits log view):"
    Get-Content -Path $StdoutLog, $StderrLog -Tail 80 -Wait
}

switch ($Action) {
    "start" { Start-Harness }
    "stop" { Stop-Harness }
    "restart" { Stop-Harness; Start-Harness }
    "status" { Show-HarnessStatus }
    "logs" { Show-HarnessLogs }
}
