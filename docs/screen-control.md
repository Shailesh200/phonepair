# Screen control

The phone can control the laptop from the screen view, in the same style as a remote desktop. The laptop tab forwards pointer events to the desktop helper. The helper listens on `127.0.0.1` only, requires the 6-digit code, allows one session, and checks the origin allowlist. It injects mouse and keyboard input only. It does not read files or run commands.

v1 moves the pointer on the **primary display only**. A window or tab share cannot be controlled.

## Install the helper on macOS

The helper lives in `helper/` and keeps its own dependencies.

```bash
cd helper
npm ci
npm start
```

The terminal prints a 6-digit pairing code and `CONTROL OFF`.

macOS will not let the helper move the pointer until Accessibility permission is granted. If that permission is missing, the helper prints instructions and input is rejected by the system. Grant it, then start the helper again:

1. Open **System Settings > Privacy & Security > Accessibility**.
2. Enable the app that launched the helper (Terminal or iTerm).
3. Quit the helper (Ctrl+C) and run `npm start` again.

Windows and Linux may work through the same input library. The permission check and the settings path above are for macOS.

## Turn on control

1. On the laptop, open PhonePair (`http://localhost:5173` for local development, or the production site) and pair the phone.
2. In the Remote card, turn on **Full laptop**, enter the 6-digit code, and wait until the card says **Connected**.
3. Share the **entire screen** (the monitor), not a window or a browser tab.
4. On the phone, open Screen view. The Control toggle is off until it is switched on.

Control is offered only when both of these are true:

- Full laptop is connected.
- The shared track reports `displaySurface === 'monitor'`.

Otherwise the phone stays view-only. For a window or tab, the laptop shows **Share your entire screen to control it** and sends no pointer events. The laptop tells the phone with `{t:'sc:avail', on:false, reason:'surface'|'helper'}`. `on:true` is sent only for a connected helper and a monitor share, once when sharing starts and again whenever that changes.

## Manual test

Run this on a Mac after the helper is allowed under Accessibility.

1. Pair the phone with the laptop.
2. Turn on **Full laptop** and confirm the Remote card says Connected.
3. Share the entire screen. Confirm the laptop does not show "Share your entire screen to control it".
4. On the phone, turn **Control** on. It starts off.
5. Tap the screen: the pointer moves there and clicks.
6. Double-tap: double-click.
7. Long-press (about half a second): right-click.
8. Drag with one finger: click-drag.
9. Drag with two fingers: scroll.
10. Open the keyboard and type a few characters.
11. On the laptop, confirm the banner **Phone is controlling this laptop** with **Stop**. Primary display only.
12. Press **Stop**. The banner goes away and the pointer button is released. Press Control again, drag, and press **Esc** while the PhonePair tab is focused. The banner goes away the same way. Esc does not stop control when another window is in front. Ctrl+C in the helper terminal is the global stop.
13. Stop sharing, then share a single window. Confirm the laptop shows **Share your entire screen to control it**, the phone stays view-only, and taps do nothing on the desktop.
14. Turn Full laptop off while a monitor is shared. Confirm the phone is view-only until Full laptop is connected again.

Stop and Esc end control from the PhonePair tab. Esc only works while that tab has focus. Ctrl+C in the helper terminal is the global stop and works even when the tab is in the background. Unpair, helper disconnect, and a 3-second gap with no messages each release a button the helper is holding.
