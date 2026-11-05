' Fallback shortcut maker (no PowerShell needed).
Option Explicit
Dim sh, fso, root, exe, ico, folders, f, lnk, made
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
exe = root & "\node_modules\electron\dist\electron.exe"
ico = root & "\assets\icon.ico"
If Not fso.FileExists(exe) Then
  WScript.Echo "Electron is not installed yet. Run Setup Regis.bat first."
  WScript.Quit 1
End If
made = 0
folders = Array(sh.SpecialFolders("Desktop"), sh.SpecialFolders("Programs"))
On Error Resume Next
For Each f In folders
  If f <> "" Then
    Err.Clear
    Set lnk = sh.CreateShortcut(f & "\Regis.lnk")
    lnk.TargetPath = exe
    lnk.Arguments = """" & root & """"
    lnk.WorkingDirectory = root
    If fso.FileExists(ico) Then lnk.IconLocation = ico & ",0"
    lnk.Description = "Regis"
    lnk.Save
    If Err.Number = 0 Then
      made = made + 1
      WScript.Echo "Created " & f & "\Regis.lnk"
    End If
  End If
Next
If made = 0 Then WScript.Quit 1
