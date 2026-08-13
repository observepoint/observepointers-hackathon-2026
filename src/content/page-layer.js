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

const callbacks = { onState: null, onCompleted: null }

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
// STUBS — replace the bodies below
// ---------------------------------------------------------------------------

/**
 * Run an ordered sequence of walkthroughs.
 *
 * @param {Array<object>} plans  hydrated, validated plans — run in order
 */
export function startWalkthrough(plans) {
  // TODO(person-3): walk plans[0].steps, then plans[1], and so on. Call reportState() as
  // you go so the status bar tracks you, and reportCompleted(plan.recipeId) as each one
  // finishes.
  console.log('[op-walkthroughs] page layer stub — received plans', {
    count: plans.length,
    plans: plans.map(plan => ({
      recipeId: plan.recipeId,
      goal: plan.goal,
      steps: plan.steps.length,
    })),
  })

  // Shows the status bar so the handoff is visibly wired end to end. Replace this with
  // real per-step reporting.
  const [first] = plans

  if (first)
    reportState({
      status: 'running',
      goal: first.goal,
      currentStepIndex: 0,
      totalSteps: first.steps.length,
      say: `Page layer not implemented yet. First step would be: ${first.steps[0]?.say ?? '—'}`,
      queued: plans.length - 1,
    })
}

/**
 * Stop and clean up everything.
 *
 * @param {string} reason 'user' | 'complete' | 'error'
 */
export function endWalkthrough(reason) {
  // TODO(person-3): dispose highlights, tooltips, observers, listeners, stored session.
  console.log('[op-walkthroughs] page layer stub — end walkthrough', reason)
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
  // TODO(person-3)
  return {
    url: window.location.href,
    path: window.location.pathname,
    title: document.title,
    elements: [],
  }
}
