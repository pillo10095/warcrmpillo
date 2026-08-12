param(
  [string]$PlanFile,
  [int]$TaskNumber
)
# Extract one task's full text from the plan into .superpowers/sdd/task-N-brief.md
$lines = Get-Content -Encoding UTF8 $PlanFile
$out = Join-Path (Join-Path (Get-Location) ".superpowers\sdd") "task-$TaskNumber-brief.md"
$inFence = $false
$inTask = $false
$result = New-Object System.Collections.Generic.List[string]
foreach ($line in $lines) {
  if ($line -match '^```') { $inFence = -not $inFence }
  if (-not $inFence -and $line -match '^#+\s+Task\s+[0-9]+') {
    $inTask = ($line -match "^#+\s+Task\s+$TaskNumber([^0-9]|$)")
  }
  if ($inTask) { $result.Add($line) }
}
if ($result.Count -eq 0) { Write-Error "Task $TaskNumber not found in $PlanFile"; exit 3 }
$result -join "`n" | Set-Content -Path $out -Encoding UTF8
Write-Output "wrote $out : $($result.Count) lines"
