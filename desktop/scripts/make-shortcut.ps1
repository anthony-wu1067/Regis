# Creates "Regis" shortcuts on the Desktop and in the Start menu that open the app directly.
$ErrorActionPreference = 'Stop'
try {
  $root = Split-Path -Parent $PSScriptRoot
  $exe  = Join-Path $root 'node_modules\electron\dist\electron.exe'
  if (-not (Test-Path -LiteralPath $exe)) { throw "Electron is not installed yet. Run Setup Regis.bat first." }
  $ico = Join-Path $root 'assets\icon.ico'
  $ws  = New-Object -ComObject WScript.Shell
  $targets = @()
  foreach ($name in 'Desktop', 'Programs') {
    try { $p = [Environment]::GetFolderPath($name); if ($p -and (Test-Path -LiteralPath $p)) { $targets += $p } } catch { }
  }
  if (-not $targets.Count) { throw "Could not find your Desktop or Start menu folder." }
  $made = 0
  foreach ($dir in $targets) {
    try {
      $lnk = $ws.CreateShortcut((Join-Path $dir 'Regis.lnk'))
      $lnk.TargetPath       = $exe
      $lnk.Arguments        = '"' + $root.TrimEnd('\') + '"'
      $lnk.WorkingDirectory = $root
      if (Test-Path -LiteralPath $ico) { $lnk.IconLocation = $ico + ',0' }
      $lnk.Description      = 'Regis'
      $lnk.Save()
      Write-Host "Created $dir\Regis.lnk"
      $made++
    } catch { Write-Host "Could not write to $dir : $($_.Exception.Message)" }
  }
  if (-not $made) { throw "No shortcut could be written." }
} catch {
  Write-Host ("Shortcut error: " + $_.Exception.Message)
  exit 1
}
