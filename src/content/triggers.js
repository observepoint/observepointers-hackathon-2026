// Contextual walkthroughs: offers that appear when the user lands somewhere we have
// a relevant walkthrough for.
//
// Entirely gated on profile.wantsGuidance -- someone who said "I know my way around"
// never sees one of these.
//
// Two rules that keep this from becoming annoying:
//   - We offer, never auto-start. Hijacking someone mid-task is hostile.
//   - Suppression is real: two dismissals, or completing the recipe, and we stop.

import { ROUTE } from '../shared/selectors.js'
import { getRecipe } from '../shared/recipes.js'
import { storage, KEYS } from '../shared/utils.js'
import { onRouteChange } from './navigation.js'
import { showOffer, hideOffer } from './ui/offer.js'

/** How many dismissals before we stop offering a given trigger. */
const MAX_DISMISSALS = 2

/**
 * Let the route settle before offering.
 *
 * Matching is on the URL alone. Confirming the page really has the element we think it
 * does would be more accurate on this lazy-loading app, but element resolution belongs to
 * the page layer — so a short delay stands in for it. The cost is an occasional offer on a
 * route whose content hasn't finished mounting, which is harmless: the offer is
 * non-blocking and dismissable.
 */
const SETTLE_MS = 1200

export const TRIGGERS = [
  {
    id: 'page-details-network-requests',
    route: ROUTE.pageDetails,
    recipeId: 'audit-report-network-requests',
    title: 'Reading a page in detail?',
    body: 'We can walk you through the Network Requests tab and how to trace what fired on this page.',
  },
  {
    id: 'journey-cookies-tab',
    route: ROUTE.journeyResults,
    recipeId: 'journey-cookies',
    title: 'First time in a Journey report?',
    body: 'There is a specific order to these tabs. We can show you how to read the Cookies tab for a given action.',
  },
  {
    id: 'consent-categories',
    route: ROUTE.consentCategories,
    recipeId: 'privacy-consent-categories',
    title: 'Setting up Consent Categories?',
    body: 'These drive every privacy compliance report. We can walk you through how they fit together.',
  },
]

let disposeRouteWatch = null
let currentOfferId = null

async function loadState() {
  const [profile, progress] = await Promise.all([
    storage.sync.get(KEYS.PROFILE),
    storage.local.get(KEYS.PROGRESS),
  ])

  return { profile, progress: progress ?? {} }
}

/**
 * Should we stay quiet about this offer?
 *
 * Exported because the suggestion shown when orientation finishes is the same kind of
 * promise to the user -- two dismissals and we stop -- and it would be a bad look for one
 * offer surface to honour that and another to ignore it.
 *
 * @param {object} offer { id, recipeId }
 */
export function isSuppressed(offer, progress) {
  const seen = progress.seenTriggers?.[offer.id]

  if (seen?.suppressed) return true
  if ((seen?.count ?? 0) >= MAX_DISMISSALS) return true

  // Already done this walkthrough -- no reason to keep suggesting it.
  return Boolean(progress.completedRecipes?.[offer.recipeId])
}

export function recordSeen(triggerId, patch) {
  return storage.local.update(KEYS.PROGRESS, (progress = {}) => {
    const seenTriggers = progress.seenTriggers ?? {}
    const previous = seenTriggers[triggerId] ?? { count: 0, suppressed: false }

    return {
      ...progress,
      seenTriggers: { ...seenTriggers, [triggerId]: { ...previous, ...patch } },
    }
  })
}

/**
 * Evaluate triggers for the current route.
 *
 * @param {object} options { isRunning(), onAccept(recipeId) }
 */
async function evaluate({ isRunning, onAccept }) {
  // Never interrupt a walkthrough that's already in progress.
  if (isRunning?.()) return

  const path = window.location.pathname
  const { profile, progress } = await loadState()

  if (!profile?.wantsGuidance) return

  const trigger = TRIGGERS.find(
    candidate => candidate.route.test(path) && !isSuppressed(candidate, progress),
  )

  if (!trigger) {
    // Left the route the current offer belonged to.
    if (currentOfferId) {
      hideOffer()
      currentOfferId = null
    }
    return
  }

  if (trigger.id === currentOfferId) return
  if (!getRecipe(trigger.recipeId)) return

  // Let the route settle before offering, so we don't interrupt someone who is still
  // clicking through, and so a fast redirect doesn't leave a stale offer behind.
  await new Promise(resolve => window.setTimeout(resolve, SETTLE_MS))

  // The user may have navigated away, or started a walkthrough, while we waited.
  if (isRunning?.() || !trigger.route.test(window.location.pathname)) return

  currentOfferId = trigger.id
  await recordSeen(trigger.id, { count: (progress.seenTriggers?.[trigger.id]?.count ?? 0) + 1 })

  showOffer({
    title: trigger.title,
    body: trigger.body,
    onAccept: () => {
      currentOfferId = null
      onAccept?.(trigger.recipeId)
    },
    onDismiss: () => {
      currentOfferId = null
    },
    onNever: () => {
      currentOfferId = null
      recordSeen(trigger.id, { suppressed: true })
    },
  })
}

/** Start watching routes and offering walkthroughs. Idempotent. */
export function startTriggers(options) {
  if (disposeRouteWatch) return

  disposeRouteWatch = onRouteChange(() => evaluate(options))

  // Evaluate the route we booted on, too.
  evaluate(options)
}

export function stopTriggers() {
  disposeRouteWatch?.()
  disposeRouteWatch = null
  hideOffer()
  currentOfferId = null
}
