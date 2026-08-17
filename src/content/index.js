// Content script entry point. Runs only on the ObservePoint app (see manifest matches).
//
// This side produces walkthrough plans and owns the extension chrome: the onboarding
// questions, the "Walkthroughs" item in the app's Settings dropdown, the picker modal,
// the contextual offers, and the End Walkthrough bar.
//
// It does not run walkthroughs. Plans are handed to content/page-layer.js — a stub owned
// by Person 3 — which owns the entire runtime: resolving elements, highlighting them,
// clicking, and stepping through.

import { MSG, END_REASON, sendToBackground } from '../shared/messages.js'
import { storage, KEYS } from '../shared/utils.js'
import { RECIPES, resolveRecipe } from '../shared/recipes.js'
import { NAV_SEGMENTS, ORIENTATION_RECIPE_ID, buildOrientation } from '../shared/orientation.js'
import { recommendedRecipeIds } from '../shared/purposes.js'
import { hydratePlan } from '../shared/hydrate.js'
import { startNavigationWatch, notifyExternalUrlChange } from './navigation.js'
import { waitForAppShell } from './app-ready.js'
import { startSettingsMenuInjection } from './settings-menu.js'
import { startTriggers, isSuppressed, recordSeen } from './triggers.js'
import * as pageLayer from './page-layer.js'
import { openPicker } from './ui/picker.js'
import { openOnboarding } from './ui/onboarding.js'
import { showOffer } from './ui/offer.js'
import * as endButton from './ui/end-button.js'

let active = false

// The page layer drives the status bar and tells us when a walkthrough finishes.
pageLayer.registerHostCallbacks({
  onState: state => {
    active = Boolean(state) && state.status !== 'idle'
    endButton.sync(state)
  },
  onCompleted: recipeId => {
    markCompleted(recipeId)
    if (recipeId === ORIENTATION_RECIPE_ID) suggestNextAfterOrientation()
  },
})

endButton.setEndHandler(() => endWalkthrough(END_REASON.USER))

/** Recorded so the picker can show "Done" and triggers stop offering it. */
function markCompleted(recipeId) {
  if (!recipeId) return

  return storage.local.update(KEYS.PROGRESS, (progress = {}) => ({
    ...progress,
    completedRecipes: {
      ...(progress.completedRecipes ?? {}),
      [recipeId]: new Date().toISOString(),
    },
  }))
}

// The stated purposes, cached. Orientation is composed from these on every start, so this
// is read on a hot path -- but boot() and onboarding both already have the profile in
// hand, and they seed it, so the common paths cost no extra storage read at all.
let purposeIdsPromise = null

function loadPurposeIds() {
  purposeIdsPromise ??= storage.sync.get(KEYS.PROFILE).then(profile => profile?.purposes ?? [])
  return purposeIdsPromise
}

function setPurposeIds(profile) {
  purposeIdsPromise = Promise.resolve(profile?.purposes ?? [])
}

/**
 * Hand an ordered list of recipes to the page layer as hydrated plans.
 *
 * Hydration happens here so the page layer never has to know about recipes or
 * {{parameters.*}} placeholders — it receives finished, validated plans.
 *
 * Still an array because the page layer accepts one, but nothing queues more than a single
 * plan any more: the next walkthrough is offered when this one finishes, not chained.
 *
 * @param {string[]} recipeIds
 * @param {object} parameters {{parameters.*}} values
 * @param {object} options { includeSettingsIntro } — first run only, see showOnboarding
 */
async function startWalkthroughs(recipeIds, parameters = {}, { includeSettingsIntro } = {}) {
  // Claimed before the await, not after: triggers gate on `active` and we are about to
  // yield, so leaving it false here lets a contextual offer slip into the gap.
  active = true

  const purposeIds = await loadPurposeIds()

  const plans = recipeIds
    .map(recipeId => resolveRecipe(recipeId, { purposeIds, includeSettingsIntro }))
    .filter(Boolean)
    .map(recipe => hydratePlan(recipe, parameters))

  if (plans.length === 0) {
    active = false
    console.warn('[op-walkthroughs] nothing to start', recipeIds)
    return
  }

  pageLayer.startWalkthrough(plans)
}

const SUGGEST_OFFER_ID = 'suggest-after-orientation'

// Long enough for the confetti and the completion popup (which self-dismisses at 6s) to
// clear, so the suggestion reads as the next beat rather than competing with the applause.
const SUGGEST_DELAY_MS = 6500

/**
 * Offer the next walkthrough once orientation finishes.
 *
 * Offered, never started. Orientation used to chain straight into Audit setup, which meant
 * finishing a nav tour dropped the user into a form they had not asked for. Suggesting it
 * keeps the choice with them, and reuses the same offer toast and the same two-dismissals
 * suppression rule as the contextual triggers.
 */
async function suggestNextAfterOrientation() {
  const [profile, progress] = await Promise.all([
    storage.sync.get(KEYS.PROFILE),
    storage.local.get(KEYS.PROGRESS),
  ])

  if (!profile?.wantsGuidance) return

  // Their stated purposes decide what is worth suggesting. Skip anything they have already
  // done, and fall back to creating an Audit -- the one thing every new account needs.
  const candidates = [...recommendedRecipeIds(profile.purposes ?? []), 'create-first-audit']
  const completed = progress?.completedRecipes ?? {}

  const recipeId = candidates.find(id => id !== ORIENTATION_RECIPE_ID && !completed[id])
  if (!recipeId) return

  const offer = { id: SUGGEST_OFFER_ID, recipeId }
  if (isSuppressed(offer, progress ?? {})) return

  const recipe = resolveRecipe(recipeId)
  if (!recipe) return

  await new Promise(r => window.setTimeout(r, SUGGEST_DELAY_MS))

  // They may have started something else in the meantime.
  if (active) return

  await recordSeen(SUGGEST_OFFER_ID, {
    count: (progress?.seenTriggers?.[SUGGEST_OFFER_ID]?.count ?? 0) + 1,
  })

  showOffer({
    title: 'Want to keep going?',
    body: `${recipe.goal} — ${recipe.steps.length} steps. We can walk you through it now, or you can find it later under Settings > Walkthroughs.`,
    acceptLabel: 'Show me',
    onAccept: () => startWalkthroughs([recipeId]),
    onNever: () => recordSeen(SUGGEST_OFFER_ID, { suppressed: true }),
  })
}

function endWalkthrough(reason) {
  active = false
  pageLayer.endWalkthrough(reason)
  endButton.hide()
  sendToBackground(MSG.END_WALKTHROUGH, { reason })
}

// The only place the Settings intro is switched on. Someone who just answered the
// questions has no idea the Walkthroughs menu item exists, so the tour opens by pointing
// at it. Anywhere else -- the picker especially -- that would be redundant.
function showOnboarding() {
  openOnboarding({
    onComplete: (profile, chain) => {
      setPurposeIds(profile)
      startWalkthroughs(chain, {}, { includeSettingsIntro: true })
    },
  })
}

function showPicker() {
  openPicker({
    onStart: recipeId => startWalkthroughs([recipeId]),
    onStartOnboarding: showOnboarding,
  })
}

/**
 * Turn a free-text intent into a running walkthrough.
 *
 * This is the seam a chat UI plugs into. Page context is gathered here because only the
 * content script can see the DOM, and ad-hoc generation needs it — it travels with the
 * intent in one round trip rather than the background calling back for it.
 */
async function requestWalkthrough(intent) {
  const pageContext = pageLayer.simplifyDom()

  sendToBackground(MSG.PAGE_CONTEXT_UPDATED, pageContext)

  const result = await sendToBackground(MSG.INTENT_RECEIVED, { intent, pageContext })

  if (!result?.plan) {
    console.warn('[op-walkthroughs] no plan for intent', intent, result?.error)
    return { ok: false, error: result?.error ?? 'Background did not respond.' }
  }

  active = true
  pageLayer.startWalkthrough([result.plan])
  return { ok: true, source: result.source }
}

async function boot() {
  startNavigationWatch()

  // Safe to start immediately — it's watching for a menu panel that may not exist for
  // minutes, and it works on every route.
  startSettingsMenuInjection(showPicker)

  // Everything else needs the app shell, which never appears on the login/signup routes.
  try {
    await waitForAppShell()
  } catch {
    console.debug('[op-walkthroughs] no app shell on this route, staying idle')
    return
  }

  const profile = await storage.sync.get(KEYS.PROFILE)
  setPurposeIds(profile)

  if (!profile?.completedOnboarding) showOnboarding()
  else startTriggers({ isRunning: () => active, onAccept: id => startWalkthroughs([id]) })

  console.log('[op-walkthroughs] ready', RECIPES.length, 'recipes')
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { type, payload } = message ?? {}

  switch (type) {
    case MSG.OPEN_PICKER:
      showPicker()
      break

    case MSG.URL_CHANGED:
      // Backup signal for the case where our in-page history patch missed one.
      notifyExternalUrlChange()
      break

    case MSG.START_WALKTHROUGH:
      // The background can start one directly — how an ad-hoc generated plan arrives.
      // Orientation is the exception: the background only ever has the core-only default,
      // so re-resolve it here where the profile is reachable.
      if (payload?.plan?.recipeId === ORIENTATION_RECIPE_ID)
        startWalkthroughs([ORIENTATION_RECIPE_ID])
      else if (payload?.plan) pageLayer.startWalkthrough([payload.plan])
      else if (payload?.recipeIds) startWalkthroughs(payload.recipeIds, payload.parameters)
      break

    case MSG.END_WALKTHROUGH:
      endWalkthrough(payload?.reason ?? END_REASON.USER)
      break

    default:
      break
  }

  sendResponse?.({ ok: true })
  return false
})

boot()

// Dev handle. The content script runs in an isolated world, so this is reachable from
// DevTools once you switch the console context to the extension, and is not exposed to
// the page.
window.__opWt = {
  recipes: RECIPES,
  segments: NAV_SEGMENTS,
  // What the guards see right now. Run it in each nav state -- pinned, unpinned, mobile
  // drawer open -- and compare.
  guards: () => pageLayer.inspectGuards(),
  // Compose an orientation without touching stored state — much faster than resetAll()
  // and re-answering onboarding for every combination you want to check.
  orientation: (purposeIds, options) => buildOrientation(purposeIds ?? [], options ?? {}),
  startOrientation: (purposeIds, options) =>
    pageLayer.startWalkthrough([buildOrientation(purposeIds ?? [], options ?? {})]),
  plan: async (recipeId, parameters) =>
    hydratePlan(resolveRecipe(recipeId, { purposeIds: await loadPurposeIds() }), parameters ?? {}),
  start: (recipeId, parameters) => startWalkthroughs([recipeId], parameters),
  startChain: recipeIds => startWalkthroughs(recipeIds),
  end: () => endWalkthrough(END_REASON.USER),
  picker: showPicker,
  onboarding: showOnboarding,
  ask: requestWalkthrough,
  pageLayer,
  statusBar: endButton.sync,
  resetProfile: () => storage.sync.remove(KEYS.PROFILE),
  resetProgress: () => storage.local.remove(KEYS.PROGRESS),
  resetAll: () =>
    Promise.all([
      storage.sync.remove(KEYS.PROFILE),
      storage.local.remove(KEYS.PROGRESS),
      storage.local.remove(KEYS.SESSION),
    ]),
}
