# Full laptop control (desktop helper)

The phone remote normally moves a pointer inside the PhonePair tab. This helper lets that same remote move the laptop's real mouse and type on its real keyboard.

The laptop's PhonePair tab already receives the phone's remote events. While Full laptop is on, the tab forwards move, click, scroll, and key events to this program over a local WebSocket. The helper does not open its own WebRTC or PeerJS connection. If the helper is not running, PhonePair behaves as before and control stays inside the tab.

## Security model

- The helper listens on `127.0.0.1` only, never `0.0.0.0`. It uses port `47811`, then `47812`, `47813`, and `47814` if a port is already taken.
- On start it prints a random 6-digit pairing code and `CONTROL OFF`. The browser must send that code in its first message.
- Five wrong codes lock pairing for 60 seconds. Only one client can be paired at a time.
- The WebSocket origin must be `https://phonepair.vercel.app` or `http://localhost:5173`. Any other origin is rejected. For local development, open the app at `http://localhost:5173`.
- A Chrome Private Network Access preflight is answered with `Access-Control-Allow-Private-Network: true`.
- Every message is checked. Mouse and scroll deltas are clamped. Keys must be an arrow, Enter, Escape, Tab, Backspace, Space, Page Up, Page Down, a printable character, or a modifier (`cmd`, `ctrl`, `alt`, `shift`). Anything else is dropped.
- The helper only injects mouse move, click, scroll, and key events. It does not run a shell or open files.

## Install and run on macOS

```bash
cd helper
npm ci
npm start
```

The terminal prints the pairing code. On macOS, the helper must be allowed to control the computer. If Accessibility permission is missing, it prints instructions. Grant it in **System Settings > Privacy & Security > Accessibility**, enable the app that launched the helper (Terminal or iTerm), then start the helper again.

On the laptop, open PhonePair and pair the phone. In the Remote card, turn on **Full laptop**, enter the 6-digit code, and wait until the card says **Connected**. The phone shows a **Full laptop** badge. `CONTROL ON (paired)` is printed in the terminal.

Windows and Linux may work through the same input library, as a best effort. The permission check and the settings path above are for macOS.

## Turn it off

Turn off **Full laptop** on the laptop card, or press Ctrl+C in the helper terminal. The helper prints `CONTROL OFF`, the phone badge goes away, and remote events stay inside the PhonePair tab again.
