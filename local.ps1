<#
.SYNOPSIS
    Runs the map site locally.

.DESCRIPTION
    Starts server/serve.mjs against a site root and opens a browser at it.
    Self-locating: run it from anywhere, no absolute paths inside.

    The site root defaults to this repo's public/ directory. Until the site
    itself lands here that directory does not exist, so -SiteRoot pointing at
    another static tree is the normal case for now.

.PARAMETER Port
    TCP port to listen on. Default 8788.

.PARAMETER SiteRoot
    Directory to serve. Default: public/ beside this script.

.PARAMETER NoBrowser
    Do not open a browser.

.EXAMPLE
    ./local.ps1
    ./local.ps1 -Port 9000 -SiteRoot ../some-other-site/public -NoBrowser
#>
[CmdletBinding()]
param(
    [int]$Port = 8788,
    [string]$SiteRoot,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot

# --- Node ---------------------------------------------------------------------
# Not every shell on every machine has node on PATH, so fall back to the
# default Windows install location before giving up. An actionable message
# beats a "command not found" from three frames deeper.
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
    foreach ($candidate in @(
        "$env:ProgramFiles\nodejs\node.exe",
        "${env:ProgramFiles(x86)}\nodejs\node.exe",
        "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
    )) {
        if (Test-Path -LiteralPath $candidate) { $node = $candidate; break }
    }
}
if (-not $node) {
    Write-Error @"
Node.js was not found.

Looked on PATH and in the default install locations. Install Node 20 or newer
from https://nodejs.org/ , or put your existing node.exe on PATH, then re-run.
"@
    exit 1
}

$nodeVersion = (& $node --version).TrimStart('v')
$nodeMajor = [int]($nodeVersion.Split('.')[0])
if ($nodeMajor -lt 20) {
    Write-Error "Node 20 or newer is required; found $nodeVersion at $node"
    exit 1
}

# --- Site root ----------------------------------------------------------------
if (-not $SiteRoot) { $SiteRoot = Join-Path $repo 'public' }
if (-not (Test-Path -LiteralPath $SiteRoot -PathType Container)) {
    Write-Error @"
Site root does not exist: $SiteRoot

The default is this repo's public/ directory, which is not populated yet.
Point -SiteRoot at a directory containing the site you want to serve, e.g.

    ./local.ps1 -SiteRoot path/to/a/static/site
"@
    exit 1
}
$SiteRoot = (Resolve-Path -LiteralPath $SiteRoot).Path

# Starting a server that can only 404 wastes the next ten minutes of whoever
# does it, so refuse an empty root rather than serving nothing.
if (-not (Get-ChildItem -LiteralPath $SiteRoot -Force | Select-Object -First 1)) {
    Write-Error "Site root is empty: $SiteRoot"
    exit 1
}

$serve = Join-Path $repo 'server/serve.mjs'
if (-not (Test-Path -LiteralPath $serve)) {
    Write-Error "Cannot find the server at $serve - is this the repo root?"
    exit 1
}

# --- Run ----------------------------------------------------------------------
$url = "http://127.0.0.1:$Port/"
Write-Host ''
Write-Host "  root  $SiteRoot"
Write-Host "  url   $url"
Write-Host '  stop  Ctrl-C'
Write-Host ''

if (-not $NoBrowser) {
    # Opened before the blocking call below, on a short delay, so the browser
    # arrives after the listener is up. Failure to open a browser is never a
    # reason to fail the run.
    Start-Job -ScriptBlock {
        param($u)
        Start-Sleep -Milliseconds 600
        try { Start-Process $u } catch { }
    } -ArgumentList $url | Out-Null
}

# Runs in the foreground on purpose: Ctrl-C reaches node directly, which its
# SIGINT handler turns into a graceful close. Backgrounding it would leave an
# orphan listening on the port.
& $node $serve --root $SiteRoot --port $Port
exit $LASTEXITCODE
