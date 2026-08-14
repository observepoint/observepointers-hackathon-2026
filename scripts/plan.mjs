/**
 * Try a goal from the terminal, without Chrome.
 *
 *   npm run plan "set up an audit for example.com that checks my tag rules"
 *   npm run plan -- --model "make sure nothing breaks on checkout"
 *
 * This is the fast loop for authoring recipes: change a keyword, re-run, see
 * whether the right recipe wins. Loading an extension to test that is far too
 * slow to iterate on.
 *
 * Defaults to the deterministic matcher (no key, no network, no spend). Pass
 * --model to route through Gemini instead, using GEMINI_API_KEY from the
 * environment.
 */

import process from 'node:process'
import { createPlan, answerAndRetry, suggestions } from '../src/planner/index.js'

const args = process.argv.slice(2)
const useModel = args.includes('--model')
const goal = args.filter(a => a !== '--model').join(' ')

if (!goal) {
  console.log('\nUsage: npm run plan "<what the user wants>"  [-- --model]\n')
  console.log('Try one of these:')
  for (const s of suggestions()) console.log(`  ${s.example}`)
  console.log()
  process.exit(1)
}

const bold = s => `\x1b[1m${s}\x1b[0m`
const dim = s => `\x1b[2m${s}\x1b[0m`
const green = s => `\x1b[32m${s}\x1b[0m`
const yellow = s => `\x1b[33m${s}\x1b[0m`
const red = s => `\x1b[31m${s}\x1b[0m`

function printPlan(result) {
  const { plan } = result
  console.log(`\n${bold(plan.recipeId)}  ${dim(`(${result.matchedBy ?? 'templated'})`)}`)
  if (result.confidence !== undefined) {
    console.log(dim(`confidence ${result.confidence.toFixed(2)}`))
  }
  console.log(`\n${plan.summary}\n`)

  console.log(dim('parameters'))
  for (const [k, v] of Object.entries(plan.parameters)) console.log(`  ${k}: ${v}`)

  console.log(`\n${dim('steps')}`)
  for (const step of plan.steps) {
    const who = step.actor === 'ai' ? green('  AI  ') : '  you '
    const act = step.action ? dim(` [${step.action.type}: ${step.action.value ?? ''}]`) : ''
    console.log(`${who}${step.id}  ${step.say}${act}`)
    console.log(`       ${dim(step.targetSelector)}`)
  }

  for (const warning of result.warnings ?? []) console.log(`\n${yellow(`⚠ ${warning}`)}`)
  console.log()
}

let result = await createPlan(goal, { forceLocal: !useModel })

// Answer the clarifying question with the parameter's own example, so a single
// command still shows you the finished plan.
if (result.status === 'needs_input') {
  console.log(`\n${yellow('needs input')}  ${result.question}`)
  const { getRecipe } = await import('../src/planner/recipes/index.js')
  const param = getRecipe(result.recipeId).parameters.find(p => p.name === result.missing[0])
  const answer = param?.example ?? 'example'
  console.log(dim(`(answering with the example: ${answer})`))
  result = answerAndRetry(result, answer, goal)
}

switch (result.status) {
  case 'plan':
    printPlan(result)
    break
  case 'no_match':
    console.log(`\n${yellow('no match')}  ${result.message}\n`)
    for (const s of result.suggestions) console.log(`  ${s.title}  ${dim(s.example)}`)
    console.log()
    break
  default:
    console.log(`\n${red(result.status)}  ${result.message}\n`)
    process.exitCode = 1
}
