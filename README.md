# RemoteCamera
Repurpose old phones for personal remote camera use
How to run

How to run it (no cloning needed)

## Step 1 — Find your computer's LAN IP *Windows*

`ipconfig`

Look for "IPv4 Address" under your WiFi adapter, e.g.       
`192.168.1.42`

## Step 2 — Edit the two config lines (one-time setup)

client/app.js line ~6 change  
localhost to your LAN IP:
const SERVER_URL = `ws://10.65.70.213:3001`   // use your actual IP

dashboard/app.js line ~6 — change 
const SERVER_URL = `ws://10.65.70.213:3001`
## Step 3 — Start the server
```
cd server
npm install
node index.js
```

## Step 4 — Open on your phone (no install, no cloning)

On your phone's browser, navigate to:
http://192.168.1.42:3001/client

## Step 5 — Open the dashboard on your computer
http://192.168.1.42:3001/dashboard

---

Android: Works over plain http:// on LAN.
iPhone: Safari requires HTTPS for camera access. For a quick workaround, use Chrome on Android, or set up a self-signed cert on the server.