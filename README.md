# ObservePoint Copilot

Ask for an outcome. Get walked through it, in the app, with a cursor pointing at
the next thing to click.

```
"check our site for privacy compliance, gap.com"
  → a 9-step walkthrough that names the consent category your account
    already has for gap.com, and points at the control that attaches it
```

ObservePoint is powerful and has a steep first hour. This is an attempt at
removing that hour: instead of learning where audits, rules, consent categories
and alerts live and how they hang off each other, you say what you want and get
shown.

## Three parts, one contract

The work splits cleanly, and the seam between the halves is a single message.

| Part                       | Owner | Does                                                                                       |
| -------------------------- | ----- | ------------------------------------------------------------------------------------------ |
| **1 — intent → plan**      | Jun   | Turns a sentence into a validated `Plan`: ordered steps, real selectors, who does each one |
| **2 — plan → walkthrough** |       | Consumes the `Plan`, drives the steps, advances when the user completes one                |
| **3 — the pointer**        |       | The travelling cursor, and resolving a step's target on the page                           |

```js
// The entire integration surface.
chrome.runtime.onMessage.addListener(message => {
  if (message.type === 'PLAN_READY') startWalkthrough(message.plan)
})
```

Part 2 does not import from Part 1 and does not need to know a model was
involved. **[PART1.md](PART1.md) is the contract doc** — read that before
building against the plan shape. Real plans are committed under `fixtures/`, so
Parts 2 and 3 are never blocked on the planner running.

## Design decision worth knowing up front

**The model does not invent plans. It picks a recipe and fills in the blanks.**

An open-ended planner confidently produces ObservePoint configurations that don't
exist, because it has no idea whether an alert hangs off an audit, a rule or a
journey. So the steps, the order and the selectors are authored by us, in
`src/planner/recipes/`. The model's only job is matching intent and pulling out
parameters the user actually supplied.

Consequence: **coverage is the product.** Whatever isn't in the recipe library,
the assistant handles badly. Adding a recipe is the highest-value contribution
anyone can make.

**The copilot never clicks anything that creates or changes an object.** It fills
text fields; every save, every create, every attach stays with the user. That's a
deliberate line, not a limitation we haven't got to yet.

## Running it

```bash
npm install
npm run build      # then load dist/ at chrome://extensions
npm test           # 196 checks, no API key, no network
```

Open the side panel from the toolbar icon. Type, or click the mic — **voice sends
on silence, no Enter needed.**

An API key is optional. Without one the planner matches on keywords and still
produces real plans for common phrasings, which means you can develop all
weekend without touching a quota. Add a [Gemini
key](https://aistudio.google.com/apikey) in Options for better handling of
unusual phrasings.

> The key lives in `chrome.storage.sync`. Fine for a build we each run locally,
> **not shippable** — anyone can unpack a published extension and read it. The
> real fix is a backend proxy.

## Handy scripts

```bash
npm run plan -- "alert me when checkout breaks"   # print a plan in the terminal
npm run fixtures                                  # regenerate fixtures/
npm run lint
```

## Layout

```text
src/
├── planner/          # Part 1. Pure JS, no chrome APIs except storage — testable in node
│   ├── recipes/      # THE LIBRARY. Read recipes/index.js first.
│   ├── onboarding.js # The first-run question
│   ├── account.js    # Reads the signed-in account so plans can name real objects
│   ├── schema.js     # The Plan contract, and the validator every plan passes
│   └── match.js      # intent → recipe, with and without a model
├── sidepanel/        # The chat surface. input.js is the voice/text seam.
├── content/          # On-page: reads the session token, describes the screen,
│                     # verifies selectors. Part 2's walkthrough lands here.
│                     # Injected only on ObservePoint hosts + localhost, not
│                     # <all_urls>.
├── background/       # Service worker. Cross-origin API calls happen here, not
│                     # in the content script — page CORS blocks those.
├── options/          # API key
└── shared/           # storage helpers
```

## Docs

- **[PART1.md](PART1.md)** — the plan contract, what I found reading moonbeam,
  and the known gaps. Start here.
- `src/planner/recipes/index.js` — how to add a recipe.
- `src/planner/recipes/_unswept.js` — what "verified" means here, and what has
  actually been looked at.
