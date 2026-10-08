' Starts the Food Tracker server with no window.
' If it is already running, the new copy just exits.
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = appDir
sh.Run "node """ & appDir & "\server\server.js""", 0, False
