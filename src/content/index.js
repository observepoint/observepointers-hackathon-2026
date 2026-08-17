/**
 * Content script. Two jobs.
 *
 * 1. ACCOUNT BRIDGE — the piece that lets the Copilot plan against what is
 *    actually in your account instead of guessing.
 *
 *    moonbeam does NOT authenticate with cookies. Its auth-request interceptor
 *    reads a bearer token out of localStorage and sets an Authorization header
 *    (core/interceptors/auth-request.interceptor.ts), so `credentials: 'include'`
 *    on its own gets you a 401. A content script shares the page's origin for
 *    storage, so it can read that same token and make the same authenticated
 *    call the app makes.
 *
 *    The token crosses exactly one boundary: this script → our own service
 *    worker, which needs it because a content script's cross-origin fetch obeys
 *    the *page's* CORS policy and the app host does not proxy /api. It goes no
 *    further. The side panel asks for a path and gets back JSON, so it never
 *    sees the credential and a bug up there cannot leak it. An earlier version
 *    of this comment claimed the token never left this file; that stopped being
 *    true when the fetch moved to the worker, and saying so was worse than the
 *    change itself.
 *
 * 2. PLAN_READY receipt — Part 2's placeholder. Logs the plan and flags whether
 *    its first step resolves on this page.
 *
 * WHERE THIS RUNS
 * The manifest injects only on the hosts below — not <all_urls>. The extension
 * is useless anywhere else, and a script on every page you visit is a much
 * bigger ask than one on the app it automates. Chrome match patterns ignore the
 * port, so `http://localhost/*` covers moonbeam's dev server on :4200.
 *
 * Part 2 and Part 3, if you need the pointer on some other page to test:
 * background/index.js::ensureContentScript() injects on demand via
 * chrome.scripting, which the `activeTab` permission covers once the user has
 * opened the panel. Narrowing the declared matches did not take that away.
 */

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
    let element
    try {
      element = document.querySelector(selector)
    } catch {
      return { id, selector, found: false, visible: false, error: 'invalid-selector' }
    }

    if (!element) return { id, selector, found: false, visible: false }

    const rect = element.getBoundingClientRect()
    return {
      id,
      selector,
      found: true,
      visible: rect.width > 1 && rect.height > 1 && element.offsetParent !== null,
      text: (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
    }
  })
}

/* ---------------------------------------------------------------------- *
 * PART 2 territory — replace handlePlan() with the real runtime.
 * ---------------------------------------------------------------------- */

function handlePlan(plan) {
  console.groupCollapsed(
    `%c[copilot] PLAN_READY %c${plan.recipeId} — ${plan.steps.length} steps`,
    'color:#d5a900;font-weight:bold',
    'color:inherit',
  )
  console.log('goal:', plan.goal)
  console.log('summary:', plan.summary)
  console.log('parameters:', plan.parameters)
  console.table(
    plan.steps.map(s => ({
      id: s.id,
      actor: s.actor,
      target: s.targetSelector,
      action: s.action?.type ?? '—',
      completion: s.completion.type,
      say: s.say,
    })),
  )

  const first = plan.steps[0]
  const found = document.querySelector(first.targetSelector)
  console.log(
    found
      ? `%c✓ step ${first.id} resolves on this page`
      : `%c✗ step ${first.id} does NOT resolve here (${first.targetSelector})`,
    `color:${found ? '#50bc77' : '#f34146'}`,
  )
  console.groupEnd()
}

/* ---------------------------------------------------------------------- *
 * Message routing
 * ---------------------------------------------------------------------- */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'PLAN_READY') {
    handlePlan(message.plan)
    return false
  }

  if (message?.type === 'OP_CHECK_SELECTORS') {
    sendResponse({
      ok: true,
      results: checkSelectors(message.selectors ?? []),
      page: { url: location.href, screen: describeScreen() },
    })
    return false
  }

  if (message?.type === 'OP_AUTH_CONTEXT') {
    sendResponse(authContext())
    return false
  }

  if (message?.type === 'OP_ACCOUNT_STATUS') {
    sendResponse({
      ok: OP_HOST.test(location.hostname) && Boolean(readAuthToken()),
      onObservePoint: OP_HOST.test(location.hostname),
      signedIn: Boolean(readAuthToken()),
      environment: environmentName(),
      hostname: location.hostname,
      advancedAuditMode: usesAdvancedAuditMode(),
    })
    return false
  }

  return false
})

console.log('[copilot] content script ready')
