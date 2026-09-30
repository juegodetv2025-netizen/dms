@echo off
REM Instala el DMS en modo kiosco en un mini PC con Windows (Chrome o Edge).
REM Uso:  install-windows.bat https://TU_USUARIO.github.io/dms/
setlocal
set "BASE=%~1"
if "%BASE%"=="" (
  echo Uso: install-windows.bat https://TU_USUARIO.github.io/dms/
  exit /b 1
)
if "%BASE:~-1%"=="/" set "BASE=%BASE:~0,-1%"
set "URL=%BASE%/?autostart=1"

set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%BROWSER%" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%BROWSER%" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%BROWSER%" (
  echo No se encontro Chrome ni Edge.
  exit /b 1
)

set "DIR=%ProgramData%\DMS"
mkdir "%DIR%" 2>nul
set "RUN=%DIR%\dms-kiosk.bat"

> "%RUN%" echo @echo off
>> "%RUN%" echo :loop
>> "%RUN%" echo "%BROWSER%" --kiosk --no-first-run --noerrdialogs --disable-infobars --user-data-dir="%DIR%\profile" --use-fake-ui-for-media-stream --autoplay-policy=no-user-gesture-required "%URL%"
>> "%RUN%" echo timeout /t 5 /nobreak ^>nul
>> "%RUN%" echo goto loop

REM Arranque automatico al iniciar sesion
copy /y "%RUN%" "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\dms-kiosk.bat" >nul

REM Que la pantalla y el equipo no se suspendan
powercfg /change monitor-timeout-ac 0
powercfg /change standby-timeout-ac 0

echo.
echo Listo. Siguientes pasos:
echo  1) Activa el inicio de sesion automatico de Windows (netplwiz).
echo  2) Abre UNA vez con internet: "%RUN%" para que se guarde en cache.
echo  3) Para configurar Telegram: cierra con Alt+F4 y abre "%BROWSER%" --user-data-dir="%DIR%\profile" %BASE%/
echo  4) Reinicia el equipo.
endlocal
