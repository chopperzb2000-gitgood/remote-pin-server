"""
Remote PIN Desktop - visible host agent for Windows 10/11.
Use only on a computer you own or are authorized to administer.
The host must approve each controller request in this console.
"""
import io
import time
import threading
import socketio
import mss
from PIL import Image
import pyautogui

SERVER_URL = input("Relay server URL (e.g. https://your-app.onrender.com): ").strip().rstrip("/")
if not SERVER_URL.startswith(("https://", "http://")):
    raise SystemExit("Enter a valid server URL.")
if SERVER_URL.startswith("http://") and "localhost" not in SERVER_URL and "127.0.0.1" not in SERVER_URL:
    print("WARNING: HTTP is unencrypted. Use HTTPS for remote connections.")

sio = socketio.Client(reconnection=True, logger=False, engineio_logger=False)
approved = threading.Event()
running = True
pyautogui.FAILSAFE = True  # เลื่อนเมาส์ไปมุมซ้ายบนสุดเพื่อหยุดการทำงานฉุกเฉิน
pyautogui.PAUSE = 0.02

@sio.event
def connect():
    print("Connected to relay. Creating a temporary PIN...")
    sio.emit("host-register", {}, callback=lambda data: print("Host registered." if data and data.get("ok") else print(data.get("error", "Error") if data else "Error")))

@sio.event
def host_pin(data):
    pin = data.get("pin", "N/A") if isinstance(data, dict) else "N/A"
    print("\n" + "=" * 42)
    print(f" YOUR TEMPORARY REMOTE PIN: {pin}")
    print(" Expires in 2 minutes. Keep this window open.")
    print("=" * 42 + "\n")

@sio.on("controller-request")
def controller_request(data):
    global running
    pin = data.get('pin', 'N/A') if isinstance(data, dict) else 'N/A'
    print(f"\nA controller entered PIN {pin}.")
    answer = input("Approve this person? Type YES to allow this session: ").strip()
    if answer == "YES":
        approved.set()
        sio.emit("host-approve", {"approve": True})
        print("Approved. Screen sharing/control is active. Press Ctrl+C to stop.")
    else:
        sio.emit("host-approve", {"approve": False})
        print("Connection denied.")

@sio.on("controller-status")
def controller_status(data):
    if isinstance(data, dict) and not data.get("connected"):
        approved.clear()
        print("Controller disconnected. Sharing paused.")

@sio.on("remote-input")
def remote_input(data):
    if not approved.is_set() or not isinstance(data, dict):
        return
    try:
        kind = data.get("kind")
        if kind in ("move", "click"):
            x, y = int(data.get("x", 0)), int(data.get("y", 0))
            with mss.mss() as sct:
                mon = sct.monitors[1]
                x = max(0, min(x, mon["width"] - 1))
                y = max(0, min(y, mon["height"] - 1))
            if kind == "move":
                pyautogui.moveTo(x, y, duration=0)
            else:
                button = data.get("button", "left")
                if button in ("left", "right", "middle"):
                    pyautogui.click(x, y, button=button)
        elif kind == "key":
            key = str(data.get("key", ""))
            valid_keys = ("enter","tab","escape","backspace","delete","space","up","down","left","right","home","end","pageup","pagedown","f1","f2","f3","f4","f5","f6","f7","f8","f9","f10","f11","f12")
            if key in valid_keys or (len(key) == 1 and key.isprintable()):
                pyautogui.press(key)
        elif kind == "scroll":
            amount = max(-3, min(3, int(data.get("amount", 0))))
            pyautogui.scroll(amount)
    except Exception as exc:
        print("Input event ignored:", exc)

def stream_screen():
    while running:
        if approved.is_set() and sio.connected:
            try:
                with mss.mss() as sct:
                    shot = sct.grab(sct.monitors[1])
                    image = Image.frombytes("RGB", shot.size, shot.rgb)
                    image.thumbnail((1280, 800))
                    buf = io.BytesIO()
                    image.save(buf, format="JPEG", quality=55)
                    sio.emit("frame", {"jpeg": __import__("base64").b64encode(buf.getvalue()).decode("ascii")})
            except Exception as exc:
                print("Screen capture paused:", exc)
        time.sleep(0.4)

threading.Thread(target=stream_screen, daemon=True).start()
print("Host agent starting. Keep this console visible; close it to stop.")
try:
    sio.connect(SERVER_URL, transports=["websocket", "polling"])
    sio.wait()
except KeyboardInterrupt:
    print("\nStopping remote access.")
finally:
    running = False
    approved.clear()
    if sio.connected:
        sio.disconnect()