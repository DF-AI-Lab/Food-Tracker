' Resets the TEST copy: stops only the TEST server, makes fresh random data, then opens it.
' Your real data is never touched.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
appDir = fso.GetParentFolderName(here)
testDir = fso.GetParentFolderName(appDir) & "\FoodTrackerTestData"

' Stop the TEST server only (whatever is listening on port 5179). Runs hidden and waits.
sh.Run "powershell -NoProfile -Command ""Get-NetTCPConnection -LocalPort 5179 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }""", 0, True
WScript.Sleep 500

' Make fresh random test data (seed.js deletes the old test food.db first)
sh.Run "node """ & appDir & "\server\seed.js"" """ & testDir & """", 0, True

MsgBox "Test copy reset with fresh random data.", vbInformation, "Food Tracker TEST"

' Start the TEST server again and open it
sh.Run "wscript """ & here & "\open-test.vbs""", 0, False
