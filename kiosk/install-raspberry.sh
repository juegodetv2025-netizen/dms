#!/usr/bin/env bash
# Instala el DMS en modo kiosco en Raspberry Pi OS (Bookworm) o Debian/Ubuntu con escritorio.
# Uso:  bash install-raspberry.sh https://TU_USUARIO.github.io/dms/
set -euo pipefail

URL="${1:-}"
[ -z "$URL" ] && { echo "Uso: bash install-raspberry.sh https://TU_USUARIO.github.io/dms/"; exit 1; }
URL="${URL%/}/?autostart=1"

sudo apt-get update
sudo apt-get install -y chromium-browser unclutter || sudo apt-get install -y chromium unclutter
BROWSER=$(command -v chromium-browser || command -v chromium)

# Script de arranque: reintenta hasta abrir; perfil persistente guarda los ajustes (Telegram, umbrales...)
mkdir -p "$HOME/.local/bin" "$HOME/.config/dms-profile"
cat > "$HOME/.local/bin/dms-kiosk.sh" <<EOF
#!/usr/bin/env bash
xset s off 2>/dev/null; xset -dpms 2>/dev/null; xset s noblank 2>/dev/null
unclutter -idle 0.5 -root 2>/dev/null &
while true; do
  "$BROWSER" \\
    --kiosk --noerrdialogs --disable-infobars --no-first-run --disable-session-crashed-bubble \\
    --user-data-dir="$HOME/.config/dms-profile" \\
    --use-fake-ui-for-media-stream \\
    --autoplay-policy=no-user-gesture-required \\
    --enable-features=WebRTCPipeWireCapturer \\
    --check-for-update-interval=31536000 \\
    "$URL"
  sleep 5   # si Chromium se cierra o falla, vuelve a abrir
done
EOF
chmod +x "$HOME/.local/bin/dms-kiosk.sh"

# Autoarranque: X11/LXDE y labwc/wayfire (Pi OS Bookworm)
mkdir -p "$HOME/.config/autostart" "$HOME/.config/labwc"
cat > "$HOME/.config/autostart/dms.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=DMS Kiosk
Exec=$HOME/.local/bin/dms-kiosk.sh
EOF
grep -qs dms-kiosk "$HOME/.config/labwc/autostart" 2>/dev/null || echo "$HOME/.local/bin/dms-kiosk.sh &" >> "$HOME/.config/labwc/autostart"

echo
echo "Listo. Pasos siguientes:"
echo " 1) sudo raspi-config -> System Options -> Boot / Auto Login -> Desktop Autologin"
echo " 2) Abre UNA vez con internet para que se guarde en caché:  $HOME/.local/bin/dms-kiosk.sh"
echo " 3) Con teclado: Ctrl+Alt+... no hay barra; para configurar Telegram sal con Alt+F4 y abre:"
echo "    $BROWSER --user-data-dir=$HOME/.config/dms-profile ${URL%%\?*}"
echo " 4) Reinicia: sudo reboot"
