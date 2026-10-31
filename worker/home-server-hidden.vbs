Option Explicit
Dim shell
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = "C:\dev\alpha-engine"
shell.Run "cmd /c cd /d C:\dev\alpha-engine && set NODE_ENV=production&& node dist\boot.js >> worker\.runs\home-server.log 2>&1", 0, False
