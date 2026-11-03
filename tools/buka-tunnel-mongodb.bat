@echo off
title Tunnel MongoDB TOSCHA
echo ==========================================================
echo  Tunnel MongoDB TOSCHA aktif selama jendela ini terbuka.
echo  Di MongoDB Compass pakai:
echo    mongodb://localhost:27018/?directConnection=true
echo  Tutup jendela ini untuk menghentikan tunnel.
echo ==========================================================
:loop
ssh -N -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -L 27018:127.0.0.1:27017 toscha@116.212.74.136
echo.
echo Tunnel terputus. Menyambung ulang dalam 5 detik...
timeout /t 5 /nobreak >nul
goto loop
