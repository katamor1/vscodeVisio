param(
    [string]$FixturePath = ".\test\fixtures\four-level-80-step.c",
    [string]$OutputDirectory = ".\visio-output\verify",
    [string]$StencilPath = "C:\Program Files\Microsoft Office\Root\Office16\Visio Content\1041\BASFLO_M.VSSX",
    [string]$PdfToPpm = "C:\texlive\2025\bin\windows\pdftoppm.exe"
)

$ErrorActionPreference = "Stop"

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)]
        [scriptblock]$Command,

        [Parameter(Mandatory = $true)]
        [string]$Description
    )

    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Description failed with exit code $LASTEXITCODE"
    }
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$fixture = Resolve-Path -LiteralPath (Join-Path $repoRoot $FixturePath)
$outputRoot = Join-Path $repoRoot $OutputDirectory
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null

$jsonPath = Join-Path $outputRoot "four-level-80-step.flow.json"
$vsdxPath = Join-Path $outputRoot "four-level-80-step.vsdx"
$pdfPath = Join-Path $outputRoot "four-level-80-step.pdf"
$pngPrefix = Join-Path $outputRoot "four-level-80-step"

Invoke-Checked -Description "Flow JSON generation" -Command {
    node (Join-Path $repoRoot "out\src\cli\generateFlowJson.js") $fixture $jsonPath
}
Invoke-Checked -Description "VSDX generation" -Command {
    powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "New-VisioFlowchart.ps1") -InputJson $jsonPath -OutputVsdx $vsdxPath -StencilPath $StencilPath
}
Invoke-Checked -Description "PDF export" -Command {
    powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "Export-VisioPdf.ps1") -InputVsdx $vsdxPath -OutputPdf $pdfPath
}

if (-not (Test-Path -LiteralPath $PdfToPpm)) {
    throw "pdftoppm was not found: $PdfToPpm"
}
Invoke-Checked -Description "PDF to PNG conversion" -Command {
    & $PdfToPpm -png -r 144 $pdfPath $pngPrefix
}

$pngs = Get-ChildItem -LiteralPath $outputRoot -Filter "four-level-80-step-*.png"
if ($pngs.Count -eq 0) {
    throw "PDF to PNG conversion produced no images in $outputRoot"
}

$flow = Get-Content -LiteralPath $jsonPath -Raw | ConvertFrom-Json
$stepCount = @($flow.nodes | Where-Object { $_.kind -ne "start" -and !($_.kind -eq "terminator" -and -not $_.source) }).Count
if ($stepCount -lt 80) {
    throw "Expected at least 80 flow steps but found $stepCount"
}

Write-Output "Verified VSDX: $vsdxPath"
Write-Output "Verified PDF:  $pdfPath"
Write-Output "Verified PNG:  $($pngs[0].FullName)"
Write-Output "Flow steps:    $stepCount"
