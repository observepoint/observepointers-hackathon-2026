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
 *    The token never leaves this file. The side panel asks for a path and gets
 *    back JSON; it never sees the credential, so a bug up there can't leak it.
 *
 * 2. PLAN_READY receipt — Part 2's placeholder. Logs the plan and flags whether
 *    its first step resolves on this page.
 */

const OP_HOST = /(^|\.)observepoint(staging)?\.com$/i

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

function environmentName() {
  return location.hostname.includes('observepointstaging') ? 'staging' : 'production'
}

async function apiGet(path) {
  if (!OP_HOST.test(location.hostname)) {
    return { ok: false, error: 'not-on-observepoint', hostname: location.hostname }
  }

  const token = readAuthToken()
  if (!token) return { ok: false, error: 'not-signed-in' }

  // Paths arrive relative ("/api/v3/consent-categories/library") and resolve
  // against this tab's origin, so staging and prod are handled by whichever tab
  // you happen to be on rather than by configuration.
  const url = new URL(path, location.origin).toString()

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      credentials: 'include',
    })

    const contentType = response.headers.get('content-type') ?? ''
    const body = await response.text()

    if (!response.ok) {
      return {
        ok: false,
        error: `http-${response.status}`,
        status: response.status,
        contentType,
        finalUrl: response.url,
        snippet: body.slice(0, 160),
      }
    }

    // A 200 that returns HTML means the request never reached the API — the
    // host served the SPA's index.html for an unmatched path. Reporting that as
    // "Unexpected token '<'" tells you nothing, so name it.
    if (!contentType.includes('json')) {
      return {
        ok: false,
        error: 'not-json',
        status: response.status,
        contentType,
        finalUrl: response.url,
        snippet: body.slice(0, 160),
      }
    }

    try {
      return { ok: true, data: JSON.parse(body), environment: environmentName() }
    } catch {
      return {
        ok: false,
        error: 'bad-json',
        contentType,
        finalUrl: response.url,
        snippet: body.slice(0, 160),
      }
    }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
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

  if (message?.type === 'OP_API_GET') {
    apiGet(message.path).then(sendResponse)
    return true // async reply
  }

  if (message?.type === 'OP_ACCOUNT_STATUS') {
    sendResponse({
      ok: OP_HOST.test(location.hostname) && Boolean(readAuthToken()),
      onObservePoint: OP_HOST.test(location.hostname),
      signedIn: Boolean(readAuthToken()),
      environment: environmentName(),
      hostname: location.hostname,
    })
    return false
  }

  return false
})

console.log('[copilot] content script ready')
