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
import { cssPartOf } from './selector-query.js'

/* ---------------------------------------------------------------------- *
 * PART 1's ACCOUNT BRIDGE
 *
 * moonbeam does NOT authenticate with cookies. Its auth-request interceptor
 * reads a bearer token out of localStorage and sets an Authorization header
 * (core/interceptors/auth-request.interceptor.ts), so `credentials: 'include'`
 * on its own gets you a 401. A content script shares the page's origin for
 * storage, so it can read that same token and make the same authenticated call
 * the app makes. That is what lets a plan say "gap.com — us,ca already covers
 * this site" instead of "search for the category".
 *
 * The token crosses exactly one boundary: this script -> our own service worker,
 * which needs it because a content script's cross-origin fetch obeys the
 * *page's* CORS policy and the app host does not proxy /api. It goes no further.
 * The side panel asks for a path and gets back JSON, so it never sees the
 * credential and a bug up there cannot leak it.
 * ---------------------------------------------------------------------- */

// Kept in sync with the manifest's content_scripts.matches by hand. This is the
// runtime guard, that is the injection filter, and they answer different
// questions — on-demand injection can land us somewhere matches would not.
// Local moonbeam (`npm start` → localhost:4200) counts: it is the same app,
// and its dev environment.ts points at the staging API, so everything else
// works unchanged.
const OP_HOST = /(^|\.)observepoint(staging)?\.com$|^localhost$|^127\.0\.0\.1$/i

/* ---------------------------------------------------------------------- *
 * Account bridge
 * ---------------------------------------------------------------------- */

/**
 * Impersonation is checked first because that is the order moonbeam itself
 * uses — a support user acting as a customer must read the customer's account,
 * not their own.
 */
function readAuthToken() {
  const sources = [
    () => sessionStorage.getItem('authImpersonate'),
    () => localStorage.getItem('authorization'),
  ]
  for (const read of sources) {
    try {
      const parsed = JSON.parse(read() ?? 'null')
      if (parsed?.token) return parsed.token
    } catch {
      /* malformed entry — try the next source */
    }
  }
  return null
}

/**
 * moonbeam's own branch: manage-cards.component.ts::createWebAudit() opens the
 * ADVANCED editor unless this is explicitly false (or the account has no data
 * sources at all). storage.service.ts returns `value ?? true`, so advanced is
 * the default — the opposite of what the recipe originally assumed.
 */
function usesAdvancedAuditMode() {
  for (const key of ['useAdvancedAuditMode.other', 'useAdvancedAuditMode']) {
    try {
      const raw = localStorage.getItem(key)
      if (raw !== null) return JSON.parse(raw) !== false
    } catch {
      /* try the next key */
    }
  }
  return true // matches storage.service.ts's own default
}

function environmentName() {
  if (/^(localhost|127\.0\.0\.1)$/i.test(location.hostname)) return 'local'
  return location.hostname.includes('observepointstaging') ? 'staging' : 'production'
}

/**
 * Hands the session token to the background worker, which makes the actual
 * call.
 *
 * This used to fetch from here, which was nicer — the credential never left the
 * page's own context. It doesn't work: every /api/* path on this origin returns
 * the SPA's index.html, so the API is served from a different host, and a
 * content script's cross-origin fetch is subject to the page's CORS policy. The
 * background worker has the extension's host permissions and isn't, so the call
 * has to happen there.
 *
 * The token therefore crosses one boundary, from this script to our own service
 * worker. It never reaches the side panel and never leaves the extension.
 */
function authContext() {
  if (!OP_HOST.test(location.hostname)) {
    return { ok: false, error: 'not-on-observepoint', hostname: location.hostname }
  }

  const token = readAuthToken()
  if (!token) return { ok: false, error: 'not-signed-in', hostname: location.hostname }

  return {
    ok: true,
    token,
    origin: location.origin,
    hostname: location.hostname,
    environment: environmentName(),
  }
}

/**
 * Does each of these selectors resolve on the screen in front of you?
 *
 * This is how a step earns `verified`. Every recipe currently carries
 * `unverified: true` on the steps nobody has clicked through, and the only
 * honest way to clear that flag is to stand on the screen and look. Doing it by
 * hand means pasting selectors into devtools one at a time; this checks the
 * whole plan at once.
 *
 * Found-but-hidden is reported separately from missing, because they mean
 * different things: hidden usually means "right selector, wrong screen — you
 * haven't opened the modal yet", while missing means the selector is wrong.
 */
/**
 * Landmarks that identify which screen you're on. "0/9 resolve" is useless on
 * its own — the first question is always "where was it looking?", and the
 * answer is nearly always "a different screen than the step expects".
 */
const LANDMARKS = [
  ['the audit editor (advanced)', '.op-audit-editor'],
  ['the standards picker', '.op-standards-selector'],
  ['Quick Audit', '.audit-setup-modal'],
  ['Data Sources', '[op-selector="cards-view-container"]'],
  ['API Keys', '[op-selector="api-keys-panel"]'],
  ['an ObservePoint page', '[op-selector="top-nav-bar"]'],
]

function describeScreen() {
  for (const [label, selector] of LANDMARKS) {
    try {
      if (document.querySelector(selector)) return label
    } catch {
      /* ignore */
    }
  }
  return 'an unrecognised page'
}

function checkSelectors(selectors) {
  return selectors.map(({ id, selector }) => {
    // The runtime's own lookup, not a raw querySelector. A sweep that resolves
    // selectors differently from the run it is verifying answers the wrong question
    // -- and would report every `>>` selector as invalid, on precisely the recipes
    // with the most unswept steps.
    let element
    try {
      element = pageLayer.resolveTarget(selector)
    } catch {
      return { id, selector, found: false, visible: false, error: 'invalid-selector' }
    }

    // resolveTarget already filters to laid-out elements, so anything it returns is
    // on screen. The fallback below is what distinguishes "not in the DOM at all"
    // from "there but hidden", which is a finding rather than a near miss.
    if (element) {
      return {
        id,
        selector,
        found: true,
        visible: true,
        text: (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
      }
    }

    let hidden
    try {
      hidden = document.querySelector(cssPartOf(selector))
    } catch {
      return { id, selector, found: false, visible: false, error: 'invalid-selector' }
    }

    if (!hidden) return { id, selector, found: false, visible: false }

    return {
      id,
      selector,
      found: true,
      visible: false,
      text: (hidden.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
    }
  })
}

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

  console.log('[observe-pointers] ready', RECIPES.length, 'recipes')
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

    // --- Part 1 ----------------------------------------------------------
    // PLAN_READY is Part 1's documented handoff and every committed fixture is
    // built against it, so it is kept and routed here rather than renamed. The
    // panel needs no change; this is the whole seam.
    // `plans` is the whole chain in order — "import the consent categories, create
    // the rule, create the alert, then build the audit" arrives as four plans. It
    // falls back to the single plan, because that is what every committed fixture
    // and every unchained recipe sends.
    case 'PLAN_READY':
      if (message?.plans?.length) pageLayer.startWalkthrough(message.plans)
      else if (message?.plan) pageLayer.startWalkthrough([message.plan])
      break

    // Part 1's messages are flat ({ type, path }), not { type, payload }, and
    // they answer synchronously — so each returns before the blanket
    // sendResponse({ ok: true }) below can clobber it.
    case 'OP_AUTH_CONTEXT':
      sendResponse(authContext())
      return false

    case 'OP_ACCOUNT_STATUS':
      sendResponse({
        ok: OP_HOST.test(location.hostname) && Boolean(readAuthToken()),
        onObservePoint: OP_HOST.test(location.hostname),
        signedIn: Boolean(readAuthToken()),
        hostname: location.hostname,
        environment: environmentName(),
        advancedAuditMode: usesAdvancedAuditMode(),
      })
      return false

    case 'OP_CHECK_SELECTORS':
      sendResponse({
        ok: true,
        results: checkSelectors(message?.selectors ?? []),
        page: { screen: describeScreen(), url: location.href },
      })
      return false

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
