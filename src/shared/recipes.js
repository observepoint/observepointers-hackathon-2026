// Hand-authored walkthrough templates.
//
// Deliberately small and separate rather than one long tour: each recipe covers one
// idea and declares its successor via `chain`, so onboarding can string together
// exactly the ones a given user needs and nothing more.
//
// Every selector here comes from shared/selectors.js. Text uses ObservePoint's real
// UI terminology -- "Journeys" not "Web Journeys", "Data Source Scans" not
// "Data Sources", "Network Requests" not "Request Log".
//
// Every recipe is validated at import time, so a typo fails the moment the content
// script boots instead of halfway through a demo.

import { ANCHOR } from './selectors.js'
import { assertValidRecipe } from './schema.js'

const orientationLeftNav = {
  recipeId: 'orientation-left-nav',
  goal: 'Get oriented in the ObservePoint left navigation',
  summary:
    'A short tour of the main navigation: Create New, Data Source Scans, Standards, and Reports.',
  executionMode: 'templated',
  parameters: {},
  chain: 'create-first-audit',
  steps: [
    {
      id: 'nav-create-new',
      actor: 'user',
      navContext: '*',
      targetSelector: ANCHOR.navCreateNew,
      say: 'Start here. Create New is where every Audit, Journey, and Folder begins. Give it a click.',
      completion: { type: 'click', targetSelector: ANCHOR.navCreateNew },
    },
    {
      id: 'close-create-menu',
      actor: 'user',
      navContext: '*',
      targetSelector: '[op-selector="close-btn"]',
      say: 'Close this menu to continue the tour.',
      optional: true,
      completion: { type: 'click', targetSelector: '[op-selector="close-btn"]' },
    },
    {
      id: 'nav-data-sources',
      actor: 'user',
      navContext: '*',
      targetSelector: ANCHOR.navDataSources,
      say: 'Data Source Scans holds Audits & Journeys — every scan you have set up, and its results.',
      completion: { type: 'click', targetSelector: ANCHOR.navDataSources },
    },
    {
      id: 'nav-standards',
      actor: 'user',
      navContext: '*',
      targetSelector: ANCHOR.navStandards,
      say: 'Standards is where you define what "correct" means: Alerts, Tag & Variable Rules, and Consent Categories.',
      completion: { type: 'click', targetSelector: ANCHOR.navStandards },
    },
    {
      id: 'nav-reports',
      actor: 'user',
      navContext: '*',
      targetSelector: ANCHOR.navReports,
      say: 'And Reports is the Report Gallery plus anything you have saved. That is the tour — next, your first Audit.',
      completion: { type: 'click', targetSelector: ANCHOR.navReports },
    },
  ],
}

const createFirstAudit = {
  recipeId: 'create-first-audit',
  goal: 'Create your first Audit',
  summary:
    'Walks through creating a Web Audit: naming it, adding starting URLs, and setting the page limit and frequency.',
  executionMode: 'templated',
  parameters: { auditName: 'My First Audit' },
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
      id: 'name-the-audit',
      actor: 'user',
      navContext: '*',
      targetSelector: ANCHOR.auditName,
      say: 'Give it a name you will recognise later — something like "{{parameters.auditName}}".',
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

/** Lightweight list for the picker and for Pipeline A's recipe selection. */
export function recipeSummaries() {
  return RECIPES.map(({ recipeId, goal, summary, steps }) => ({
    recipeId,
    goal,
    summary,
    stepCount: steps.length,
  }))
}
