// Guards: app states that must hold for the WHOLE walkthrough, not just at one step.
//
// A step's `targetSelector` is checked once, when the step starts. That is not enough for
// state the user can change out from under us mid-tour. The left navigation is the case
// that forced this: it can be unpinned, and once it is, every `global-sidebar` anchor the
// orientation tour points at stops resolving. The old behaviour was to warn to the console
// and skip, so the user watched the tour quietly gut itself.
//
// So a plan can declare `guards: ['nav-available']`. The page layer then:
//   - refuses to start a step that needs the state while it is missing,
//   - watches for violations while waiting on a step's completion, and
//   - re-runs the interrupted step once the state comes back.
//
// A plan carries guard IDS, not guard definitions -- guardsFor() resolves them against this
// module inside the content script, so nothing here is ever serialised over the message bus.
// That is what lets these be predicates rather than inert data.
//
// A guard has:
//
//   appliesTo(step)   which steps care. A guard that blocked steps unrelated to its state
//                     would just be in the way.
//   remedies[]        the guard HOLDS if ANY remedy's `satisfied(ctx)` is met -- whichever
//                     route the user took to get there. `when(ctx)` only picks which advice to
//                     show when none of them is. Those two jobs were fused at first, so a
//                     misread of the layout meant testing a condition that could never be true
//                     there (a pinned nav on a narrow window) and blocking forever.
//
// A remedy has `when` (optional, defaults to always), `satisfied`, `pointAt` (what to
// highlight, optional), `title` and `say`.
//
// It may also narrow what counts as DONE, which is a different question from whether to block:
//
//   confirmed(ctx)   optional, defaults to `satisfied`. Blocking is lenient on purpose -- a
//                    hover-expanded nav is usable, so we must not nag about it -- but that
//                    same leniency would let the prompt vanish the instant the pointer crosses
//                    the rail, without the user ever pinning anything, and return the moment
//                    it left. `confirmed` is the durable version of the state.
//   clickToConfirm   optional selector. A click anywhere inside it answers the ask outright,
//                    so we never strand someone whose fix we failed to detect.

import { ANCHOR, SIDEBAR_ANCHORS } from './selectors.js'

// A nav row this wide or wider means the sidebar is showing labels, not just an icon rail.
// Expanded rows run ~200px+; a collapsed rail is ~48-64px. Anywhere in between works, so this
// does not need to be exact -- __opWt.guards() prints the measured widths if it ever does.
const NAV_EXPANDED_MIN_WIDTH = 120

export const GUARDS = {
  'nav-available': {
    id: 'nav-available',

    // Only guard steps that actually point into the sidebar. The Settings-menu intro steps
    // and close-create-menu don't, and holding those up over a collapsed nav they never
    // touch would be the guard getting in the way rather than helping.
    //
    // Set membership, not a substring test: this was `includes('global-sidebar')` until those
    // selectors were unscoped, at which point it quietly matched nothing and the guard stopped
    // applying at all.
    appliesTo: step => SIDEBAR_ANCHORS.has(step?.targetSelector),

    remedies: [
      {
        // Narrow window: the app renders no pin control at all, so "pin the nav" is advice
        // the user cannot act on. Lead with widening, because that satisfies the guard once
        // for the whole tour -- the hamburger overlay closes again on every nav click, which
        // would otherwise re-prompt before nearly every step.
        id: 'widen-or-hamburger',
        when: ctx => ctx.isMobileLayout,
        // The drawer being open is what makes the nav usable here. Testing for navExpanded
        // would wedge the user: collapse-wrapper never appears in the mobile overlay, so the
        // guard could never be satisfied on a narrow window.
        satisfied: ctx => Boolean(ctx.find(ANCHOR.mobileNavOpened)),
        clickToConfirm: ANCHOR.mobileNavToggle,
        pointAt: ANCHOR.mobileNavToggle,
        title: 'Open the navigation',
        say: 'This window is too narrow to pin the navigation open. Widen it and the rest of the tour will flow — or open the navigation from the menu button each time.',
      },
      {
        // Normal layout. Satisfied if the nav is pinned OR merely hover-expanded, because
        // either way its labels are on screen and the tour can point at them.
        //
        // Pinned alone was the original condition and it made hovering the nav pop the "pin
        // me" card up over and over: navExpanded is the PINNED control, absent while the nav
        // is hover-expanded, even though a hover-expanded nav is perfectly usable. Debouncing
        // could not fix that -- a hover lasts as long as the mouse sits there, so the
        // violation was sustained, not a blink.
        //
        // Width is the honest test for "labels are showing", and it covers hover, pin, and
        // anything else that expands the rail without us having to enumerate them.
        id: 'pin-the-nav',
        satisfied: ctx =>
          Boolean(ctx.find(ANCHOR.navExpanded)) ||
          Boolean(ctx.findWide(ANCHOR.navCreateNew, NAV_EXPANDED_MIN_WIDTH)),
        // Hover is deliberately NOT enough to close this prompt. Width satisfies the block
        // test so we don't nag someone whose nav is open, but a hover-expanded rail collapses
        // again the moment the pointer leaves -- so the ask isn't answered until it is really
        // pinned, or until they click the toggle we are pointing at.
        confirmed: ctx => Boolean(ctx.find(ANCHOR.navExpanded)),
        clickToConfirm: ANCHOR.navPinToggle,
        pointAt: ANCHOR.navPinToggle,
        title: 'Pin the left navigation',
        say: 'This walkthrough points at items in the left navigation, so it needs to stay pinned open. Pin it again and we will pick up where we left off.',
      },
    ],
  },
}

/** Resolve a plan's declared guard ids to guard objects, dropping unknown ones. */
export function guardsFor(plan) {
  return (plan?.guards ?? []).map(id => GUARDS[id]).filter(Boolean)
}

/** The remedy in force for the current context, or null if none applies. */
export function activeRemedy(guard, ctx) {
  return guard.remedies.find(remedy => !remedy.when || remedy.when(ctx)) ?? null
}

/** Does this guard have anything to say about this step? */
export function appliesToStep(guard, step) {
  return !guard.appliesTo || guard.appliesTo(step)
}

/**
 * Is this guard's state durably fixed, rather than merely good enough not to block?
 *
 * The stricter sibling of the any-remedy `satisfied` rule used to decide blocking. Only this
 * one may dismiss a prompt we have already shown.
 */
export function isConfirmed(guard, ctx) {
  return guard.remedies.some(remedy => (remedy.confirmed ?? remedy.satisfied)(ctx))
}
