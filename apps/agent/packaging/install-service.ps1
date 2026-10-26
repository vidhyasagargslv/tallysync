# Manual install (the Inno Setup installer runs the same steps). Run as Administrator from the install folder.
# Optional pre-config:  .\install-service.ps1 -BackendUrl https://app.example.com -ApiKey xxx -Company "My Co"
param([string]$BackendUrl = "", [string]$ApiKey = "", [string]$Company = "")
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$data = Join-Path $env:ProgramData "TallySync"
New-Item -ItemType Directory -Force -Path $data, "$data\logs", "$data\state" | Out-Null
# Lock the data dir down to SYSTEM + Administrators (API key + state live here)
icacls $data /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" | Out-Null
if ($BackendUrl -or $ApiKey -or $Company) {
  $env:TALLYSYNC_HOME = $data
  $a = @("configure"); if ($BackendUrl) { $a += @("--backend", $BackendUrl) }; if ($ApiKey) { $a += @("--key", $ApiKey) }; if ($Company) { $a += @("--company", $Company) }
  & "$here\tallysync-agent.exe" @a
}
& "$here\tallysync-agent-service.exe" install
& "$here\tallysync-agent-service.exe" start
Write-Host "TallySync Agent installed as a Windows service (auto start). Open http://127.0.0.1:4100"
