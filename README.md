# RemoteCamera
Repurpose old phones for personal remote camera use
How to run

## 1. Start the server
```
cd server
npm install
node index.js        
```
*listens on port 3001*

## 2. Open dashboard in a browser (laptop/desktop)

Double-click `dashboard/index.html` — or — open `http://localhost:3001`

## 3. Open phone client on your phone
Change SERVER_URL in client/app.js to your LAN IP first:
const SERVER_URL = 'ws://192.168.x.x:3001'
Then open client/index.html on the phone, allow camera, tap "Start Streaming"

## 4. In the dashboard, click "View" next to the camera ID