# Sets up her voice (voice/server.py): a Python 3.11 environment with PyTorch (CUDA) and Chatterbox in
# %USERPROFILE%\.capri\voice\env, about 6 GB with the model, which downloads on her first start.
# Run from Mainframe (CYBERWARE > Voice), or by hand:
#   powershell -ExecutionPolicy Bypass -File voice\setup.ps1
# ASCII only (Windows PowerShell 5.1).
param([string]$VoiceHome = (Join-Path $env:USERPROFILE '.capri\voice'))

# not 'Stop': uv reports progress on stderr, which PowerShell 5.1 would take for a failure (exit codes decide)
$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
New-Item -ItemType Directory -Force -Path $VoiceHome | Out-Null

# uv makes the environment and fetches Python 3.11 by itself
$uv = (Get-Command uv -ErrorAction SilentlyContinue).Source
if (-not $uv) {
  $uv = Join-Path $env:USERPROFILE '.local\bin\uv.exe'
  if (-not (Test-Path $uv)) {
    Write-Output 'Installing uv (astral.sh)...'
    powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex" | Out-Null
  }
  if (-not (Test-Path $uv)) { throw 'uv could not be installed' }
}

$envDir = Join-Path $VoiceHome 'env'
$py = Join-Path $envDir 'Scripts\python.exe'
if (-not (Test-Path $py)) {
  Write-Output 'Creating the Python 3.11 environment...'
  & $uv venv --python 3.11 $envDir 2>&1 | ForEach-Object { "$_" }
  if ($LASTEXITCODE) { throw 'uv venv failed' }
}

$gpu = $null
try { $gpu = (& nvidia-smi --query-gpu=name --format=csv,noheader 2>$null | Select-Object -First 1) } catch {}
if ($gpu) {
  Write-Output "Installing PyTorch for $gpu (CUDA, ~2.5 GB)..."
  & $uv pip install --python $py torch==2.6.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cu124 2>&1 | ForEach-Object { "$_" }
} else {
  Write-Output 'No NVIDIA GPU found: PyTorch for the CPU (her voice will be slow)...'
  & $uv pip install --python $py torch==2.6.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cpu 2>&1 | ForEach-Object { "$_" }
}
if ($LASTEXITCODE) { throw 'PyTorch failed to install' }

Write-Output 'Installing Chatterbox...'
& $uv pip install --python $py -r (Join-Path $here 'requirements.txt') 2>&1 | ForEach-Object { "$_" }
if ($LASTEXITCODE) { throw 'Chatterbox failed to install' }

New-Item -ItemType Directory -Force -Path (Join-Path $VoiceHome 'profiles') | Out-Null
Write-Output 'Done.'
