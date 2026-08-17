# Part 2 — Plan → Walkthrough

Owner: Skyler

> Preserved verbatim from `origin/main`'s README at the integration merge, so
> nothing in it is lost to a conflict resolution. The top-level README now covers
> the whole product; this covers the runtime half. Where the two disagree, the
> integration decisions in INTEGRATION.md win.

A Chrome extension (MV3, Vite + CRXJS) that delivers interactive guided walkthroughs for
the ObservePoint web app. It asks two questions on first visit to work out what the user
needs, then produces walkthrough plans and hands them to the page layer to run.

The app itself is **not modified**. Everything is content-script injection, so this works
against prod and staging today with no ObservePoint deploy.

## Ownership boundary

This repo currently contains **everything except the runtime**.

| Done here                                                 | Owned by Person 3 (`src/content/page-layer.js`) |
| --------------------------------------------------------- | ----------------------------------------------- |
| Onboarding: the two questions → user profile              | Resolving a step's element on the page          |
| Recipe templates + `{{parameters.*}}` hydration           | Highlighting it, rendering the step text        |
| `generatePlan(intent)` — Pipeline A working, B scaffolded | Performing clicks/keystrokes for `ai` steps     |
| "Walkthroughs" item in the app's Settings dropdown        | Detecting when a `user` step completes          |
| Picker modal, ranked by the user's stated purposes        | Stepping through, and chaining plan → plan      |
| Contextual offer toasts + suppression                     | Surviving a hard reload mid-walkthrough         |
| The floating "End Walkthrough" bar                        | `simplifyDom()` for ad-hoc generation           |

The handoff is three functions. `src/content/page-layer.js` is a stub with the full
contract, the plan/step shapes, and twelve app-specific gotchas written up — start there.

```js
startWalkthrough(plans) // ordered array of hydrated, validated plans — run in order
endWalkthrough(reason) // stop and clean up
simplifyDom() // compact actionable-element snapshot
```

And two functions provided back to it:

```js
reportState(state) // drives the floating End Walkthrough bar
reportCompleted(recipeId) // marks it Done in the picker, stops triggers offering it
```

Plans arrive already hydrated and already validated against `WalkthroughSchema`, so the
page layer never needs to touch `recipes.js` or `hydrate.js`.

## Quick start

```bash
npm install
npm run build          # or: npm run dev   (HMR; reload the extension after manifest changes)
```

Then `chrome://extensions` → enable Developer mode → **Load unpacked** → select `dist/`.

Navigate to a logged-in ObservePoint session. Onboarding fires on first visit; after that,
open **Settings (gear) → Walkthroughs**. Picking one logs the plan it would hand over and
shows the End Walkthrough bar — the rest waits on the page layer.

## Anchoring

The app already ships stable anchors that were added for Intercom Product Tours — 14
`guide-*` ids and ~103 `op-selector` attributes. `manage-cards.component.html` says so
outright:

```html
<!-- NOTE: the id "guide-create-new-audit" is used for the in-app intercom guide. -->
```

Recipes use those rather than CSS paths. Every app-coupled string lives in
[`src/shared/selectors.js`](src/shared/selectors.js) as `ANCHOR` and `ROUTE`, so there is
one file to fix when the app changes. Three traps are documented there:

- `guide-left-nav-*` ids are **duplicated** — `<global-sidebar>` (desktop) and
  `<mobile-sidebar>` are both in the DOM at once, with the wrong one hidden by a media
  query rather than removed. Scope to `global-sidebar` and gate on a non-zero rect.
- Journey report tab selectors sit on `<mat-tab>` **host** elements, which are not the
  clickable labels — Material renders those separately as `div.mat-mdc-tab`. Map by index.
  **This is the one mapping unverified against a live page.**
- `audit-setup-*` selectors land on `<mat-form-field>` **wrappers**, not inputs.

## Layout

```
src/
├── manifest.json
├── background/
│   ├── index.js            SW: message router, action.onClicked, tabs.onUpdated relay
│   ├── generate-plan.js    generatePlan(intent, pageContext?) → Pipeline A | Pipeline B
│   └── gemini.js           Gemini client — STUBBED; the single model call site
├── content/
│   ├── index.js            Boot, plan production, handoff, dev handle
│   ├── page-layer.js       ★ STUB — Person 3 owns the entire runtime
│   ├── navigation.js       history patch → op:route-change (SPA has no nav event)
│   ├── app-ready.js        Boot gate: has div#application mounted?
│   ├── settings-menu.js    Injects "Walkthroughs" into the app's Settings mat-menu
│   ├── triggers.js         Contextual offers + suppression
│   └── ui/
│       ├── host.js         Shadow-root host, theme mirroring
│       ├── styles.js       Tokens + both themes
│       ├── modal.js        Modal shell (scrim, Escape, focus trap)
│       ├── onboarding.js   The two questions
│       ├── picker.js       Walkthrough chooser
│       ├── offer.js        Contextual offer toast
│       └── end-button.js   The floating "End Walkthrough" bar
└── shared/
    ├── utils.js            Promise-wrapped storage + KEYS
    ├── messages.js         Message catalog
    ├── schema.js           WalkthroughSchema + validateRecipe
    ├── recipes.js          5 chained templates, validated at import
    ├── hydrate.js          {{parameters.*}} substitution + extraction
    ├── selectors.js        App anchors + route patterns
    └── purposes.js         The 9 ObservePoint use cases
```

## Walkthrough contract

Recipes conform to `WalkthroughSchema` and are validated at **import time**, so a typo
fails when the content script boots rather than halfway through a demo. A step:

```js
{
  id: 'network-requests-tab',
  actor: 'user',                    // 'user' waits for them; 'ai' performs the action
  navContext: '*',                  // '*' anywhere, else a path prefix
  targetSelector: ANCHOR.pdTabNetworkRequests,
  say: 'Network Requests is the raw truth…',
  optional: true,                   // skip if it never resolves (permission/feature gated)
  completion: { type: 'click', targetSelector: ANCHOR.pdTabNetworkRequests },
}
```

`completion.type` is one of `url_change`, `dom_mutation`, `dom_event`, `click`.

Onboarding hands over an **ordered array** of plans rather than one, because the user asked
for onboarding to be delivered as several short chained walkthroughs instead of one long
tour. Which recipes, and in what order, comes from the purposes they select —
see `buildChain()` in `shared/purposes.js`.

## UI layer

All injected UI mounts into a **shadow root** on a single `div` that is a direct child of
`document.body` — clean stacking context, and Angular can't tear it down when it re-renders.
`ui/host.js` exposes `getLayer(name)`; mount into that and you inherit the token set in
`ui/styles.js`, themed for both `body.dark-theme` (the app's **default**) and
`body.light-theme`.

`z-index` is `2147483000+`. The app's own SCSS ceiling is `99999` and Material's
`.cdk-overlay-container` is pinned to `1150`, but **Intercom** (loaded via GTM) injects
iframes around `2147483000` and owns the bottom-right corner. So our chrome sits top-centre
(End Walkthrough bar) and bottom-left (offer toast) — never bottom-right.

## Gemini

The architecture is complete; the two `generate*` functions in
[`src/background/gemini.js`](src/background/gemini.js) are inert, so everything is demoable
without an API key.

- **Pipeline A (templated)** works today with no model: recipe selection is keyword scoring
  against each recipe's goal and summary, parameter extraction is regex. When the model is
  wired up it does both better and this becomes the fallback.
- **Pipeline B (ad-hoc)** is scaffolded; it needs `simplifyDom()` from the page layer.

Wiring it up means `npm i @google/genai` and filling in the two marked `TODO(gemini)`
blocks. The key goes in `storage.sync` via an options page — never in source.

## Dev handle

The content script exposes `window.__opWt` in its isolated world. In DevTools, switch the
console context to the extension:

```js
__opWt.recipes // all loaded recipes
__opWt.plan('create-first-audit', { auditName: 'Q3 Privacy' }) // hydrated plan, no run
__opWt.start('orientation-left-nav') // hand one plan to the page layer
__opWt.startChain(['orientation-left-nav', 'create-first-audit'])
__opWt.ask('create an audit called Q3 Privacy') // intent → generatePlan → handoff
__opWt.picker()
__opWt.onboarding()
__opWt.statusBar({ status: 'running', goal: 'Test', currentStepIndex: 2, totalSteps: 7, say: 'Hi' })
__opWt.end()
__opWt.resetAll() // clear profile, progress, session
```

## Scripts

| Command            | Purpose                                                      |
| ------------------ | ------------------------------------------------------------ |
| `npm run dev`      | Vite dev server with HMR                                     |
| `npm run build`    | Production build into `dist/`                                |
| `npm run lint`     | ESLint (Prettier runs through it, so formatting is an error) |
| `npm run lint:fix` | Auto-fix                                                     |

House style: no semicolons, single quotes, 100 columns, `arrowParens: avoid`. Note
`curly: multi-or-nest` **forbids** braces on single-statement `if` bodies.

## Origins

Prod (including SSO subdomains) and staging:

```
https://app.observepoint.com/*
https://*.app.observepoint.com/*
https://app.observepointstaging.com/*
https://*.app.observepointstaging.com/*
https://*.observepointstaging.com/*
```

Local moonbeam dev (`http://localhost:9004/*`) is intentionally not included; add it to
`matches` and `host_permissions` in `src/manifest.json` if you want it.

`storage` is the only permission. `host_permissions` on these origins already grants
`changeInfo.url` in `tabs.onUpdated`, so no `tabs` permission is needed; the content script
is declarative, so no `scripting` either.

## Storage keys

| Key              | Area  | Owner                                                         |
| ---------------- | ----- | ------------------------------------------------------------- |
| `op_wt_profile`  | sync  | This side — onboarding answers (`wantsGuidance`, `purposes`)  |
| `op_wt_progress` | local | This side — `completedRecipes`, `seenTriggers`                |
| `op_wt_session`  | local | **Reserved for the page layer** — resume state after a reload |

`chrome.storage.session` is deliberately unused: it is not readable from content scripts
unless the worker calls `setAccessLevel`, which is a footgun not worth the trouble.
