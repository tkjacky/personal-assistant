# Configure Docker Model Runner keep-alive timeout
# Usage:
#   .\scripts\dmr-keep-alive.ps1           - Show current setting
#   .\scripts\dmr-keep-alive.ps1 30m       - Set to 30 minutes
#   .\scripts\dmr-keep-alive.ps1 1h        - Set to 1 hour
#   .\scripts\dmr-keep-alive.ps1 -1        - Never unload
#   .\scripts\dmr-keep-alive.ps1 0         - Unload immediately after each request

param(
    [Parameter(Position=0)]
    [string]$Duration
)

$ModelId = "huggingface.co/google/gemma-4-12b-it-qat-q4_0-gguf"

if (-not $Duration) {
    Write-Host "Current model config:" -ForegroundColor Cyan
    docker model inspect $ModelId
    Write-Host ""
    Write-Host "Usage: .\scripts\dmr-keep-alive.ps1 <duration>" -ForegroundColor Yellow
    Write-Host "  30m  - 30 minutes (recommended)"
    Write-Host "  1h   - 1 hour"
    Write-Host "  -1   - never unload"
    Write-Host "  0    - unload immediately"
} else {
    Write-Host "Setting keep-alive to: $Duration" -ForegroundColor Cyan
    docker model configure --keep-alive $Duration $ModelId
    Write-Host "Done." -ForegroundColor Green
}
