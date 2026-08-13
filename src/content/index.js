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
import { RECIPES, getRecipe } from '../shared/recipes.js'
import { hydratePlan } from '../shared/hydrate.js'
import { startNavigationWatch, notifyExternalUrlChange } from './navigation.js'
import { waitForAppShell } from './app-ready.js'
import { startSettingsMenuInjection } from './settings-menu.js'
import { startTriggers } from './triggers.js'
import * as pageLayer from './page-layer.js'
import { openPicker } from './ui/picker.js'
import { openOnboarding } from './ui/onboarding.js'
import * as endButton from './ui/end-button.js'

let active = false

// The page layer drives the status bar and tells us when a walkthrough finishes.
pageLayer.registerHostCallbacks({
  onState: state => {
    active = Boolean(state) && state.status !== 'idle'
    endButton.sync(state)
  },
  onCompleted: recipeId => markCompleted(recipeId),
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

/**
 * Hand an ordered list of recipes to the page layer as hydrated plans.
 *
 * Hydration happens here so the page layer never has to know about recipes or
 * {{parameters.*}} placeholders — it receives finished, validated plans.
 *
 * An array rather than a single plan because onboarding delivers several short chained
 * walkthroughs rather than one long tour.
 */
function startWalkthroughs(recipeIds, parameters = {}) {
  const plans = recipeIds
    .map(getRecipe)
    .filter(Boolean)
    .map(recipe => hydratePlan(recipe, parameters))

  if (plans.length === 0) {
    console.warn('[op-walkthroughs] nothing to start', recipeIds)
    return
  }

  active = true
  pageLayer.startWalkthrough(plans)
}

function endWalkthrough(reason) {
  active = false
  pageLayer.endWalkthrough(reason)
  endButton.hide()
  sendToBackground(MSG.END_WALKTHROUGH, { reason })
}

function showOnboarding() {
  openOnboarding({ onComplete: (_profile, chain) => startWalkthroughs(chain) })
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
      if (payload?.plan) pageLayer.startWalkthrough([payload.plan])
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
  plan: (recipeId, parameters) => hydratePlan(getRecipe(recipeId), parameters ?? {}),
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
