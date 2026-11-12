# PhonePair design specs (2026-11-12)

Designs only. Do not change app logic in this pass. Paste `espresso-additions.css` after the live Espresso sheet. Reuse `.btn`, `.card`, `.pill`, `.step-n`, `.pp-list`, `.pp-list-row`, `.pp-icon-toggle`, `.seg` patterns. New hooks are prefixed `pp-`.

## Tokens

From `src/styles.css` on main. Font: Geist, then `ui-sans-serif, system-ui, sans-serif`. Mono: Geist Mono.

| Token | Value |
| --- | --- |
| `--bg` | `#EFE6D8` |
| `--surface` | `#F8F3EA` |
| `--line` | `#E0D4C4` |
| `--text` | `#1C1916` |
| `--muted` | `#5C564E` |
| `--accent` | `#2A1C16` |
| `--accent-ink` | `#F6F0E6` |
| `--tile` | `#FFFEFA` |
| `--wait` | `#3F3C38` |
| `--spark` | `#C4A06A` |
| connected `--ok` | `#2E6B3E` |
| error `--danger` | `#A23B2A` |

## B — Laptop control

One card, `data-testid="remote-panel"`, `data-os="mac"|"windows"`, `data-state` below.

| State | What shows |
| --- | --- |
| `idle` | `.pp-connect` only. Copy: **Connect laptop control**. |
| `steps` | `.pp-steps` open. Current step has `.pp-step--active`. |
| `waiting` | Steps 1–3 `.pp-step--done`, step 4 `.pp-step--active`. `helper-status`: **Waiting for helper**. |
| `connected` | Steps hidden. `helper-status` uses `.on` (existing green). Copy: **Connected**. |
| `error` | Existing `.err`. Copy stays: **Couldn't reach the helper. Make sure it's running, and click Allow if Chrome asks about local network access, then try again.** Rejected code: **That code was rejected. Check the helper window and try again.** |

Steps (all visible in `steps`, not a wizard):

1. **Download the helper.** `data-testid="download-mac"` and `download-win`. Add `.on` to the detected OS.
2. **Open it.** Mac `data-testid="mac-open-steps"`: Open the DMG, drag PhonePair Helper to Applications, and open it. Windows `data-testid="win-open-steps"`: If SmartScreen appears, click More info, then Run anyway.
3. **Allow Accessibility** (`.pp-step--mac`, hidden when `data-os="windows"`). Why: macOS needs this so the helper can move the pointer and send keys.
4. **Enter the 6-digit code.** Six `.pp-code-input` boxes inside `[data-testid="helper-code"]`. Digits only, length 6.

No “run from source” line. `.pp-dev-link` (**Developer**) reveals `data-testid="helper-dev-note"`: `cd helper && npm start`.

Keep: `connect-laptop`, `helper-steps`, `helper-hint`, `helper-status`, `helper-code`, `download-mac`, `download-win`, `mac-open-steps`, `win-open-steps`, `helper-dev-note`.

## C — One remote

Phone (`.pp-remote`) and the laptop card share one segmented control. Last mode is `localStorage["pp-remote-mode"]` = `trackpad` | `clicker` | `pointer`.

Tabs: `.pp-seg` > `.pp-seg-btn` with `aria-selected`. Test ids stay `rtab-trackpad`, `rtab-clicker`, `rtab-pointer`. On the phone the tabs sit at the bottom (thumb), min-height 52px.

- Trackpad: `.pp-remote-pad` `data-testid="trackpad"`, scroll strip `scroll-strip`, Left/Right `lclick` / `rclick`. Hint: Swipe to move · tap to click, two fingers to scroll.
- Clicker: hide the pad and click row. Prev/Next (`prev`, `next`) are the large targets. Hint: Prev and Next send arrow and page keys to the laptop, so a slideshow open in this tab can flip.
- Pointer: same pad. Hint: Swipe to move the pointer, tap to click, two fingers to scroll. Keep `data-testid="pointer"` on the laptop cursor overlay.

Keyboard: `kb-toggle` (**Keyboard**) reveals `kb-input`, placeholder **Type here, it appears on the laptop**. On the laptop card the field is the existing `remote-text` textarea under the mode control: **Open Remote on your phone and type. Text lands here, or in the field the pointer focuses.** Laptop card also shows the current mode label and `helper-status`.

Keep `full-laptop-badge` (**Full laptop**) when the helper is connected.

## E — Connected devices

Extend `.pp-list` / `.pp-list-row` with `.pp-device-row`.

- Star: `.pp-icon-toggle.pp-star`, `aria-pressed`, `data-testid="device-fav"`. Outline until pressed, then filled `var(--spark)`.
- Rename: pencil `.pp-icon-toggle` `data-testid="device-rename"` swaps the name for `.pp-rename-input` `data-testid="device-rename-input"`. Enter saves, Esc cancels, maxlength 32, empty reverts.
- Row states: default, `:hover` (mock class `.is-hover` matches it), `.is-editing`, star pressed.
- Sort: `fav` first, then `last` descending.

Saved in the browser only (`localStorage` key `pp.deviceMeta.v1`, shape `{v:1, devices:{[id]:{name?:string, fav?:boolean}}}`). Not sent to the helper or the peer.

## D — Wide screens

`.pp-shell` is the same wrapper as `.laptop` / `.phone-wrap` around the laptop nav and `.grid` (drop the old `max-width: 1240px` on `.nav` / `.grid` once the shell is the wrapper).

```css
.pp-shell {
  width: 100%;
  margin-inline: auto;
  padding-inline: clamp(16px, 4vw, 48px);
}
@media (min-width: 1200px) {
  .laptop,
  .phone-wrap,
  .pp-shell { max-width: min(80vw, 1440px); margin-inline: auto; }
}
@media (min-width: 1200px) and (max-width: 1500px) {
  .art { transform: scale(0.75); }
}
```

**Decision.** The wide cap `min(80vw, 1440px)` applies from 1200px up on `.laptop` and `.phone-wrap` (equivalent to `.pp-shell`). Between 1200px and 1500px the landing hero art (`.art`) is scaled to 0.75. `padding-inline: clamp(16px, 4vw, 48px)` stays as side padding in addition to that scale; it does not replace it. Under 1200px the page stays full width: at 390px the padding clamp resolves to 16px and there is no max-width.

Mocks: `b-connect.html`, `c-remote.html`, `e-devices.html`, `d-wide.html`.
