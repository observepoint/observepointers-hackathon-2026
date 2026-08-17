/**
 * Part 1 — the chat surface.
 *
 * Takes a question (typed or spoken), runs it through the planner, renders the
 * result, and hands the finished Plan to Part 2.
 *
 * THE HANDOFF (Part 2 listens for this):
 *   chrome.runtime.sendMessage({ type: 'PLAN_READY', plan })
 *
 * That's the entire integration surface. Part 2 does not import from Part 1 and
 * does not need to know a model was involved.
 */

import { mountInput } from './input.js'
// DEBUG — delete this import and the renderOutgoingPlan() call below to remove.
import { renderOutgoingPlan } from './debug-plan.js'
import { createPlan, answerAndRetry, suggestions } from '../planner/index.js'
import { allKnownSelectors } from '../planner/recipes/index.js'
import { getStoredApiKey } from '../planner/llm.js'
import {
  ONBOARDING_QUESTION,
  onboardingOptions,
  loadOnboarding,
  saveOnboarding,
  biasSuggestions,
} from '../planner/onboarding.js'
import {
  status as accountStatus,
  listConsentCategories,
  listRules,
  probeApi,
  checkSelectors,
} from '../planner/account.js'

const transcript = document.getElementById('transcript')
const statusEl = document.getElementById('status')

let controller = null
let pendingQuestion = null // a `needs_input` result awaiting an answer
// Both left undefined, not [] — "we never managed to read it" has to stay
// distinguishable from "we read it and it was empty". Onboarding branches on
// the second, and an unread account defaulting to [] would tell someone with a
// full library to go build a duplicate.
let lastCategories
let lastRules
let lastAccountState = null // e.g. whether this user gets Quick Audit or Advanced
let lastGoal = ''
let lastPlan = null // so the screen can be re-checked without asking again
let onboardingAnswer = null // what they said they came for, from a previous run

/* ---------------------------------------------------------------------- *
 * Rendering
 * ---------------------------------------------------------------------- */

function addMessage(role, text) {
  const el = document.createElement('div')
  el.className = `msg ${role}`
  el.textContent = text
  transcript.appendChild(el)
  transcript.scrollTop = transcript.scrollHeight
  return el
}

function addSuggestions(items) {
  const wrap = document.createElement('div')
  wrap.className = 'chips'
  for (const item of items) {
    const chip = document.createElement('button')
    chip.className = 'chip'
    chip.textContent = item.title
    chip.title = item.example
    chip.addEventListener('click', () => controller.prefill(item.example))
    wrap.appendChild(chip)
  }
  transcript.appendChild(wrap)
  transcript.scrollTop = transcript.scrollHeight
}

/**
 * The first-run card. One question, four answers, and picking one goes straight
 * into the normal ask() path — the option's `goal` is fed in exactly as if it
 * had been typed, so there is no second planning route to keep in sync.
 */
function renderOnboarding(options) {
  const card = document.createElement('div')
  card.className = 'onboarding'

  const question = document.createElement('h2')
  question.textContent = ONBOARDING_QUESTION
  card.appendChild(question)

  for (const option of options) {
    const button = document.createElement('button')
    button.className = 'onboarding-option'

    const label = document.createElement('span')
    label.className = 'onboarding-label'
    label.textContent = option.label
    button.appendChild(label)

    const hint = document.createElement('span')
    hint.className = 'onboarding-hint'
    hint.textContent = option.hint
    button.appendChild(hint)

    button.addEventListener('click', () => chooseOnboarding(option, card))
    card.appendChild(button)
  }

  transcript.appendChild(card)
  transcript.scrollTop = transcript.scrollHeight
}

async function chooseOnboarding(option, card) {
  // Remove rather than disable: it has done its job, and leaving four dead
  // buttons above the answer makes the panel look stuck.
  card.remove()
  onboardingAnswer = await saveOnboarding(option)

  if (!option.goal) {
    addMessage(
      'assistant',
      "Here's what I can walk you through. Pick one, or just tell me what you're after.",
    )
    addSuggestions(biasSuggestions(suggestions(), onboardingAnswer))
    return
  }

  if (option.retargeted) addMessage('note', `Starting here because ${option.hint}.`)
  await ask(option.goal)
}

function renderPlan(result) {
  const { plan, warnings } = result

  const card = document.createElement('div')
  card.className = 'plan'

  const title = document.createElement('h2')
  title.textContent = plan.summary
  card.appendChild(title)

  const list = document.createElement('ol')
  for (const step of plan.steps) {
    const li = document.createElement('li')
    li.textContent = step.say
    if (step.actor === 'ai') {
      const tag = document.createElement('span')
      tag.className = 'actor'
      tag.textContent = 'I do this'
      li.appendChild(tag)
    }
    list.appendChild(li)
  }
  card.appendChild(list)

  for (const warning of warnings || []) {
    const w = document.createElement('div')
    w.className = 'warn'
    w.textContent = `⚠ ${warning}`
    card.appendChild(w)
  }

  // Verification affordance: stand on the relevant screen, press this, and the
  // page says which of the plan's selectors actually resolve. That is what
  // clears an `unverified: true` flag honestly.
  const check = document.createElement('button')
  check.className = 'chip'
  check.textContent = 'Check selectors on this screen'
  check.addEventListener('click', () =>
    runSelectorCheck(plan.steps, card, check, 'Check selectors on this screen'),
  )
  card.appendChild(check)

  transcript.appendChild(card)
  transcript.scrollTop = transcript.scrollHeight
}

function renderCheck(results, page, target) {
  const output = document.createElement('pre')
  output.className = 'selector-check'

  // Found-first: on a sweep of every selector we ship, the handful that resolve
  // are the answer and the rest are noise.
  const sorted = [...results].sort(
    (a, b) => Number(b.visible) - Number(a.visible) || Number(b.found) - Number(a.found),
  )

  const body = sorted
    .map(r => {
      const mark = r.visible ? '✓' : r.found ? '·' : '✗'
      const note = r.visible
        ? r.text
          ? `visible — "${r.text}"`
          : 'visible'
        : r.found
          ? 'in DOM but hidden'
          : (r.error ?? 'not found')
      return `${mark} ${r.id}  ${note}\n   ${r.selector}`
    })
    .join('\n')

  // Lead with where we looked. Without it, "0/9" reads as "the selectors are
  // wrong" when the real answer is almost always "wrong screen".
  output.textContent = `on ${page?.screen ?? 'unknown'} — ${page?.url ?? ''}\n\n${body}`
  target.appendChild(output)
  transcript.scrollTop = transcript.scrollHeight
}

async function runSelectorCheck(steps, card, button, label) {
  const original = label ?? button.textContent
  button.disabled = true
  button.textContent = 'Checking…'

  try {
    const { results, page } = await checkSelectors(steps)
    renderCheck(results, page, card)
    const visible = results.filter(r => r.visible).length
    button.textContent = `${visible}/${results.length} on ${page?.screen ?? 'this screen'}`
  } catch (error) {
    button.textContent = `Failed: ${error.message}`
  } finally {
    button.disabled = false
    setTimeout(() => (button.textContent = original), 6000)
  }
}

/**
 * Header button: verify a screen at any time, with or without a plan.
 *
 * Requiring a question first made this useless for the job it exists for —
 * walking the app and recording which selectors resolve where. With a plan in
 * play it checks that plan; otherwise it sweeps every selector in the library,
 * which is what you want when standing on a screen asking "what do we know
 * about this one?".
 */
async function checkCurrentScreen(button) {
  const steps = lastPlan
    ? lastPlan.steps
    : allKnownSelectors().map(s => ({ id: s.id, targetSelector: s.selector }))

  const holder = document.createElement('div')
  holder.className = 'msg note'
  holder.textContent = lastPlan
    ? `Checking the ${lastPlan.recipeId} plan against this screen.`
    : `Checking all ${steps.length} known selectors against this screen.`
  transcript.appendChild(holder)

  await runSelectorCheck(steps, holder, button, 'Check screen')
}

/* ---------------------------------------------------------------------- *
 * Handoff to Part 2
 * ---------------------------------------------------------------------- */

function emitPlan(plan) {
  chrome.runtime.sendMessage({ type: 'PLAN_READY', plan }, () => {
    // Part 2's listener may not exist yet — that's expected while they build,
    // and it must not surface as an error in the chat.
    void chrome.runtime.lastError
  })
}

/* ---------------------------------------------------------------------- *
 * Flow
 * ---------------------------------------------------------------------- */

function handleResult(result) {
  switch (result.status) {
    case 'plan':
      pendingQuestion = null
      if (result.amended) addMessage('note', 'Updated the plan.')
      // The summary is the plan card's heading — adding it as a message too
      // printed it twice.
      lastPlan = result.plan
      renderPlan(result)
      emitPlan(result.plan)
      renderOutgoingPlan(transcript, result.plan) // DEBUG — delete to remove
      window.dispatchEvent(
        new CustomEvent('copilot:assistant-text', { detail: result.plan.summary }),
      )
      break

    case 'needs_input':
      // Asking beats guessing: an invented URL gets typed into a real form.
      pendingQuestion = result
      addMessage('assistant', result.question)
      break

    case 'no_match':
      pendingQuestion = null
      addMessage('assistant', result.message)
      addSuggestions(result.suggestions?.length ? result.suggestions : suggestions())
      break

    default:
      pendingQuestion = null
      addMessage('error', result.message || 'Something went wrong building that plan.')
  }
}

/** Whatever we managed to read from the account, for state-aware recipes. */
function accountContext() {
  if (!lastCategories && !lastRules && !lastAccountState) return { account: null }
  return {
    account: {
      // Passed through as-is, undefined included. Recipes already treat a
      // missing list as "can't see the account" rather than "it's empty".
      consentCategories: lastCategories,
      rules: lastRules,
    },
  }
}

async function ask(text) {
  addMessage('user', text)
  controller.setBusy(true)
  controller.setHint('Working out the steps…')

  try {
    if (pendingQuestion) {
      handleResult(answerAndRetry(pendingQuestion, text, lastGoal, accountContext()))
    } else {
      lastGoal = text
      // `previous` is what lets "can I do it for Canada instead" amend the last
      // plan rather than be read as a fresh, unmatchable request.
      handleResult(
        await createPlan(text, {
          account: accountContext().account,
          previous: lastPlan,
        }),
      )
    }
  } catch (err) {
    addMessage('error', err.message || String(err))
  } finally {
    controller.setBusy(false)
    controller.setHint('')
  }
}

/* ---------------------------------------------------------------------- *
 * Boot
 * ---------------------------------------------------------------------- */

/**
 * Proves the account bridge end to end: reads the session token from the
 * ObservePoint tab and makes a real authenticated call. This is the foundation
 * state-aware recipes will be built on, so it is worth showing plainly whether
 * it is working rather than discovering later that it never was.
 */
async function showAccount() {
  const state = await accountStatus()
  lastAccountState = state

  if (!state.connected) {
    const why = {
      'not-on-observepoint':
        'Open an ObservePoint tab and I can read your account — then I can name the consent categories you actually have instead of guessing.',
      'not-signed-in':
        "You're on ObservePoint but not signed in, so I can't read your account yet.",
    }
    addMessage(
      'note',
      why[state.reason] ??
        `Can't read your account: ${state.reason}${state.hostname ? ` (${state.hostname})` : ''}`,
    )
    return
  }

  // Awaited, not fired and forgotten — onboarding retargets on whether the rule
  // library is empty, so a result that lands after the card has rendered is no
  // result at all. Failure leaves it undefined, which onboarding reads as unknown
  // rather than empty.
  const [rules] = await Promise.allSettled([listRules()])
  if (rules.status === 'fulfilled') lastRules = rules.value

  try {
    const categories = await listConsentCategories()
    const line =
      categories.length === 0
        ? `Connected to ${state.environment} (${state.hostname}). No consent categories in this account yet — I'll walk you through creating one when you need it.`
        : `Connected to ${state.environment} (${state.hostname}). ${categories.length} consent categor${categories.length === 1 ? 'y' : 'ies'} found: ${categories
            .slice(0, 4)
            .map(c => c.name)
            .join(', ')}${categories.length > 4 ? '…' : ''}`
    addMessage('note', line)
    lastCategories = categories
  } catch (error) {
    addMessage(
      'note',
      `Connected to ${state.environment} (${state.hostname}), but the category lookup failed: ${error.message}\nProbing which API paths and hosts actually answer…`,
    )

    // Probe automatically. This only runs when something is already broken, and
    // "which path reaches the API from this origin" is the first thing anyone
    // would want to know — guessing it one round-trip at a time is worse.
    const results = await probeApi()
    addMessage(
      'note',
      results
        .map(r => `${r.ok ? '✓' : '✗'} ${r.base}${r.path}\n     ${r.status} ${r.detail}`)
        .join('\n'),
    )
    console.table(results)
  }
}

async function showMode() {
  const key = await getStoredApiKey()
  statusEl.textContent = key ? 'Gemini' : 'offline matching'
  statusEl.className = `status ${key ? 'live' : 'local'}`
  if (!key) {
    addMessage(
      'note',
      "No API key set, so I'm matching on keywords only — plans still work for common phrasings. Add a Gemini key in the extension Options for better understanding.",
    )
  }
}

const checkScreenButton = document.getElementById('check-screen')
checkScreenButton.addEventListener('click', () => checkCurrentScreen(checkScreenButton))

controller = mountInput(document.getElementById('input-root'), { onSubmit: ask })

/**
 * Boot order matters here.
 *
 * The account read comes before the greeting because the first-run question
 * retargets on what the account already contains, and a card that renders first
 * and corrects itself second is worse than one that waits. The account read is
 * a single API call against a tab that is already open, so the wait is short —
 * and if it fails, onboarding falls back to its un-retargeted options rather
 * than blocking.
 */
async function boot() {
  showMode()
  await showAccount()

  onboardingAnswer = await loadOnboarding()

  if (!onboardingAnswer) {
    renderOnboarding(onboardingOptions(accountContext()))
    return
  }

  addMessage(
    'system',
    "Tell me what you want to set up and I'll work out the steps, then walk you through them.",
  )
  addSuggestions(biasSuggestions(suggestions(), onboardingAnswer))
}

boot()
