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
import * as bubble from './ui/bubble.js'
import * as voice from './voice.js'
// Part 1's recipe catalogue, for the selector sweep below. Pure data and pure functions --
// no DOM, no API key -- so it is safe on the app's origin.
import { allKnownSelectors } from '../planner/recipes/index.js'
import { parseTargetSelector, applyOperators } from './selector-query.js'

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
  return 'an unrecognized page'
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
        text: describe(element),
        ...position(selector, element),
      }
    }

    // The same query WITHOUT the visibility filter, so "there but hidden" stays
    // distinguishable from "not in the DOM".
    //
    // The operators have to be applied here too. Dropping them and matching the CSS
    // part alone reports the wrong thing with total confidence: a sweep of the
    // consent-category create menu said `button[mat-menu-item] >> text=Audits` was
    // "in DOM but hidden" -- three times -- because SOME menu item existed. There is
    // no Audits item on that menu and never was. A sweep that invents evidence is
    // worse than one that misses.
    const { css, ops } = parseTargetSelector(selector)
    let candidates
    try {
      candidates = Array.from(document.querySelectorAll(css))
    } catch {
      return { id, selector, found: false, visible: false, error: 'invalid-selector' }
    }

    const hidden = applyOperators(candidates, ops)[0]
    if (!hidden) return { id, selector, found: false, visible: false }

    return { id, selector, found: true, visible: false, text: describe(hidden) }
  })
}

/**
 * What the element says, for confirming a tick landed on the right thing.
 *
 * Falls back to `value` because the most interesting targets in the rule grid are
 * INPUTS, and an input has no textContent. A whole sweep of the variable grid came
 * back as five ticks with nothing beside them — which resolves the selector and says
 * nothing about which row it found.
 */
function describe(element) {
  const text = (element.textContent || '').replace(/\s+/g, ' ').trim()
  if (text) return text.slice(0, 40)

  // A checkbox's `value` is the string "on" whether or not it is ticked, which reads
  // exactly like state and is not. The sweep of the REGEX column said "value: on"
  // while the box was empty. Report what is actually being asked about.
  const box = element.matches?.('input[type=checkbox], input[type=radio]')
    ? element
    : element.querySelector?.('input[type=checkbox], input[type=radio]')
  if (box) return box.checked ? 'checked' : 'unchecked'

  const value = element.value ?? element.querySelector?.('input, textarea, select')?.value
  return value ? `value: ${String(value).slice(0, 40)}` : ''
}

/**
 * Which of the matches did an operator pick?
 *
 * The only way to prove `>> last` does anything. Swept against a grid with one row,
 * "the last one" and "the only one" are the same element and the tick means nothing;
 * against three rows, "3 of 3" is the whole claim. Reported only when the selector
 * uses operators, since 1 of 1 on a plain selector is noise.
 */
function position(selector, element) {
  const { css, ops } = parseTargetSelector(selector)
  if (!ops.length) return {}

  try {
    const all = Array.from(document.querySelectorAll(css)).filter(isOnScreen)
    const index = all.indexOf(element)
    if (index === -1) return {}
    return { matched: index + 1, outOf: all.length }
  } catch {
    return {}
  }
}

function isOnScreen(el) {
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

let active = false

// The page layer drives the status bar and tells us when a walkthrough finishes.
pageLayer.registerHostCallbacks({
  onState: state => {
    active = Boolean(state) && state.status !== 'idle'
    // Remembered so endWalkthrough() knows what was on screen. The End button hands us
    // a reason, not a recipe, and the offer below is worth showing for exactly one of
    // them.
    if (state?.recipeId) runningRecipeId = state.recipeId
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

let runningRecipeId = null

const SUGGEST_OFFER_ID = 'suggest-after-orientation'

// Long enough for the confetti and the completion popup (which self-dismisses at 6s) to
// clear, so the suggestion reads as the next beat rather than competing with the applause.
const SUGGEST_DELAY_MS = 6500

// Nothing to wait out when the user ended it themselves — no confetti, no popup.
const SUGGEST_AFTER_END_MS = 1200

/**
 * Offer the next walkthrough once orientation finishes.
 *
 * Offered, never started. Orientation used to chain straight into Audit setup, which meant
 * finishing a nav tour dropped the user into a form they had not asked for. Suggesting it
 * keeps the choice with them, and reuses the same offer toast and the same two-dismissals
 * suppression rule as the contextual triggers.
 */
async function suggestNextAfterOrientation({ delayMs = SUGGEST_DELAY_MS } = {}) {
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

  await new Promise(r => window.setTimeout(r, delayMs))

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
  const wasRunning = runningRecipeId
  runningRecipeId = null

  active = false
  pageLayer.endWalkthrough(reason)
  endButton.hide()
  sendToBackground(MSG.END_WALKTHROUGH, { reason })

  // Ending the tour early is not the same as not wanting anything. Someone who has seen
  // enough of the nav still has an empty account, and the offer is the only place the
  // next thing is mentioned — so it now follows an abandoned orientation as well as a
  // finished one.
  //
  // Shorter delay than the completion path: that one waits for confetti and a popup to
  // clear, and neither happens here. Long enough to not read as an argument with the
  // button they just pressed.
  if (reason === END_REASON.USER && wasRunning === ORIENTATION_RECIPE_ID) {
    suggestNextAfterOrientation({ delayMs: SUGGEST_AFTER_END_MS })
  }
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

/* ---------------------------------------------------------------------- *
 * THE LAUNCHER
 *
 * What the side panel used to do, in the corner of the app. Planning happens in the
 * service worker (OP_PLAN) rather than here: a content script runs on the app's origin,
 * and the model prompt -- with the API key on that path -- has no business there.
 *
 * When the result is a plan, the worker sends PLAN_READY to this tab itself, so the
 * handoff to Part 2 is the same one it has always been.
 * ---------------------------------------------------------------------- */

// A `needs_input` result waiting on an answer. The launcher hands it back on submit so
// the answer resumes the plan rather than being read as a new request.
let pendingQuestion = null
// The ORIGINAL request. answerAndRetry rebuilds from it, so the goal that reaches the
// planner on an answer has to be the question's goal and not the answer itself --
// buildChain reads it, and "jun@observepoint.com" chains to nothing.
let lastGoal = ''

/**
 * Has this content script been orphaned?
 *
 * Reloading the extension leaves the OLD content script running in every open tab, with a
 * dead `chrome.runtime`. Every call then fails with "Extension context invalidated", and
 * the page keeps the stale code until it is reloaded — which is why the behaviour looked a
 * version behind at the same time: the transcript-confirm step existed in the new bundle
 * and the page was still running the one that submitted straight away.
 *
 * `chrome.runtime.id` is the cheap tell; the message match covers a context that dies
 * mid-call.
 */
function contextGone(error) {
  if (!chrome.runtime?.id) return true
  return /Extension context invalidated|message port closed/i.test(error?.message ?? '')
}

function reachError(error) {
  if (contextGone(error)) {
    return 'Observe Pointers was updated — reload this page to pick up the new version.'
  }
  return `Could not reach the planner: ${error?.message ?? 'unknown error'}`
}

async function askPlanner(goal, answering) {
  // Checked up front as well as caught: an orphaned script cannot plan, and spending two
  // seconds pretending to before saying so is worse than saying so.
  if (!chrome.runtime?.id) {
    return bubble.say(reachError(new Error('Extension context invalidated')), { sticky: true })
  }

  bubble.setBusy(true)
  bubble.setHint('Working out the steps…')

  try {
    // chrome.runtime.sendMessage directly, not sendToBackground: that helper swallows a
    // rejection and returns null, which reached the user as "No answer from the planner"
    // while the actual reason -- a closed message port, because the worker was still
    // waiting on an untimed account fetch -- went to a console nobody was reading.
    //
    // Third time in a row that discarding an error cost a round trip. The reason travels.
    const result = await chrome.runtime.sendMessage({
      type: 'OP_PLAN',
      payload: {
        goal: answering ? lastGoal : goal,
        pending: answering ?? null,
        answer: answering ? goal : undefined,
      },
    })
    handlePlannerResult(result, answering ? lastGoal : goal)
  } catch (error) {
    bubble.say(reachError(error), { sticky: contextGone(error) })
  } finally {
    bubble.setBusy(false)
    bubble.setHint('')
  }
}

function handlePlannerResult(result, goal) {
  if (!result) return bubble.say('No answer from the planner.')

  // The worker's listener turns any throw into { ok: false, error } with no `status`, so
  // without this it fell to the default branch below and the reason was thrown away —
  // which is exactly how a real failure came back as "Something went wrong building that
  // plan." and told nobody anything.
  if (result.ok === false || (!result.status && result.error)) {
    return bubble.say(result.error ?? 'The planner did not answer.')
  }

  switch (result.status) {
    case 'plan':
      pendingQuestion = null
      // The worker has already sent PLAN_READY, so the walkthrough is starting. One line
      // is the right amount to say -- the walkthrough itself is the output.
      //
      // startError means the plan is fine and only the handoff failed. Saying so beats a
      // summary for a walkthrough that never began.
      bubble.say(result.startError ?? result.plan.summary, { dim: !result.startError })
      break

    case 'needs_input':
      // Asking beats guessing: an invented URL gets typed into a real form.
      pendingQuestion = result
      bubble.askQuestion(result)
      break

    case 'no_match':
      pendingQuestion = null
      bubble.say(result.message)
      break

    default:
      pendingQuestion = null
      bubble.say(
        result.message || `The planner returned something unexpected: ${JSON.stringify(result)}`,
      )
  }

  if (goal) lastGoal = goal
}

function startVoice() {
  voice.startListening({
    onPartial: partial => bubble.showTranscript(partial),
    onError: message => bubble.say(message),
    onEnd: () => bubble.recordingEnded(),
    // Confirmed, not sent. The transcript is a guess -- it renders the demo sentence as
    // "observe point dot com" often enough that acting on it unseen is a coin toss -- so
    // the launcher shows it with an Ask and a pencil, and commits through the same door
    // typing does.
    onResult: text => bubble.confirmTranscript(text),
  })
}

async function boot() {
  startNavigationWatch()

  // Mounted before the app shell check below: the launcher is how someone asks for
  // anything, and it should be there on every route the content script runs on.
  bubble.mountBubble({
    onAsk: (text, answering) => askPlanner(text, answering ?? pendingQuestion),
    onMicStart: startVoice,
    onMicStop: () => voice.stopListening(),
  })

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

  console.log('[observe-pointers] ready', RECIPES.length, 'recipes')
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { type, payload } = message ?? {}

  switch (type) {
    case MSG.OPEN_PICKER:
      showPicker()
      break

    // The toolbar icon. There is no side panel to open any more.
    case 'OP_TOGGLE_BUBBLE':
      bubble.toggleBubble()
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
/**
 * The selector sweep, as a console command.
 *
 * It used to be a button in the side panel, and the panel is gone. Losing it was not an
 * option: it is the only thing that turns `unverified: true` into evidence, and every
 * selector this library trusts was confirmed with it.
 *
 * A console command is arguably the better home anyway — the output gets read and pasted,
 * which is not what a panel is for.
 *
 *   __opWt.check()             every selector we ship, against this screen
 *   __opWt.check('create_first_alert')   just that recipe's
 *
 * Read the ECHOED TEXT, not just the tick. A ✓ on the wrong element is the failure mode
 * that costs the most, and the echo is the only thing that catches it.
 */
async function sweepScreen(recipeId) {
  const { RECIPES: PLANNER_RECIPES, representativeParameters } =
    await import('../planner/recipes/index.js')

  let steps
  if (recipeId) {
    const recipe = PLANNER_RECIPES.find(r => r.id === recipeId)
    if (!recipe) return `No recipe "${recipeId}".`
    steps =
      recipe.steps ?? recipe.buildSteps({ parameters: representativeParameters(recipe), goal: '' })
    steps = steps.map(step => ({ id: `${recipe.id}/${step.id}`, ...step }))
  } else {
    steps = allKnownSelectors().map(s => ({ id: s.id, targetSelector: s.selector }))
  }

  // What a step WAITS on as well as what it points at: a completion that never resolves
  // stalls the walkthrough silently, which is the failure worth the most to catch.
  const selectors = steps.flatMap(step => {
    const target = { id: step.id, selector: step.targetSelector }
    const waitsFor = step.completion?.targetSelector
    if (!waitsFor || waitsFor === step.targetSelector) return [target]
    return [target, { id: `${step.id} waits for`, selector: waitsFor }]
  })

  const results = checkSelectors(selectors)

  // Found-first: on a sweep of everything we ship, the handful that resolve are the
  // answer and the rest are noise.
  const sorted = [...results].sort(
    (a, b) => Number(b.visible) - Number(a.visible) || Number(b.found) - Number(a.found),
  )

  const body = sorted
    .map(r => {
      const mark = r.visible ? '✓' : r.found ? '·' : '✗'
      // "matched 3 of 3" is the only thing that proves an operator did anything: on a grid
      // with one row, `>> last` and a plain selector pick the same element.
      const which = r.outOf ? ` [matched ${r.matched} of ${r.outOf}]` : ''
      const note = r.visible
        ? r.text
          ? `visible — "${r.text}"${which}`
          : `visible${which}`
        : r.found
          ? 'in DOM but hidden'
          : (r.error ?? 'not found')
      return `${mark} ${r.id}  ${note}\n   ${r.selector}`
    })
    .join('\n')

  // Lead with where we looked. Without it "0 of 9" reads as "the selectors are wrong"
  // when the answer is almost always "wrong screen".
  return `Checking ${selectors.length} selectors\non ${describeScreen()} — ${location.href}\n\n${body}`
}

window.__opWt = {
  check: async recipeId => {
    console.log(await sweepScreen(recipeId))
  },
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
