// CSS for everything inside our shadow root, as a template string.
//
// Two things about the shadow boundary worth knowing:
//   - @font-face is document-global, so 'Open Sans' (which the app already loads
//     from Google Fonts) works in here for free.
//   - Class rules do NOT cross the boundary, so the app's `.material-icons` rule is
//     invisible to us. We redeclare the font-family below to get icon ligatures.
//
// ObservePoint has no CSS custom properties at runtime -- its design system is SCSS
// compiled away -- so these token values are transcribed from
// moonbeam/src/main/web/styles/variables/colors.scss. Dark is the app's default
// theme when localStorage is unset, so both themes are first-class here.

export const STYLES = /* css */ `
  :host {
    /* ObservePoint palette, from styles/variables/colors.scss */
    --op-yellow: #F2CD14;
    --op-yellow-dark: #D5A900;
    --op-blue: #11A6D4;
    --op-green: #50BC77;
    --op-red: #F34146;
    --op-white: #FFFFFF;
    --op-gray-1: #F7F7F7;
    --op-gray-2: #F2F2F2;
    --op-gray-3: #ECECEC;
    --op-gray-4: #DADADA;
    --op-gray-5: #B0B0B0;
    --op-gray-6: #777777;
    --op-gray-7: #5B5B5B;
    --op-gray-8: #4A4A4A;
    --op-gray-9: #3E3E3E;
    --op-gray-10: #333333;
    --op-gray-14: #242424;

    /* Resolved per theme by the .op-dark / .op-light classes below. */
    --surface: var(--op-white);
    --surface-raised: var(--op-gray-1);
    --text: var(--op-gray-10);
    --text-dim: var(--op-gray-6);
    --border: var(--op-gray-4);
    --scrim: rgba(0, 0, 0, 0.55);

    all: initial;
    font-family: 'Open Sans', -apple-system, BlinkMacSystemFont, sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  .op-root.op-dark {
    --surface: var(--op-gray-9);
    --surface-raised: var(--op-gray-8);
    --text: var(--op-gray-1);
    --text-dim: var(--op-gray-5);
    --border: var(--op-gray-7);
    --scrim: rgba(0, 0, 0, 0.65);
  }

  .op-root {
    font-family: 'Open Sans', -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    color: var(--text);
  }

  /* The app loads Material Icons on the document; the ligature font-family has to
     be restated in here because the .material-icons class rule doesn't cross. */
  .op-icon {
    font-family: 'Material Icons';
    font-weight: normal;
    font-style: normal;
    font-size: 20px;
    line-height: 1;
    letter-spacing: normal;
    text-transform: none;
    display: inline-block;
    white-space: nowrap;
    word-wrap: normal;
    direction: ltr;
    -webkit-font-feature-settings: 'liga';
    -webkit-font-smoothing: antialiased;
  }

  /* --------------------------------------------------------------- status bar */

  /* Top-centre: Intercom's launcher owns the bottom-right corner on this app, and the
     app's own toasts own the bottom edge. */
  .op-statusbar {
    position: fixed;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    width: max-content;
    max-width: calc(100vw - 32px);
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-left: 4px solid var(--op-yellow);
    border-radius: 8px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
    padding: 10px 14px;
    pointer-events: auto;
    box-sizing: border-box;
  }

  .op-statusbar-top {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .op-statusbar-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--op-yellow);
    flex: none;
  }

  .op-statusbar-dot[data-paused='true'] { background: var(--op-red); }

  .op-statusbar-label {
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
  }

  .op-statusbar-progress {
    font-size: 12px;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    margin-right: 4px;
  }

  .op-statusbar-say {
    margin: 8px 0 0;
    font-size: 13px;
    max-width: 560px;
  }

  .op-statusbar-say:empty { display: none; }
  .op-statusbar-say[data-error='true'] { color: var(--op-red); }

  /* ------------------------------------------------------------------ buttons */

  .op-btn {
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    border-radius: 4px;
    border: 1px solid transparent;
    padding: 7px 14px;
    cursor: pointer;
    background: var(--op-yellow);
    color: #000000;
    transition: background 120ms ease;
  }

  .op-btn:hover { background: var(--op-yellow-dark); }

  .op-btn:focus-visible {
    outline: 2px solid var(--op-blue);
    outline-offset: 2px;
  }

  .op-btn--ghost {
    background: transparent;
    color: var(--text-dim);
    border-color: var(--border);
  }

  .op-btn--ghost:hover {
    background: var(--surface-raised);
    color: var(--text);
  }

  .op-btn--sm { padding: 5px 10px; font-size: 12px; }
  .op-btn:disabled { opacity: 0.45; cursor: default; }
  .op-spacer { margin-left: auto; }

  /* ------------------------------------------------------- modals (picker etc) */

  /* Modals are meant to block the app underneath, so this layer takes pointer events. */
  .op-scrim {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(3px);
    pointer-events: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    box-sizing: border-box;
  }

  .op-modal {
    width: 560px;
    max-width: 100%;
    max-height: calc(100vh - 48px);
    display: flex;
    flex-direction: column;
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-top: 4px solid var(--op-yellow);
    border-radius: 10px;
    box-shadow: 0 18px 60px rgba(0, 0, 0, 0.55);
    overflow: hidden;
  }

  .op-modal-head {
    padding: 20px 24px 12px;
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }

  .op-modal-title {
    margin: 0;
    font-size: 18px;
    font-weight: 700;
  }

  .op-modal-sub {
    margin: 4px 0 0;
    font-size: 13px;
    color: var(--text-dim);
  }

  .op-modal-body {
    padding: 4px 24px;
    overflow-y: auto;
    flex: 1 1 auto;
  }

  .op-modal-foot {
    padding: 14px 24px 18px;
    display: flex;
    align-items: center;
    gap: 10px;
    border-top: 1px solid var(--border);
  }

  .op-close {
    margin-left: auto;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-dim);
    padding: 2px;
    line-height: 1;
    flex: none;
  }

  .op-close:hover { color: var(--text); }

  /* --------------------------------------------------------- selectable cards */

  .op-card {
    display: block;
    width: 100%;
    text-align: left;
    font-family: inherit;
    background: var(--surface-raised);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px 14px;
    margin-bottom: 8px;
    cursor: pointer;
    transition: border-color 120ms ease, background 120ms ease;
  }

  .op-card:hover {
    border-color: var(--op-yellow);
  }

  .op-card:focus-visible {
    outline: 2px solid var(--op-blue);
    outline-offset: 2px;
  }

  .op-card[aria-pressed='true'],
  .op-card[data-selected='true'] {
    border-color: var(--op-yellow);
    box-shadow: inset 3px 0 0 var(--op-yellow);
  }

  .op-card-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 3px;
  }

  .op-card-blurb {
    font-size: 12.5px;
    color: var(--text-dim);
    margin: 0;
  }

  .op-tag {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    padding: 2px 6px;
    border-radius: 3px;
    background: var(--op-blue);
    color: #000000;
    flex: none;
  }

  .op-tag--done { background: var(--op-green); }
  .op-tag--muted { background: var(--op-gray-5); }

  .op-card-meta {
    margin-left: auto;
    font-size: 11px;
    font-weight: 400;
    color: var(--text-dim);
    flex: none;
  }

  .op-check {
    width: 16px;
    height: 16px;
    border: 2px solid var(--op-gray-5);
    border-radius: 3px;
    flex: none;
    display: grid;
    place-items: center;
    font-size: 12px;
    color: #000000;
  }

  .op-card[data-selected='true'] .op-check {
    background: var(--op-yellow);
    border-color: var(--op-yellow);
  }

  .op-section-label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-dim);
    margin: 14px 0 8px;
  }

  .op-empty {
    font-size: 13px;
    color: var(--text-dim);
    padding: 12px 0 16px;
  }

  /* ------------------------------------------------------------- offer toast */

  /* Bottom-LEFT on purpose: Intercom's messenger launcher owns the bottom-right
     corner on this app, and this must never fight it for the same pixels. */
  .op-offer {
    position: fixed;
    bottom: 20px;
    left: 20px;
    width: 320px;
    max-width: calc(100vw - 40px);
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-left: 4px solid var(--op-yellow);
    border-radius: 8px;
    box-shadow: 0 10px 32px rgba(0, 0, 0, 0.5);
    padding: 14px 16px;
    pointer-events: auto;
    box-sizing: border-box;
    animation: op-slide-in 220ms cubic-bezier(0.2, 0, 0.2, 1);
  }

  @keyframes op-slide-in {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @media (prefers-reduced-motion: reduce) {
    .op-offer { animation: none; }
  }

  .op-offer-title {
    font-size: 13px;
    font-weight: 700;
    margin: 0 0 4px;
  }

  .op-offer-body {
    font-size: 12.5px;
    color: var(--text-dim);
    margin: 0 0 12px;
  }

  .op-offer-foot {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  /* ------------------------------------------------------------------ *
   * The launcher.
   *
   * Replaces the side panel. A 48px circle that expands LEFT into a three-button
   * pill, because it is anchored by its right edge: "right" is fixed and the width
   * animates, so the growth direction falls out of the anchoring rather than
   * needing to be animated.
   *
   * pointer-events are re-enabled per element: the host is inset:0 with
   * pointer-events:none so the app stays usable underneath.
   * ------------------------------------------------------------------ */

  .op-launcher {
    position: fixed;
    right: 48px;
    bottom: 80px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 10px;
    pointer-events: none;
  }

  .op-launcher-bar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    height: 48px;
    width: 48px;
    padding: 0;
    box-sizing: border-box;
    border-radius: 999px;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.22);
    overflow: hidden;
    pointer-events: auto;
    transition:
      width 220ms cubic-bezier(0.2, 0, 0, 1),
      padding 220ms cubic-bezier(0.2, 0, 0, 1);
  }

  .op-launcher-bar[data-state='open'] {
    width: 156px;
    padding: 0 4px;
  }

  /* Each slot is a 44px hit target. The logo is always the rightmost, so it stays
     put as the bar grows and reads as the same object throughout. */
  .op-launcher-btn {
    all: unset;
    flex: 0 0 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border-radius: 999px;
    cursor: pointer;
    color: var(--text);
    transition: background 120ms ease;
  }

  .op-launcher-btn:hover { background: var(--op-gray-3); }
  .op-root.op-dark .op-launcher-btn:hover { background: var(--op-gray-7); }

  .op-launcher-btn:focus-visible {
    outline: 2px solid var(--op-blue);
    outline-offset: -2px;
  }

  /* Hidden rather than removed while collapsed, so the width transition has
     something to reveal and focus order never changes. */
  .op-launcher-bar[data-state='collapsed'] .op-launcher-btn[data-slot='mic'],
  .op-launcher-bar[data-state='collapsed'] .op-launcher-btn[data-slot='type'] {
    opacity: 0;
    pointer-events: none;
  }

  .op-launcher-logo {
    width: 26px;
    height: 26px;
    display: block;
    border-radius: 6px;
  }

  /* Recording. The bar is back to a circle and the rings say why -- two of them,
     offset, so there is always one mid-flight. */
  .op-launcher-bar[data-recording='true'] {
    border-color: var(--op-red);
  }

  .op-launcher-ripple {
    position: absolute;
    inset: 0;
    border-radius: 999px;
    border: 2px solid var(--op-red);
    opacity: 0;
    pointer-events: none;
  }

  .op-launcher-bar[data-recording='true'] .op-launcher-ripple {
    animation: op-launcher-ripple 1600ms ease-out infinite;
  }

  .op-launcher-bar[data-recording='true'] .op-launcher-ripple:nth-child(2) {
    animation-delay: 800ms;
  }

  @keyframes op-launcher-ripple {
    0%   { transform: scale(1);   opacity: 0.55; }
    100% { transform: scale(2.1); opacity: 0; }
  }

  .op-launcher-shell {
    position: relative;
    display: flex;
    justify-content: flex-end;
  }

  /* The card above the circle: a question we need answered, or a line of reply. */
  .op-launcher-card {
    width: 320px;
    max-width: min(320px, calc(100vw - 96px));
    box-sizing: border-box;
    padding: 12px 14px;
    border-radius: 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.28);
    pointer-events: auto;
  }

  .op-launcher-card[hidden] { display: none; }

  .op-launcher-card-text {
    margin: 0;
    font-size: 13px;
    line-height: 1.45;
    color: var(--text);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .op-launcher-card-text[data-dim='true'] { color: var(--text-dim); }

  .op-launcher-form {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    margin-top: 10px;
  }

  .op-launcher-form[hidden] { display: none; }

  .op-launcher-input {
    all: unset;
    flex: 1;
    box-sizing: border-box;
    min-height: 34px;
    max-height: 120px;
    padding: 7px 9px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface-raised);
    color: var(--text);
    font-family: inherit;
    font-size: 13px;
    line-height: 1.4;
    resize: none;
    overflow-y: auto;
  }

  .op-launcher-input:focus { border-color: var(--op-yellow); }

  .op-launcher-hint {
    margin: 8px 0 0;
    font-size: 11.5px;
    color: var(--text-dim);
    min-height: 14px;
  }
`
