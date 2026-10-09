' Starts the Food Tracker server with no window.
' If it is already running, the new copy just exits.
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = appDir

' Turn on auto-updates for the server this script starts
sh.Environment("PROCESS")("FT_AUTO_UPDATE") = "1"

' Restart when server files change on disk (covers changes without its own pull)
sh.Environment("PROCESS")("FT_WATCH") = "1"

' Run the server hidden and wait for it to stop.
' Exit code 3 means "restarted after an update", so start it again.
' Any other exit (already running, or an error) ends this script.
Do
  code = sh.Run("node """ & appDir & "\server\server.js""", 0, True)
Loop While code = 3
