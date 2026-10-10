# Remote PIN Desktop (starter project)

This is a starter implementation for a consent-based remote desktop relay:
- No IP address is entered by the controller.
- Host agent connects outbound to a central Socket.IO relay.
- Host gets a temporary 3-digit PIN (2-minute lifetime).
- Controller enters the PIN and waits for the host operator to approve in the host console.
- One controller per host session; server limits repeated failed PIN attempts.
- The host can stop the agent with Ctrl+C.

## Important limitations and security
A 3-digit PIN is weak. Treat it only as a short-lived pairing code, never as the sole long-term credential.
Use HTTPS/WSS, restrict the deployed origin, add production-grade rate limiting and audit logs, and do not run this on a computer without authorization.
This starter is not hardened for production. The host agent currently implements screen capture and basic mouse clicks/movement and single-key input; coordinate scaling, keyboard layouts, clipboard, multi-monitor support, and robust session management need more work.
The sample web UI in `web/index.html` is a prototype and is not wired to the Socket.IO session flow yet. The relay backend and host agent are provided as starter source, not a turnkey product.

## Deploy the relay server
1. Push this folder to a private Git repository.
2. Create a Node.js web service on a host such as Render.
3. Build command: `npm install`
4. Start command: `npm start`
5. Set environment variable `ALLOWED_ORIGIN` to your deployed website origin (for example `https://your-site.example`). Do not leave wildcard CORS in a production deployment.
6. Ensure the service has HTTPS and supports WebSockets.
7. The frontend must be completed to use Socket.IO events (`controller-join`, `connection-approved`, `frame`, `remote-input`) before it can connect to this relay. The provided static page is currently a design prototype.

## Run the host agent on Windows 10/11
Install Python 3.11+ and open PowerShell in `host`:
```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python host_agent.py
```
Enter your deployed relay URL, e.g. `https://your-app.onrender.com`. Keep the console visible. Share the PIN only with the intended controller. Type `YES` in the host console to approve a request. Press Ctrl+C to stop.

## Build a Windows EXE (optional)
```powershell
python -m pip install pyinstaller
pyinstaller --onefile --console --name RemotePINHost host_agent.py
```
The EXE is created in `host\dist\RemotePINHost.exe`. Keep the console build so the host can see and approve requests.

## Local development
```bash
npm install
npm start
```
Then visit `http://localhost:3000`. For local host-agent testing, use `http://127.0.0.1:3000` as the relay URL. Browser mixed-content restrictions and local network configuration may require using HTTPS for remote access.
