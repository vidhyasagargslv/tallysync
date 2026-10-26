# Build TallySync-Agent-Setup-<ver>.exe on Windows. Needs Node 22+ and Inno Setup 6 (winget install JRSoftware.InnoSetup).
$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\..\..\.."
Push-Location $root
npm ci
npm run build:exe            # -> apps\agent\release\tallysync-agent.exe
node apps\agent\packaging\fetch-winsw.mjs
$iscc = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
& $iscc apps\agent\packaging\tallysync-agent.iss
Pop-Location
Write-Host "Installer: apps\agent\release\TallySync-Agent-Setup-1.0.0.exe"
