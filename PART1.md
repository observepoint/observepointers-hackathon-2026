# Part 1 — Intent → Plan

Owner: Jun

Takes what the user asks for ("I want to be alerted when checkout breaks") and
produces a **Plan**: an ordered list of steps Part 2 can walk them through.

```
user speaks or types  →  planner  →  Plan JSON  →  PLAN_READY  →  Part 2
```

---

## For Part 2: the only two things you need

**1. Listen for the plan.** That's the whole integration surface.

```js
chrome.runtime.onMessage.addListener(message => {
  if (message.type === 'PLAN_READY') startWalkthrough(message.plan)
})
```

The background worker forwards it to the active tab too, so a content script can
listen with the same code.

**2. Build against the fixtures, not against me.** Real plans, generated from the
real recipes, committed to the repo:

```
fixtures/plan.create-api-key.json      7 steps, all selectors verified
fixtures/plan.add-rules-to-audit.json  6 steps
fixtures/plan.alert-on-failure.json    7 steps, mostly unverified selectors
```

`npm run fixtures` regenerates them. They come out of the live recipes on
purpose — a hand-written fixture drifts the moment someone edits the schema, and
then you're coding against a shape that no longer ships.

**You are not blocked on me.** Nothing in Part 2 needs the planner to run.

---

## The Plan shape

Matches the design you specified. `src/planner/schema.js` is the source of
truth and every plan is validated against it before it leaves — a malformed plan
would fail inside your runtime and look like your bug.

```jsonc
{
  "recipeId": "create_api_key",
  "goal": "I need an API key called \"CI bot\"", // user's words, verbatim
  "summary": "We'll open API Keys, start a new key…", // one line for the chat
  "executionMode": "templated",
  "parameters": { "keyName": "CI bot" },
  "steps": [
    {
      "id": "s1",
      "actor": "user", // "user" | "ai"
      "navContext": "/account/api-keys", // optional
      "targetSelector": "[op-selector=\"top-nav-api-keys\"]",
      "say": "API keys live under your account menu.",
      "completion": { "type": "url_change", "value": "/account/api-keys" },
    },
  ],
}
```

Guarantees the validator enforces, so you don't have to defend against them:

- `steps` is non-empty and every `id` is unique.
- `actor: "ai"` **always** has an `action`; `actor: "user"` **never** does.
  (Otherwise both of you act on the same control.)
- `fill_text` and `select_option` always carry `action.value`.
- Every `completion` has the fields its own type needs — a `url_change` always
  has a `value`, a `dom_mutation` always has a `targetSelector` and `condition`.
  Without this a step gives your runtime nothing to wait on and stalls silently.
- **No `{{placeholders}}` survive.** An unsubstituted one would have you typing
  `{{parameters.keyName}}` into a real form.

### One additive field

Some steps carry `targetFallback: { description: "the button to create a rule" }`.
**Ignore it for now** — it costs you nothing. It exists because CSS selectors
break on screens without `op-selector` attributes, and Part 3's pointer can
already resolve a plain description. Wire it up only if selector misses become a
problem.

---

## For Part 3: what I found in moonbeam

Two things that will save you a day.

**1. `op-selector` coverage is lopsided.** There are ~163, and they're
concentrated in top-nav, api-keys, archived-items, and report tabs. **Alert and
rule _creation_ screens have none.** Recipes touching those are marked
`unverified: true` per step, and the plan carries a warning. Where you see one,
the pointer will miss — fix it by adding an `op-selector` in moonbeam (one line)
rather than by writing a fragile CSS path.

**2. `op-selector` sits on the wrapper, not the control.** ObservePoint's design
system puts it on `op-text-input` / `op-button` / `op-textarea`, so:

```
fill_text  →  [op-selector="api-keys-create-name"] input
click      →  [op-selector="api-keys-create-submit"] button
```

`op-button` binds Angular's `(buttonClick)`, so a synthetic click on the host
element does nothing. You have to hit the real `button` inside.

Recipes already follow this convention.

---

## Running it

```bash
npm install
npm run build      # then load dist/ at chrome://extensions
npm test           # 51 checks, no API key, no network
npm run fixtures   # regenerate fixtures/ after editing a recipe
```

Open the side panel from the toolbar icon. Type or click the mic — **voice sends
on silence, no Enter needed.**

### The API key is optional

With no key the planner matches on keywords and still produces real plans for
common phrasings. That is deliberate:

- You two can develop all weekend without touching a quota.
- The demo survives running out of free-tier tokens ten minutes before we
  present, which is not hypothetical.

Add a [Gemini key](https://aistudio.google.com/apikey) in Options for better
understanding of unusual phrasings. Stored in `chrome.storage.sync` — fine for a
hackathon build we each run locally, **not** shippable, since anyone can unpack a
published extension and read it. Real fix is a backend proxy.

---

## How planning actually works

**The model does not invent plans. It picks a recipe and fills in the blanks.**

An open-ended planner confidently produces ObservePoint configurations that don't
exist, because it has no idea whether an alert hangs off an audit, a rule, or a
journey. So the model's job is only:

1. Match the goal to one of the recipes in `src/planner/recipes/`.
2. Extract parameter values the user actually supplied.

Everything else — the steps, the order, the selectors — is authored by us.

**Coverage is the product.** Whatever isn't in the recipe library, the assistant
handles badly. Adding a recipe is the highest-value contribution anyone can make
this weekend; `src/planner/recipes/index.js` explains how.

### It asks rather than guesses

```
> alert me when the purchase tag stops firing
< The page or site to watch? For example: https://www.example.com/checkout
> https://shop.example.com
< [plan]
```

If a required parameter is missing, `createPlan` returns `needs_input` with one
question instead of inventing a value. A fabricated URL would get typed into a
real form by Part 2 — silently wrong is worse than visibly incomplete.

### API

```js
import { createPlan, answerAndRetry } from './src/planner/index.js'

const result = await createPlan(goal)
// { status: 'plan',        plan, warnings[] }
// { status: 'needs_input', question, recipeId, missing[], draftParameters }
// { status: 'no_match',    message, suggestions[] }
// { status: 'error',       message }

// after the user answers a needs_input question:
const plan = answerAndRetry(result, answer, goal)
```

`createPlan(goal, { forceLocal: true })` skips the model entirely — that's what
the tests use.

---

## Known gaps

- **Only 3 recipes.** `create_api_key` is fully verified end to end. The other
  two need a human to walk the flow and paste real selectors in.
- **`alert_on_rule_failure` is the pitch and the weakest link.** It's the flow we
  demo, and 5 of its 7 steps use guessed selectors. Highest-priority fix.
- **No page awareness.** The planner doesn't know what screen the user is on, so
  it always plans from the top. Part 2/3 could feed the current route back in.
- **One recipe per goal.** "Set up an audit _and_ alert me when it fails" needs
  chaining, which isn't built.
