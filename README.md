# PhonePair

![PhonePair UI mockups](docs/hero.png)
<!-- This hero image will be replaced with a real screenshot after deploy. -->

Pair your phone with your laptop in the browser. Scan a QR code, or type a 6-character code, and move things between the two devices. No app install.

Live: [phonepair.vercel.app](https://phonepair.vercel.app)

## Features

1. **Pairing by QR and a 6-character code, with auto-reconnect.** The laptop shows a QR code and the code next to it. The phone scans the QR (it opens `/j/` plus the code) or types the code. Codes are six characters drawn from an alphabet that leaves out `I`, `O`, `0`, and `1`. The laptop keeps its code in `sessionStorage`, so a reload uses the same code and the phone reconnects on its own. A ping goes out every 4 seconds. After 15 seconds of silence the phone redials, and the laptop goes back to waiting on that same code. If the old code is still held after 5 retries (about 12s), the laptop gets a new code and the phone needs to pair again.

2. **Text and links, both ways.** Either device can send a note or a URL. Links in the text stay clickable, and both sides keep the thread.

3. **Files and screenshots, both ways.** Drop files, pick them, or paste a screenshot. Transfers go in 64 KB chunks with a progress bar, in either direction. A pasted screenshot is named with the time it was sent. A received file can be saved on the other device.

4. **Live clipboard.** A shared text box. Typing or pasting on one device shows up on the other, with a short history of recent clips.

5. **Phone as a remote.** The phone is a trackpad for the laptop, with Prev and Next controls and a keyboard. With the desktop helper, that same remote can control the whole laptop.

6. **Laptop screen on the phone.** View the laptop screen from the phone. Control, off until you turn it on, sends taps and drags to the laptop. It works on the primary display only, and only while the laptop is sharing the entire screen with Full laptop connected. Otherwise the phone stays view-only.

## How it works

Both sides run in the browser. After pairing they talk over WebRTC: data channels carry messages, files, and clipboard text, and media calls carry the screen only. [PeerJS](https://peerjs.com/) opens those connections.

A PeerJS signalling server introduces the two browsers so they can negotiate the session. The laptop's peer id is `phonepair-` plus the pairing code in lowercase.

When a direct path is blocked, a coturn TURN relay carries the traffic. The page asks `GET /api/turn` for ICE servers, and that function mints short-lived TURN credentials. Add `?relay=1` to the URL to force TURN-only (`iceTransportPolicy` set to `'relay'`) when you want to test the relay.

## Full laptop control (desktop helper)

The phone remote normally moves a pointer inside the PhonePair tab. The desktop helper lets that same remote move the laptop's real mouse and type on its real keyboard.

The laptop's PhonePair tab already receives the phone's remote events. While Full laptop is on, the tab forwards move, click, scroll, and key events to a small program on the laptop over a local WebSocket. The helper does not open its own WebRTC or PeerJS connection. If the helper is not running, PhonePair behaves as before and control stays inside the tab.

### Security model

- The helper listens on `127.0.0.1` only, never `0.0.0.0`. It uses port `47811`, then `47812`, `47813`, and `47814` if a port is already taken.
- On start it prints a random 6-digit pairing code and `CONTROL OFF`. The browser must send that code in its first message.
- Five wrong codes lock pairing for 60 seconds. Only one client can be paired at a time.
- The WebSocket origin must be `https://phonepair.vercel.app` or `http://localhost:5173`. Any other origin is rejected. For local development, open the app at `http://localhost:5173`.
- A Chrome Private Network Access preflight is answered with `Access-Control-Allow-Private-Network: true`.
- Every message is checked. Mouse and scroll deltas are clamped. Keys must be an arrow, Enter, Escape, Tab, Backspace, Space, Page Up, Page Down, a printable character, or a modifier (`cmd`, `ctrl`, `alt`, `shift`). Anything else is dropped.
- The helper only injects mouse move, click, scroll, and key events, plus absolute moves and button presses for screen control. It does not run a shell or open files.

### Install and run on macOS

```bash
cd helper
npm ci
npm start
```

The terminal prints the pairing code. On macOS, the helper must be allowed to control the computer. If Accessibility permission is missing, it prints instructions. Grant it in **System Settings > Privacy & Security > Accessibility**, enable the app that launched the helper (Terminal or iTerm), then start the helper again.

On the laptop, open PhonePair and pair the phone. In the Remote card, turn on **Full laptop**, enter the 6-digit code, and wait until the card says **Connected**. The phone shows a **Full laptop** badge. `CONTROL ON (paired)` is printed in the terminal.

Windows and Linux may work through the same input library, as a best effort. The permission check and the settings path above are for macOS.

### Turn it off

Turn off **Full laptop** on the laptop card, or press Ctrl+C in the helper terminal. The helper prints `CONTROL OFF`, the phone badge goes away, and remote events stay inside the PhonePair tab again.

### Screen control

Screen control is inside the laptop screen view, and only while Full laptop is connected. The phone can move the pointer when the shared track is the entire screen (`displaySurface === 'monitor'`). A window or tab share stays view-only: the laptop says "Share your entire screen to control it" and does not forward pointer events. v1 moves the pointer on the primary display only. While the phone is controlling, the laptop shows "Phone is controlling this laptop" with Stop. Stop or Esc ends that session. See `docs/screen-control.md`.

## Known limits

- On networks that only allow TCP 443, the relay won't connect, because TURN runs on port 3478 (UDP/TCP) only; TURN over TLS on 443 is planned.
- `/api/turn` issues 6-hour TURN credentials to any caller; rate limiting is planned.

## Local development

```bash
npm ci
npm run dev
```

`npm run build` typechecks the project and writes the static site to `dist`.

## Environment variables

| Name | Role |
| --- | --- |
| `TURN_SECRET` | Shared secret read by `/api/turn`. When it is set, `/api/turn` returns TURN credentials. When it is unset, `/api/turn` returns STUN only. |

## Deploy

PhonePair deploys on Vercel. Production deploys come from `main` only, on the free plan. The framework preset is Vite and the output directory is `dist`. The deployment also includes the `api/turn.js` function.

## License

[MIT](LICENSE)
