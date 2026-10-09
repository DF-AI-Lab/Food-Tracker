' Opens the TEST copy of Food Tracker: random fake food, its own server and data.
' Your real data is never touched.
' The first run makes random test data and a "Food Tracker TEST" icon on the desktop.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
appDir = fso.GetParentFolderName(here)
testDir = fso.GetParentFolderName(appDir) & "\FoodTrackerTestData"

' Make the random test data if there isn't any yet (runs hidden, waits to finish)
If Not fso.FileExists(testDir & "\food.db") Then
  sh.Run "node """ & appDir & "\server\seed.js"" """ & testDir & """", 0, True
End If

' First run only: put a "Food Tracker TEST" icon on the desktop
shortcutFile = sh.SpecialFolders("Desktop") & "\Food Tracker TEST.lnk"
If Not fso.FileExists(shortcutFile) Then
  Set s = sh.CreateShortcut(shortcutFile)
  s.TargetPath = "wscript.exe"
  s.Arguments = """" & WScript.ScriptFullName & """"
  s.WorkingDirectory = here
  s.IconLocation = "%SystemRoot%\System32\shell32.dll,22"
  s.Save
End If

' Start the TEST server hidden, on its own port (5179) and data folder.
' If it is already running, the new copy just exits.
sh.Environment("PROCESS")("FT_PORT") = "5179"
sh.Environment("PROCESS")("FT_DATA_DIR") = testDir
sh.Environment("PROCESS")("FT_TEST") = "1"
sh.CurrentDirectory = appDir
sh.Run "node """ & appDir & "\server\server.js""", 0, False
WScript.Sleep 1500

' Open it in its own window, the same way open-app.vbs does
url = "http://127.0.0.1:5179"
browsers = Array( _
  sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Google\Chrome\Application\chrome.exe", _
  sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Google\Chrome\Application\chrome.exe", _
  sh.ExpandEnvironmentStrings("%LocalAppData%") & "\Google\Chrome\Application\chrome.exe", _
  sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe", _
  sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Microsoft\Edge\Application\msedge.exe")

For Each b In browsers
  If fso.FileExists(b) Then
    sh.Run """" & b & """ --app=" & url, 1, False
    WScript.Quit
  End If
Next
sh.Run url
