$ErrorActionPreference = "Stop"

if (-not (Get-Command pi -ErrorAction SilentlyContinue)) {
    throw "Pi is not installed or is not available on PATH."
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js is not installed or is not available on PATH."
}

& pi install git:github.com/RS-XuRan/pi-flow-tidy
if ($LASTEXITCODE -ne 0) {
    throw "Could not install the pi-flow-tidy Pi package."
}

$agentDir = if ($env:PI_CODING_AGENT_DIR) {
    $env:PI_CODING_AGENT_DIR
} else {
    Join-Path $HOME ".pi\agent"
}
$packageRoot = Join-Path $agentDir "git\github.com\RS-XuRan\pi-flow-tidy"
$installer = Join-Path $packageRoot "bin\pi-flow-tidy.mjs"
if (-not (Test-Path $installer)) {
    throw "Installed package entry point was not found: $installer"
}

& node $installer install
if ($LASTEXITCODE -ne 0) {
    throw "pi-flow-tidy bootstrap failed."
}
