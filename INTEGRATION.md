# Integrating Part 1 with Part 2

Written after a trial merge of `feat/part1-recipes` into `origin/main`, so the
numbers below are measured rather than estimated.

**The headline: this is mostly additive, not a conflict.** The two halves share
almost no protocol and almost no code. What looks like eleven conflicts is three
real ones, and two of those are "two different programs that happen to share a
filename."

---

## What actually conflicts

```
README.md              trivial
eslint.config.js       trivial
package.json           trivial — name, plus Part 1's `test` script
src/manifest.json       REAL, small — a union with three known gotchas
src/background/index.js REAL — two disjoint programs
src/content/index.js    REAL — two disjoint programs

src/options/{index.html,main.js,style.css}   modify/delete
src/sidepanel/{index.html,main.js}           modify/delete
```

The five modify/deletes need no thought: `origin/main` deleted them, Part 1 needs
them, and the decision to ship both UI surfaces means **keep them.** The options
page is also the only way to enter a Gemini key — see below.

## Why background/ and content/ aren't really conflicts

**The message protocols do not overlap at all.**

```
Part 2:  INTENT_RECEIVED  PAGE_CONTEXT_UPDATED  EXECUTE_STEP  STEP_COMPLETED
         STEP_FAILED  GET_PROFILE  SAVE_PROFILE  RESET_PROFILE  LIST_RECIPES
         START_WALKTHROUGH  END_WALKTHROUGH  RUNNER_STATE_CHANGED  URL_CHANGED
         OPEN_PICKER
Part 1:  PLAN_READY  OP_ACCOUNT_STATUS  OP_CHECK_SELECTORS  OP_API_GET
         OP_AUTH_CONTEXT
```

Not one collision. So both files resolve by **concatenating responsibilities**,
not by picking lines:

- `background/index.js` — their router, plan pipeline and toolbar action, plus
  Part 1's `apiGet` / `apiBasesFor` / `fetchJson` / `ensureContentScript`.
- `content/index.js` — their page layer, plus Part 1's three handlers
  (`OP_AUTH_CONTEXT`, `OP_ACCOUNT_STATUS`, `OP_CHECK_SELECTORS`) and the helpers
  they call.

Resolving these line-by-line in a merge tool will be miserable and pointless.
Take one side whole, then paste the other side's block in.

## The seam already exists

Their runner accepts a finished plan directly:

```js
// content/index.js
case MSG.START_WALKTHROUGH:
  if (payload?.plan) pageLayer.startWalkthrough([payload.plan])
```

So Part 1's panel stops broadcasting `PLAN_READY` and sends `START_WALKTHROUGH`
with `{ plan }` instead. One line. Note it takes an **array**, which is how
`chain` runs several short walkthroughs back to back.

## The one behavioural mismatch

`executeAiAction()` switches on `'click' | 'input' | 'scrollIntoView'`. Part 1
emits `fill_text`, which means exactly what their `input` does — descend to
`input, textarea, select`, set the value, fire `input` and `change`.

**Fixed** in `content/page-layer.js` — `case 'fill_text':` falls through to
`case 'input':`. Accepting both names is cheaper than renaming it across six
recipes and every committed fixture, and Part 1's `ACTION_TYPES` accepts Part 2's
names too.

## Two things the merge surfaced that neither side knew

**1. `dom_mutation` resolved instantly for a target that wasn't there yet.**
`waitForCompletion()` did `const target = document.querySelector(...); if (!target)
return resolve()`. Part 1's plans depend on the opposite: the step that opens the
audit editor names a selector that _does not exist yet_, so the run advanced to the
next step before the modal opened. `condition: 'visible'` now means "wait for it to
appear" and is honoured; absent still means "watch a node already present", which is
what Part 2's recipes want. Both behaviours, one field.

That also settled a schema argument in Part 2's favour: `condition` was _required_
in Part 1's validator, which would have forced the field into three of Part 2's five
recipes for something their own runtime ignored. What mattered was never the field —
it was that the runtime distinguishes the two cases.

**2. `chrome.action.onClicked` no longer fires.** While
`setPanelBehavior({ openPanelOnActionClick: true })` is set, Chrome opens the side
panel and that listener never runs — so the toolbar can't open the picker. Kept
rather than deleted: it goes live the moment the flag is flipped, and the picker
already has a better entry point than a toolbar icon in the "Walkthroughs" item
Part 2 added to the app's own Settings menu.

## Validated in both directions

After the merge, every recipe on each side passes the _other_ side's validator:

```
Part 2 recipes -> Part 1 validator      5/5 ok
Part 1 fixtures -> Part 2 validator     6/6 ok
```

## Three things in the manifest that will bite

1. **`localhost` is missing from `content_scripts.matches`** on `origin/main`.
   All of Part 1's selector verification was done on `localhost:9004`; without
   this the extension does not inject on a local moonbeam at all.
2. **The Gemini host is missing from `host_permissions`.** A worker fetch to
   `generativelanguage.googleapis.com` will be blocked, so wiring up
   `background/gemini.js` cannot work until it is added.
3. `sidePanel`, `activeTab`, `tabs` and `scripting` are all absent and all
   needed — side panel, on-demand injection, and reading the active tab's URL.

## The API key has no way in

`background/gemini.js` reads `op_wt_gemini_key` from `storage.sync`, and
**nothing ever calls `setApiKey`** — the options page that was the only entry
point was deleted. So `getApiKey()` always returns undefined and both generate
functions return `null` regardless of what else is wired.

Restoring `src/options/` fixes it. Pick one storage key name and use it in both
places; Part 1 currently uses `geminiApiKey`.

## What Part 1 brings that has no equivalent on main

Worth knowing so it doesn't get dropped in a resolution:

- **A working Gemini client** with runtime model discovery. Part 2's TODO
  hardcodes `model: <latest Gemini model id>`; that exact class of constant
  already 404'd once with "no longer available to new users". There is also an 8s
  deadline on both calls, because the keyword fallback only fires on a throw and a
  hang throws nothing.
- **The account bridge.** Reads the signed-in account through the page's bearer
  token so a plan can say _"gap.com — us,ca already covers this site"_ instead of
  _"search for the category"_. `origin/main` makes no API calls at all.
- **`Check screen`.** Verifies a plan's selectors against the screen in front of
  you. This is what caught five wrong selectors that reading the Angular source
  had missed — including two hidden buttons, a duplicate `op-selector`, and a menu
  row that resolved to the wrong item.
- **216 tests.** `origin/main` has none and no `test` script.
- **Mid-conversation edits.** "Can I do it for Canada instead" amends the last
  plan rather than being read as a fresh, unmatchable request.

## What main brings that Part 1 never had

- The runtime. Part 1's Part-2 stub was a `console.log`.
- `shared/selectors.js` — one file, with reasoning Part 1 lacked: the
  `<mobile-sidebar>` id duplication, and the mat-menu panel being destroyed on
  every close.
- `optional` and `chain`, both now in Part 1's schema too.
- The settings-menu entry point, which is better product thinking than a toolbar
  icon.

Two of their anchors are wrong, with sweep evidence:

| Anchor                                                           | Problem                                                                                                                                              |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auditName: '[op-selector="audit-setup-name"]'`                  | Swept **not found** on the advanced editor. The real one is `audit-editor-header-name-control input`. Quick Audit has no name field at all.          |
| `navConsentPreferences: 'sidebar-standards-consent-preferences'` | **Never rendered.** `global-sidebar` only calls `getOpLinkAttr('consent-categories')`. The live attribute is `sidebar-standards-consent-categories`. |

## Suggested order

Doing UI first is tempting and wrong — both surfaces read the schema, so it
churns twice.

1. **Schema.** Already unioned in `src/planner/schema.js`; every difference and
   its resolution is documented at the top of that file. One person lands it.
2. **Selectors.** Their file, Part 1's verified values, Part 1's `unverified`
   discipline.
3. **Recipes.** Both libraries side by side. No id collisions, so nothing forces a
   merge; dedupe only the audit-creation overlap.
4. **Runtime wiring.** `START_WALKTHROUGH`, the `fill_text` case, the manifest.
5. **UI.** Panel and overlay, one onboarding between them.

## File ownership

| File                      | Owner  | Why                                                                                        |
| ------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| `src/content/index.js`    | Part 2 | Four of their five new modules attach here. Part 1's additions arrive as a block to paste. |
| `src/background/index.js` | Part 1 | Holds the API bridge and the CORS reasoning, and is where the model client is going.       |
| `src/manifest.json`       | Part 1 | Small file, high blast radius, three known gotchas above.                                  |

Whoever has the reasoning in comments should own the file — that is what gets
silently lost in a conflict resolution.
