# VR Soundboard (Beginner Setup)

A local Node.js server that lets you trigger sound clips stored **on your Android headset/phone** by hitting simple HTTP addresses (like `http://localhost:3000/left-grip`) from your PC. Combine it with **Key Mapper** (see credit below) to fire those sounds from real button presses on your VR controllers.

> ⚠️ **Android only.** This setup relies on ADB and Android intents, so it currently only works with Android-based headsets/phones (e.g. Meta Quest, Pico, or any Android device with USB debugging). **Apple/iOS support is coming soon** — it is not currently supported.

---

## How it works

1. Your sound files (`.mp3`/`.wav`) live on **your phone's** storage (e.g. `/sdcard/Download/`) — the phone is what actually plays them.
2. **The soundboard server (`server.js`) runs on your PC**, connected to your **phone** via ADB.
3. **Key Mapper is installed on the VR headset**, where it watches for controller button presses.
4. When a mapped button is pressed, Key Mapper fires an **HTTP Request** action over your local Wi-Fi network to the soundboard server running on your PC (e.g. `http://<your-pc-ip>:3000/left-grip`).
5. The server receives that request and uses **ADB** to tell your **phone** to open and play the matching sound file.
6. Your phone is also connected to a **Voicemod Key** hardware dongle (via USB-C), running the **Voicemod app**. The phone's audio output (the sound that just played) passes through the Voicemod Key, then out through a 3.5mm-to-USB-C adapter into your VR headset as an external microphone — so everyone in voice chat hears it. See [Audio Routing](#audio-routing-getting-sounds-into-voice-chat-with-voicemod-key) below.

**Devices involved, at a glance:**

| Device | Role |
|---|---|
| **PC** | Runs `server.js` (this soundboard server). Talks to the phone over ADB. |
| **Phone** | Stores and plays the sound files (ADB target). Also runs the **Voicemod app** and connects to the Voicemod Key — this is where all Voicemod setting changes happen, and it must be open at boot. |
| **VR headset** | Runs **Key Mapper**, which sends the HTTP request when a controller button is pressed. Also receives the processed audio from the Voicemod Key (via the 3.5mm-to-USB-C adapter) as its external microphone input. |

---

## What's in this folder

| File | Purpose |
|---|---|
| `server.js` | The soundboard server (Express-based). Defines routes and talks to your device via ADB. |
| `package.json` / `package-lock.json` | Node.js dependency list. |
| `logo.png` / `banner.png` | Shown on the terminal boot screen when the server starts. |

---

## Requirements

Before you start, make sure you have:

- **Node.js** (v18 or newer recommended) — [nodejs.org](https://nodejs.org)
- **ADB (Android Platform Tools)** installed on your **PC** and available on your system PATH — [Download here](https://developer.android.com/tools/releases/platform-tools)
- An **Android phone** (this is what stores/plays the sounds) with **Developer Options** and **USB Debugging** enabled
- A USB cable (or ADB over Wi-Fi) connecting the **phone** to your PC
- An **Android VR headset** (Meta Quest, Pico, etc.) on the same **local Wi-Fi network** as your PC (required for Key Mapper's HTTP requests to reach the server)
- The **Key Mapper** app installed **on the VR headset** (see credit section below) — not on your phone or PC
- A **Voicemod Key** hardware dongle + the **Voicemod app** installed on your **phone**, for routing sound into voice chat
- A **3.5mm-to-USB-C audio adapter**, for connecting the Voicemod Key to your VR headset
- Your sound files (`.mp3` or `.wav`) copied onto your **phone**, e.g. into `/sdcard/Download/`

---

## Setup

### 1. Install dependencies
Open a terminal in this folder and run:
```bash
npm install
```

### 2. Enable USB debugging on your phone
1. On your **phone**, go to **Settings → About** and tap **Build Number** 7 times to unlock Developer Options.
2. Go to **Settings → Developer Options** and enable **USB Debugging**.
3. Connect the **phone** to your PC via USB (or set up ADB over Wi-Fi).
4. On the phone, accept the "Allow USB Debugging" prompt when it appears.

### 3. Verify ADB sees your phone
```bash
adb devices
```
You should see your phone listed with `device` next to it (not `unauthorized` or `offline`). The server will refuse to play sounds unless **exactly one** device is connected.

### 4. Copy your sound files to your phone
Push your sound clips onto your phone's storage, for example:
```bash
adb push "MySound.mp3" /sdcard/Download/
```
Note the exact path — you'll need it in the next step.

### 5. Configure your sound routes
Open `server.js` and find the `ROUTES` block near the top:
```js
const ROUTES = {
  "left-grip":  { name: "left-grip",  filePath: "/sdcard/Download/Bonk.mp3",      mimeType: "audio/wav" },
  "slot2":      { name: "slot2",      filePath: "/sdcard/Download/NAME HERE.mp3", mimeType: "audio/wav" }
};
```
- **Key** (e.g. `"slot2"`) — becomes the URL path: `http://localhost:3000/slot2`
- **filePath** — the path to the sound **on your phone**, not your PC or headset
- **mimeType** — leave as `"audio/wav"` (works fine for mp3 files too in this setup)

To add a new sound:
1. Copy an existing line and give it a new key/name.
2. Update `filePath` to point at your new sound file on the device.
3. Add a matching route near the bottom of the file, next to the existing ones:
   ```js
   app.get('/left-grip', (req, res) => { playSound('left-grip', res); });
   app.get('/slot2',     (req, res) => { playSound('slot2', res); });
   app.get('/your-new-key', (req, res) => { playSound('your-new-key', res); });
   ```
   (Only the very last entry in `ROUTES` should be without a trailing comma — everything else needs one.)

### 6. Start the server
```bash
npm start
```
If everything is working, you'll see a boot screen confirming the server is **ONLINE** on port `3000`.

### 7. Test a sound
With your phone connected, open a browser (or just visit the URL) at:
```
http://localhost:3000/left-grip
```
You should hear the sound play through your connected phone. Visiting the same URL again will reset and replay it automatically.

---

## Setting up Key Mapper (to trigger sounds from controller buttons)

**Key Mapper** is an Android app that lets you remap physical buttons/keys — including VR controller inputs recognized as key events — to custom actions. **Install it directly on your VR headset** (not on your phone or PC) — that's what lets a real button press on your controller reach your soundboard server on your PC.

1. Sideload/install Key Mapper **on the VR headset** from the official release:
   **https://github.com/keymapperorg/KeyMapper/releases/tag/v4.3.0**
2. On the headset, open Key Mapper and create a new keymap.
3. Set the **trigger** to the controller button you want to use (Key Mapper can record the input directly).
4. Set the **action type to "HTTP Request"** (not "Open URL") and enter your PC's route, e.g.:
   ```
   http://<your-pc-local-ip>:3000/left-grip
   ```
   This must point at your **PC's local IP address on your Wi-Fi network** — not `localhost` and not the headset's own IP, since the request needs to leave the headset and reach the PC running `server.js`. Find your PC's IP with `ipconfig` (Windows) or `ifconfig`/`ip a` (Mac/Linux), e.g. `http://192.168.1.50:3000/left-grip`.
5. Save the keymap and make sure it's enabled (Key Mapper needs Accessibility Service permission on the headset to intercept controller key events — it will prompt you for this on first setup).
6. Make sure the headset and PC are connected to the **same Wi-Fi network**, then press the mapped button — it should trigger your soundboard server and play the sound.

---

## Audio routing: getting sounds into voice chat with Voicemod Key

The soundboard server makes your **phone** *play* the sound file — the **Voicemod Key** hardware is what carries that audio from your phone into your VR voice chat as a virtual microphone.

1. Plug the **Voicemod Key** into your **phone** via USB-C (or a Lightning adapter for iPhone) — this is the same phone that stores and plays the sound files.
2. **Open the Voicemod app on your phone** and wait for it to detect the Voicemod Key — this app is where all Voicemod settings changes are made, not on the headset or PC.
3. Run a 3.5mm cable from the Voicemod Key's Controller jack into a **3.5mm-to-USB-C audio adapter**, then plug that adapter into your **VR headset**. This feeds the phone's audio (routed through the Voicemod Key) into the headset as an external mic source.
4. On the headset, go to your audio/microphone settings and select the Voicemod Key as the **external microphone** source.
5. **The Voicemod app on your phone must be open and running whenever you boot up / start your session** — if it's closed, the Voicemod Key has nothing to route audio through and sounds won't come through in-game.
6. Trigger a sound via Key Mapper as usual — your phone plays it, it passes through the Voicemod Key, and comes out your headset's mic input so others in voice chat can hear it.

---

## Other useful endpoints

| Endpoint | What it does |
|---|---|
| `GET /play/:route` | Generic way to trigger any configured route, e.g. `/play/slot2` |
| `GET /trigger-adb` | Sends a "back" key event and resets the last played sound |
| `GET /reset/:route` | Manually resets a specific route's state without playing it |
| `GET /logs/view` | Opens a live, styled log viewer in your browser at `http://localhost:3000/logs/view` |
| `GET /health` | Basic health check — confirms the server is reachable |

---

## Troubleshooting

- **"No device or too many devices connected"** — Run `adb devices` and make sure exactly one **phone** shows as `device`. Unplug/replug or re-authorize if needed.
- **"Sound path invalid"** — Double-check the `filePath` in `ROUTES` matches exactly where the file lives on your **phone** (case-sensitive), and that the extension is `.mp3` or `.wav`.
- **Sound doesn't play but no error** — Make sure the phone's media volume isn't muted, and that it has a default app assigned to open audio files via intent.
- **Key Mapper button doesn't trigger anything** — Confirm Key Mapper's Accessibility permission is enabled on the headset, that the action type is set to **HTTP Request** (not "Open URL"), and that you're using your PC's actual local Wi-Fi IP (not `localhost`).
- **Sound plays on the phone but nobody hears it in voice chat** — Make sure the **Voicemod app is open on your phone** (it won't route audio while closed), the Voicemod Key is plugged into the phone via USB-C, the 3.5mm-to-USB-C adapter connects it to the headset, and the headset's mic input is set to the external/Voicemod Key microphone.
- **Headset and PC can't reach each other over HTTP** — Confirm both devices are on the **same Wi-Fi network** and that your PC's firewall isn't blocking inbound connections on port `3000`.

---

## Credit

Button-to-action mapping is powered by **[Key Mapper](https://github.com/keymapperorg/KeyMapper)** by **[sds100](https://github.com/sds100)** and the Key Mapper org — a free, open-source Android app for remapping buttons and keys. This project simply calls a soundboard URL from a Key Mapper action; all credit for the remapping functionality goes to its creator.
Release used: [v4.3.0](https://github.com/keymapperorg/KeyMapper/releases/tag/v4.3.0)

---

### Platform note
This entire workflow (ADB intents + Key Mapper) is **Android-specific**. **iOS/Apple support is planned for a future update** and is not available yet.
