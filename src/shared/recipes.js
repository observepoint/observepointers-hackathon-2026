// Hand-authored walkthrough templates.
//
// Deliberately small and separate rather than one long tour: each recipe covers one idea,
// so we can put exactly the one a given user needs in front of them and nothing more.
// Nothing auto-starts a successor -- `chain` records what naturally follows a walkthrough,
// but the next one is offered when this one finishes and the user decides.
//
// Every selector here comes from shared/selectors.js. Text uses ObservePoint's real
// UI terminology -- "Journeys" not "Web Journeys", "Data Source Scans" not
// "Data Sources", "Network Requests" not "Request Log".
//
// Every recipe is validated at import time, so a typo fails the moment the content
// script boots instead of halfway through a demo.
//
// One recipe is not hand-authored: orientation-left-nav is composed per profile in
// shared/orientation.js, because what it should point out depends on the purposes the
// user picked during onboarding. The entry below is its core-only default, which is what
// anything reading RECIPES for metadata sees. Callers that want the personalised version
// go through resolveRecipe().

import { ANCHOR } from './selectors.js'
import { assertValidRecipe } from './schema.js'
import { ORIENTATION_RECIPE_ID, buildOrientation } from './orientation.js'

const orientationLeftNav = buildOrientation()

const createFirstAudit = {
  recipeId: 'create-first-audit',
  goal: 'Create your first Audit',
  summary:
    'Walks through creating a Web Audit: naming it, adding starting URLs, and setting the page limit and frequency.',
  executionMode: 'templated',
  // The NAME is filled in rather than suggested — see the 'ai' step below. The
  // starting URL is not: this is an orientation tour, and which site to crawl is the
  // one decision in it that is genuinely the user's. The demo's own site gets typed in
  // the walkthrough that follows, where it is the point rather than a detail.
  parameters: { auditName: 'My First Audit' },
  // Only the first step needs the sidebar, and appliesTo means the guard leaves the audit
  // form steps alone -- so declaring it costs nothing and stops step 1 stalling.
  guards: ['nav-available'],
  steps: [
    {
      id: 'go-to-data-sources',
      actor: 'user',
      navContext: '*',
      targetSelector: ANCHOR.navDataSources,
      say: 'Audits live under Data Source Scans. Open it, then choose Audits & Journeys.',
      completion: { type: 'url_change', value: '/sources' },
    },
    {
      id: 'open-create-menu',
      actor: 'user',
      navContext: '/sources',
      targetSelector: ANCHOR.createNewDataSource,
      say: 'Click Create New Data Source to see what you can build.',
      completion: { type: 'click', targetSelector: ANCHOR.createNewDataSource },
    },
    {
      id: 'choose-audit',
      actor: 'user',
      navContext: '/sources',
      targetSelector: ANCHOR.createNewAudit,
      say: 'Pick Audit. An Audit crawls your site and records every tag, cookie, and network request it finds.',
      completion: { type: 'click', targetSelector: ANCHOR.createNewAudit },
    },
    {
      // Filled rather than suggested. Two reasons, and the second is the real one.
      //
      // It reads better: "something like My First Audit" leaves the user to type it,
      // and then a tour about learning the app has spent a step on data entry.
      //
      // The starting URL below is deliberately NOT filled, for the mirror of the same
      // reason: nothing downstream depends on its value, and which site to crawl is
      // the one decision in this tour that is genuinely the user's.
      //
      // And the walkthrough AFTER this one has to find what this one made. The demo
      // runs onboarding first and then "edit My First Audit to add…", which opens the
      // audit by name. If the name is a suggestion, the second walkthrough is looking
      // for a card that may be called anything.
      id: 'name-the-audit',
      actor: 'ai',
      navContext: '*',
      targetSelector: ANCHOR.auditName,
      say: 'Naming it "{{parameters.auditName}}" — a name you will recognise in a list later.',
      action: { type: 'input', value: '{{parameters.auditName}}' },
      completion: { type: 'dom_mutation', targetSelector: ANCHOR.auditName },
    },
    {
      id: 'switch-to-url-sources',
      actor: 'user',
      navContext: '*',
      targetSelector: ANCHOR.auditTabUrlSources,
      say: 'Switch to the URL Sources tab to enter where the crawl should start.',
      completion: { type: 'click', targetSelector: ANCHOR.auditTabUrlSources },
    },
    {
      id: 'starting-urls',
      actor: 'user',
      navContext: '*',
      targetSelector: ANCHOR.auditStartingUrls,
      say: 'Starting URLs are where the crawl begins. One per line. For a first run, a single homepage URL is plenty.',
      completion: { type: 'dom_mutation', targetSelector: ANCHOR.auditStartingUrls },
    },
    {
      id: 'page-limit',
      actor: 'user',
      navContext: '*',
      targetSelector: ANCHOR.auditPageLimit,
      say: 'Page Limit caps how far the crawl goes. Keep it small on your first Audit so results come back quickly.',
      optional: true,
      completion: { type: 'dom_mutation', targetSelector: ANCHOR.auditPageLimit },
    },
    {
      id: 'switch-to-schedule',
      actor: 'user',
      navContext: '*',
      targetSelector: ANCHOR.auditTabSchedule,
      say: 'Open the Schedule tab to set how often this Audit runs.',
      optional: true,
      completion: { type: 'click', targetSelector: ANCHOR.auditTabSchedule },
    },
    {
      id: 'frequency',
      actor: 'user',
      navContext: '*',
      targetSelector: ANCHOR.auditFrequency,
      say: 'Frequency turns this into ongoing monitoring. Leave it manual for now — you can schedule it once you trust the setup.',
      optional: true,
      completion: { type: 'dom_mutation', targetSelector: ANCHOR.auditFrequency },
    },
    {
      id: 'save-audit',
      actor: 'user',
      navContext: '*',
      targetSelector: ANCHOR.auditSave,
      say: 'Hit Save Audit to kick off your first crawl. Results will be ready in a few minutes.',
      completion: { type: 'click', targetSelector: ANCHOR.auditSave },
    },
  ],
}

const auditReportNetworkRequests = {
  recipeId: 'audit-report-network-requests',
  goal: 'Find the network requests a single page fired',
  summary:
    'Reads an Audit report down to one page, then opens its Network Requests tab to see every request the page made.',
  executionMode: 'templated',
  parameters: {},
  steps: [
    {
      id: 'go-to-data-sources',
      actor: 'user',
      navContext: '*',
      targetSelector: ANCHOR.navDataSources,
      say: 'Start under Data Source Scans. Find an Audit that has already run and open its report.',
      completion: { type: 'url_change', value: '/sources' },
    },
    {
      id: 'filter-pages',
      actor: 'user',
      navContext: '*',
      targetSelector: ANCHOR.auditReportFilterBtn,
      say: 'Use Filters to narrow down to the page you care about.',
      optional: true,
      completion: { type: 'click', targetSelector: ANCHOR.auditReportFilterBtn },
    },
    {
      id: 'filter-data-source-type',
      actor: 'user',
      navContext: '*',
      targetSelector: ANCHOR.auditReportFilterDataSourceType,
      say: 'Select Data Source Type to filter the results by audit or journey.',
      optional: true,
      completion: { type: 'click', targetSelector: ANCHOR.auditReportFilterDataSourceType },
    },
    {
      id: 'filter-audits-checkbox',
      actor: 'user',
      navContext: '*',
      targetSelector: ANCHOR.auditReportFilterAudits,
      say: 'Check Audits to show only Audit pages in the results.',
      optional: true,
      completion: { type: 'click', targetSelector: ANCHOR.auditReportFilterAudits },
    },
    {
      id: 'open-audit-card',
      actor: 'user',
      navContext: '/sources',
      targetSelector: ANCHOR.auditCard,
      say: 'Click on an Audit to open its report.',
      optional: true,
      completion: { type: 'url_change', value: '/audit/' },
    },
    {
      id: 'view-pages-report',
      actor: 'user',
      navContext: '/audit/',
      targetSelector: ANCHOR.auditViewPagesReport,
      say: 'Click "View Pages report to get more detail" to see the full list of pages the Audit crawled.',
      completion: { type: 'url_change', value: '/audit/' },
    },
    {
      id: 'select-page-row',
      actor: 'user',
      navContext: '/audit/',
      targetSelector: ANCHOR.auditPageRow,
      say: 'Click on any page row to open its Page Details.',
      optional: true,
      completion: { type: 'click', targetSelector: ANCHOR.auditPageRow },
    },
    {
      id: 'tags-tab',
      actor: 'user',
      navContext: '*',
      targetSelector: ANCHOR.pdTabTags,
      say: 'The Tags tab lists every tag that fired here, with the variables it sent.',
      completion: { type: 'click', targetSelector: ANCHOR.pdTabTags },
    },
    {
      id: 'network-requests-tab',
      actor: 'user',
      navContext: '*',
      targetSelector: ANCHOR.pdTabNetworkRequests,
      say: 'Network Requests is the raw truth: every request the page made, with status code, size, load time, and origin. When a tag is missing, start here.',
      completion: { type: 'click', targetSelector: ANCHOR.pdTabNetworkRequests },
    },
    {
      id: 'initiators-tab',
      actor: 'user',
      navContext: '*',
      targetSelector: ANCHOR.pdTabInitiators,
      say: 'Initiators answers "what caused this?" — it traces a request or cookie back to whatever set it off.',
      optional: true,
      completion: { type: 'click', targetSelector: ANCHOR.pdTabInitiators },
    },
  ],
}

const journeyCookies = {
  recipeId: 'journey-cookies',
  goal: 'Inspect the cookies set during a Journey',
  summary:
    "Opens a Journey's results, selects an action, and reads the Cookies tab to see what was set at that point in the flow.",
  executionMode: 'templated',
  parameters: {},
  steps: [
    {
      id: 'go-to-data-sources',
      actor: 'user',
      navContext: '*',
      targetSelector: ANCHOR.navDataSources,
      say: 'Start under Data Source Scans. Find a Journey that has already run.',
      completion: { type: 'url_change', value: '/sources' },
    },
    {
      id: 'filter-pages',
      actor: 'user',
      navContext: '*',
      targetSelector: ANCHOR.auditReportFilterBtn,
      say: 'Use Filters to narrow the list down to Journeys.',
      optional: true,
      completion: { type: 'click', targetSelector: ANCHOR.auditReportFilterBtn },
    },
    {
      id: 'filter-data-source-type',
      actor: 'user',
      navContext: '*',
      targetSelector: ANCHOR.auditReportFilterDataSourceType,
      say: 'Select Data Source Type.',
      optional: true,
      completion: { type: 'click', targetSelector: ANCHOR.auditReportFilterDataSourceType },
    },
    {
      id: 'filter-journeys-checkbox',
      actor: 'user',
      navContext: '*',
      targetSelector: ANCHOR.auditReportFilterJourneys,
      say: 'Check Journeys to show only Journey runs in the list.',
      optional: true,
      completion: { type: 'click', targetSelector: ANCHOR.auditReportFilterJourneys },
    },
    {
      id: 'open-journey-card',
      actor: 'user',
      navContext: '/sources',
      targetSelector: ANCHOR.journeyCard,
      say: 'Click on a Journey to open its results.',
      optional: true,
      completion: { type: 'url_change', value: '/web-journey/' },
    },
    {
      id: 'open-journey-results',
      actor: 'user',
      navContext: '*',
      targetSelector: ANCHOR.journeyTabHostActionDetails,
      say: 'Open a Journey run. A Journey replays a real user flow — checkout, signup, a form — one action at a time.',
      completion: { type: 'dom_mutation', targetSelector: ANCHOR.journeyTabHostActionDetails },
    },
    {
      id: 'action-details',
      actor: 'user',
      navContext: '*',
      targetSelector: ANCHOR.journeyTabHostActionDetails,
      say: 'Action Details shows each step the Journey performed. Pick the action you care about first — the other tabs are scoped to it.',
      completion: { type: 'click', targetSelector: ANCHOR.journeyTabHostActionDetails },
    },
    {
      id: 'cookies-tab',
      actor: 'user',
      navContext: '*',
      targetSelector: ANCHOR.journeyTabHostCookies,
      say: 'Now the Cookies tab. These are the cookies present at that exact point in the flow — click any one to see what set it.',
      completion: { type: 'click', targetSelector: ANCHOR.journeyTabHostCookies },
    },
    {
      id: 'tag-presence',
      actor: 'user',
      navContext: '*',
      targetSelector: ANCHOR.journeyTabHostTagPresence,
      say: 'Tag Presence is the companion view: which tags fired on each action, so you can spot the step where tracking drops out.',
      optional: true,
      completion: { type: 'click', targetSelector: ANCHOR.journeyTabHostTagPresence },
    },
  ],
}

const privacyConsentCategories = {
  recipeId: 'privacy-consent-categories',
  goal: 'Set up Consent Categories for privacy validation',
  summary:
    'Introduces Standards and Consent Categories — the approved and unapproved lists that drive every privacy compliance report.',
  executionMode: 'templated',
  parameters: {},
  // Every step here points at a global-sidebar anchor, so a collapsed nav breaks all of them.
  guards: ['nav-available'],
  steps: [
    {
      id: 'open-standards',
      actor: 'user',
      navContext: '*',
      targetSelector: ANCHOR.navStandards,
      say: 'Privacy work starts under Standards. This is where you tell ObservePoint what is allowed on your site.',
      completion: { type: 'click', targetSelector: ANCHOR.navStandards },
    },
    {
      id: 'consent-categories',
      actor: 'user',
      navContext: '*',
      targetSelector: ANCHOR.navConsentPreferences,
      say: 'Open Consent Categories. A category is a list of approved and unapproved cookies, tags, and domains — you can import one from OneTrust or start from their spreadsheet template.',
      completion: { type: 'url_change', value: '/consent-categories' },
    },
    {
      id: 'rules',
      actor: 'user',
      navContext: '*',
      targetSelector: ANCHOR.navRules,
      say: 'Tag & Variable Rules sit alongside them. A rule is an optional WHEN plus a required EXPECT — that is how you assert a tag fired correctly.',
      optional: true,
      completion: { type: 'click', targetSelector: ANCHOR.navRules },
    },
    {
      id: 'triggered-alerts',
      actor: 'user',
      navContext: '*',
      targetSelector: ANCHOR.navTriggeredAlerts,
      say: 'Once categories and rules are attached to an Audit, anything that breaks shows up in Triggered Alerts. That is the loop.',
      completion: { type: 'click', targetSelector: ANCHOR.navTriggeredAlerts },
    },
  ],
}

/** All recipes, validated on import. Order here is the picker's fallback order. */
export const RECIPES = [
  orientationLeftNav,
  createFirstAudit,
  auditReportNetworkRequests,
  journeyCookies,
  privacyConsentCategories,
].map(assertValidRecipe)

const BY_ID = new Map(RECIPES.map(r => [r.recipeId, r]))

export function getRecipe(recipeId) {
  return BY_ID.get(recipeId)
}

/**
 * Resolve a recipe id to a plan, personalising the ones that are composed rather than
 * hand-authored.
 *
 * Every entry point that is about to RUN a walkthrough should go through this instead of
 * getRecipe, so there is one seam rather than one per caller. getRecipe stays the right
 * call for metadata and existence checks.
 *
 * @param {string} recipeId
 * @param {object} context { purposeIds, includeSettingsIntro }
 */
export function resolveRecipe(recipeId, { purposeIds, includeSettingsIntro } = {}) {
  if (recipeId === ORIENTATION_RECIPE_ID)
    return buildOrientation(purposeIds ?? [], { includeSettingsIntro })

  return getRecipe(recipeId)
}

/** Lightweight list for the picker and for Pipeline A's recipe selection. */
export function recipeSummaries() {
  return RECIPES.map(({ recipeId, goal, summary, steps }) => ({
    recipeId,
    goal,
    summary,
    stepCount: steps.length,
  }))
}
