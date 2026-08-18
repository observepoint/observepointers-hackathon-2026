// ============================================================================
// PAGE LAYER — STUB. This module is owned by Person 3.
// ============================================================================
//
// Everything below is a placeholder. The rest of the extension is finished and calls
// into these three functions; none of them do anything yet.
//
// The split:
//
//   This side (done)          Produces a walkthrough plan and the extension chrome.
//                             Onboarding asks the two questions, the picker lets you
//                             choose, both hand over a fully hydrated plan.
//
//   Your side (this file)     The entire runtime. Given a plan, walk its steps: find
//                             each element, highlight it, show the text, perform clicks
//                             and keystrokes for 'ai' steps, notice when the user has
//                             done a 'user' step, move to the next one, and handle the
//                             queue surviving a page reload.
//
// You receive plans already hydrated — `{{parameters.auditName}}` is substituted before
// it reaches you, and every plan has been validated against WalkthroughSchema. So you
// never need to touch shared/recipes.js or shared/hydrate.js.
//
// ---------------------------------------------------------------------------
// WHAT YOU NEED TO IMPLEMENT
// ---------------------------------------------------------------------------
//
//   startWalkthrough(plans)   An ORDERED ARRAY of plans. The picker passes one; the
//                             onboarding flow passes several, because the user asked for
//                             onboarding to be delivered as multiple short chained
//                             walkthroughs rather than one long tour. Run them in order,
//                             one after another.
//
//   endWalkthrough(reason)    Stop immediately and clean up: highlights, tooltips,
//                             observers, listeners, stored session. Called when the user
//                             hits "End walkthrough" in the status bar. Safe to call when
//                             nothing is running.
//
//   simplifyDom()             Compact snapshot of actionable elements, for ad-hoc
//                             (AI-generated) walkthroughs. See the shape below.
//
// ---------------------------------------------------------------------------
// WHAT YOU GET FROM THIS SIDE
// ---------------------------------------------------------------------------
//
//   reportState(state)        Drives the "End Walkthrough" status bar that floats above
//                             the app. Call it whenever your state changes and the bar
//                             updates itself. Passing { status: 'idle' } hides it.
//                             Shape: { status, goal, currentStepIndex, totalSteps, say }
//                             where status is 'running' | 'paused' | 'idle'.
//
//   reportCompleted(recipeId) Marks a walkthrough finished, so the picker shows it as
//                             "Done" and the contextual triggers stop offering it.
//
// You can also use the message bus (shared/messages.js) to talk to the service worker:
// MSG.STEP_COMPLETED, MSG.STEP_FAILED and MSG.RUNNER_STATE_CHANGED are already routed
// and logged there, which is handy for debugging when a step won't advance.
//
// ---------------------------------------------------------------------------
// THE PLAN SHAPE
// ---------------------------------------------------------------------------
//
//   {
//     recipeId: 'audit-report-network-requests',
//     goal: 'Find the network requests a single page fired',   // show in your UI
//     summary: '…',
//     executionMode: 'templated' | 'ad-hoc',
//     parameters: { auditName: 'Q3 Privacy' },   // already substituted into step text
//     chain: 'create-first-audit',               // successor; the array supersedes this
//     steps: [ … ]
//   }
//
// A step:
//
//   {
//     id: 'network-requests-tab',
//     actor: 'user',                 // 'user' = wait for them; 'ai' = you do it
//     navContext: '*',               // '*' anywhere, else a path prefix — don't run the
//                                    // step until location.pathname matches
//     targetSelector: 'div.op-tab[op-selector="pagedetails-tab-requestlog"]',
//     say: 'Network Requests is the raw truth…',   // show this to the user
//     optional: true,                // can't resolve it? skip, don't stall
//     action: { type: 'click' | 'input' | 'scrollIntoView', value: '…' },
//     completion: {
//       type: 'url_change' | 'dom_mutation' | 'dom_event' | 'click',
//       value: '/sources',           // path prefix for url_change, event name for dom_event
//       targetSelector: '…',         // what to watch; falls back to step.targetSelector
//     },
//   }
//
// ---------------------------------------------------------------------------
// THINGS THAT WILL BITE YOU (found while mapping the app — save yourself the time)
// ---------------------------------------------------------------------------
//
// Every selector you need is already collected in shared/selectors.js as ANCHOR, with
// route patterns as ROUTE. Use those rather than writing CSS paths: the app maintains
// `op-selector` attributes and `guide-*` ids deliberately (they were added for Intercom
// Product Tours), so they're the stable surface. There are 14 `guide-*` ids and ~103
// `op-selector` values.
//
//   1. `guide-left-nav-*` ids are DUPLICATED. <global-sidebar> (desktop) and
//      <mobile-sidebar> are both in the DOM at once; the wrong one is hidden by a media
//      query, not removed. Scope to `global-sidebar`, and gate on a non-zero
//      getBoundingClientRect() so you never highlight an invisible element.
//   2. Journey report tab selectors (`cookies-tab` and friends) sit on <mat-tab> HOST
//      elements, whose content is an <ng-template> — present in the DOM but neither
//      visible nor clickable. Material renders the real labels separately as
//      div.mat-mdc-tab inside mat-tab-header. Map host -> label by index within the
//      mat-tab-group. (labelClass="tab-label-one" is on every tab, so it can't
//      disambiguate.) This is the one mapping I could not verify against a live page —
//      check it early, `journey-cookies` depends on it.
//   3. `audit-setup-*` selectors land on <mat-form-field> WRAPPERS, not the inputs. Fine
//      to highlight; for an 'ai' input step you must drill in to the
//      input/textarea/select first, or you'll set .value on a wrapper and nothing will
//      happen.
//   4. Setting .value on an Angular input is not enough — dispatch 'input' and 'change'
//      with { bubbles: true }, or ControlValueAccessor never sees it and the form stays
//      pristine.
//   5. The app lazy-loads ~40 route chunks, so a target often doesn't exist for a second
//      or two after the URL changes. Wait with a timeout; don't fail fast.
//   6. Use { capture: true } on completion listeners. Angular Material routinely calls
//      stopPropagation, so bubble-phase listeners miss clicks.
//   7. Scope MutationObservers to the closest stable ancestor, never document.body. This
//      app mutates constantly and a subtree observer on body is a real perf problem.
//      Always disconnect.
//   8. The app is a pushState SPA (Angular PathLocationStrategy, no hash routing), so
//      there's no navigation event. content/navigation.js already solves this — import
//      `onRouteChange` from there instead of patching history again. Note the app sets
//      onSameUrlNavigation:'reload', so the SAME url can re-render and tear down
//      anything you injected. Make injection idempotent.
//   9. Because it's an SPA, in-app navigation does NOT re-inject this content script — so
//      a multi-page walkthrough survives naturally. Only a hard reload restarts you,
//      which is what the stored session (KEYS.SESSION in shared/utils.js, reserved for
//      you) is for.
//  10. Intercom is injected via GTM at z-index ~2147483000 and its launcher owns the
//      BOTTOM-RIGHT corner. Our UI layer sits at 2147483000 (Z_INDEX in
//      shared/selectors.js) and the status bar is top-centre. Keep your highlight out of
//      that corner, and note the app's own SCSS ceiling is 99999 while Material's
//      .cdk-overlay-container is pinned all the way down at 1150.
//  11. Dark theme is the DEFAULT (body.dark-theme; body.light-theme once toggled). Style
//      for both — and the user can flip it from the very Settings menu we inject into.
//  12. Nothing renders until the user object loads: everything inside div#application is
//      gated on @if (user), and on the login/signup routes it never appears at all.
//
// If you want a shadow-root UI layer that's already isolated from the app's CSS and
// themed, ui/host.js exposes getLayer(name) — mount into that and you inherit the token
// set in ui/styles.js.
//
// ============================================================================

import { ANCHOR } from '../shared/selectors.js'
import { GUARDS, guardsFor, activeRemedy, appliesToStep, isConfirmed } from '../shared/guards.js'
import { matchesNavContext, onRouteChange } from './navigation.js'
import { parseTargetSelector, applyOperators, cssPartOf } from './selector-query.js'
import {
  highlightElement,
  unhighlightElement,
  showTooltip,
  removeTooltip,
  showConfetti,
  showCompletionPopup,
  showPrerequisitePopup,
  showGuardPopup,
  hideGuardPopup,
  showGuardTooltip,
  hideGuardTooltip,
} from './ui.js'

const callbacks = { onState: null, onCompleted: null }
let activeElement = null
// The element a violated guard is pointing at, tracked separately from activeElement because a
// guard highlight outlives the step it interrupted and has to survive endWalkthrough().
let guardPointer = null
let abortController = null

// ---------------------------------------------------------------------------
// Selector compatibility tables
//
// The app occasionally renders a different element than what the recipe
// selector targets. Add entries here rather than touching recipes or selectors.
// ---------------------------------------------------------------------------

// recipe selector → actual DOM selector
// Used when the app renders a different element than what op-selector targets.
const SELECTOR_OVERRIDES = {
  '[op-selector="audit-setup-name"]': 'audit-editor-header-name-control',
  '[op-selector="audit-setup-frequency"]': 'mat-form-field:has(.frequency-hint)',
}

function resolveSelector(selector) {
  return SELECTOR_OVERRIDES[selector] ?? selector
}

// Journey tab selectors in recipes target mat-tab host elements that never
// render in the DOM. The real clickable labels are div.mat-mdc-tab elements
// matched by their visible text (counts like "(28)" are excluded via includes()).
const JOURNEY_TAB_MAP = {
  'mat-tab[op-selector="details-tab"]': 'Action Details',
  'mat-tab[op-selector="tag-comparison-tab"]': 'Tag Presence',
  'mat-tab[op-selector="tags-tab"]': 'Variable Summary',
  'mat-tab[op-selector="cookies-tab"]': 'Cookies',
  'mat-tab[op-selector="rules-tab"]': 'Rules',
}

function findJourneyTab(selector) {
  const text = JOURNEY_TAB_MAP[selector]
  if (!text) return null
  return (
    Array.from(document.querySelectorAll('mat-tab-header div.mat-mdc-tab')).find(el =>
      el.textContent.includes(text),
    ) ?? null
  )
}

// Audit setup tab selectors in recipes use namespaced keys (e.g. 'audit-tab:url-sources')
// that don't exist in the DOM. Map them to visible text so findOpTab can locate the
// real div.op-tab element by its label.
const OP_TAB_MAP = {
  'audit-tab:url-sources': 'URL Sources',
  '[op-selector="audit-tab-url-sources"]': 'URL Sources',
  'audit-tab:schedule': 'Schedule',
  '[op-selector="audit-tab-standards"]': 'Standards',
  '[op-selector="standards-tab-consent-categories"]': 'Consent Categories',
  'filter-menu:data-source-type': 'Data Source Type',
  'filter-menu:audits': 'Audits',
  'filter-menu:journeys': 'Journeys',
}

function findOpTab(selector) {
  const text = OP_TAB_MAP[selector]
  if (!text) return null
  const cssQuery = selector.startsWith('filter-menu:')
    ? 'button.filter-bar-menu-item, div.filter-bar-menu-item'
    : 'div.op-tab, button.filter-bar-menu-item, mat-checkbox.filter-bar-menu-item'
  return (
    Array.from(document.querySelectorAll(cssQuery)).find(el => el.textContent.includes(text)) ??
    null
  )
}

// ---------------------------------------------------------------------------
// AI step execution
// ---------------------------------------------------------------------------

// Performs the action declared on an actor:'ai' step automatically.
// Angular inputs need value + bubbled input/change events, otherwise
// ControlValueAccessor never sees the change and the form stays pristine.
async function executeAiAction(element, action, dwellMs = 800) {
  if (!action) return

  switch (action.type) {
    case 'click':
      element.click()
      break

    // 'fill_text' is Part 1's name for exactly this: descend to the control, set
    // the value, fire input and change. Accepting both names is cheaper than
    // renaming it across six recipes and every committed fixture.
    case 'fill_text':
    case 'input': {
      const input = element.querySelector('input, textarea, select') ?? element
      input.focus()
      input.value = action.value ?? ''
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      break
    }

    case 'scrollIntoView':
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
      break
  }

  // Brief pause so the user can see what the AI just did before moving on. Steps that
  // exist to be READ rather than to change something set their own, longer dwell.
  await new Promise(r => setTimeout(r, dwellMs))
}

// ---------------------------------------------------------------------------
// Element finding
// ---------------------------------------------------------------------------

function isOnScreen(el) {
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

// Returns the first visible element matching selector, handling the two known
// edge cases: journey tab hosts (invisible mat-tab elements) and selector
// overrides where the app renders a different element than the recipe expects.
//
// Selectors may carry `>>` operators (see selector-query.js) to say "the one
// labelled X" or "the row I just added". The compatibility tables above are keyed
// on plain selector strings, so they get the CSS part rather than the whole thing.
function findVisible(selector) {
  const { css, ops, unknown } = parseTargetSelector(selector)

  if (unknown.length) {
    console.warn(`[observe-pointers] unknown selector operator(s): ${unknown.join(', ')}`)
  }

  const journeyTab = findJourneyTab(css)
  if (journeyTab) return journeyTab
  const opTab = findOpTab(css)
  if (opTab) return opTab

  // Filter to visible BEFORE applying operators, so `last` and `nth` count the
  // rows the user can see. This app leaves hidden duplicates in the DOM (the
  // mobile sidebar, torn-down overlays) and counting those points at nothing.
  const visible = Array.from(document.querySelectorAll(resolveSelector(css))).filter(isOnScreen)
  if (!ops.length) return visible[0] ?? null

  return applyOperators(visible, ops)[0] ?? null
}

/**
 * The runtime's own element lookup, for the Check-screen sweep.
 *
 * Exported so the sweep and the run cannot disagree. They used to: the sweep called
 * document.querySelector directly, which knows nothing about the compatibility tables
 * or the `>>` operators — so every step using one came back "invalid-selector", on
 * exactly the recipes with the most unswept steps in them.
 */
export const resolveTarget = selector => findVisible(selector)

// ---------------------------------------------------------------------------
// Guards
//
// State the walkthrough needs held for its whole run, not just at one step. See
// shared/guards.js for the why. A guard is satisfied while its `requireVisible`
// selector resolves — the same test every step target goes through, so a satisfied
// guard genuinely means "the rest of this plan can work".
// ---------------------------------------------------------------------------

const GUARD_POLL_MS = 500

// There is deliberately NO debounce here. An earlier version made a violation wait ~1.5s before
// it counted, to stop the hover-transient pin control popping the card up constantly. That is
// now handled where it belongs -- a hover-expanded nav SATISFIES the block test (see the
// 'pin-the-nav' remedy), so there is no flicker left to absorb -- and delaying meant a nav the
// user actually collapsed took over a second to register, which just felt broken.

/**
 * What the guards can see right now. Rebuilt on every check, never cached: the user can
 * resize or re-pin mid-walkthrough and noticing that is the entire point.
 *
 * `find` is handed in rather than imported by guards.js so the shared module stays free of
 * DOM access, and so every guard measures visibility exactly the way step targets are
 * measured. Absent and present-but-hidden both read as "not there" -- an earlier version
 * treated "matches nothing" as "cannot evaluate, carry on", which swallowed the real signal,
 * because Angular destroys the sidebar's collapse-wrapper rather than hiding it. Absence IS
 * how you detect an unpinned nav.
 */
function guardContext() {
  return {
    find: findVisible,
    // Visible AND at least this wide. The sidebar is the reason this exists: pinned open,
    // hover-expanded and inside the mobile drawer all render wide nav rows, while a collapsed
    // rail renders the same elements icon-only. Width tells those apart; presence can't.
    findWide: (selector, minWidth) => {
      const el = findVisible(selector)
      return el && el.getBoundingClientRect().width >= minWidth ? el : null
    },
    // The app only renders the hamburger in its mobile layout, so if it is visible there is
    // no pin control to talk about. Deriving this from the app's own media queries beats
    // hardcoding a breakpoint that silently diverges the next time they change theirs.
    isMobileLayout: Boolean(findVisible(ANCHOR.mobileNavToggle)),
  }
}

/**
 * The first violated guard relevant to `step`, as a { guard, remedy } pair, or null.
 *
 * Pass no step to evaluate every guard regardless of relevance — that is what the monitor
 * does, so a single poll can serve waiters interested in different steps.
 */
function guardViolation(guards, step) {
  const ctx = guardContext()

  for (const guard of guards) {
    if (step && !appliesToStep(guard, step)) continue

    // The guard holds if ANY remedy's condition is met, whichever route the user took to get
    // there. Checking only the `when`-selected remedy made a misread of the layout fatal: if
    // isMobileLayout came back false on a narrow window, we would test for a pinned nav that
    // can never exist there and stay violated no matter what the user did. `when` now only
    // decides which advice to show, never whether we block.
    if (guard.remedies.some(remedy => remedy.satisfied(ctx))) continue

    // Nothing is satisfied, so we do have to ask. Fall back to the last remedy if no `when`
    // matched, so there is always something to say.
    const remedy = activeRemedy(guard, ctx) ?? guard.remedies[guard.remedies.length - 1]
    if (remedy) return { guard, remedy }
  }

  return null
}

/**
 * One poller for the whole plan.
 *
 * Deliberately NOT per-step. A watcher created around a single step only covers the window
 * where we happen to be waiting on that step, which leaves the route waits, the settle
 * delays and an 'ai' step's dwell unmonitored — and those gaps are seconds long each, so
 * they are exactly where a user gets to unpin the nav unnoticed. One interval runs from the
 * plan's first step to its last, and every wait consults it.
 *
 * Polled, not observed. We can't know which mutation a given state change produces --
 * unpinning the nav could be a class on a wrapper, an inline style, or a detach -- and a
 * subtree observer on body is the one thing this file is explicitly warned off (bite #7).
 * Half a second is imperceptible and costs one querySelector per guard.
 */
function startGuardMonitor(guards, signal) {
  // Each waiter records the step it cares about, so a violation of a guard that step doesn't
  // use never wakes it.
  const waiters = new Set()
  // Woken on ANY transition, including one violation replacing another. That is what lets the
  // pause UI re-render when a resize swaps which remedy applies.
  const changeWaiters = new Set()

  // Evaluated without a step filter: one poll serves every waiter, and each of them applies
  // its own relevance test to the result.
  let current = guards.length > 0 ? guardViolation(guards) : null

  const relevantGuard = (guard, step) => !step || appliesToStep(guard, step)

  const relevant = (violation, step) => Boolean(violation) && relevantGuard(violation.guard, step)

  // Identity includes the remedy: narrow-and-closed and wide-and-unpinned are both violations
  // of the same guard but need different advice, so swapping between them is a change.
  const identity = violation => (violation ? `${violation.guard.id}:${violation.remedy.id}` : '')

  const commit = next => {
    if (identity(next) === identity(current)) return

    const appeared = Boolean(next) && !current
    current = next

    for (const resolve of [...changeWaiters]) resolve()
    changeWaiters.clear()

    if (!appeared) return

    for (const waiter of [...waiters]) {
      if (!relevant(next, waiter.step)) continue
      waiters.delete(waiter)
      waiter.resolve(next)
    }
  }

  const evaluate = () => {
    if (guards.length === 0) return
    commit(guardViolation(guards))
  }

  const timer = guards.length > 0 ? window.setInterval(evaluate, GUARD_POLL_MS) : null

  // Width is an input to which remedy applies -- the hamburger only exists in the app's
  // mobile layout -- so a resize can invalidate the current answer without anything in the
  // DOM being touched by the user. Waiting up to GUARD_POLL_MS to notice means the prompt
  // keeps saying "widen the window" for half a second after they already did.
  //
  // rAF-coalesced because resize fires continuously through a drag and we only need the
  // settled value once per frame.
  let rafId = null
  const onResize = () => {
    if (rafId !== null) return
    rafId = window.requestAnimationFrame(() => {
      rafId = null
      evaluate()
    })
  }

  if (guards.length > 0) window.addEventListener('resize', onResize)

  const dispose = () => {
    if (timer !== null) window.clearInterval(timer)
    if (rafId !== null) window.cancelAnimationFrame(rafId)
    window.removeEventListener('resize', onResize)
    // Resolve pending waiters rather than dropping them. A race still holding one would
    // otherwise never settle -- and the dom_mutation path has no other way out, since its
    // promise only resolves when the user clicks Next.
    for (const waiter of [...waiters]) waiter.resolve(null)
    waiters.clear()
    for (const resolve of [...changeWaiters]) resolve()
    changeWaiters.clear()
  }

  signal?.addEventListener('abort', dispose, { once: true })

  return {
    /**
     * The { guard, remedy } currently blocking this step, or null. Omit the step to ask
     * whether anything at all is violated.
     */
    violatedFor(step) {
      return relevant(current, step) ? current : null
    },
    /** Resolves with the violation the moment one relevant to this step appears. */
    nextViolationFor(step) {
      if (relevant(current, step)) return Promise.resolve(current)
      if (signal?.aborted) return Promise.resolve(null)
      return new Promise(resolve => waiters.add({ step, resolve }))
    },
    /**
     * Are all the guards this step depends on durably fixed? Stricter than violatedFor, which
     * is about whether to block; this is what may dismiss a prompt already on screen.
     */
    confirmedFor(step) {
      const ctx = guardContext()
      return guards.every(guard => !relevantGuard(guard, step) || isConfirmed(guard, ctx))
    },
    /** Resolves on the next transition — appeared, cleared, or a different remedy. */
    changed() {
      if (signal?.aborted) return Promise.resolve()
      return new Promise(resolve => changeWaiters.add(resolve))
    },
    /** Force a re-check now rather than waiting for the next tick. */
    refresh: evaluate,
    dispose,
  }
}

// Block until every guard holds. Deliberately unbounded: there is no sensible timeout for
// "the user has not put the nav back yet", and giving up would leave the walkthrough
// silently stalled. They can always end it from the status bar.
//
// The sleep here only yields; the monitor above is what actually re-checks, so there is one
// place that decides whether a guard holds.
async function awaitGuards(monitor, signal, step, plan) {
  let violation = monitor.violatedFor(step)
  if (!violation) return

  console.debug(
    // Names the step, not just the guard. A pause is easy to misattribute: the step you can see
    // on screen is often the one BEFORE the one that paused, because an optional step whose
    // target didn't resolve is skipped silently on the way here.
    `[op-walkthroughs] paused: ${plan?.recipeId ?? '?'} / step '${step?.id ?? '?'}' ` +
      `needs '${violation.guard.id}' -> advising '${violation.remedy.id}'`,
  )

  // Point at the control they need if we can reach it, and fall back to the centred popup if
  // we can't. Not reaching it is ordinary, not exceptional: on a narrow window the pin toggle
  // isn't rendered at all, and when the nav is fully hidden neither is. Either way there has
  // to be something on screen explaining why the walkthrough stopped.
  let clickWait = null

  const present = () => {
    showGuardUi(violation.remedy)
    reportState({ status: 'paused', goal: violation.remedy.title })
    // Re-armed per presentation, because a changed remedy asks for a different control.
    clickWait = waitForRemedyClick(violation.remedy, signal)
  }

  present()

  while (!signal.aborted) {
    // The timer, a state transition, or the user clicking what we asked them to. The click is
    // the decisive one -- see below.
    const clicked = await Promise.race([
      new Promise(r => window.setTimeout(() => r(false), GUARD_POLL_MS)),
      monitor.changed().then(() => false),
      clickWait,
    ])

    // They did the thing. Treat that as answer enough even if the state hasn't caught up yet:
    // refreshing and giving the app a beat to re-render stops a pin that is mid-animation from
    // reading as "still collapsed" and immediately prompting again. Not gating on the state
    // here also means a finicky probe can never strand someone who has visibly complied.
    if (clicked) {
      monitor.refresh()
      await new Promise(r => window.setTimeout(r, GUARD_POLL_MS))
      monitor.refresh()
      break
    }

    // Only a durable fix dismisses the prompt. Hovering the rail satisfies the block test, so
    // using that here would let the card vanish as the pointer crossed the nav and come back
    // the moment it left, without anything actually being pinned.
    if (monitor.confirmedFor(step)) break

    const next = monitor.violatedFor(step)
    if (!next) continue

    // Two reasons to re-present, and the remedy is the important one: resizing changes WHICH
    // remedy applies, so holding on to the one we started with would keep telling someone to
    // widen a window they already widened, while pointing at a hamburger that no longer
    // exists. The second is the control being re-rendered or swapped under us.
    const wanted = next.remedy.pointAt ? findVisible(next.remedy.pointAt) : null
    if (next.remedy === violation.remedy && wanted === guardPointer) continue

    violation = next
    present()
  }

  clearGuardUi()

  // Back to running the moment the pause ends. Without this the status bar keeps showing the
  // remedy title ("Pin the left navigation") until some later step resolves a target -- and if
  // the next step is optional and gets skipped, that stale label sits there through it, which
  // makes the pause look like it belongs to the wrong step.
  if (!signal.aborted) reportState({ status: 'running', goal: plan?.goal })
}

/**
 * Resolve when the user clicks the control the remedy asked them to.
 *
 * Listens on document in the CAPTURE phase and matches with closest(), rather than binding to
 * the element itself, for two reasons: Material calls stopPropagation so bubble-phase listeners
 * miss clicks (bite #6), and the sidebar swaps these controls out from under us constantly, so
 * a listener bound to one node would go stale the first time it re-rendered.
 */
function waitForRemedyClick(remedy, signal) {
  const selector = remedy.clickToConfirm
  if (!selector) return new Promise(() => {})

  return new Promise(resolve => {
    const onClick = event => {
      if (!(event.target instanceof Element)) return
      if (!event.target.closest(selector)) return

      cleanup()
      resolve(true)
    }

    const cleanup = () => document.removeEventListener('click', onClick, true)

    document.addEventListener('click', onClick, true)
    signal?.addEventListener(
      'abort',
      () => {
        cleanup()
        resolve(false)
      },
      { once: true },
    )
  })
}

// Point at the control that would fix things if we can reach it, and fall back to the centred
// popup if we can't. Not reaching it is ordinary rather than exceptional: on a narrow window
// the pin toggle isn't rendered at all, and when the nav is fully hidden neither is. Either
// way something has to be on screen explaining why the walkthrough stopped.
function showGuardUi(remedy) {
  clearGuardUi()

  guardPointer = remedy.pointAt ? findVisible(remedy.pointAt) : null

  if (guardPointer) {
    highlightElement(guardPointer)
    showGuardTooltip(guardPointer, remedy)
    return
  }

  showGuardPopup(remedy)
}

/** Tear down whichever guard presentation is up. Safe to call when none is. */
function clearGuardUi() {
  if (guardPointer) unhighlightElement(guardPointer)
  guardPointer = null
  hideGuardTooltip()
  hideGuardPopup()
}

/**
 * Dev helper: exactly what every guard sees right now. Surfaced as `__opWt.guards()`.
 *
 * Guard bugs are all of the form "the DOM isn't what we assumed", and reading them off a
 * paused walkthrough is guesswork. This prints the context, whether each guard holds, which
 * remedy would be advised, and for every selector involved: how many nodes match, whether one
 * is visible, and its size. Run it with the nav pinned, unpinned, and with the mobile drawer
 * open, and the answer is in the diff.
 */
export function inspectGuards() {
  const ctx = guardContext()

  const describe = selector => {
    if (!selector) return null

    const matches = document.querySelectorAll(resolveSelector(selector)).length
    const el = findVisible(selector)
    const rect = el?.getBoundingClientRect()

    return {
      selector,
      matches,
      visible: Boolean(el),
      width: rect ? Math.round(rect.width) : null,
      size: rect ? `${Math.round(rect.width)}x${Math.round(rect.height)}` : null,
    }
  }

  return {
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    isMobileLayout: ctx.isMobileLayout,
    // The selectors the guards and the nav steps depend on, so you can see at a glance
    // whether a satisfied guard actually leaves the step targets reachable.
    probes: {
      mobileNavToggle: describe(ANCHOR.mobileNavToggle),
      mobileNavOpened: describe(ANCHOR.mobileNavOpened),
      navExpanded: describe(ANCHOR.navExpanded),
      navPinToggle: describe(ANCHOR.navPinToggle),
      navCreateNew: describe(ANCHOR.navCreateNew),
    },
    guards: Object.values(GUARDS).map(guard => ({
      id: guard.id,
      holds: guard.remedies.some(remedy => remedy.satisfied(ctx)),
      advice: (activeRemedy(guard, ctx) ?? guard.remedies.at(-1))?.id ?? null,
      remedies: guard.remedies.map(remedy => ({
        id: remedy.id,
        wouldAdvise: !remedy.when || remedy.when(ctx),
        satisfied: remedy.satisfied(ctx),
        pointAt: describe(remedy.pointAt),
      })),
    })),
  }
}

/** Wired at boot by content/index.js. You don't need to call this. */
export function registerHostCallbacks({ onState, onCompleted }) {
  callbacks.onState = onState
  callbacks.onCompleted = onCompleted
}

/**
 * Update the floating status bar.
 *
 * @param {object} state { status: 'running'|'paused'|'idle', goal, currentStepIndex,
 *                         totalSteps, say, error }
 */
export function reportState(state) {
  callbacks.onState?.(state)
}

/** Mark a walkthrough finished, so the picker shows "Done" and triggers stop offering it. */
export function reportCompleted(recipeId) {
  callbacks.onCompleted?.(recipeId)
}

// ---------------------------------------------------------------------------
// Walkthrough runner
// ---------------------------------------------------------------------------

/**
 * What to tell someone whose current route doesn't match where a plan starts.
 *
 * step.say on its own is useless here — the first step of the audit flow says
 * "Open the create menu", which is not actionable from the Consent Categories
 * page. The destination is the missing half.
 *
 * Labels rather than raw paths, because "/rules/library" is a developer's answer
 * to "where do I go". Falls back to the path when we don't have a name for it,
 * which is still better than not saying.
 */
const NAV_LABELS = {
  '/sources': 'Data Sources',
  '/rules/library': 'Standards → Tag & Variable Rules',
  '/consent-categories': 'Standards → Consent Categories',
  '/alerts-library': 'Standards → Alerts',
}

function navContextPrompt(step) {
  // A step scoped to '*' has no destination, so naming one would be a lie -- and
  // "Go to *" is what a naive lookup produces. This is reached for a missed step
  // mid-plan as well as for a route mismatch on step one.
  if (!step.navContext || step.navContext === '*') return step.say

  const where = NAV_LABELS[step.navContext] ?? step.navContext
  return `Go to <strong>${where}</strong> to begin. Then: ${step.say}`
}

/**
 * Wait for a step's target to show up, bounded.
 *
 * Bounded rather than indefinite on purpose: a step whose element genuinely never
 * appears — a permission the account lacks, a feature flag off — should let the run
 * carry on to the next step rather than deadlock. Ten seconds is long enough for an
 * Angular modal and short enough not to look hung.
 */
function waitForElement(selector, signal, timeoutMs = 10000) {
  return new Promise(resolve => {
    const started = Date.now()
    const poll = setInterval(() => {
      const found = findVisible(selector)
      if (found || Date.now() - started > timeoutMs || signal?.aborted) {
        clearInterval(poll)
        resolve(found ?? null)
      }
    }, 100)
    signal?.addEventListener(
      'abort',
      () => {
        clearInterval(poll)
        resolve(null)
      },
      { once: true },
    )
  })
}

/**
 * Bring an element into view, but only if it isn't already.
 *
 * Unconditional scrolling is worse than none: every step would yank the page even
 * when the target is plainly visible, which reads as jitter. So this checks first,
 * and leaves anything comfortably on screen alone.
 *
 * `block: 'center'` rather than 'nearest' because a target flush against the bottom
 * edge is technically visible and practically not — and the tooltip needs room
 * underneath it.
 */
function scrollIntoViewIfNeeded(element) {
  const rect = element.getBoundingClientRect()
  const height = window.innerHeight || document.documentElement.clientHeight
  // A margin, not zero: an element with 10px showing is not usable, and the
  // tooltip has to fit somewhere near it.
  const margin = 120
  const onScreen = rect.top >= margin && rect.bottom <= height - margin

  if (onScreen) return Promise.resolve()

  element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
  // Long enough for a smooth scroll to settle, so the highlight and the tooltip
  // land on the element's final position rather than its old one.
  return new Promise(r => setTimeout(r, 400))
}

/**
 * Does this step get a Continue button, and does the button do the advancing?
 *
 * The rule the walkthrough is judged on, in the user's words: "if any operation is
 * a click, don't display continue. Things where it asks user to fill something out,
 * display continue."
 *
 * That is a rule about the OPERATION, so it is derived from the operation rather
 * than restated on every step:
 *
 *   'auto'    A click the user performs. It announces itself — we listen for it and
 *             move on. Putting a button here is the thing this project exists to
 *             fix: being told to click something and then having to confirm it.
 *             The button still exists, but STAYS HIDDEN until the step has been
 *             sitting there long enough to look stuck (see STUCK_MS). Detection is
 *             good, not perfect, and a walkthrough with no way forward is worse
 *             than a button nobody needed.
 *   'button'  Either we typed something (the user needs a beat to read what we put
 *             in the field and agree to it), or the step is a remark about a value
 *             the app already set — "Operator is equals by default" — where there
 *             is nothing to detect because nothing is supposed to happen.
 *   'race'    Part 2's recipes, which ask for a manual button because their
 *             dom_mutation completions have nothing watchable. Detection wins if it
 *             works, the button covers it when it doesn't.
 *
 * `advance: 'continue' | 'auto'` on a step overrides the default. It is needed for
 * exactly one shape — the remark-about-a-default step, which is an actor:'user' step
 * that must NOT auto-advance — and it stays out of every other recipe.
 *
 * @returns {'auto' | 'button' | 'race'}
 */
/**
 * How long a self-advancing step may sit before we offer a way past it.
 *
 * Long enough that nobody waiting to be told what to click ever sees the button;
 * short enough that a missed click is a pause, not a dead end.
 */
const STUCK_MS = 8000

function advanceModeFor(step) {
  if (step.advance === 'auto') return 'auto'
  if (step.advance === 'continue') return 'button'
  if (step.actor === 'ai') return 'button'
  const isDomMutation = step.completion?.type === 'dom_mutation'
  if (isDomMutation && step.completion.condition !== 'visible') return 'race'
  return 'auto'
}

export async function startWalkthrough(plans) {
  // Stop anything already running FIRST. This used to just overwrite abortController, which
  // orphaned the previous loop instead of ending it: it kept its own guard monitor, its own
  // highlight and its own reportState, so you could get one run's "Open the navigation" prompt
  // on screen while another run highlighted a step in a modal, with the status bar owned by
  // whichever wrote last. Two runs are easy to start -- the picker, the post-orientation offer,
  // the message handler and the dev handle all call in here.
  if (abortController) {
    console.debug('[op-walkthroughs] superseding a walkthrough already in progress')
    abortController.abort()
    // Let the old loop observe the abort and tear its own UI down before we put ours up,
    // otherwise its cleanup lands after ours and wipes the new run's highlight.
    await new Promise(r => window.setTimeout(r, 0))
  }

  clearGuardUi()
  removeTooltip()
  if (activeElement) {
    unhighlightElement(activeElement)
    activeElement = null
  }

  abortController = new AbortController()
  const { signal } = abortController

  for (const plan of plans) {
    // A non-optional step whose element never turned up means the plan did not really
    // run. Without this the loop falls through to reportCompleted() below and the user
    // gets confetti plus a "Done" badge in the picker for a walkthrough they never saw.
    let missedRequired = null

    // Started once, here, so the guards are polled continuously for the plan's whole life
    // rather than only while a step happens to be waiting. Disposed in the finally below,
    // which every exit path from the step loop runs through.
    const monitor = startGuardMonitor(guardsFor(plan), signal)

    // Manual index rather than for..of: a guard that breaks mid-step has to re-run that
    // same step once the state is back, not advance past it.
    let stepIndex = 0

    try {
      while (stepIndex < plan.steps.length) {
        const step = plan.steps[stepIndex]

        if (!matchesNavContext(step.navContext)) {
          // Tell the user what we are waiting for. Without this the run stalls
          // SILENTLY: a plan whose first step is scoped to /consent-categories,
          // started from anywhere else, sits in the promise below with no highlight,
          // no tooltip and no popup -- indistinguishable from the extension being
          // broken.
          if (stepIndex === 0) showPrerequisitePopup(plan.goal, navContextPrompt(step))

          await new Promise(resolve => {
            const unsub = onRouteChange(() => {
              if (matchesNavContext(step.navContext)) {
                unsub()
                resolve()
              }
            })
            signal.addEventListener(
              'abort',
              () => {
                unsub()
                resolve()
              },
              { once: true },
            )
          })
        }

        if (signal.aborted) return

        // Don't point at anything while the app is in a state this plan can't work in --
        // an unpinned left nav makes every sidebar anchor unresolvable, and skipping them
        // one by one would quietly gut the tour.
        await awaitGuards(monitor, signal, step, plan)

        if (signal.aborted) return

        // Some flows (new-user audit creation) intercept with a quick-setup modal.
        // Auto-click through to the advanced form so recipe selectors resolve correctly.
        await new Promise(r => setTimeout(r, 500))
        const advancedBtn = document.querySelector(
          '[op-selector="web-audit-switch-to-advanced-setup"]',
        )
        if (advancedBtn) {
          advancedBtn.click()
          await new Promise(r => setTimeout(r, 2000))
        }

        if (signal.aborted) return

        // The waits above take seconds. Re-check rather than trusting the state we saw
        // before them, otherwise the first thing we do after a long route change is
        // highlight something that moved.
        if (monitor.violatedFor(step)) continue

        // Give the target a chance to appear before giving up on it. A single lookup
        // followed by `continue` silently skipped steps -- and a run whose steps all
        // skip used to report Complete without showing anything. Optional steps are not
        // worth waiting for: absent is their expected state.
        let element = findVisible(step.targetSelector)
        if (!element && !step.optional) {
          element = await waitForElement(step.targetSelector, signal)
        }

        if (signal.aborted) return

        if (!element && step.optional) {
          // Skipping silently makes a target that just hasn't lazy-loaded yet
          // indistinguishable from a module this customer isn't licensed for. Say which
          // step it was so the difference is visible in the console.
          console.debug(
            `[op-walkthroughs] skipped optional step '${step.id}':`,
            step.targetSelector,
          )
          stepIndex++
          continue
        }

        if (!element) {
          if (stepIndex === 0) {
            showPrerequisitePopup(plan.goal, navContextPrompt(step))
            return
          }
          console.warn(`[op-walkthroughs] could not find element: ${step.targetSelector}`)
          missedRequired ??= step
          stepIndex++
          continue
        }

        activeElement = element
        // Scroll before highlighting, not after. The standards picker's "add all"
        // button sits below the fold on a short window: it was being highlighted
        // correctly and the user could not see it, which is indistinguishable from
        // the walkthrough pointing at nothing.
        //
        // Also before showTooltip, which anchors to the element's rect -- position it
        // first and the tooltip ends up wherever the element used to be.
        await scrollIntoViewIfNeeded(element)
        highlightElement(element)

        const advance = advanceModeFor(step)
        let resolveNext = null
        const nextPromise = new Promise(resolve => {
          resolveNext = resolve
          // Without this an aborted run sits here forever, because nothing else
          // resolves the button's promise.
          signal.addEventListener('abort', () => resolve(), { once: true })
        })

        showTooltip(element, step.say, stepIndex, plan.steps.length, resolveNext, {
          label: advance === 'auto' ? 'Next →' : 'Continue →',
          revealAfterMs: advance === 'auto' ? STUCK_MS : 0,
        })
        reportState({ status: 'running', goal: plan.goal })

        if (step.actor === 'ai') {
          await executeAiAction(element, step.action, step.dwellMs)
        }

        // What "done" means for this step. `button` is the only mode with nothing to
        // detect -- we typed something, or the step is a remark -- so the button is the
        // whole condition. The others race detection against the button, which keeps
        // auto-advance (the entire point of this project) while leaving an escape hatch
        // when detection fails. See advanceModeFor.
        const finished =
          advance === 'button'
            ? nextPromise
            : Promise.race([nextPromise, waitForCompletion(step, signal, element)])

        // Race the step against the monitor. If the user unpins the nav while we are
        // waiting on them, stop waiting on a step they can no longer see and re-run it
        // once the state is back, rather than sitting on a dead highlight.
        //
        // Boolean(), not () => true: nextViolationFor resolves null on shutdown, which
        // is not an interruption to retry.
        const interrupted = await Promise.race([
          finished.then(() => false),
          monitor.nextViolationFor(step).then(Boolean),
        ])

        if (signal.aborted) return

        removeTooltip()
        unhighlightElement(element)
        activeElement = null

        // Leave stepIndex alone so the top of the loop waits for the guard, then repeats
        // this step from scratch.
        if (interrupted) continue

        stepIndex++
      }
    } finally {
      monitor.dispose()
    }

    // Tell them what was actually missing rather than celebrating. Stopping the whole
    // chain is deliberate: a later plan built on this one's premise will not fare better.
    if (missedRequired) {
      showPrerequisitePopup(plan.goal, navContextPrompt(missedRequired))
      reportState({ status: 'idle' })
      return
    }

    reportCompleted(plan.recipeId)
  }

  const lastPlan = plans[plans.length - 1]
  if (lastPlan.executionMode === 'templated') {
    showConfetti()
    showCompletionPopup(lastPlan.goal)
  }
  reportState({ status: 'idle' })
}

/**
 * @param {Element} [stepElement] the element the step is highlighting, so the completion
 *   watcher and the highlight are guaranteed to be the same node
 */
function waitForCompletion(step, signal, stepElement) {
  const completion = step.completion
  if (!completion) return Promise.resolve()

  const rawSelector = completion.targetSelector ?? step.targetSelector
  // findVisible understands `>>` operators and the compatibility tables; the bare
  // querySelector is the fallback for a target that exists but is not laid out yet.
  const watchSelector = resolveSelector(cssPartOf(rawSelector))

  if (completion.type === 'click') {
    return new Promise(resolve => {
      // Watch what we highlighted, rather than looking the selector up again.
      //
      // These nav ids are duplicated across <global-sidebar> and <mobile-sidebar>. This used to
      // be document.querySelector, which returns whichever comes first in DOCUMENT order, while
      // the highlight used findVisible, which returns the first VISIBLE one. Once the nav
      // selectors were unscoped those stopped being the same node in the mobile drawer: we
      // highlighted the drawer's item and listened on the hidden desktop copy, so the click was
      // never seen, the step never advanced, and closing the drawer re-fired the guard on step 1
      // forever.
      //
      // Falls back to findVisible -- not querySelector -- when the completion names a different
      // selector than the step highlights. findVisible is also what resolves `>> last` and
      // `>> text=`, so a completion pointing at "the row just added" reaches the same node the
      // recipe meant.
      const watchesStepTarget =
        !completion.targetSelector || completion.targetSelector === step.targetSelector

      const target =
        (watchesStepTarget && stepElement) ||
        findVisible(rawSelector) ||
        document.querySelector(watchSelector)
      if (!target) return resolve()

      const handler = () => {
        target.removeEventListener('click', handler, true)
        resolve()
      }
      target.addEventListener('click', handler, { capture: true })
      signal?.addEventListener(
        'abort',
        () => {
          target.removeEventListener('click', handler, true)
          resolve()
        },
        { once: true },
      )
    })
  }

  // Was missing entirely, so every dom_event completion fell through to
  // Promise.resolve() and advanced instantly. It is in Part 2's own
  // COMPLETION_TYPES and its validator requires `value` for it, so it was
  // intended; Part 2's recipes only use dom_mutation and click, so nothing ever
  // exercised it. Part 1's audit flow uses it for 6 of 10 steps, which is why a
  // ten-step walkthrough reported Complete in about five seconds.
  //
  // Capture phase, because Angular handlers routinely call stopPropagation() and
  // a bubble-phase listener on a parent would never see the event.
  if (completion.type === 'dom_event') {
    return new Promise(resolve => {
      const target = findVisible(rawSelector) ?? document.querySelector(watchSelector)
      if (!target) return resolve()

      const finish = () => {
        target.removeEventListener(completion.value, finish, true)
        resolve()
      }
      target.addEventListener(completion.value, finish, true)
      signal?.addEventListener('abort', finish, { once: true })
    })
  }

  if (completion.type === 'url_change') {
    return new Promise(resolve => {
      const unsub = onRouteChange(({ path }) => {
        if (path.startsWith(completion.value)) {
          unsub()
          resolve()
        }
      })
      signal?.addEventListener(
        'abort',
        () => {
          unsub()
          resolve()
        },
        { once: true },
      )
    })
  }

  // Skyler replaced this whole branch with a manual "Next" button in the tooltip
  // (see startWalkthrough), because watching for a mutation was unreliable. His
  // commented-out original is kept below for the record.
  //
  // The one case that IS reliable is kept live: `condition: 'visible'` means "wait
  // for the target to appear", which is a poll for a specific element rather than a
  // guess about arbitrary DOM churn. It is raced against the Next button, so
  // detection failing costs nothing.
  //
  // Absence of `condition` deliberately falls through to Promise.resolve() and
  // therefore to the button alone. That is what Part 2's recipes want, and it is
  // why the observe-an-existing-node version below could not simply be re-enabled:
  // it resolves INSTANTLY for a target that is not there yet, which in a race
  // against the button would advance the moment a step began.
  if (completion.type === 'dom_mutation' && completion.condition === 'visible') {
    return new Promise(resolve => {
      const finish = () => {
        clearInterval(poll)
        resolve()
      }
      const poll = setInterval(() => {
        if (findVisible(rawSelector)) finish()
      }, 100)
      if (findVisible(rawSelector)) return finish()
      signal?.addEventListener('abort', finish, { once: true })
    })
  }

  // if (completion.type === 'dom_mutation') {
  //   return new Promise(resolve => {
  //     const target = document.querySelector(watchSelector)
  //     if (!target) return resolve()
  //
  //     const observer = new MutationObserver(() => {
  //       observer.disconnect()
  //       resolve()
  //     })
  //     observer.observe(target, {
  //       childList: true,
  //       subtree: true,
  //       characterData: true,
  //       attributes: true,
  //     })
  //     signal?.addEventListener(
  //       'abort',
  //       () => {
  //         observer.disconnect()
  //         resolve()
  //       },
  //       { once: true },
  //     )
  //   })
  // }

  return Promise.resolve()
}

/**
 * Stop and clean up everything.
 *
 * @param {string} reason 'user' | 'complete' | 'error'
 */
export function endWalkthrough(reason) {
  console.log('[op-walkthroughs] end walkthrough', reason)
  abortController?.abort()
  abortController = null
  removeTooltip()
  // The guard prompt has no dismiss button of its own -- ending the walkthrough is the other
  // way out of it -- and its highlight is on a different element than activeElement, so it
  // needs clearing here or it pulses forever.
  clearGuardUi()
  if (activeElement) {
    unhighlightElement(activeElement)
    activeElement = null
  }
  reportState({ status: 'idle' })
}

/**
 * Compact snapshot of actionable elements, for ad-hoc walkthrough generation.
 *
 * Do NOT send raw HTML — an audit report page is megabytes of Angular Material markup
 * and will blow the token limit. Send a flat list of things a walkthrough could point at
 * (buttons, links, inputs, tabs), each named by its most stable selector.
 *
 * Prefer `[op-selector="…"]` and `guide-*` ids over generated paths: those are contracts
 * the app maintains, so a generated plan built on them keeps working. Skip invisible
 * elements and anything with no accessible name — an entry that can't be resolved later
 * is worse than no entry, because the model will happily build steps on it. Cap it around
 * 150 elements.
 *
 * @returns {{ url: string, path: string, title: string, elements: Array<{
 *   tag: string, selector: string, text: string, type?: string, role?: string }> }}
 */
export function simplifyDom() {
  const candidates = document.querySelectorAll(
    [
      'button',
      'a[href]',
      'input',
      'textarea',
      'select',
      '[op-selector]',
      '[id^="guide-"]',
      'div.op-tab',
      'div.mat-mdc-tab',
    ].join(','),
  )

  const seen = new Set()
  const elements = []

  for (const el of candidates) {
    if (elements.length >= 150) break

    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue

    const opSel = el.getAttribute('op-selector')
    const guideId = el.id?.startsWith('guide-') ? el.id : null

    let selector
    if (opSel) {
      selector = `[op-selector="${opSel}"]`
    } else if (guideId) {
      selector = `#${guideId}`
    } else {
      selector = el.tagName.toLowerCase()
    }

    const text = (
      el.getAttribute('aria-label') ||
      el.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80) ||
      el.getAttribute('placeholder') ||
      el.getAttribute('title') ||
      ''
    ).trim()

    // No stable selector and no text means the AI can't reference or describe it
    if (!opSel && !guideId && !text) continue

    // Deduplicate: catches the mobile/desktop sidebar duplication where the same
    // op-selector and label appear twice in the DOM (one hidden by media query)
    const key = `${selector}::${text}`
    if (seen.has(key)) continue
    seen.add(key)

    const entry = { tag: el.tagName.toLowerCase(), selector, text }
    const type = el.getAttribute('type')
    const role = el.getAttribute('role')
    if (type) entry.type = type
    if (role) entry.role = role

    elements.push(entry)
  }

  return {
    url: window.location.href,
    path: window.location.pathname,
    title: document.title,
    elements,
  }
}
