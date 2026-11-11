# PhonePair core

Vite + React 18 + TypeScript. `npm install && npm run build` → static `dist/`, plus one Vercel function `api/turn.js`.
Deps: react, react-dom, peerjs 1.5.4, qrcode. Ask Arc before adding more.

## Layout
```
src/
  main.tsx, App.tsx      app shell: routing, Link lifecycle, bus wiring, toasts
  Laptop.tsx             laptop: QR landing → dashboard (renders feature panels + overlays)
  Phone.tsx              phone: code entry / connecting / home tiles → feature pages
  core/link.ts           PeerJS connection (pairing, reconnect, heartbeat, hello/bye/ping)
  core/bus.ts            message bus + feature registry + tiny stores   <-- your API
  core/ui.tsx            Logo, CopyBtn, Linkified, Video, StatusPill
  core/icons.tsx         <Icon n="..."/> (upload share clip pointer camera mic scan screen x back next send copy file image keyboard full zoom rotate download slides flip lock)
  core/util.ts           fmtSize, ago, uid, copyText, linkify, download
  features/index.ts      one import line per feature
  features/files|clipboard/   working baseline features (owned by those lanes; improve freely)
api/turn.js              GET /api/turn → { iceServers, ttl }
```

## Routing / roles
- `/` on a desktop browser = **host** (laptop). `/` on a phone UA = code entry screen (with a "use as laptop" link). `/?as=host` forces host.
- `/j/ABC123` (what the QR encodes) or `/?c=ABC123` = **guest** (phone) joining that code.
- Host's code is kept in `sessionStorage` so a laptop reload keeps the same code and the phone auto-reconnects.
- Debug: add `?relay=1` to force TURN-only (`iceTransportPolicy: 'relay'`).

## Adding a feature (the hook-in)
Create `src/features/<area>/index.tsx`, then add `import './<area>'` to `src/features/index.ts`. No other core edits needed.

```tsx
import { registerFeature, onMessage, createStore, CoreCtx } from '../../core/bus'

const state = createStore<string[]>([])           // survives page changes; state.use() in components

registerFeature({
  id: 'remote', title: 'Remote', icon: 'pointer', order: 40,
  PhonePage: ({ ctx }) => <button onClick={() => ctx.send({ t: 'remote:click' })}>Click</button>,  // phone tile + full page
  LaptopPanel: ({ ctx }) => <div className="card pad">…</div>, laptopColumn: 'right',               // dashboard card
  LaptopOverlay: ({ ctx }) => null,                                                                 // full-screen layer (pointer, slideshow)
  init: (ctx) => onMessage('remote:click', (m, ctx) => { /* runs on the receiving device */ }),     // return cleanup
})
```
Existing orders: files 10, clipboard 30. Suggested: remote 40, camera 50, mic 55, scan 60, screen 70.

## Bus API (`src/core/bus.ts`)
- `ctx.send({ t: 'area:thing', ...payload })` — send to the other device. Payload can contain `Uint8Array`/`ArrayBuffer` (PeerJS binary serialization). **Prefix types with your area** (`file:`, `clip:`, `remote:`, `cam:`, `screen:`). Reserved by core: `hello`, `bye`, `ping`.
- `onMessage(type, (msg, ctx) => …)` → unsubscribe. Register in `init` so it works even when your page isn't open. `onMessage('*', …)` sees everything.
- `useMessage(type, handler, deps)` — same, tied to a component's lifetime.
- `createStore(initial)` → `{ get, set, use, subscribe }` module-level state.
- `ctx.role` — `'host'` (laptop) or `'guest'` (phone).
- `ctx.toast(text)`, `ctx.openPage(featureId)` (phone: jump to a feature page, e.g. when a screen stream arrives).
- `ctx.link` — `status` ('starting'|'waiting'|'connecting'|'connected'|'reconnecting'|'error'|'closed'), `remoteName`, `code`, `conn` (PeerJS DataConnection; files use `conn.dataChannel.bufferedAmount` for backpressure), `disconnect()`.
- Media: sender `const call = ctx.call(stream, 'camera')` (one-way; `call.close()` to stop). Receiver: `onCall('camera', (call, ctx) => { call.answer(); call.on('stream', s => …) })` in `init`. One handler per kind; calls with no handler are closed. Send your own `area:stop` message too, since PeerJS close events can lag.

## Connection details
- Signal (PeerJS server): `https://signal.167.233.223.123.sslip.io/peerjs` (client config: host `signal.167.233.223.123.sslip.io`, port 443, path `/peerjs`, secure, key `peerjs`). Host peer id = `phonepair-<code lowercase>`; codes are 6 chars from `A-Z2-9` minus I/O/0/1.
- Heartbeat: ping every 4 s; link considered lost after 15 s silence. Phone redials automatically; laptop goes back to "waiting" with the same code.
- TURN: coturn at `167.233.223.123:3478` (UDP + TCP), relay ports `49160-49200/udp`, realm `phonepair`, REST auth (`use-auth-secret`): username = `<unix-expiry>:phonepair`, credential = base64(HMAC-SHA1(secret, username)), 6 h TTL. `/api/turn` mints these from the `TURN_SECRET` env var (never commit or log it); without the env var it returns STUN only.
- Server side lives in `/opt/phonepair` on the Hetzner VM (docker compose: `phonepair-peerjs` behind Traefik with Let's Encrypt, `phonepair-coturn` on host network, 128 MB limit each). Private/internal peer IPs are denied in coturn.
- Tested from the box (Nov 11 23:25 IST): relay-only data channel works over TURN/UDP and TURN/TCP — no extra Hetzner cloud firewall ports needed.

## Tested locally (Playwright, desktop + Pixel 7 emulation, real signal server)
Pair by code; 3.5 MB laptop→phone and 1.2 MB phone→laptop files with matching SHA-256; clipboard both ways; phone reload and laptop reload both auto-reconnect.
