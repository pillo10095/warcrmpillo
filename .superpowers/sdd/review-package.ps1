param(
  [string]$Base,
  [string]$Head
)
# Generate a review package: commit list, stat summary, and full diff with context.
$base7 = (git rev-parse --short $Base).Trim()
$head7 = (git rev-parse --short $Head).Trim()
$out = Join-Path (Join-Path (Get-Location) ".superpowers\sdd") "review-$base7..$head7.diff"
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("# Review package: $Base..$Head")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("## Commits")
$commits = git log --oneline "$Base..$Head"
foreach ($c in $commits) { [void]$sb.AppendLine($c) }
[void]$sb.AppendLine("")
[void]$sb.AppendLine("## Files changed")
$stat = git diff --stat "$Base..$Head"
foreach ($s in $stat) { [void]$sb.AppendLine($s) }
[void]$sb.AppendLine("")
[void]$sb.AppendLine("## Diff")
$diff = git diff -U10 "$Base..$Head"
foreach ($d in $diff) { [void]$sb.AppendLine($d) }
[System.IO.File]::WriteAllText($out, $sb.ToString(), [System.Text.UTF8Encoding]::new($false))
$count = (git rev-list --count "$Base..$Head").Trim()
$bytes = (Get-Item $out).Length
Write-Output "wrote $out : $count commit(s), $bytes bytes"
