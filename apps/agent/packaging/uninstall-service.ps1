param([switch]$RemoveData)
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
& "$here\tallysync-agent-service.exe" stop
& "$here\tallysync-agent-service.exe" uninstall
if ($RemoveData) { Remove-Item -Recurse -Force (Join-Path $env:ProgramData "TallySync") }
