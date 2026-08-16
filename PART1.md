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
fixtures/plan.audit-with-rules.json               10 steps
fixtures/plan.audit-with-consent-categories.json  10 steps
fixtures/plan.audit-with-alerts.json              10 steps
fixtures/plan.alert-from-report.json               6 steps
fixtures/plan.create-api-key.json                  7 steps, fully verified
```

Start with `plan.create-api-key.json` — it's the only one whose selectors are all
confirmed, so if your runtime fails on it the bug is yours, not the plan's.

`npm run fixtures` regenerates them. They come out of the live recipes on
purpose — a hand-written fixture drifts the moment someone edits the schema, and
then you're coding against a shape that no longer ships.

**You are not blocked on me.** Nothing in Part 2 needs the planner to run.

---

## The Plan shape

Matches the design you specified. `src/planner/schema.js` is the source of
truth and every plan is validated against it before it leaves — a malformed plan
would fail inside your runtime and look like your bug.

Real output, trimmed to two steps:

```jsonc
{
  "recipeId": "create_first_rule",
  "goal": "create a rule that checks Google Analytics fires", // user's words, verbatim
  "summary": "A rule defines what \"correct\" looks like…", // one line for the chat
  "executionMode": "templated",
  "parameters": { "ruleSubject": "…", "ruleName": "Google Analytics fires on every page" },
  "steps": [
    {
      "id": "s1",
      "actor": "user", // "user" | "ai"
      "targetSelector": "[op-selector=\"sidebar-standards\"]",
      "say": "Open Standards in the sidebar.",
      "targetFallback": { "description": "the \"Standards\" section in the left sidebar" },
      // Standards is a mat-expansion-panel; its children don't exist until it opens.
      "completion": {
        "type": "dom_mutation",
        "condition": "visible",
        "targetSelector": "[op-selector=\"sidebar-standards-rules\"]",
      },
    },
    {
      "id": "s2",
      "actor": "user",
      "navContext": "/sources", // optional
      "targetSelector": "[op-selector=\"sidebar-standards-rules\"]",
      "say": "Go to Tag & Variable Rules.",
      "completion": { "type": "url_change", "value": "/rules/library" },
    },
  ],
}
```

`npm run plan -- "your goal here"` prints one of these for any goal.

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

Four things that will save you a day each.

**1. Half the `op-selector`s are invisible to grep.** A literal search for
`op-selector="` finds ~163. But many are bound dynamically —
`[attr.op-selector]="OP_SELECTORS.name"` — with the values in `*.constants.ts`
enums. `EAuditSetupOpSelectors`, `QuickCreateOpSelectors`, `RuleSetupOpSelectors`
and others only turn up if you grep the TypeScript too. Coverage is meaningfully
better than it first looks.

**2. `op-selector` sits on the wrapper, not the control.** ObservePoint's design
system puts it on `op-text-input` / `op-button` / `op-textarea`, so:

```
fill_text  →  [op-selector="api-keys-create-name"] input
click      →  [op-selector="api-keys-create-submit"] button
```

`op-button` binds Angular's `(buttonClick)`, so a synthetic click on the host
element does nothing. You have to hit the real `button` inside. Recipes already
follow this.

**3. The audit flows never change the URL.** Both audit setup screens are modals
(`audit-setup-modal` → `op-audit-editor`), so every completion in those recipes
is `dom_mutation` / `dom_event`. If you build URL-watching first, it will look
like the walkthrough hangs.

**4. Tabs can carry `op-selector` but currently don't.** `op-tabs` renders
`[attr.op-selector]="tab.opSelector"`, and neither the audit editor nor the
standards tab sets it. **Adding it is 4 lines and makes all three audit recipes
verified** — worth doing before demo day:

```ts
// audit-editor.component.ts  generateTabs()
{ name: …, path: EAuditTab.standards, opSelector: 'audit-tab-standards' }

// standards-tab.component.ts  this.tabs = [ … ]
opSelector: 'standards-tab-rules' | 'standards-tab-consent-categories' | 'standards-tab-alerts'
```

---

## Running it

```bash
npm install
npm run build      # then load dist/ at chrome://extensions
npm test           # 59 checks, no API key, no network
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

### First run asks one question

An empty chat box assumes you already know what ObservePoint can do — which is
the exact problem this project exists to fix. So the first thing a new user sees
is a question with four answers, and picking one goes **straight to a plan**. No
recommendation screen, no tour, no settings page.

`src/planner/onboarding.js`. Two properties worth preserving:

- **An option is just a sentence.** Each carries a `goal` string that is fed
  into `createPlan()` exactly as if it had been typed, so onboarding shares one
  planning path with everything else. A test asserts every option's goal still
  reaches the recipe it claims — reword a label and you find out immediately.
- **It retargets on an empty account.** Three of the audit recipes end in "pick
  from your library". On a fresh account those libraries are empty and the
  walkthrough dead-ends, so when we can see there is nothing there, the option
  silently switches to the recipe that creates the first one. An account we
  _couldn't read_ never counts as empty — that direction would send someone with
  a full library off to build a duplicate.

The answer is stored in `chrome.storage.local` under `onboarding` and biases the
suggestion chips on later runs (reorder, never filter).

**Seam:** Part 1 owns the question and the stored answer. If Part 2 wants a
guided tour of the app itself, it reads the same key and decides for itself.

### It asks rather than guesses

```
> set up an audit that checks my tag rules
< The site or starting URL to audit? For example: https://www.example.com
> https://www.example.com
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

## The recipe library

Focused on audits and the three things you attach to them, plus the two starter
flows for an account that has none of them yet.

| Recipe                          | Covers                                         | Verified           |
| ------------------------------- | ---------------------------------------------- | ------------------ |
| `audit_with_rules`              | Audit + Tag & Variable Rules                   | ✅ all steps       |
| `audit_with_consent_categories` | Audit + Consent Categories (privacy/GDPR)      | ✅ all steps       |
| `audit_with_alerts`             | Audit + Alerts                                 | ✅ all steps       |
| `alert_from_report`             | "Alert me when X breaks", from a report widget | ⚠️ 2 steps unswept |
| `create_first_rule`             | Fill an empty rule library                     | ⚠️ needs a sweep   |
| `create_first_consent_category` | Fill an empty consent category library         | ⚠️ 3 steps unswept |

The three audit recipes share `src/planner/recipes/_audit-standards.js`, because
in moonbeam they aren't three flows — they're three sub-tabs of one Standards
tab, all rendering the same `op-standards-selector`. Fix that shared path once
and all three improve. The two starters share `_standards-library.js`.

"Verified" means somebody stood on the screen and pressed **Check screen**, not
that the selector was read out of moonbeam source. Every step still marked
`unverified: true` is one the pointer may miss.

### Three things the recipes encode that aren't obvious

**Advanced is the default, not Quick Audit.** `storage.service.ts` returns
`value ?? true`, so Create → Web Audit opens the advanced editor unless the user
explicitly turned advanced mode off (or the account has no data sources at all).
An earlier version of this file claimed the opposite and the recipes were built
backwards; a live sweep settled it. Both paths are built, branching on
`account.advancedAuditMode`.

**Alerts watch report widget data, not websites.** So an alert is only meaningful
once the audit has run at least once, and the sane way to create one is the bell
on the widget you care about (it pre-fills metric and filters) rather than the
Alerts Library.

**"Attach a standard" dead-ends on a new account.** Every audit recipe ends at a
picker, and on day one that picker is empty. That is what the two `create_first_*`
recipes are for, and why onboarding retargets to them when it can see the library
is empty.

## Known gaps

- **`alert_from_report` and the two starters aren't fully swept.** `alert_from_report`
  needs an audit with a completed run to reach its report widgets; the starters
  need someone to walk the rule and consent-category builders. Stand on the
  screen and press **Check screen** — that's what clears an `unverified` flag.
- **The Quick Audit branch is untested**, since advanced is the default. It's
  reachable by turning advanced mode off in user settings.
- **No page awareness.** The planner doesn't know what screen the user is on, so
  it always plans from the start. If Part 2/3 feed the current route back in,
  recipes could skip steps the user has already done.
- **One recipe per goal.** "Set up an audit _and_ alert me when it fails" needs
  chaining, which isn't built — today it picks whichever intent matched strongest.
