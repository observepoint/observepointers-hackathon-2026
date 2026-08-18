/**
 * The recipe library.
 *
 * A recipe is a walkthrough template: ordered steps with {{parameters.x}} holes
 * in them. The model's job is NOT to invent a plan — it is to pick the right
 * recipe and fill the holes. That constraint is deliberate: an open-ended
 * planner confidently produces ObservePoint configurations that don't exist,
 * because it has no idea whether an alert hangs off an audit, a rule, or a
 * journey. Recipes put that knowledge in our hands, where it belongs.
 *
 * Adding one is the highest-value contribution to this project: coverage IS the
 * product. Whatever isn't authored, the assistant handles badly.
 *
 * CURRENT FOCUS — audits, and the three things you attach to them:
 *   audit_with_rules               Tag & Variable Rules
 *   audit_with_consent_categories  Consent Categories (privacy)
 *   audit_with_alerts              Alerts
 *   edit_audit_add_standards       the same three, on an audit that already exists —
 *                                  which is what "edit My First Audit to add…" means,
 *                                  and what the onboarding walkthrough leaves behind
 *   audit_with_all_standards       all three at once, because they are three
 *                                  sub-tabs of ONE screen — ask for more than one
 *                                  and you used to get exactly one, silently
 *   alert_from_report              "alert me when X breaks", from a report widget
 *
 * The first three share `_audit-standards.js`, because in moonbeam they are
 * three sub-tabs of one screen rather than three separate flows.
 *
 * PLUS the empty-account pair, sharing `_standards-library.js`:
 *   create_first_rule                 fill the rule library, named and no further —
 *                                     the right answer when the request does not say
 *                                     what "correct" means
 *   create_tag_variable_rule          the same builder driven all the way through the
 *                                     conditions grid, for when it does: a named tag
 *                                     and named variables
 *   create_first_consent_category     fill the consent category library
 *   import_consent_from_onetrust      pull them from the CMP instead of typing
 *                                     them, which is what a OneTrust account
 *                                     actually does. Chains into the audit.
 *   create_first_alert                fill the alerts library, including the metric
 *                                     four levels down a nested menu. Prefer the bell
 *                                     on a report widget (alert_from_report) when
 *                                     there is a run to point at — it pre-fills.
 *
 * Those exist because the three audit recipes all end in "pick from your
 * library", which is a dead end on an account whose library is empty — which
 * is every account on its first day, i.e. exactly the user this is built for.
 *
 * To add a recipe:
 *   1. Walk the flow yourself with devtools open; copy the real selectors.
 *   2. Prefer [op-selector="..."] — stable and human-named. Note that many are
 *      bound dynamically ([attr.op-selector]="OP_SELECTORS.x"), so grep the
 *      *.constants.ts enums too, not just the templates.
 *   3. Wrap your steps in unswept() from ./_unswept.js until you have watched
 *      them resolve with Check screen. Per-step, not per-recipe: there used to
 *      be a recipe-level `verified` flag and it drifted immediately, because
 *      nothing read it and because a recipe with two branches cannot answer the
 *      question with one boolean. The step flag is what Part 2 and Part 3
 *      consume, so it is the only one that exists now.
 */

import auditWithRules from './audit-with-rules.js'
import auditWithConsentCategories from './audit-with-consent-categories.js'
import auditWithAlerts from './audit-with-alerts.js'
import auditWithAllStandards from './audit-with-all-standards.js'
import editAuditAddStandards from './edit-audit-add-standards.js'
import alertFromReport from './alert-from-report.js'
import createFirstRule from './create-first-rule.js'
import createTagVariableRule from './create-tag-variable-rule.js'
import createFirstConsentCategory from './create-first-consent-category.js'
import createFirstAlert from './create-first-alert.js'
import importConsentFromOnetrust from './import-consent-from-onetrust.js'

export const RECIPES = [
  auditWithRules,
  auditWithConsentCategories,
  auditWithAlerts,
  auditWithAllStandards,
  editAuditAddStandards,
  alertFromReport,
  createFirstRule,
  createTagVariableRule,
  createFirstConsentCategory,
  createFirstAlert,
  importConsentFromOnetrust,
]

export const getRecipe = id => RECIPES.find(r => r.id === id) || null

/** Compact catalogue for the model — full step bodies would just burn tokens. */
export const recipeCatalogue = () =>
  RECIPES.map(r => ({
    recipeId: r.id,
    title: r.title,
    description: r.intent.description,
    examples: r.intent.examples,
    parameters: r.parameters.map(p => ({
      name: p.name,
      description: p.description,
      required: Boolean(p.required),
      example: p.example,
    })),
  }))

/**
 * A representative parameter set, for asking a recipe what its steps look like.
 *
 * `{}` is the wrong question. A recipe asked for its steps with no parameters
 * produces its DEGENERATE branch, and that branch is exactly the one with the fewest
 * selectors in it. A live sweep of the OneTrust flow came back with the location
 * picker confirmed and the search box and option row absent — not because they were
 * missing from the page, but because with no location named the recipe emits one
 * "pick yours" step instead of three. The two selectors that most needed looking at
 * were the two the sweep could not see.
 *
 * `example` beats `default`, because they mean different things. An example is by
 * definition a real value someone might supply. A default is frequently the
 * nothing-was-said fallback — "the location you need" — which is what selects the
 * thin branch in the first place.
 */
export function representativeParameters(recipe) {
  const parameters = {}
  for (const param of recipe.parameters ?? []) {
    if (param.example) parameters[param.name] = param.example
    else if (param.default) parameters[param.name] = param.default
    else if (param.derive) parameters[param.name] = param.derive(parameters)
  }
  return parameters
}

/**
 * Every distinct selector across the library, for verifying a screen without
 * first asking a question.
 *
 * Recipes that build their steps from account state are asked for their
 * no-account form — that is the shape with the widest selector coverage, which
 * is what a verification sweep wants.
 */
export function allKnownSelectors() {
  const seen = new Map()

  for (const recipe of RECIPES) {
    let steps = recipe.steps
    if (!steps && recipe.buildSteps) {
      try {
        steps = recipe.buildSteps({ parameters: representativeParameters(recipe), goal: '' })
      } catch {
        steps = []
      }
    }

    for (const step of steps ?? []) {
      // What the step WAITS on, as well as what it points at. A completion selector
      // that never resolves stalls the walkthrough silently, which is the failure
      // worth the most to catch and the one nothing was checking.
      const waitsFor = step.completion?.targetSelector
      if (waitsFor && waitsFor !== step.targetSelector && !seen.has(waitsFor)) {
        seen.set(waitsFor, {
          id: `${recipe.id}/${step.id} waits for`,
          selector: waitsFor,
          say: step.say,
        })
      }

      if (!step.targetSelector || seen.has(step.targetSelector)) continue
      // Kept whole, operators included. The sweep runs them through the same
      // findVisible the runtime uses, so "the option labelled Utah" is exactly the
      // thing worth checking — narrowing it to the CSS part would report a tick for
      // a list of two hundred options when the one we need is absent.
      seen.set(step.targetSelector, {
        id: `${recipe.id}/${step.id}`,
        selector: step.targetSelector,
        say: step.say,
      })
    }
  }

  return [...seen.values()]
}
