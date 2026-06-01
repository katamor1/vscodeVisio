param(
    [Parameter(Mandatory = $true)]
    [string]$InputJson,

    [Parameter(Mandatory = $true)]
    [string]$OutputVsdx,

    [Parameter(Mandatory = $true)]
    [string]$StencilPath,

    [switch]$Visible
)

$ErrorActionPreference = "Stop"

function Get-MasterByNameU {
    param(
        [Parameter(Mandatory = $true)]$Stencil,
        [Parameter(Mandatory = $true)][string[]]$Names
    )

    foreach ($name in $Names) {
        try {
            return $Stencil.Masters.ItemU($name)
        } catch {
            try {
                return $Stencil.Masters.Item($name)
            } catch {
                # Try the next localized or universal name.
            }
        }
    }

    throw "Could not find Visio master: $($Names -join ', ')"
}

function Set-CellFormula {
    param(
        [Parameter(Mandatory = $true)]$Shape,
        [Parameter(Mandatory = $true)][string]$Cell,
        [Parameter(Mandatory = $true)][string]$Formula
    )
    $Shape.CellsU($Cell).FormulaU = $Formula
}

if (-not (Test-Path -LiteralPath $InputJson)) {
    throw "Input JSON does not exist: $InputJson"
}
if (-not (Test-Path -LiteralPath $StencilPath)) {
    throw "Visio stencil does not exist: $StencilPath"
}

$flow = Get-Content -LiteralPath $InputJson -Raw | ConvertFrom-Json
$outputDirectory = Split-Path -Parent $OutputVsdx
if ($outputDirectory) {
    New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
}

$visio = $null
$document = $null
$stencil = $null

try {
    $visio = New-Object -ComObject Visio.Application
    $visio.Visible = [bool]$Visible
    $visio.AlertResponse = 7

    $document = $visio.Documents.Add("")
    $stencil = $visio.Documents.OpenEx($StencilPath, 64)
    $page = $visio.ActivePage
    $page.Name = if ($flow.title) { [string]$flow.title } else { "Flowchart" }
    Set-CellFormula -Shape $page.PageSheet -Cell "PageWidth" -Formula ("{0} in" -f [double]$flow.page.width)
    Set-CellFormula -Shape $page.PageSheet -Cell "PageHeight" -Formula ("{0} in" -f [double]$flow.page.height)

    $masters = @{
        start = Get-MasterByNameU -Stencil $stencil -Names @("Start/End")
        process = Get-MasterByNameU -Stencil $stencil -Names @("Process")
        decision = Get-MasterByNameU -Stencil $stencil -Names @("Decision")
        terminator = Get-MasterByNameU -Stencil $stencil -Names @("Start/End")
        connector = Get-MasterByNameU -Stencil $stencil -Names @("Dynamic connector")
    }

    $shapeById = @{}
    foreach ($node in $flow.nodes) {
        $position = $flow.positions.PSObject.Properties[$node.id].Value
        $master = $masters[[string]$node.kind]
        $shape = $page.Drop($master, [double]$position.x, [double]$position.y)
        $shape.Text = [string]$node.label

        $lineCount = ([string]$node.label -split "`n").Count
        $width = if ($node.kind -eq "decision") { 2.6 } elseif ($node.kind -eq "process") { 2.9 } else { 2.2 }
        $height = [Math]::Max(0.55, 0.34 * $lineCount + 0.25)
        Set-CellFormula -Shape $shape -Cell "Width" -Formula ("{0} in" -f $width)
        Set-CellFormula -Shape $shape -Cell "Height" -Formula ("{0} in" -f $height)
        Set-CellFormula -Shape $shape -Cell "Char.Size" -Formula "8 pt"
        $shapeById[$node.id] = $shape
    }

    foreach ($edge in $flow.edges) {
        if (-not $shapeById.ContainsKey($edge.from) -or -not $shapeById.ContainsKey($edge.to)) {
            throw "Edge references missing shape: $($edge.from) -> $($edge.to)"
        }
        $connector = $page.Drop($masters.connector, 0, 0)
        $connector.CellsU("BeginX").GlueTo($shapeById[$edge.from].CellsU("PinX"))
        $connector.CellsU("EndX").GlueTo($shapeById[$edge.to].CellsU("PinX"))
        if ($edge.label) {
            $connector.Text = [string]$edge.label
            Set-CellFormula -Shape $connector -Cell "Char.Size" -Formula "7 pt"
        }
    }

    $document.SaveAs($OutputVsdx) | Out-Null
    Write-Output "Wrote $OutputVsdx"
} finally {
    if ($stencil) {
        $stencil.Close() | Out-Null
    }
    if ($document) {
        $document.Close() | Out-Null
    }
    if ($visio) {
        $visio.Quit()
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($visio) | Out-Null
    }
}
