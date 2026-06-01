param(
    [Parameter(Mandatory = $true)]
    [string]$InputVsdx,

    [Parameter(Mandatory = $true)]
    [string]$OutputPdf
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $InputVsdx)) {
    throw "Input VSDX does not exist: $InputVsdx"
}

$outputDirectory = Split-Path -Parent $OutputPdf
if ($outputDirectory) {
    New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
}

$visio = $null
$document = $null

try {
    $visio = New-Object -ComObject Visio.Application
    $visio.Visible = $false
    $visio.AlertResponse = 7
    $document = $visio.Documents.Open($InputVsdx)
    $document.ExportAsFixedFormat(1, $OutputPdf, 1, 0)
    Write-Output "Wrote $OutputPdf"
} finally {
    if ($document) {
        $document.Close() | Out-Null
    }
    if ($visio) {
        $visio.Quit()
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($visio) | Out-Null
    }
}
