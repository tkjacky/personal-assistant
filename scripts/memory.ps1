# ChromaDB Memory Management Script
# Usage:
#   .\scripts\memory.ps1 list [collection]          - List all entries (default: memories)
#   .\scripts\memory.ps1 delete <id> [collection]   - Delete an entry by ID
#   .\scripts\memory.ps1 clear [collection]         - Delete all entries (with confirmation)
#   .\scripts\memory.ps1 collections                - List all collections
#
# Collections: memories, people

param(
    [Parameter(Position=0)]
    [string]$Action = "list",
    
    [Parameter(Position=1)]
    [string]$IdOrCollection,

    [Parameter(Position=2)]
    [string]$Collection
)

$ChromaBase = "http://localhost:8100/api/v2/tenants/default_tenant/databases/default_database"

# Determine collection name
function Get-CollectionName {
    param([string]$Arg1, [string]$Arg2, [string]$DefaultAction)
    
    if ($DefaultAction -eq "list" -or $DefaultAction -eq "clear") {
        if ($Arg1 -and $Arg1 -ne "") { return $Arg1 } else { return "memories" }
    }
    # For delete action, Arg1=id, Arg2=collection
    if ($Arg2 -and $Arg2 -ne "") { return $Arg2 } else { return "memories" }
}

# Get collection UUID from name
function Get-CollectionId {
    param([string]$Name)
    $collections = Invoke-RestMethod -Method GET -Uri "$ChromaBase/collections"
    $col = $collections | Where-Object { $_.name -eq $Name }
    if (-not $col) {
        Write-Host "Collection '$Name' not found." -ForegroundColor Red
        Write-Host "Available collections:" -ForegroundColor Yellow
        $collections | ForEach-Object { Write-Host "  - $($_.name)" }
        exit 1
    }
    return $col.id
}

switch ($Action) {
    "collections" {
        Write-Host "Collections:" -ForegroundColor Cyan
        $collections = Invoke-RestMethod -Method GET -Uri "$ChromaBase/collections"
        if ($collections.Count -eq 0) {
            Write-Host "  (none)" -ForegroundColor Yellow
        } else {
            $collections | ForEach-Object { Write-Host "  - $($_.name)" -ForegroundColor Green }
        }
    }
    "list" {
        $colName = if ($IdOrCollection) { $IdOrCollection } else { "memories" }
        Write-Host "Fetching from '$colName'..." -ForegroundColor Cyan
        $colId = Get-CollectionId -Name $colName
        $response = Invoke-RestMethod -Method POST -Uri "$ChromaBase/collections/$colId/get" -ContentType "application/json" -Body '{}'
        if ($response.ids.Count -eq 0) {
            Write-Host "No entries found." -ForegroundColor Yellow
        } else {
            for ($i = 0; $i -lt $response.ids.Count; $i++) {
                $id = $response.ids[$i]
                $doc = $response.documents[$i]
                $meta = $response.metadatas[$i]
                Write-Host "[$id]" -ForegroundColor Green -NoNewline
                Write-Host " $doc" -NoNewline
                if ($meta.timestamp) {
                    Write-Host " ($($meta.timestamp))" -ForegroundColor Gray
                } elseif ($meta.name) {
                    Write-Host " [name: $($meta.name)]" -ForegroundColor Gray
                } else {
                    Write-Host ""
                }
            }
            Write-Host "`nTotal: $($response.ids.Count) entries" -ForegroundColor Cyan
        }
    }
    "delete" {
        if (-not $IdOrCollection) {
            Write-Host "Usage: .\scripts\memory.ps1 delete <id> [collection]" -ForegroundColor Red
            exit 1
        }
        $id = $IdOrCollection
        $colName = if ($Collection) { $Collection } else { "memories" }
        $colId = Get-CollectionId -Name $colName
        Write-Host "Deleting '$id' from '$colName'..." -ForegroundColor Yellow
        $body = @{ ids = @($id) } | ConvertTo-Json
        Invoke-RestMethod -Method POST -Uri "$ChromaBase/collections/$colId/delete" -ContentType "application/json" -Body $body
        Write-Host "Deleted." -ForegroundColor Green
    }
    "clear" {
        $colName = if ($IdOrCollection) { $IdOrCollection } else { "memories" }
        Write-Host "Are you sure you want to delete ALL entries in '$colName'? (y/n)" -ForegroundColor Red
        $confirm = Read-Host
        if ($confirm -eq "y") {
            Invoke-RestMethod -Method DELETE -Uri "$ChromaBase/collections/$colName"
            Write-Host "Collection '$colName' cleared." -ForegroundColor Green
        } else {
            Write-Host "Cancelled." -ForegroundColor Yellow
        }
    }
    default {
        Write-Host "Unknown action: $Action" -ForegroundColor Red
        Write-Host "Usage:"
        Write-Host "  .\scripts\memory.ps1 collections              - List collections"
        Write-Host "  .\scripts\memory.ps1 list [collection]        - List entries (default: memories)"
        Write-Host "  .\scripts\memory.ps1 delete <id> [collection] - Delete an entry"
        Write-Host "  .\scripts\memory.ps1 clear [collection]       - Clear a collection"
        Write-Host ""
        Write-Host "Collections: memories, people"
    }
}
