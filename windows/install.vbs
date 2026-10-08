' One-time setup. Double-click this once.
'  - starts the server silently every time Windows starts
'  - puts a "Food Tracker" icon on your desktop
' Run it again if you move or rebuild the app folder.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)

If sh.Run("cmd /c node -v", 0, True) <> 0 Then
  MsgBox "Node.js isn't installed yet." & vbCrLf & vbCrLf & _
    "Get the LTS version from nodejs.org, install it, then run this again.", vbExclamation, "Food Tracker"
  WScript.Quit
End If

Set s = sh.CreateShortcut(sh.SpecialFolders("Startup") & "\Food Tracker server.lnk")
s.TargetPath = "wscript.exe"
s.Arguments = """" & here & "\start-server.vbs"""
s.WorkingDirectory = here
s.Save

Set d = sh.CreateShortcut(sh.SpecialFolders("Desktop") & "\Food Tracker.lnk")
d.TargetPath = "wscript.exe"
d.Arguments = """" & here & "\open-app.vbs"""
d.WorkingDirectory = here
d.IconLocation = "%SystemRoot%\System32\shell32.dll,43"
d.Save

sh.Run "wscript """ & here & "\start-server.vbs""", 0, False
MsgBox "All set!" & vbCrLf & vbCrLf & _
  "Use the Food Tracker icon on your desktop." & vbCrLf & _
  "Your food list is saved in the FoodTrackerData folder.", vbInformation, "Food Tracker"
