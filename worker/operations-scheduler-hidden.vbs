Option Explicit
Dim shell
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = "C:\dev\alpha-engine"
shell.Run "cmd /c cd /d C:\dev\alpha-engine && npx tsx worker\operations-scheduler.mts >> worker\.runs\operations-scheduler.log 2>&1", 0, False
