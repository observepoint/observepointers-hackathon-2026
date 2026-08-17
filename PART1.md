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
fixtures/plan.audit-with-rules.json                    12 steps, all selectors confirmed
fixtures/plan.audit-with-consent-categories.json        9 steps, all selectors confirmed
fixtures/plan.audit-with-alerts.json                   11 steps, all selectors confirmed
fixtures/plan.audit-with-all-standards.json            13 steps, all selectors confirmed
fixtures/plan.alert-from-report.json                    6 steps
fixtures/plan.create-first-rule.json                    5 steps, all selectors confirmed
fixtures/plan.create-first-consent-category.json        5 steps
```

Start with `plan.audit-with-rules.json` — every selector in it has been confirmed
against a running moonbeam, so if your runtime fails on it the bug is yours, not
the plan's.

Then try `plan.create-first-rule.json`. It's the only shape that navigates the
sidebar and lands on a **real route**, so it's the one that exercises
`url_change` completions — the audit flows are all modals and never change the
URL, so a runtime built against those alone has never run that path.

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
      "targetSelector": "[op-selector=\"sidebar-standards-rules\"]",
      "say": "Open Tag & Variable Rules in the sidebar, under Standards…",
      "targetFallback": { "description": "the \"Tag & Variable Rules\" link under Standards" },
      "completion": { "type": "url_change", "value": "/rules/library" },
    },
    {
      "id": "s2",
      "actor": "user",
      "targetSelector": "button[aria-label=\"Create Rule\"]",
      "say": "Start a new rule.",
      "targetFallback": { "description": "the \"Create Rule\" button" },
      "completion": {
        "type": "dom_mutation",
        "condition": "visible",
        "targetSelector": "rule-name-control input",
      },
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
  `{{parameters.auditName}}` into a real form.

### One additive field, and it is no longer optional

**Every** step carries
`targetFallback: { description: "the \"Create Rule\" button" }`. That started as
a nice-to-have for screens without `op-selector` attributes. It isn't any more:
two of the six recipes are almost entirely unswept, and the report-widget
bell genuinely cannot be addressed by CSS (one bell per widget, and the class we
target only exists on widgets with no alerts yet).

So Part 3 should resolve `targetFallback.description` against visible text when
`targetSelector` misses. A test asserts no step ever ships without one, so you
can rely on it being there.

---

## For Part 3: what I found in moonbeam

Six things that will save you a day each.

**1. Half the `op-selector`s are invisible to grep.** A literal search for
`op-selector="` finds ~163. But many are bound dynamically —
`[attr.op-selector]="OP_SELECTORS.name"` — with the values in `*.constants.ts`
enums. `EAuditSetupOpSelectors`, `QuickCreateOpSelectors`, `RuleSetupOpSelectors`
and others only turn up if you grep the TypeScript too. Coverage is meaningfully
better than it first looks.

**2. `op-selector` sits on the wrapper, not the control.** ObservePoint's design
system puts it on `op-text-input` / `op-button` / `op-textarea`, so:

```
fill_text  →  [op-selector="audit-setup-starting-urls-textarea"] textarea
fill_text  →  [op-selector="quick-create-name"] input
```

`op-button` binds Angular's `(buttonClick)`, so a synthetic click on the host
element does nothing. You have to hit the real `button` inside.

**But it is not a rule — it's a per-template fact, and guessing costs you a
selector that never resolves.** Every modal footer button
(`quick-create-save-button`, `rule-setup-save-btn`, `cc-create-save`) goes
through `op-modal-footer-buttons`, which binds `[attr.op-selector]` **straight
onto the `<button>`**; so does `cc-name`, onto its `<input matInput>`. A trailing
` button` on those looks for a button inside a button. That was a real bug in
this repo. There's a test pinning the ones we've read; add to it when you read
another.

**3. The audit flows never change the URL.** Both audit setup screens are modals
(`audit-setup-modal` → `op-audit-editor`), so every completion in those recipes
is `dom_mutation` / `dom_event`. If you build URL-watching first, it will look
like the walkthrough hangs.

**4. Tabs can carry `op-selector`, and mostly don't yet.** `op-tabs` renders
`[attr.op-selector]="tab.opSelector"`, but neither the audit editor nor the
standards tab sets it upstream. There's a local moonbeam patch adding five of
them (`audit-tab-standards`, `standards-tab-rules` /
`-consent-categories` / `-alerts`) — worth landing, but **the extension no longer
depends on it.**

The two main editor tabs fall back positionally:

```
[op-selector="audit-tab-standards"], .op-audit-editor .op-tabs:not(.sub-menu) .op-tab:nth-child(4)
```

That is safe **only because both halves resolve to the same element** — the
attribute sits on the very tab the position picks, and `generateTabs()` emits all
six tabs unconditionally. Don't copy the pattern blind; a comma list whose halves
can match different elements is a coin toss.

The three **standards sub-tabs** deliberately get no positional fallback.
`createTabs()` builds them with `unshift()` and drops Consent Categories when
privacy is off, so no index is right in both layouts — a fallback there would
point confidently at the wrong tab, which is worse than pointing at nothing. They
rely on `targetFallback.description` instead.

**5. Sidebar links are the most reliable selectors in the app.** Every one comes
from `opLinkSelectorMap` in `sidebar.constants.ts` — `sidebar-standards`,
`sidebar-standards-rules`, `sidebar-standards-consent-categories`,
`sidebar-alerts`, and ~70 more. Nothing positional, no patch needed. Note that
**The sections are always expanded, and that matters.** `global-sidebar-link` has
a `mat-expansion-panel` branch, but nothing reaches it: `app.component.ts:149` is
`readonly showTopNavBar = true`, hardcoded, and that feeds
`[alwaysExpanded]`. So every sub-link is in the DOM from first paint.

This cost us a step that hung. The starter recipes used to open Standards first
and wait for `dom_mutation` / visible on the library link — a link that was
already visible, and a mutation observer never fires for an element that does not
change. **If you are debugging a step that never completes, check whether it is
waiting for something already on screen.** Reading the template found the branch;
it took someone saying "Standards is always expanded" to notice which branch runs.

One caveat left: `always-expanded-body` is gated on `!sidebarIsClosed`, so on the
collapsed icon rail the sub-links genuinely are absent.

**6. `op-button-2021` binds `aria-label` from `labelText`.** So a button with no
`op-selector` is still reachable semantically — `button[aria-label="Create Rule"]`
— which beats an `:nth-child` every time.

---

## Running it

```bash
npm install
npm run build      # then load dist/ at chrome://extensions
npm test           # 269 checks, no API key, no network
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

### It can be corrected mid-conversation

```
> Check compliance for gap.com in the United States
< [a nine-step plan]
> Can i do it for Canada instead
< Updated the plan. [same plan, Canadian categories, gap.com kept]
```

That second message is unmatchable on its own — there is no Canada recipe — and
it used to come back "not covered by any of the available recipes". So a
follow-up inherits the previous plan's recipe and parameters, and its own text
becomes the goal: **replacement, not accumulation**, or both regions would match
and the narrowing would mean nothing. `src/planner/amend.js`.

Pass the last plan as `options.previous` to enable it. Three behaviours worth
knowing:

- If the follow-up matches a recipe on its own, that wins — "actually alert me
  when it breaks" switches recipes and carries the site over.
- Derived values recompute. Change the site and the audit name follows it; a name
  the user typed survives, because it doesn't equal what its own `derive` would
  produce.
- **It's gated.** Inheriting on every unmatched message would be worse than the
  bug — ask "what is the weather in Utah" after a plan and you'd get a consent
  walkthrough for Utah. Only explicit edit phrasing ("instead", "actually",
  "what about") or a short bare value that fits a parameter counts. There's a
  test for the Utah case.

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

| Recipe                          | Covers                                         | Verified     |
| ------------------------------- | ---------------------------------------------- | ------------ |
| `audit_with_rules`              | Audit + Tag & Variable Rules                   | ✅ all steps |
| `audit_with_consent_categories` | Audit + Consent Categories (privacy/GDPR)      | ✅ all steps |
| `audit_with_alerts`             | Audit + Alerts                                 | ✅ all steps |
| `audit_with_all_standards`      | One audit, all three Standards sub-tabs        | ✅ all steps |
| `alert_from_report`             | "Alert me when X breaks", from a report widget | ⚠️ 0/6 swept |
| `create_first_rule`             | Fill an empty rule library                     | ✅ all steps |
| `create_first_consent_category` | Fill an empty consent category library         | ⚠️ 4/5 swept |
| `create_first_alert`            | Fill an empty alerts library                   | ⚠️ 0/6 swept |

The three audit recipes share `src/planner/recipes/_audit-standards.js`, because
in moonbeam they aren't three flows — they're three sub-tabs of one Standards
tab, all rendering the same `op-standards-selector`. Fix that shared path once
and all three improve. The two starters share `_standards-library.js`.

**Two things sweeping taught us that reading the source did not.**

**Asking for two of the three means you asked for both.** Keyword scoring cannot
see that: _"check our tags still fire, only approved cookies drop before consent, and
alert me if either breaks"_ names all three concepts and not one of them by its
product name, so it scored highest on whichever area happened to share the most words
— and answering with one silently drops the rest.

So the evidence is read **across** recipes. `AREA_SIGNALS` in `match.js` holds the
distinctive vocabulary of each area, and two or more matches routes to
`audit_with_all_standards`. That is deliberately separate from the recipes' own
keyword lists, which answer a different question: `audit_with_rules` claims _"set up
an audit"_ so a bare audit request lands somewhere sensible, but that phrase says
nothing about rules — counting it here would read the alerts onboarding goal as two
areas. If `AREA_SIGNALS` ever grows past a line per area, the honest move is a model
call rather than a longer regex.

**All three Standards plan against the live account, not just consent.** Consent
categories got it first because CMP groups carry a domain to match on. Rules and
alerts have no site — a rule is about a tag, not a domain — so the signal is
popularity inside the account:

|         | signal                                            | recommendation                             |
| ------- | ------------------------------------------------- | ------------------------------------------ |
| Rules   | `usageCount` (`/api/v2/rules?withUsages=true`)    | the rule your other audits already check   |
| Alerts  | `subscribedCount` (`POST /api/v3/alerts/library`) | the alert most people already watch        |
| Consent | `cmpDomain` + `cmpGeo`                            | the category covering this site and region |

All three share the same three branches: **unreadable** → hedge and name nothing;
**empty** → creating one _is_ the plan; **populated** → prefill the top one and say
how many others there are. Unreadable is never treated as empty.

> The alerts library is a **POST** (filters in the body). The worker therefore
> supports POST — behind an **allowlist of exactly one path**. A GET-only bridge
> bounds the worst case to reading the account; a general POST proxy would let a bug
> in the panel write to it with the user's token. Add to `POST_ALLOWLIST` only for
> reads.

**OneTrust-imported category names carry their geography.** They come through as
`Analytical Cookies | example.com | Canada, Alberta` — domain, country, state — so
the country is _in the name_, and typing the country is the filter that matches how
they are actually organised. That is why the picker search fills:

| the user says           | typed              | why                                 |
| ----------------------- | ------------------ | ----------------------------------- |
| "for Canada" (3 match)  | `Canada`           | the country; they pick the province |
| "for Alberta" (1 match) | the full name      | nothing to choose                   |
| no region               | the most-used name | a concrete recommendation           |

Never a two-letter code. `US` typed into a picker that matches on substring hits
most of the names in the account — a live run filtered to 67 of 79 that way.

_A ✓ can be the wrong element._ On the Consent Categories create menu,
`.mat-menu-op-button-2021 button[mat-menu-item]` reported _visible_ while
pointing at "Import Category Data from Template" instead of "Create a New
Consent Category". A selector that resolves to the wrong control is worse than
one that misses: the miss falls through to `targetFallback`, the wrong hit walks
the user into an import dialog. Read the text the checker echoes back — that echo
is the only reason it was caught.

_"in DOM but hidden" is a finding, not a near miss._ `cc-create-next` and
`cc-create-save` both came back hidden on the consent-category create screen. Not
a timing problem: `initFooterButtons()` hides five of that modal's **eight**
footer buttons on the create path, and the button we actually wanted was a third
one, "Create without selecting a report". `cc-create-save` was also on two
buttons at once, so it resolved to the hidden one — fixed on the moonbeam branch.
Reading the template found all eight; only the sweep said which was on screen.

"Verified" means somebody stood on the screen and pressed **Check screen**, not
that the selector was read out of moonbeam source — every selector in this
library was read out of the template that renders it, and that is a weaker claim
than having looked. A selector that is right in the source and absent from the
DOM (wrong screen, feature flag off, conditional block) fails exactly like a
wrong one.

Unswept steps are marked `unverified: true` by `unswept()` in
`recipes/_unswept.js`, which also records what has actually been looked at and
how to clear a flag. It is applied per step, not per recipe:
`create_first_consent_category` has a swept sidebar step and five unswept ones
after it, and rounding that either way would be a lie in one direction. An earlier version of this had the flags
hand-placed and they had already drifted — two of these recipes were claiming
verified steps nobody had seen.

### Three things the recipes encode that aren't obvious

**Audits start from the sidebar, not from Data Sources.** The audit path used to
open the Data Sources page's Create button, scoped to `navContext: '/sources'` — so
a plan begun anywhere else stopped to tell the user to navigate first. The
walkthrough's opening act was a chore.

The sidebar's **Create New** opens the same `NewDataModalComponent` from every
screen, so that step is gone rather than explained. `navContext: '*'`, no
prerequisite popup, and it survives a collapsed sidebar (only
`always-expanded-body` is gated on that; Create New is a top-level item).

Two things found doing it:

- **`#guide-left-nav-create-new` does not exist.** `global-sidebar.component.ts`
  sets an `id` on its link objects, but `global-sidebar-link.component.html` never
  binds one — those ids live only in the TypeScript. Use the `opLinkSelectorMap`
  names: `[op-selector="sidebar-create-new"]`. Part 2's `ANCHOR.navCreateNew` reaches
  for the dead id.
- **The two routes branch differently.** `new-data-modal`'s `createAudit()` checks
  `useAdvancedAuditMode()` alone; `manage-cards`' `createWebAudit()` _also_ opens
  Quick Audit when the account has no data sources. So the sidebar route lands in the
  advanced editor more often — which changes nothing here, because the switch step is
  optional rather than predicted.

**Create → Audit opens one of two different screens, and it's an OR.**

```ts
// manage-cards.component.ts::createWebAudit()
totalCardsCount === 0 || useAdvancedAuditMode() !== true ? openQuickAudit() : openAdvancedAudit()
```

Advanced mode defaults to **on** (`storage.service.ts` returns `value ?? true`),
so an established account goes straight to the editor. But an account with **no
data sources gets Quick Audit regardless** — which is every account on day one,
i.e. exactly who this is for.

**We no longer guess which.** This used to read the audit count, predict the
modal, and emit one of two step lists. Wrong shape: a wrong prediction doesn't
degrade the walkthrough, it points at a modal that never opened — and the
prediction cost an API call per boot to produce an answer that was still
approximate, since `totalCardsCount` counts every data source card and we only
had the audits.

Instead, the **"Switch to Advanced Setup" step is `optional`**, so the runtime
skips it when it isn't on screen. In Quick Audit it resolves and the user clicks
it; in the advanced editor it's absent and the run moves on. One list, both entry
points, no account read.

Two facts make that safe rather than lucky:

- `switchToAdvancedView()` carries the URL across, so nothing typed is lost.
- Quick Audit auto-names to `"Simple Audit - <date>"`, so naming **after** the
  switch is correct either way — it either sets the name or replaces that default.

**Part 2: an `optional` step whose target is missing must be skipped, not
failed.** That is the whole mechanism, and it is the one thing this depends on.

**The audit editor is a modal, so an unsaved audit is a discarded audit.** Every
audit recipe therefore ends on `web-audit-create-save` ("Save Audit"). They used to
end on "attach it", which configures an audit and never creates one — the
walkthrough reported Complete having produced nothing, which is the worst kind of
failure because it looks like success. That step stays `actor: "user"`: the copilot
fills fields, the person commits the change.

**Alerts watch report widget data, not websites.** So an alert is only meaningful
once the audit has run at least once, and the sane way to create one is the bell
on the widget you care about (it pre-fills metric and filters) rather than the
Alerts Library.

**"Attach a standard" dead-ends on a new account.** Every audit recipe ends at a
picker, and on day one that picker is empty. That is what the two `create_first_*`
recipes are for, and why onboarding retargets to them when it can see the library
is empty.

## Known gaps

- **`alert_from_report` and the Quick Audit branch aren't swept.** Both are
  source-accurate — every selector was read out of the template that renders it —
  but nobody has watched them resolve, and on the evidence so far that is the
  weaker claim by some distance. `alert_from_report` needs an audit with a
  completed run; Quick Audit needs an account with no data sources, or advanced
  mode turned off in user settings. Stand on the screen and press **Check
  screen** — that's what clears an `unverified` flag.
- **One consent-category step is awkward rather than unvisited.** The create menu
  row (`s3`) exists only while the menu is open, a state that lasts between two
  steps. It is catchable — an earlier sweep caught it, which is how we found the
  selector was pointing at the wrong row — it just needs Check screen pressed
  with the menu still up. Everything either side of it is confirmed.
- **The report bell is per-widget, and we can't say which one.**
  `.create-new-alert-icon` matches the first bell in the document, not the
  widget the user cares about, and it only exists on widgets with no alerts yet
  — otherwise the bell opens a menu and the create action is inside it. The step
  tells the user both things and waits on the dialog, so either route completes,
  but Part 3's pointer will land on the wrong widget until it can resolve
  `targetFallback.description` against nearby text.
- **No page awareness.** The planner doesn't know what screen the user is on, so
  it always plans from the start. If Part 2/3 feed the current route back in,
  recipes could skip steps the user has already done.
- **One recipe per goal.** "Set up an audit _and_ alert me when it fails" needs
  chaining, which isn't built — today it picks whichever intent matched strongest.
