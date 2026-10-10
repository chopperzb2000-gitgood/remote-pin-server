@echo off
chcp 65001 >nul
echo [INFO] กำลังตรวจสอบและติดตั้งไลบรารีที่จำเป็น...

if not exist requirements.txt (
    echo python-socketio > requirements.txt
    echo mss >> requirements.txt
    echo Pillow >> requirements.txt
    echo pyautogui >> requirements.txt
    echo websocket-client >> requirements.txt
)

python -m pip install --upgrade pip
pip install -r requirements.txt

echo.
echo [INFO] กำลังเริ่มรัน host_agent.py...
python host_agent.py

pause