' Double-click to open Regis. No terminal window.
Option Explicit
Dim sh, fso, here, exe, rc
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
exe = here & "\node_modules\electron\dist\electron.exe"
If Not fso.FileExists(exe) Then
  MsgBox "Regis is not set up yet." & vbCrLf & vbCrLf & "Double-click ""Setup Regis.bat"" once. It installs what Regis needs.", 48, "Regis"
Else
  sh.CurrentDirectory = here
  On Error Resume Next
  sh.Run """" & exe & """ """ & here & """", 1, False
  If Err.Number <> 0 Then
    MsgBox "Windows would not start Regis:" & vbCrLf & Err.Description & vbCrLf & vbCrLf & "Try ""Regis (show errors).bat"" in the same folder to see the details.", 16, "Regis"
  End If
End If
