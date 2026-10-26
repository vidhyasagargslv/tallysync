; Inno Setup 6 script -> TallySync-Agent-Setup.exe (one installer for every client).
; Build on Windows: iscc apps\agent\packaging\tallysync-agent.iss  (after `npm run build:exe` and fetch-winsw)
#define AppVersion "1.0.0"
[Setup]
AppId={{6B0F5D2E-3C77-4D0B-9A51-7C1E2B9A4F10}
AppName=TallySync Agent
AppVersion={#AppVersion}
AppPublisher=TallySync
DefaultDirName={autopf}\TallySync Agent
DisableProgramGroupPage=yes
OutputDir=..\release
OutputBaseFilename=TallySync-Agent-Setup-{#AppVersion}
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
Compression=lzma2
SolidCompression=yes
CloseApplications=yes
; SignTool=signtool sign /fd sha256 /tr http://timestamp.digicert.com /td sha256 /a $f

[Files]
Source: "..\release\tallysync-agent.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "bin\tallysync-agent-service.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "tallysync-agent-service.xml"; DestDir: "{app}"; Flags: ignoreversion
Source: "install-service.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "uninstall-service.ps1"; DestDir: "{app}"; Flags: ignoreversion

[Dirs]
Name: "{commonappdata}\TallySync"; Permissions: system-full admins-full
Name: "{commonappdata}\TallySync\logs"
Name: "{commonappdata}\TallySync\state"

[Icons]
Name: "{autoprograms}\TallySync Agent"; Filename: "http://127.0.0.1:4100"

[Run]
; stop+uninstall any previous service (upgrade), then install, start (Automatic, restart on failure)
Filename: "{app}\tallysync-agent-service.exe"; Parameters: "stop"; Flags: runhidden; StatusMsg: "Stopping old service..."
Filename: "{app}\tallysync-agent-service.exe"; Parameters: "uninstall"; Flags: runhidden
Filename: "{app}\tallysync-agent-service.exe"; Parameters: "install"; Flags: runhidden; StatusMsg: "Installing service..."
Filename: "{app}\tallysync-agent-service.exe"; Parameters: "start"; Flags: runhidden
Filename: "http://127.0.0.1:4100"; Description: "Open TallySync Agent setup page"; Flags: postinstall shellexec nowait

[UninstallRun]
Filename: "{app}\tallysync-agent-service.exe"; Parameters: "stop"; Flags: runhidden; RunOnceId: "StopSvc"
Filename: "{app}\tallysync-agent-service.exe"; Parameters: "uninstall"; Flags: runhidden; RunOnceId: "DelSvc"
; Data in %ProgramData%\TallySync (settings, API key, state, logs) is kept on uninstall so a reinstall stays configured.
