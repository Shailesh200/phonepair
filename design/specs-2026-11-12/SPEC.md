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

`.pp-os-toggle` sits at the top of the guide (Mac / Windows) and auto-selects the detected OS (`data-os`). Steps stay open together, not a wizard.

1. **Download the helper.** `data-testid="download-mac"` and `download-win`. Highlight the selected OS (`.on`).
2. **Open it.** Mac `mac-open-steps`: Open the DMG, drag PhonePair Helper to Applications, then open it. Windows `win-open-steps`: Run the installer. If SmartScreen appears, click More info, then Run anyway.
3. **Allow access.** Mac: Allow Accessibility: System Settings > Privacy & Security > Accessibility > turn on PhonePair Helper. This lets it move the pointer and type. Windows: Allow access: if Windows asks to allow PhonePair Helper through the firewall or to make changes, click Allow / Yes.
4. **Enter the 6-digit code.** Six `.pp-code-input` boxes inside `[data-testid="helper-code"]`. `.pp-code-go` sits on the right, same height as the boxes: `--accent` background, `--accent-ink` arrow, `aria-label="Connect"`. Disabled and muted until 6 digits are entered.

No “run from source” line. `.pp-dev-link` (**Developer**) reveals `data-testid="helper-dev-note"`: `cd helper && npm start`.

Keep: `connect-laptop`, `helper-steps`, `helper-hint`, `helper-status`, `helper-code`, `download-mac`, `download-win`, `mac-open-steps`, `win-open-steps`, `helper-dev-note`.

## C — One remote

No mode tabs. Drop `.pp-seg` for the remote. Trackpad, clicker, and pointer sit on one phone screen, top to bottom, with no scroll at 390×844.

1. `.pp-remote-pad` about 45% of the height, `data-testid="trackpad"`, scroll strip `scroll-strip`. Hint: Swipe to move · tap to click, two fingers to scroll.
2. Left / Right under the pad: `lclick`, `rclick`.
3. `.pp-remote-clicker`: big Prev / Next (`prev`, `next`). They send arrow and page keys so a slideshow can flip.
4. `.pp-remote-laser`: press and hold to show the laser, release to hide. Label **Pointer**. `data-testid="pointer"`.
5. Keyboard field `kb-input`. Placeholder: **Type here, it appears on the laptop**.

Laptop card `data-testid="remote-panel"`, title **Remote**. One summary: `helper-status` (**Connected**) and the three capabilities (trackpad, clicker, pointer). No segmented control. Keyboard placement is `remote-text`: **Open Remote on your phone and type. Text lands here, or in the field the pointer focuses.**

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
