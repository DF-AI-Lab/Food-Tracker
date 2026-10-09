' Starts the TEST copy of the Food Tracker server with no window.
' It restarts itself when its server files change (FT_WATCH), like the real server.
' It does NOT pull updates itself: the real server does the git pulls.
' If it is already running, the new copy just exits.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
appDir = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
testDir = fso.GetParentFolderName(appDir) & "\FoodTrackerTestData"
sh.CurrentDirectory = appDir

' TEST copy settings: its own port and data folder, and the red TEST banner
sh.Environment("PROCESS")("FT_PORT") = "5179"
sh.Environment("PROCESS")("FT_DATA_DIR") = testDir
sh.Environment("PROCESS")("FT_TEST") = "1"
' Restart when server files change on disk
sh.Environment("PROCESS")("FT_WATCH") = "1"

' Run the server hidden and wait for it to stop.
' Exit code 3 means "restart me" (server files changed), so start it again.
' Any other exit (already running, or an error) ends this script.
Do
  code = sh.Run("node """ & appDir & "\server\server.js""", 0, True)
Loop While code = 3
