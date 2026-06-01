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

function Ensure-ConnectionPoint {
    param(
        [Parameter(Mandatory = $true)]$Shape,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$XFormula,
        [Parameter(Mandatory = $true)][string]$YFormula
    )

    try {
        $Shape.CellsU("Connections.$Name.X") | Out-Null
    } catch {
        if (-not $Shape.SectionExists(7, 0)) {
            $Shape.AddSection(7) | Out-Null
        }
        $Shape.AddNamedRow(7, $Name, 185) | Out-Null
    }

    Set-CellFormula -Shape $Shape -Cell "Connections.$Name.X" -Formula $XFormula
    Set-CellFormula -Shape $Shape -Cell "Connections.$Name.Y" -Formula $YFormula
    Set-CellFormula -Shape $Shape -Cell "Connections.$Name.Type" -Formula "0"
}

function Ensure-FlowConnectionPoints {
    param(
        [Parameter(Mandatory = $true)]$Shape
    )

    Ensure-ConnectionPoint -Shape $Shape -Name "FlowTop" -XFormula "Width*0.5" -YFormula "Height"
    Ensure-ConnectionPoint -Shape $Shape -Name "FlowBottom" -XFormula "Width*0.5" -YFormula "0"
    Ensure-ConnectionPoint -Shape $Shape -Name "FlowRight" -XFormula "Width" -YFormula "Height*0.5"
}

function Get-FlowBeginPortCell {
    param(
        [Parameter(Mandatory = $true)]$Shape,
        [Parameter(Mandatory = $true)][string]$Port
    )

    switch ($Port.ToLowerInvariant()) {
        "bottom" { return $Shape.CellsU("Connections.FlowBottom.X") }
        "right" { return $Shape.CellsU("Connections.FlowRight.X") }
        default { throw "Unknown flow connector begin port: $Port" }
    }
}

function Get-FlowEndPortCell {
    param(
        [Parameter(Mandatory = $true)]$Shape
    )

    return $Shape.CellsU("Connections.FlowTop.X")
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
    Set-CellFormula -Shape $page.PageSheet -Cell "RouteStyle" -Formula "5"
    Set-CellFormula -Shape $page.PageSheet -Cell "LineToNodeX" -Formula "0.35 in"
    Set-CellFormula -Shape $page.PageSheet -Cell "LineToNodeY" -Formula "0.35 in"
    Set-CellFormula -Shape $page.PageSheet -Cell "LineToLineX" -Formula "0.18 in"
    Set-CellFormula -Shape $page.PageSheet -Cell "LineToLineY" -Formula "0.18 in"

    $masters = @{
        start = Get-MasterByNameU -Stencil $stencil -Names @("Start/End")
        process = Get-MasterByNameU -Stencil $stencil -Names @("Process")
        decision = Get-MasterByNameU -Stencil $stencil -Names @("Decision")
        terminator = Get-MasterByNameU -Stencil $stencil -Names @("Start/End")
        connector = Get-MasterByNameU -Stencil $stencil -Names @("Dynamic connector")
    }

    if ($flow.groupBoxes) {
        foreach ($box in $flow.groupBoxes) {
            $rect = $page.DrawRectangle([double]$box.left, [double]$box.bottom, [double]$box.right, [double]$box.top)
            Set-CellFormula -Shape $rect -Cell "FillPattern" -Formula "0"
            Set-CellFormula -Shape $rect -Cell "LineColor" -Formula "RGB(90,90,90)"
            Set-CellFormula -Shape $rect -Cell "LineWeight" -Formula "0.75 pt"
            Set-CellFormula -Shape $rect -Cell "LinePattern" -Formula "1"
            $rect.SendToBack() | Out-Null
        }
    }

    $shapeById = @{}
    $frontShapes = @()
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
        Set-CellFormula -Shape $shape -Cell "ObjType" -Formula "1"
        Ensure-FlowConnectionPoints -Shape $shape
        $shapeById[$node.id] = $shape
        $frontShapes += $shape

        if ($node.comment) {
            $commentPosition = $flow.commentPositions.PSObject.Properties[$node.id].Value
            if ($commentPosition) {
                $commentText = $page.DrawRectangle(
                    [double]$commentPosition.x - 1.45,
                    [double]$commentPosition.y - 0.32,
                    [double]$commentPosition.x + 1.45,
                    [double]$commentPosition.y + 0.32
                )
                $commentText.Text = [string]$node.comment
                Set-CellFormula -Shape $commentText -Cell "FillPattern" -Formula "0"
                Set-CellFormula -Shape $commentText -Cell "LinePattern" -Formula "0"
                Set-CellFormula -Shape $commentText -Cell "Char.Size" -Formula "7 pt"
                Set-CellFormula -Shape $commentText -Cell "Para.HorzAlign" -Formula "0"
                $frontShapes += $commentText
            }
        }
    }

    foreach ($edge in $flow.edges) {
        if (-not $shapeById.ContainsKey($edge.from) -or -not $shapeById.ContainsKey($edge.to)) {
            throw "Edge references missing shape: $($edge.from) -> $($edge.to)"
        }
        $connector = $page.Drop($masters.connector, 0, 0)
        $fromPort = if ($edge.fromPort) { [string]$edge.fromPort } else { "bottom" }
        Set-CellFormula -Shape $connector -Cell "ObjType" -Formula "2"
        Set-CellFormula -Shape $connector -Cell "ShapeRouteStyle" -Formula "5"
        $connector.CellsU("BeginX").GlueTo((Get-FlowBeginPortCell -Shape $shapeById[$edge.from] -Port $fromPort))
        $connector.CellsU("EndX").GlueTo((Get-FlowEndPortCell -Shape $shapeById[$edge.to]))
        Set-CellFormula -Shape $connector -Cell "BeginArrow" -Formula "0"
        Set-CellFormula -Shape $connector -Cell "EndArrow" -Formula "4"
        Set-CellFormula -Shape $connector -Cell "EndArrowSize" -Formula "2"
        if ($edge.label) {
            $connector.Text = [string]$edge.label
            Set-CellFormula -Shape $connector -Cell "Char.Size" -Formula "7 pt"
        }
    }

    foreach ($frontShape in $frontShapes) {
        $frontShape.BringToFront() | Out-Null
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
