$ErrorActionPreference = "Stop"

$site = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = "C:\Users\Dungeon Master\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

Set-Location -LiteralPath $site
& $python -m http.server 8097 --bind 127.0.0.1
