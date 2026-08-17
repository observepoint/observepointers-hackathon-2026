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
 *   audit_with_all_standards       all three at once, because they are three
 *                                  sub-tabs of ONE screen — ask for more than one
 *                                  and you used to get exactly one, silently
 *   alert_from_report              "alert me when X breaks", from a report widget
 *
 * The first three share `_audit-standards.js`, because in moonbeam they are
 * three sub-tabs of one screen rather than three separate flows.
 *
 * PLUS the empty-account pair, sharing `_standards-library.js`:
 *   create_first_rule                 fill the rule library
 *   create_first_consent_category     fill the consent category library
 *   import_consent_from_onetrust      pull them from the CMP instead of typing
 *                                     them, which is what a OneTrust account
 *                                     actually does. Chains into the audit.
 *   create_first_alert                fill the alerts library — the weakest of the
 *                                     three, because the Library makes you describe
 *                                     the metric from scratch. Prefer the bell on a
 *                                     report widget (alert_from_report) when there
 *                                     is a run to point at.
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
import alertFromReport from './alert-from-report.js'
import createFirstRule from './create-first-rule.js'
import createFirstConsentCategory from './create-first-consent-category.js'
import createFirstAlert from './create-first-alert.js'
import importConsentFromOnetrust from './import-consent-from-onetrust.js'

export const RECIPES = [
  auditWithRules,
  auditWithConsentCategories,
  auditWithAlerts,
  auditWithAllStandards,
  alertFromReport,
  createFirstRule,
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
        steps = recipe.buildSteps({ parameters: {} })
      } catch {
        steps = []
      }
    }

    for (const step of steps ?? []) {
      if (!step.targetSelector || seen.has(step.targetSelector)) continue
      seen.set(step.targetSelector, {
        id: `${recipe.id}/${step.id}`,
        selector: step.targetSelector,
        say: step.say,
      })
    }
  }

  return [...seen.values()]
}
