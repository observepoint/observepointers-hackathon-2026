/**
 * A very small selector language, for the two things plain CSS cannot say.
 *
 * WHY THIS EXISTS
 *
 * The screens this extension has to point at — the rule condition builder, the
 * alert designer's report-metric menu, the OneTrust location picker — are all
 * built the same way: an Angular `@for` over a config array. Which means:
 *
 *   1. The only stable handle on an individual option is its VISIBLE LABEL. The
 *      labels come from constants that are part of the product's vocabulary
 *      ("Audits", "Tag & Variable Rules", "Rule Failures", "is set", "Tag"), so
 *      they are as durable as an op-selector and there are hundreds of them.
 *      Naming every generated <mat-option> upstream is a losing race; matching
 *      on the label is a fixed cost that covers all of them at once.
 *
 *   2. Repeating rows are identical. Every variable row in the rule grid renders
 *      `input[formControlName="variable"]`. A walkthrough that says "add a
 *      variable, now fill it in" always means THE ROW IT JUST ADDED — the last
 *      one. CSS has :nth-of-type but no :nth-of-class, and the grid interleaves
 *      `.grid-row` with `.row-separator`, so counting children does not work.
 *
 * So: `>>` separates a CSS selector from a short list of operators applied to
 * the matches, in order. `>>` is never valid CSS, so there is no ambiguity with
 * a real selector, and a selector with no `>>` behaves exactly as before.
 *
 *   input[formControlName="variable"] >> last
 *   button[mat-menu-item] >> text=Tag & Variable Rules
 *   mat-option.loc-autocomplete >> text=Utah
 *   then-condition rule-tag-variable-filter mat-select >> nth=2
 *
 * WHY IT LIVES IN ITS OWN FILE
 *
 * The DOM half of the runtime cannot be tested without a browser. The parsing
 * and the match-narrowing here are pure functions over arrays, so they can be —
 * and they are the part with the off-by-one risk. page-layer.js supplies the
 * querySelectorAll and the visibility filter; everything else is here.
 */

/** Operators, in the order they may appear. All are optional and composable. */
const OPS = {
  /** `text=Foo` — the element whose visible label is Foo. Exact wins over partial. */
  text: (matches, arg, textOf) => {
    const want = normalize(arg)
    if (!want) return matches
    const exact = matches.filter(el => normalize(textOf(el)) === want)
    if (exact.length) return exact
    return matches.filter(el => normalize(textOf(el)).includes(want))
  },
  /** `last` — the most recently added row. */
  last: matches => (matches.length ? [matches[matches.length - 1]] : []),
  /** `first` — explicit, for when relying on document order should be visible in the recipe. */
  first: matches => (matches.length ? [matches[0]] : []),
  /** `nth=2` — 1-based, because recipes are read by people. */
  nth: (matches, arg) => {
    const index = Number.parseInt(arg, 10)
    if (!Number.isInteger(index) || index < 1) return []
    return matches[index - 1] ? [matches[index - 1]] : []
  },
}

/** Collapse whitespace and case, so a label that wraps across lines still matches. */
function normalize(text) {
  return (text ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Split a target selector into its CSS part and its operators.
 *
 * Unknown operators are dropped rather than thrown: a recipe with a typo should
 * point at roughly the right thing, not abort the walkthrough. They are logged
 * by the caller in dev.
 *
 * @param {string} selector
 * @returns {{ css: string, ops: Array<{ name: string, arg: string }>, unknown: string[] }}
 */
export function parseTargetSelector(selector) {
  const parts = String(selector ?? '').split('>>')
  const css = parts.shift().trim()
  const ops = []
  const unknown = []

  for (const raw of parts) {
    const part = raw.trim()
    if (!part) continue
    // Split on the FIRST '=' only: `text=a=b` is a label containing '='.
    const eq = part.indexOf('=')
    const name = (eq === -1 ? part : part.slice(0, eq)).trim().toLowerCase()
    const arg = eq === -1 ? '' : part.slice(eq + 1).trim()
    if (!OPS[name]) {
      unknown.push(part)
      continue
    }
    ops.push({ name, arg })
  }

  return { css, ops, unknown }
}

/** True when the selector uses any of this module's extensions. */
export function hasOperators(selector) {
  return String(selector ?? '').includes('>>')
}

/**
 * Narrow a list of matches down with the parsed operators.
 *
 * `textOf` is injected so tests can pass plain objects. In the browser it is
 * `el => el.textContent`.
 *
 * IMPORTANT: callers must filter to VISIBLE elements before calling this, so
 * that `last` and `nth` count what the user can actually see. An Angular app
 * keeps torn-down overlays and hidden duplicate sidebars in the DOM; counting
 * those makes `last` point at something invisible.
 *
 * @param {Array<any>} matches
 * @param {Array<{ name: string, arg: string }>} ops
 * @param {(el: any) => string} textOf
 */
export function applyOperators(matches, ops, textOf = el => el.textContent) {
  let result = matches
  for (const { name, arg } of ops) {
    result = OPS[name](result, arg, textOf)
    if (!result.length) break
  }
  return result
}

/**
 * The CSS part alone.
 *
 * Needed because the runtime's compatibility tables (SELECTOR_OVERRIDES, the tab
 * maps) are keyed on whole selector strings, and an operator suffix must not stop
 * them matching.
 */
export function cssPartOf(selector) {
  return parseTargetSelector(selector).css
}
