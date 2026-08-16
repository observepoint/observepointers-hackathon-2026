/**
 * First run.
 *
 * The problem this product exists for is that a new ObservePoint user does not
 * know what ObservePoint is *for* — they land on Data Sources and see a Create
 * button. An empty chat box does not help: "tell me what you want to set up"
 * assumes you already know what can be set up.
 *
 * So the first thing we show is a question with four answers. Picking one goes
 * straight to a plan — it does not open a recommendation screen, a tour, or a
 * settings page. The whole point is that the second thing a new user sees is
 * their own first walkthrough.
 *
 * TWO PROPERTIES WORTH KEEPING
 *
 * 1. An option is just a sentence. `goal` is fed into createPlan() exactly as
 *    if the user had typed it, so onboarding shares one planning path with
 *    everything else. There is no second way to build a plan, which means
 *    there is no second way for one to be wrong.
 *
 * 2. It is state-aware in the one direction that matters. Three of our four
 *    audit recipes end in "pick from your library"; on a fresh account those
 *    libraries are empty and the walkthrough dead-ends. When we can see that
 *    the account has nothing, the option quietly retargets to the recipe that
 *    creates the first one instead.
 *
 * OWNERSHIP SEAM: Part 1 owns the question and the stored answer. If Part 2
 * later wants a guided tour of the app itself, it reads the same answer from
 * chrome.storage and decides for itself — nothing here has to change.
 */

export const STORAGE_KEY = 'onboarding'

export const ONBOARDING_QUESTION = 'What do you need ObservePoint to tell you?'

/**
 * Four answers, phrased as outcomes rather than features. "Attach a consent
 * category to an audit" is the thing we will do; "are we complying with cookie
 * consent" is the thing they came here worrying about, and it is the only one
 * of the two they can recognise on day one.
 *
 * `emptyAccount` is the retarget for an account with nothing in that library.
 * Options without one have nothing to retarget to — audit_with_alerts builds
 * its own alert inline rather than picking from a library.
 */
const OPTIONS = [
  {
    id: 'tags',
    label: 'Are my tags firing correctly?',
    hint: 'Analytics, pixels and tag managers, checked on every run',
    goal: 'set up an audit that checks my tag rules',
    recipeId: 'audit_with_rules',
    emptyAccount: {
      goal: 'create a rule that checks our analytics tag fires',
      recipeId: 'create_first_rule',
      because: 'your rule library is empty, so there is nothing to attach yet',
    },
  },
  {
    id: 'privacy',
    label: 'Are we complying with cookie consent?',
    hint: 'GDPR, CCPA — which tags and cookies are approved',
    goal: 'check our site for privacy compliance',
    recipeId: 'audit_with_consent_categories',
    emptyAccount: {
      goal: 'create a consent category for our site',
      recipeId: 'create_first_consent_category',
      because: 'you have no consent categories yet, and one is what defines "approved"',
    },
  },
  {
    id: 'alerts',
    label: 'Tell me when something breaks',
    hint: 'Email me if a tag stops firing or pages start failing',
    // Not alert_from_report, despite sounding like it. That recipe starts from
    // a report widget and needs an audit that has already run — which a
    // first-run user does not have. This builds the audit first and offers to
    // create the alert at the end, which is the only order that works.
    goal: 'set up an audit and alert me if something breaks',
    recipeId: 'audit_with_alerts',
  },
  {
    // Deliberately not a recipe. Someone who does not yet have a goal should
    // get the catalogue, not a plan built from a goal we invented for them —
    // and "I'm not sure" is the honest answer for most first-time users, so
    // punishing it with a wrong walkthrough is the worst thing we could do.
    id: 'browse',
    label: "I'm not sure yet",
    hint: 'Show me what you can walk me through',
    goal: null,
    recipeId: null,
  },
]

/**
 * Do we know this library is empty?
 *
 * `undefined` means we could not read the account — no ObservePoint tab, signed
 * out, API unreachable. That is not the same as empty, and treating it as empty
 * would send someone with a full library off to create a duplicate. Only an
 * array we actually received counts.
 */
const knownEmpty = list => Array.isArray(list) && list.length === 0

/**
 * @param {object} [context]
 * @param {object} [context.account] whatever account.js managed to read
 * @returns {Array} options, with empty-library ones retargeted
 */
export function onboardingOptions(context = {}) {
  const account = context.account ?? null

  const empty = {
    tags: knownEmpty(account?.rules),
    privacy: knownEmpty(account?.consentCategories),
  }

  return OPTIONS.map(option => {
    const { emptyAccount, ...rest } = option

    if (!emptyAccount || !empty[option.id]) return { ...rest, retargeted: false }

    return {
      ...rest,
      goal: emptyAccount.goal,
      recipeId: emptyAccount.recipeId,
      hint: emptyAccount.because,
      retargeted: true,
    }
  })
}

/* ---------------------------------------------------------------------- *
 * Persistence
 *
 * Injectable so the planner stays testable in plain node — chrome.storage does
 * not exist outside the extension, and a module that can only be exercised
 * inside a browser is a module nobody tests.
 * ---------------------------------------------------------------------- */

const chromeStore = () => ({
  get: key =>
    new Promise(resolve => {
      chrome.storage.local.get(key, result => {
        void chrome.runtime.lastError
        resolve(result?.[key])
      })
    }),
  set: (key, value) =>
    new Promise(resolve => {
      chrome.storage.local.set({ [key]: value }, () => {
        void chrome.runtime.lastError
        resolve()
      })
    }),
})

/** @returns {Promise<{optionId, recipeId, at}|null>} null on a first run. */
export async function loadOnboarding(store = chromeStore()) {
  const saved = await store.get(STORAGE_KEY)
  return saved && typeof saved === 'object' ? saved : null
}

export async function saveOnboarding(option, store = chromeStore()) {
  const answer = {
    optionId: option.id,
    recipeId: option.recipeId ?? null,
    at: new Date().toISOString(),
  }
  await store.set(STORAGE_KEY, answer)
  return answer
}

/**
 * Bias later suggestions toward what they said they came for.
 *
 * Reorder, never filter. Someone who picked "privacy" on day one still asks
 * about tags on day two, and a chip list that hid the answer would look like
 * the feature does not exist.
 */
export function biasSuggestions(items, answer) {
  if (!answer?.recipeId) return items

  const preferred = items.filter(i => i.recipeId === answer.recipeId)
  return preferred.length
    ? [...preferred, ...items.filter(i => i.recipeId !== answer.recipeId)]
    : items
}
