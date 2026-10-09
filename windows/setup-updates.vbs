' One-time setup for auto-updates. Double-click this once.
'  - checks that Git for Windows is installed
'  - stops the running Food Tracker server
'  - downloads the app from GitHub into a new folder next to this one,
'    called Food-Tracker-live
'  - points the desktop and startup icons at that folder and starts it
' Your food list is not moved. It stays in the FoodTrackerData folder.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)

' 1. Check that git is installed (hidden, wait for the answer)
If sh.Run("cmd /c git --version", 0, True) <> 0 Then
  MsgBox "Git isn't installed yet." & vbCrLf & vbCrLf & _
    "Install Git for Windows from https://git-scm.com/download/win" & vbCrLf & _
    "Use the default options, then run this again.", vbExclamation, "Food Tracker"
  WScript.Quit
End If

' 2. Work out the folders
appDir = fso.GetParentFolderName(here)     ' the app folder (it holds the windows folder)
parent = fso.GetParentFolderName(appDir)   ' the folder that also holds FoodTrackerData
target = parent & "\Food-Tracker-live"     ' the new auto-updating copy

' 3. Stop if this copy is already a git copy
If fso.FolderExists(appDir & "\.git") Then
  MsgBox "Auto-updates are already set up.", vbInformation, "Food Tracker"
  WScript.Quit
End If

' 4. Stop the running server (hidden, wait) so its files are not in use
psCmd = "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*server.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
sh.Run "powershell -NoProfile -Command """ & psCmd & """", 0, True

' 5. Download the app from GitHub. The window is visible, so a GitHub
'    sign-in box can pop up. If the folder is already there, skip this.
If Not fso.FolderExists(target) Then
  rc = sh.Run("git clone https://github.com/DF-AI-Lab/Food-Tracker.git """ & target & """", 1, True)
Else
  rc = 0
End If
If rc <> 0 Or Not fso.FolderExists(target & "\.git") Then
  ' Put the old copy back on, so the app still works
  sh.Run "wscript """ & here & "\start-server.vbs""", 0, False
  MsgBox "Could not download the app from GitHub." & vbCrLf & vbCrLf & _
    "Check your internet connection and that you can sign in to GitHub." & vbCrLf & _
    "Then run this again.", vbExclamation, "Food Tracker"
  WScript.Quit
End If

' 6. Point the icons at the new folder and start the server there
sh.Run "wscript """ & target & "\windows\install.vbs""", 1, True

' 7. Done
MsgBox "Auto-updates are on." & vbCrLf & vbCrLf & _
  "Just refresh the app to get new changes." & vbCrLf & _
  "Your food list is untouched (FoodTrackerData)." & vbCrLf & vbCrLf & _
  "You can delete the old folder:" & vbCrLf & appDir, vbInformation, "Food Tracker"
