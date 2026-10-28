<#
.SYNOPSIS
  Capri on Windows in one go: what she needs, Capri herself, and her shortcuts.

.DESCRIPTION
  - winget, Windows' package manager, put in first where it's missing (Windows LTSC, Server, Sandbox...)
  - Git and Node.js 20+ (with winget), if they aren't there
  - Ollama with a model, if you want it: her brain on this PC, and what keeps her thinking without the network
  - Codex or Claude Code, if you want them: the coding assistants she watches (and can talk through)
  - Tailscale, if you want it: what links her on all your PCs, wherever they are (her swarm)
  - Capri from this fork, in %LOCALAPPDATA%\Capri (run again: brought up to date), its packages installed
  - Capri in the Start menu and on the desktop, then started

  Without -Yes it asks about the optional parts. Everything else (her AI, her hooks, Telegram...) is set
  up afterwards in Capri herself: her guide, her menu, and her Mainframe window.

.EXAMPLE
  irm https://raw.githubusercontent.com/nf-gh057/capri-desktop/main/install.ps1 | iex

.EXAMPLE
  & ([scriptblock]::Create((irm https://raw.githubusercontent.com/nf-gh057/capri-desktop/main/install.ps1))) -Yes -Ollama -Codex

.EXAMPLE
  .\install.ps1 -Uninstall
#>
[CmdletBinding()]
param(
  [string]$Dir,                       # where Capri goes (default: %LOCALAPPDATA%\Capri\capri-desktop, or this clone)
  [string]$Repo = 'https://github.com/nf-gh057/capri-desktop.git',
  [string]$Branch = 'main',
  [switch]$Ollama,                    # Ollama and a model, without asking
  [switch]$NoOllama,
  [string]$Model = 'gemma3:4b',       # 3.3 GB, good in languages other than English; llama3.2 (2 GB) for smaller PCs
  [switch]$Codex,                     # OpenAI's Codex CLI (npm), without asking
  [switch]$Claude,                    # Anthropic's Claude Code (its own installer), without asking
  [switch]$Tailscale,                 # Tailscale (winget), for her swarm, without asking
  [switch]$Yes,                       # no questions: only what the switches say
  [string[]]$ShortcutDirs,            # where her shortcuts go (default: Start menu and desktop)
  [switch]$NoShortcut,
  [switch]$NoLaunch,
  [switch]$Uninstall                  # her hooks, shortcuts and folder gone (Git, Node.js, Ollama stay)
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # Invoke-WebRequest is many times slower with its progress bar
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function Say($text) { Write-Host "[capri] $text" -ForegroundColor Magenta }
function Done($text) { Write-Host "[capri] $text" -ForegroundColor Green }
function Warn($text) { Write-Host "[capri] $text" -ForegroundColor Yellow }

# yes or no, defaulting to `default` (and to it without a question with -Yes)
function Ask($question, [bool]$default) {
  if ($Yes) { return $default }
  $hint = if ($default) { '[Y/n]' } else { '[y/N]' }
  $answer = Read-Host "[capri] $question $hint"
  if ([string]::IsNullOrWhiteSpace($answer)) { return $default }
  return $answer -match '^(y|yes|t|tak)'
}

# PATH as it is now in the registry: what an installer just added counts in this window too
function Update-Path {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = (@($machine, $user, "$env:LOCALAPPDATA\Microsoft\WindowsApps") | Where-Object { $_ }) -join ';'
}

function Has($command) { [bool](Get-Command $command -ErrorAction SilentlyContinue) }

# A program run, its output shown: what it writes on stderr (git's progress, npm's warnings) is just
# output, not a PowerShell error; $LASTEXITCODE says whether it worked.
function Run([scriptblock]$command) {
  $before = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $command 2>&1 | ForEach-Object { Write-Host "  $_" }
  } finally {
    $ErrorActionPreference = $before
  }
}

# ---------- winget ----------

function Install-WingetFromModule {
  # Microsoft's own way where the Store isn't there: its WinGet module brings winget and what it needs
  if (-not (Get-PackageProvider -ListAvailable -Name NuGet -ErrorAction SilentlyContinue | Where-Object { $_.Version -ge [version]'2.8.5.201' })) {
    Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope CurrentUser | Out-Null
  }
  Install-Module -Name Microsoft.WinGet.Client -Repository PSGallery -Scope CurrentUser -Force -AllowClobber | Out-Null
  Import-Module Microsoft.WinGet.Client -Force
  Repair-WinGetPackageManager -Latest -Force | Out-Null
}

function Install-WingetFromRelease {
  # else straight from its release on GitHub: its dependencies first, then App Installer itself
  $tmp = Join-Path $env:TEMP "capri-winget-$PID"
  New-Item -ItemType Directory -Force $tmp | Out-Null
  try {
    $base = 'https://github.com/microsoft/winget-cli/releases/latest/download'
    $deps = Join-Path $tmp 'deps.zip'
    $bundle = Join-Path $tmp 'AppInstaller.msixbundle'
    Invoke-WebRequest "$base/DesktopAppInstaller_Dependencies.zip" -OutFile $deps -UseBasicParsing
    Invoke-WebRequest "$base/Microsoft.DesktopAppInstaller_8wekyb3d8bbwe.msixbundle" -OutFile $bundle -UseBasicParsing
    Expand-Archive $deps -DestinationPath (Join-Path $tmp 'deps') -Force
    $arch = if ([Environment]::Is64BitOperatingSystem) { if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' } } else { 'x86' }
    Get-ChildItem (Join-Path $tmp 'deps') -Recurse -Filter *.appx | Where-Object { $_.FullName -match "\\$arch\\" } | ForEach-Object {
      try { Add-AppxPackage -Path $_.FullName -ErrorAction Stop } catch { if ($_.Exception.Message -notmatch 'higher version|already installed|0x80073D06') { throw } }
    }
    Add-AppxPackage -Path $bundle
  } finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Confirm-Winget {
  Update-Path
  if (Has winget) { return }
  Say 'winget is missing on this Windows: putting it in (Microsoft App Installer)...'
  try {
    Install-WingetFromModule
  } catch {
    Warn "Through Microsoft's WinGet module it didn't work ($($_.Exception.Message)): straight from its release instead."
    Install-WingetFromRelease
  }
  Update-Path
  if (-not (Has winget)) { throw 'winget still not found. Install "App Installer" (github.com/microsoft/winget-cli/releases), then run this again.' }
  Done "winget $(winget --version)"
}

function Install-WithWinget($id, $name) {
  Say "Installing $name..."
  $wingetArgs = @('install', '--id', $id, '--exact', '--silent', '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity')
  Run { & winget @wingetArgs }
  # -1978335189: already installed, nothing newer
  if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1978335189) { throw "winget couldn't install $name (code $LASTEXITCODE)." }
  Update-Path
}

# ---------- what she needs ----------

function Confirm-Git {
  Update-Path
  if (Has git) { return }
  Confirm-Winget
  Install-WithWinget 'Git.Git' 'Git'
  if (-not (Has git)) { $env:Path += ";$env:ProgramFiles\Git\cmd" }
  Done (git --version)
}

function Confirm-Node {
  Update-Path
  $ok = $false
  if (Has node) { $ok = [int]((node -v) -replace '^v(\d+).*', '$1') -ge 20 }
  if ($ok) { return }
  Confirm-Winget
  Install-WithWinget 'OpenJS.NodeJS.LTS' 'Node.js (LTS)'
  if (-not (Has node)) { $env:Path += ";$env:ProgramFiles\nodejs" }
  Done "Node.js $(node -v)"
}

function Get-OllamaExe {
  $exe = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
  if (Test-Path $exe) { return $exe }
  $cmd = Get-Command ollama -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

function Test-OllamaUp {
  try { Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 3 | Out-Null; return $true } catch { return $false }
}

function Confirm-Ollama {
  if (-not (Get-OllamaExe)) {
    Confirm-Winget
    Install-WithWinget 'Ollama.Ollama' 'Ollama'
  }
  $exe = Get-OllamaExe
  if (-not $exe) { throw 'Ollama not found after installing it.' }
  if (-not (Test-OllamaUp)) {
    $app = Join-Path (Split-Path $exe) 'ollama app.exe'
    if (Test-Path $app) { Start-Process $app } else { Start-Process $exe -ArgumentList 'serve' -WindowStyle Hidden }
    for ($i = 0; $i -lt 40 -and -not (Test-OllamaUp); $i++) { Start-Sleep -Milliseconds 750 }
  }
  Say "Fetching the model $Model with Ollama (it can take a while)..."
  Run { & $exe pull $Model }
  if ($LASTEXITCODE -ne 0) { throw "Ollama couldn't fetch $Model." }
  Done "Ollama ready, with $Model"
}

function Confirm-Codex {
  Update-Path
  if (Has codex) { Done 'Codex already there'; return }
  Say 'Installing Codex (npm i -g @openai/codex)...'
  Run { npm.cmd install -g @openai/codex }
  if ($LASTEXITCODE -ne 0) { throw "npm couldn't install Codex." }
  Update-Path
  Done 'Codex installed: sign in with "codex" in a terminal (your ChatGPT plan).'
}

function Confirm-Claude {
  Update-Path
  if (Has claude) { Done 'Claude Code already there'; return }
  Say "Installing Claude Code (Anthropic's installer)..."
  Invoke-RestMethod 'https://claude.ai/install.ps1' | Invoke-Expression
  Update-Path
  Done 'Claude Code installed: sign in with "claude" in a terminal.'
}

function Confirm-Tailscale {
  $exe = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
  if ((Has tailscale) -or (Test-Path $exe)) { Done 'Tailscale already there'; return }
  Install-WithWinget 'Tailscale.Tailscale' 'Tailscale'
  Done 'Tailscale installed: sign in from its icon by the clock (the same account on each of your PCs).'
}

# ---------- Capri ----------

# this script's own clone, when it's run from one (not piped from the web)
function Get-ThisClone {
  if (-not $PSScriptRoot) { return $null }
  $pkg = Join-Path $PSScriptRoot 'package.json'
  if ((Test-Path $pkg) -and ((Get-Content $pkg -Raw) -match '"name":\s*"capri-desktop"')) { return $PSScriptRoot }
  return $null
}

function Install-Capri($app) {
  if (Test-Path (Join-Path $app '.git')) {
    Say "Bringing Capri up to date in $app..."
    Run { git -C $app pull --ff-only }
    if ($LASTEXITCODE -ne 0) { Warn 'git pull failed (changes of yours in there?): installing what is there.' }
  } elseif (Test-Path (Join-Path $app 'package.json')) {
    Say "Capri is in $app (not a git clone): using it as it is."
  } else {
    Say "Fetching Capri into $app..."
    New-Item -ItemType Directory -Force (Split-Path $app) | Out-Null
    Run { git clone --quiet --branch $Branch $Repo $app }
    if ($LASTEXITCODE -ne 0) { throw "git couldn't fetch $Repo." }
  }
  Say 'Installing her packages (npm, Electron included)...'
  Push-Location $app
  try {
    # npm.cmd: npm.ps1 may be blocked by PowerShell's script policy
    if (Test-Path 'package-lock.json') { Run { npm.cmd ci --no-audit --no-fund --loglevel=error } } else { Run { npm.cmd install --no-audit --no-fund --loglevel=error } }
    if ($LASTEXITCODE -ne 0) { throw 'npm failed to install her packages.' }
    # Electron fetches its own program on first start, not on install: her shortcut needs it now
    if (-not (Test-Path 'node_modules\electron\dist\electron.exe')) {
      Say 'Fetching Electron...'
      Run { node node_modules\electron\install.js }
      if (-not (Test-Path 'node_modules\electron\dist\electron.exe')) { throw "Electron couldn't be fetched." }
    }
  } finally {
    Pop-Location
  }
  $version = (Get-Content (Join-Path $app 'package.json') -Raw | ConvertFrom-Json).version
  Done "Capri $version in $app"
}

function Get-ShortcutDirs {
  if ($ShortcutDirs) { return $ShortcutDirs }
  return @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'))
}

function New-Shortcuts($app) {
  $electron = Join-Path $app 'node_modules\electron\dist\electron.exe'
  $shell = New-Object -ComObject WScript.Shell
  foreach ($dir in Get-ShortcutDirs) {
    New-Item -ItemType Directory -Force $dir | Out-Null
    $link = $shell.CreateShortcut((Join-Path $dir 'Capri.lnk'))
    $link.TargetPath = $electron
    $link.Arguments = "`"$app`""
    $link.WorkingDirectory = $app
    $link.IconLocation = Join-Path $app 'assets\icons\capri.ico'
    $link.Description = 'Capri, the Project Capricorn construct, on your desktop'
    $link.Save()
  }
  Done "Shortcuts: $((Get-ShortcutDirs) -join ', ')"
}

function Start-Capri($app) {
  $electron = Join-Path $app 'node_modules\electron\dist\electron.exe'
  Start-Process -FilePath $electron -ArgumentList "`"$app`"" -WorkingDirectory $app
  Done 'Capri is starting: she introduces herself, and her menu is a right-click on her.'
}

function Uninstall-Capri($app) {
  if (Test-Path (Join-Path $app 'scripts\install-hooks.js')) {
    Update-Path
    if (Has node) {
      Say 'Taking her hooks out of Claude Code, Codex and Antigravity...'
      foreach ($script in 'install-hooks.js', 'install-codex-hooks.js', 'install-hooks-agy.js') {
        $path = Join-Path $app "scripts\$script"
        if (Test-Path $path) { Run { node $path --uninstall } }
      }
    }
  }
  Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$app*" } | Stop-Process -Force -ErrorAction SilentlyContinue
  foreach ($dir in Get-ShortcutDirs) { Remove-Item (Join-Path $dir 'Capri.lnk') -Force -ErrorAction SilentlyContinue }
  $clone = Get-ThisClone
  $isClone = $clone -and ((Resolve-Path $app -ErrorAction SilentlyContinue).Path -eq (Resolve-Path $clone).Path)
  if ((Test-Path $app) -and -not $isClone) {
    Remove-Item $app -Recurse -Force
    Done "Capri removed from $app"
  } else {
    Done 'Shortcuts and hooks removed (this clone stays where it is).'
  }
  Say 'Git, Node.js and Ollama stay: remove them from Windows Settings > Apps if you want.'
}

# ---------- here we go ----------

if ($env:OS -ne 'Windows_NT') { throw 'This installer is for Windows. Elsewhere: git clone, npm install, npm start (see the README).' }

$clone = Get-ThisClone
$app = if ($Dir) { $Dir } elseif ($clone) { $clone } else { Join-Path $env:LOCALAPPDATA 'Capri\capri-desktop' }

if ($Uninstall) {
  Uninstall-Capri $app
  return
}

Say 'Capri setup: what she needs, Capri herself, her shortcuts.'
$wantOllama = (-not $NoOllama) -and ($Ollama -or (Ask "Ollama with $Model (about 5 GB): her brain on this PC, and what keeps her thinking without the network?" $true))
$wantCodex = $Codex -or (Ask 'Codex (OpenAI, with a ChatGPT plan): a coding assistant she watches and can talk through?' $false)
$wantClaude = $Claude -or (Ask 'Claude Code (Anthropic, Pro plan or higher): the coding assistant she was made for?' $false)
$wantTailscale = $Tailscale -or (Ask 'Tailscale: one Capri on all your PCs, wherever they are (needs a free Tailscale account)?' $false)

Confirm-Winget # her own setup installs Ollama with it too, from her panel
Confirm-Git
Confirm-Node
if ($wantOllama) { Confirm-Ollama }
if ($wantCodex) { Confirm-Codex }
if ($wantClaude) { Confirm-Claude }
if ($wantTailscale) { Confirm-Tailscale }
Install-Capri $app
if (-not $NoShortcut) { New-Shortcuts $app }
if (-not $NoLaunch) { Start-Capri $app }

Done 'All set. Her AI, her hooks and everything else: right-click her > Settings (Mainframe).'
