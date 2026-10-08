' Opens Food Tracker in its own window (no tabs).
' Starts the server first, hidden, in case it isn't running yet.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run "wscript """ & here & "\start-server.vbs""", 0, True
WScript.Sleep 1500

url = "http://localhost:5178"
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
