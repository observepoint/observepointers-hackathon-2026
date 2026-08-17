// The left-nav orientation walkthrough, composed rather than hand-authored.
//
// This is the one recipe that cannot be a static template: what a user needs pointed
// out depends on what they told onboarding they came here to do. Someone doing Consent
// Management Validation needs Standards > Consent Categories; someone doing Email Link
// Validation needs Configurations > Email Inboxes. A single fixed tour either skips both
// or bores everyone with both.
//
// It is also the WHOLE walkthrough, not the first link in a chain. Orientation stays at
// the nav level and never navigates into an Audit, a Journey or a report -- partly because
// that is a different kind of lesson, and partly because a brand-new account has no
// completed scan to open, so those steps cannot resolve. Deep dives live as their own
// recipes, started from the picker or offered by a contextual trigger once the user is
// actually looking at the thing.
//
// So it is additive. A fixed core of top-level nav items everybody gets, plus one
// sub-item segment per selected purpose, deduplicated (Web Privacy and Consent
// Management both want Consent Categories) and sorted into sidebar order. Selections
// merge; nothing has to be pared down.
//
// Two rules worth knowing before you edit the table:
//
//   1. Segment copy must be purpose-independent. A segment can be requested by several
//      purposes at once, so there is nowhere to hang "because you chose Web Privacy...".
//      Personalisation is expressed by WHICH segments appear, never by their wording.
//   2. A step that opens something needs a step that closes it. Panels the app leaves up
//      (the Create New modal, the Settings menu) sit over what comes next, so each one has
//      an explicit close row rather than relying on a side-effect table.
//
// Do not import recipes.js from here -- recipes.js imports this.

import { ANCHOR } from './selectors.js'
import { assertValidRecipe } from './schema.js'
import { PURPOSES } from './purposes.js'

export const ORIENTATION_RECIPE_ID = 'orientation-left-nav'

const GOAL = 'Get oriented in the ObservePoint left navigation'

// Appended to whichever step lands last. It can't live on a fixed step any more --
// Reports used to close the tour and now sits second. It also no longer promises an
// Audit: orientation ends here rather than chaining onwards.
const CLOSING = 'That is the tour. Anything you want to go deeper on is in the Walkthroughs menu.'

// Shown only on the first run, and never when the tour is launched from the picker:
// telling someone how to open the Walkthroughs modal while they are looking at the
// Walkthroughs modal is not orientation.
//
// The second step is deliberately actor:'ai'. A 'user' step completing on a click would
// open the picker and hijack the tour it is introducing, so we highlight the item, hold
// it long enough to read, and move on ourselves.
const INTRO_STEPS = [
  {
    id: 'open-settings-menu',
    actor: 'user',
    navContext: '*',
    targetSelector: ANCHOR.settingsTrigger,
    say: 'First, how to get back to this. Walkthroughs live in the Settings menu — open it.',
    completion: { type: 'click', targetSelector: ANCHOR.settingsTrigger },
  },
  {
    id: 'settings-walkthroughs-item',
    actor: 'ai',
    navContext: '*',
    targetSelector: ANCHOR.settingsWalkthroughsItem,
    say: 'There it is. Everything we are about to cover is in here, plus one walkthrough for each thing you told us you care about. Come back any time.',
    optional: true,
    action: { type: 'scrollIntoView' },
    // Long enough to actually read the tooltip. executeAiAction defaults to 800ms.
    dwellMs: 3500,
    // Never awaited -- page-layer branches on actor:'ai' before waitForCompletion. Here
    // only because the schema requires every step to declare one.
    completion: { type: 'dom_mutation', targetSelector: ANCHOR.settingsWalkthroughsItem },
  },
  {
    // The Settings menu has [hasBackdrop]="false" and our injected item carries no
    // MatMenuItem directive, so nothing dismisses it on its own. Re-clicking the trigger
    // toggles it shut -- the same fallback content/settings-menu.js uses.
    id: 'close-settings-menu',
    actor: 'user',
    navContext: '*',
    targetSelector: ANCHOR.settingsTrigger,
    say: 'Close it back up, and we will walk the navigation.',
    optional: true,
    completion: { type: 'click', targetSelector: ANCHOR.settingsTrigger },
  },
]

// One row per nav item.
//
// `order` is sidebar position, taken from the ANCHOR declaration order in selectors.js
// (which reads as a transcription of the app's sidebar.constants.ts). Sub-items are
// parent + n so they always land directly beneath their parent.
//
// `purposes` is which onboarding answers request the row. Core rows are always in and
// list none. `parent` means the row is a sub-item that is only reachable once its parent
// section has been opened -- so requesting a child pulls its parent in too.
export const NAV_SEGMENTS = [
  {
    id: 'create-new',
    stepId: 'nav-create-new',
    label: 'Create New',
    order: 10,
    core: true,
    anchor: ANCHOR.navCreateNew,
    purposes: [],
    say: 'Start here. Create New is where every Audit, Journey, and Folder begins. Give it a click.',
  },
  {
    id: 'close-create-menu',
    stepId: 'close-create-menu',
    label: 'Close Create New',
    order: 11,
    core: true,
    anchor: ANCHOR.navCloseCreateNew,
    say: 'Close this menu to continue the tour.',
    purposes: [],
  },
  {
    id: 'reports',
    stepId: 'nav-reports',
    label: 'Reports',
    order: 20,
    core: true,
    anchor: ANCHOR.navReports,
    purposes: [],
    say: 'Reports is the Report Gallery — pre-built views across every scan, plus anything you have saved.',
  },
  // ANCHOR.navDataSources drills through the Data Source Scans group to the Audits &
  // Journeys link inside it, so this row already IS that destination. A separate
  // audits-journeys segment would highlight the same element twice.
  {
    id: 'data-sources',
    stepId: 'nav-data-sources',
    label: 'Data Source Scans',
    order: 30,
    core: true,
    anchor: ANCHOR.navDataSources,
    purposes: [],
    say: 'Data Source Scans holds Audits & Journeys — every scan you have set up, and its results. An Audit crawls a set of pages; a Journey replays one real user flow, action by action.',
  },
  {
    id: 'triggered-alerts',
    stepId: 'nav-triggered-alerts',
    label: 'Triggered Alerts',
    order: 40,
    core: true,
    anchor: ANCHOR.navTriggeredAlerts,
    purposes: [],
    say: 'Triggered Alerts is the inbox for everything that broke — every Alert that fired on your recent runs.',
  },
  {
    id: 'standards',
    stepId: 'nav-standards',
    label: 'Standards',
    order: 50,
    core: true,
    anchor: ANCHOR.navStandards,
    purposes: [],
    say: 'Standards is where you define what "correct" means: Alerts, Tag & Variable Rules, and Consent Categories.',
  },
  {
    id: 'rules',
    stepId: 'nav-rules',
    label: 'Tag & Variable Rules',
    order: 51,
    parent: 'standards',
    anchor: ANCHOR.navRules,
    purposes: ['analytics-validation', 'data-layer-validation'],
    say: 'Tag & Variable Rules are how you assert correctness: an optional WHEN plus a required EXPECT, attached to a scan.',
  },
  {
    id: 'consent-categories',
    stepId: 'nav-consent-categories',
    label: 'Consent Categories',
    order: 52,
    parent: 'standards',
    anchor: ANCHOR.navConsentPreferences,
    purposes: ['web-privacy', 'consent-management'],
    say: 'Consent Categories are your approved and unapproved lists of cookies, tags, and domains — they drive every privacy report.',
  },
  {
    id: 'configs',
    stepId: 'nav-configs',
    label: 'Configurations',
    order: 60,
    core: true,
    anchor: ANCHOR.navConfigs,
    purposes: [],
    say: 'Configurations holds the reusable pieces your scans share — Action Sets, Data Layers, and Email Inboxes.',
  },
  {
    id: 'action-sets',
    stepId: 'nav-action-sets',
    label: 'Action Sets',
    order: 61,
    parent: 'configs',
    anchor: ANCHOR.navActionSets,
    purposes: ['consent-management', 'user-flow-validation'],
    say: 'Action Sets are saved sequences of clicks and inputs — accepting a consent banner, logging in — that you reuse across Journeys and Audits.',
  },
  {
    id: 'data-layers',
    stepId: 'nav-data-layers',
    label: 'Data Layers',
    order: 62,
    parent: 'configs',
    anchor: ANCHOR.navDataLayers,
    purposes: ['data-layer-validation'],
    say: 'Data Layers is where you register the data layer object to inspect, so every scan validates the same variables.',
  },
  {
    id: 'email-inboxes',
    stepId: 'nav-email-inboxes',
    label: 'Email Inboxes',
    order: 63,
    parent: 'configs',
    anchor: ANCHOR.navEmailInboxes,
    purposes: ['email-link-validation'],
    say: 'Email Inboxes gives you an ObservePoint address to send a campaign email to, so its links are validated before your customers click them.',
  },
]

// navUsage is deliberately absent: no purpose plausibly needs it, and an orientation
// tour is not the place to introduce billing. The anchor stays in selectors.js.
//
// accessibility and landing-page-validation request nothing here on purpose -- neither
// has a left-nav destination. They are audit-report concerns, so they contribute report
// recipes via purposes.js recipeIds instead of a stretched nav segment.

const BY_ID = new Map(NAV_SEGMENTS.map(segment => [segment.id, segment]))

// The one step we refuse to make optional. It is always present (core) and always first
// (lowest order), so a missing one means the sidebar itself is not there -- which the
// page layer needs to treat as a failed prerequisite rather than a skipped item.
const REQUIRED_SEGMENT_ID = 'create-new'

function listSentence(labels) {
  if (labels.length <= 1) return labels.join('')
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}

/**
 * Compose the orientation walkthrough for a set of selected purposes.
 *
 * @param {string[]} purposeIds ids from PURPOSES; unknown ones are ignored
 * @param {object} options { includeSettingsIntro } -- first run only
 */
export function buildOrientation(purposeIds = [], { includeSettingsIntro = false } = {}) {
  const selected = new Set(purposeIds)
  const chosen = new Map()

  const add = segment => {
    if (!segment || chosen.has(segment.id)) return

    chosen.set(segment.id, segment)

    // A sub-item is only resolvable once its parent section is open, so the parent comes
    // along whether or not a purpose asked for it.
    if (segment.parent) add(BY_ID.get(segment.parent))
  }

  for (const segment of NAV_SEGMENTS) {
    if (segment.core || segment.purposes.some(id => selected.has(id))) add(segment)
  }

  const ordered = [...chosen.values()].sort((a, b) => a.order - b.order)

  const navSteps = ordered.map(segment => ({
    id: segment.stepId,
    actor: 'user',
    navContext: '*',
    targetSelector: segment.anchor,
    say: segment.say,
    // Everything but create-new skips silently when absent, which is how a customer
    // without a licensed module gets a tour of what they actually have.
    ...(segment.id === REQUIRED_SEGMENT_ID ? {} : { optional: true }),
    completion: { type: 'click', targetSelector: segment.anchor },
  }))

  const steps = includeSettingsIntro ? [...INTRO_STEPS, ...navSteps] : navSteps
  const last = steps[steps.length - 1]

  // Deep-copied because INTRO_STEPS is a module singleton and we are about to edit
  // `say` on whichever step ended up last.
  const finalSteps = steps.map(step =>
    step === last ? { ...step, say: `${step.say} ${CLOSING}` } : { ...step },
  )

  return assertValidRecipe({
    recipeId: ORIENTATION_RECIPE_ID,
    goal: GOAL,
    summary: `A short tour of the navigation you will use: ${listSentence(
      ordered.map(segment => segment.label),
    )}.`,
    executionMode: 'templated',
    parameters: {},
    // Every step here targets a global-sidebar anchor, so the whole thing depends on the
    // sidebar staying open. No `chain`: what comes next is offered, not auto-started.
    guards: ['nav-available'],
    steps: finalSteps,
  })
}

// ---------------------------------------------------------------------------
// Import-time checks
// ---------------------------------------------------------------------------
//
// Same bargain recipes.js makes: a typo in the table fails the moment the content script
// boots, not halfway through a demo.

const PURPOSE_IDS = new Set(PURPOSES.map(purpose => purpose.id))
const stepIds = new Set()

for (const segment of NAV_SEGMENTS) {
  if (!segment.anchor)
    throw new Error(`[op-walkthroughs] nav segment "${segment.id}" has no anchor`)

  if (segment.parent && !BY_ID.has(segment.parent))
    throw new Error(
      `[op-walkthroughs] nav segment "${segment.id}" names unknown parent "${segment.parent}"`,
    )

  for (const id of segment.purposes)
    if (!PURPOSE_IDS.has(id))
      throw new Error(`[op-walkthroughs] nav segment "${segment.id}" names unknown purpose "${id}"`)

  if (stepIds.has(segment.stepId))
    throw new Error(`[op-walkthroughs] duplicate nav segment stepId "${segment.stepId}"`)

  stepIds.add(segment.stepId)
}

for (const step of INTRO_STEPS)
  if (stepIds.has(step.id))
    throw new Error(`[op-walkthroughs] intro step "${step.id}" collides with a nav segment`)

if (!BY_ID.has(REQUIRED_SEGMENT_ID))
  throw new Error(`[op-walkthroughs] required segment "${REQUIRED_SEGMENT_ID}" is not in the table`)

// Both extremes, so a broken composition can't hide behind an unusual set of answers.
buildOrientation([])
buildOrientation(
  PURPOSES.map(purpose => purpose.id),
  { includeSettingsIntro: true },
)
