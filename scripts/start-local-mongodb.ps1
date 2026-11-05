$ErrorActionPreference = 'Stop'
$backendRoot = Split-Path -Parent $PSScriptRoot
$stateRoot = Join-Path $backendRoot '.local-mongodb'
$dataPath = Join-Path $stateRoot 'data'
$logPath = Join-Path $stateRoot 'mongod.log'
$nodePath = (Get-Command node -ErrorAction Stop).Source
$helperPath = Join-Path $PSScriptRoot 'local-mongodb.cjs'

# Existing listeners must pass the replica-set identity check below.
$listener = Get-NetTCPConnection -State Listen -LocalPort 27018 -ErrorAction SilentlyContinue
if (-not $listener) {
    $mongoBinary = Get-ChildItem 'C:\Program Files\MongoDB\Server\*\bin\mongod.exe' |
        Sort-Object { [version]$_.Directory.Parent.Name } -Descending |
        Select-Object -First 1
    if (-not $mongoBinary) { throw 'Install MongoDB Community Server before starting the local database.' }
    New-Item -ItemType Directory -Path $dataPath -Force | Out-Null
    $arguments = @('--dbpath', ('"' + $dataPath + '"'), '--logpath', ('"' + $logPath + '"'),
        '--logappend', '--port', '27018', '--bind_ip', '127.0.0.1', '--replSet', 'banjara-test',
        '--oplogSize', '128', '--wiredTigerCacheSizeGB', '0.25')
    Start-Process -FilePath $mongoBinary.FullName -ArgumentList $arguments -WindowStyle Hidden | Out-Null
}
& $nodePath $helperPath init
if ($LASTEXITCODE -ne 0) { throw "Local MongoDB did not become ready. Check $logPath" }
