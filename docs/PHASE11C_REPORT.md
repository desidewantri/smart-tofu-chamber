# Phase 11C — RSL Model Integration, Web Dashboard Engineering & UI Verification

## A. Executive verdict

**PASS** — local implementation and regression are complete; the production
deployment is prepared but not executed.

The web application now exposes the real M1/M2/M3 outputs from the existing RSL
adapter, with a primary/supporting hierarchy, frozen-reference provenance,
measurement/model time separation, historical persisted snapshots, responsive
layouts, and explicit unavailable/empty/error states. No model value is
calculated or invented in the browser.

Production was not touched. The production deployment still requires the
security and disposition prerequisites in section L.

---

## B. Skill utilization

| Skill | Contribution | Where applied | Status |
|---|---|---|---|
| `test-driven-development` | Wrote failing tests first for the snapshot-list service and RSL components, then implemented minimal code | Backend snapshot list; frontend comparison/metadata/quality/timeline/tab tests | Applied |
| `frontend-design` | Preserved the existing TofuSense visual identity, hierarchy, restrained card design, responsive behavior, and focus states | RSL tab, dashboard, chamber/history integration | Applied; no redesign |
| `ui-ux-pro-max` | Chart/UX guidance for comparison dashboards and accessibility priorities | Chose a table + scatter/table fallback instead of radar/grouped bar because M1/M2/M3 are not directly comparable | Applied; radar recommendation intentionally deferred |
| `ui-design-system` | Token/contrast and responsive-system guidance | Brand-700 primary actions, emerald-700 connected text, mobile/tablet card layouts | Applied |
| `web-design-guidelines` | Fetched current Vercel Web Interface Guidelines and reviewed new UI | Semantic tables, aria labels, skip link, URL tab/chamber state, no page-level overflow | Applied; some non-RSL app-wide items deferred |
| `senior-frontend` | React/Next client-component, polling, accessibility, and bundle discipline | `usePolling`, client components, no new chart dependency, responsive implementation | Applied |
| `a11y-audit` | WCAG 2.2 scan guidance and contrast checker | Static component scan (false positives noted), contrast fixes, axe-core page audits | Applied |
| `agent-browser` | Authenticated local browser automation and accessibility audit | Login, RSL tab, chamber switching, screenshots, console/network checks, axe-core | Applied |
| `full-page-screenshot` | Full-page capture fallback | Loaded; not needed because agent-browser screenshots covered the pages | Deferred |
| `api-design-reviewer` | REST design review for the additive endpoint | Auth, chamber scoping, bounded limit, read-only semantics, no breaking change | Applied; OpenAPI tooling not run because the repo has Markdown API docs, not an OpenAPI spec |
| `senior-backend` | Minimal backend extension and test strategy | `listForChamber` service + controller/route; no schema or methodology change | Applied |
| `code-reviewer` | Review lens for changed code | Self-review of new components/services; PR analyzer not applicable because the workspace has no Git metadata | Applied partially |
| `verification-before-completion` | Fresh evidence before claims | Final backend/frontend/build/E2E/axe runs | Applied |

---

## C. Architecture findings

- **Frontend:** Next.js `14.2.35` App Router, React `18.3.1`, Tailwind
  `3.4.13`, Recharts `2.12.7`, lucide icons, JavaScript/JSX, JWT auth, polling
  via `usePolling`.
- **Backend:** Express/Mongoose, JWT-protected REST API, RSL adapter
  `rslService.js`, snapshot reconciliation `rslSnapshotService.js`, immutable
  `rslsnapshots` collection.
- **RSL service:** internal Python HTTP service (`:8001`) with `/health`,
  `/version`, `/estimate`; the browser never calls it directly.
- **Existing RSL UI before this phase:** M1 headline, M2/M3 detail panel,
  snapshot display in history. Missing: unified comparison, visible reference
  metadata, calculation-time/provenance separation, historical snapshot
  timeline, frontend tests, and chamber-switch isolation.
- **Reference values verified locally:** engine `1.0.0`, reference
  `v2.3-frozen-2026-11-04`, population `3`, condition `DRY`.
- **Local workspace discrepancy:** the task named
  `/home/toscha/smart-tofu-chamber`; the actual local workspace was
  `/Users/vino/Downloads/capstone/smart-tofu-chamber-main`. No production host
  was used.

Detailed audit: `docs/PHASE11C_ARCHITECTURE_AUDIT.md`.

---

## D. Implemented features

- New **Model RSL** tab in `/analysis`, chamber-scoped and deep-linkable via
  `?tab=rsl&chamber=1`.
- M1 primary result with full bounds, display-rounded bounds, elapsed time,
  reference version, DRY condition, and calculation time.
- M1/M2/M3 **model comparison** with explicit primary/supporting roles.
- M2 Turnbull support components and masses; M3 Weibull r10/r90, shape, scale,
  support warning, and suppression state.
- Reference metadata panel with engine/reference version, population, DRY
  scope, elapsed origin, TVOC contribution, research status, and caveats.
- Data-quality/provenance panel separating measurement time, server receipt
  time, timestamp quality/source, data source, freshness, and model calculation
  time.
- Historical RSL snapshot timeline using persisted immutable snapshots:
  discrete M1 lower/upper scatter points plus a full snapshot table/card list.
- Snapshot detail on `/history/[sessionId]` retains original `snapshotAt`/
  `endedAt` provenance and never substitutes a live estimate.
- Dashboard experiment context strip and compact M1/M2/M3 comparison in each
  active chamber card.
- Chamber detail full RSL comparison + metadata + provenance.
- Greeting summary now reports RSL availability instead of incorrectly saying
  “waiting for first prediction” when RSL exists.
- Loading, error, empty, unavailable, partial-model, stale-data, and no-active-
  experiment states.
- Responsive card layouts for comparison and snapshots on mobile/tablet.
- Accessibility: skip link, labeled navigation, semantic tables, chart hidden
  from assistive tech with table fallback, AA contrast fixes for primary
  actions/connected status.
- New read-only authenticated API: `GET /api/rsl/snapshots`.

---

## E. M1/M2/M3 integration status

| Model | Source | API response | Frontend rendering | Units | Interval | Availability | Limitations |
|---|---|---|---|---|---|---|---|
| **M1** | `primary_rsl` in engine response; adapter `primary` | `primary.lowerHours`, `upperHours`, `display`, `interpretation`, `nReferenceSessions` | Primary headline on dashboard/chamber/analysis; highlighted first row in comparison; snapshot headline/history | Hours | Lower/upper empirical envelope | `AVAILABLE` only when primary bounds are finite and valid; otherwise explicit reason | Empirical interval envelope, not confidence/prediction interval; not an individual safety guarantee |
| **M2** | `methods.M2`; adapter `supporting.M2` | `status`, `advisory`, `components[{lowerHours,upperHours,mass}]` | Supporting comparison row and detailed condition panel | Hours + mass | Conditional support components | Explicit `NOT_AVAILABLE`/`OUTSIDE_SUPPORT` when absent | Estimator-dependent support, not a confidence interval; mass inside support not identified |
| **M3** | `methods.M3`; adapter `supporting.M3` | `available`, `shape`, `scale`, `r10Hours`, `r90Hours`, `supportWarning`, `suppressFromDashboard` | Supporting comparison row; r10/r90 and shape/scale | Hours; shape/scale dimensionless | r10/r90 quantiles, not a single lower/upper interval | Explicit unavailable/suppressed state | Parametric comparator, not the primary estimate; three dry endpoints make shape unstable |

No M2/M3 value is copied from M1, averaged, or synthesized. The UI explicitly
states that the three methods are not the same quantity.

---

## F. Changed files

### Backend

| File | Purpose |
|---|---|
| `backend/src/services/rslSnapshotService.js` | Add read-only `listForChamber`; no recalculation |
| `backend/src/controllers/rslController.js` | Add authenticated snapshot-list controller |
| `backend/src/routes/index.js` | Add `GET /api/rsl/snapshots` |
| `backend/tests/rsl_snapshots_list.test.js` | New service/presenter contract tests |

### Frontend

| File | Purpose |
|---|---|
| `frontend/package.json`, `frontend/package-lock.json` | Add dev-only Vitest/Testing Library/jsdom scripts and dependencies |
| `frontend/vitest.config.mjs` | Vitest JSX/jsdom/alias config |
| `frontend/src/test/setup.jsx` | Test cleanup, ResizeObserver/matchMedia mocks, Link mock |
| `frontend/src/test/fixtures/rsl.js` | Test-only fixtures shaped like real responses |
| `frontend/src/components/rsl/RslStatusPill.jsx` | Consistent model/snapshot status pill |
| `frontend/src/components/rsl/RslModelComparison.jsx` | Reusable M1/M2/M3 comparison, desktop table + mobile cards |
| `frontend/src/components/rsl/RslReferenceMetadata.jsx` | Frozen reference, DRY scope, caveats |
| `frontend/src/components/rsl/RslDataQuality.jsx` | Measurement/receipt/model/snapshot provenance |
| `frontend/src/components/rsl/RslSnapshotTimeline.jsx` | Persisted snapshot scatter + table/card history |
| `frontend/src/components/rsl/RslOverview.jsx` | Live/snapshot composition |
| `frontend/src/components/rsl/RslModelTab.jsx` | Chamber-scoped live RSL + history tab |
| `frontend/src/components/rsl/*.test.jsx` | 17 frontend tests across 5 files |
| `frontend/src/components/dashboard/RslHeadline.jsx` | M1 label + reference/calculation metadata |
| `frontend/src/components/dashboard/ChamberCard.jsx` | Compact comparison in active cards |
| `frontend/src/components/dashboard/GreetingCard.jsx` | RSL-aware summary |
| `frontend/src/components/dashboard/IdleChamberCard.jsx` | AA contrast for connected text |
| `frontend/src/components/layout/BatteryIndicator.jsx` | AA contrast for good battery text |
| `frontend/src/components/layout/Sidebar.jsx` | Labeled navigation |
| `frontend/src/app/(main)/layout.jsx` | Skip link + `main` id |
| `frontend/src/app/(main)/dashboard/page.jsx` | Experiment context strip + RSL deep link |
| `frontend/src/app/(main)/analysis/page.jsx` | RSL tab, chamber guard, URL state sync |
| `frontend/src/app/(main)/chambers/[id]/page.jsx` | Full RSL comparison/metadata/provenance |
| `frontend/src/app/(main)/history/[sessionId]/page.jsx` | Snapshot overview; hide empty legacy trend |
| `frontend/src/components/analysis/ConditionAnalysisTab.jsx` | Add comparison to condition view |
| `frontend/src/services/api.js` | `getRslSnapshots` client method |
| `frontend/src/mock/mockApi.js` | Honest mock: `rsl: null`, empty snapshots; no fake model outputs |
| `frontend/src/i18n/en.js` | English translations for new RSL UI |
| `frontend/src/app/globals.css` | AA contrast for primary buttons |

### Documentation

- `docs/PHASE11C_ARCHITECTURE_AUDIT.md`
- `docs/PHASE11C_REPORT.md` (this file)
- `docs/api/README.md`
- `docs/data_contract.md`
- `docs/TESTING.md`
- `docs/phase11c/*.png` (local visual evidence)

---

## G. API changes

### New

`GET /api/rsl/snapshots?chamberId=<1|2>&limit=<1..100>`

- Authentication: Bearer JWT required.
- Read-only: queries `rslsnapshots`; never recalculates.
- Response: `{ success: true, data: { chamberId, limit, items: [rslSnapshotView] } }`.
- `items` are newest-first; each item includes `isSnapshot`, experiment/session
  identifiers, `snapshotAt`, `endedAt`, status/reason, M1/M2/M3, metadata,
  timestamp quality, last reading time, and reading count.
- Additive and backward-compatible; no existing endpoint response changed.

### Frontend client

`api.getRslSnapshots(chamberId, limit = 20)` calls the endpoint with the
authenticated request helper.

---

## H. Testing results

| Check | Result |
|---|---|
| Backend suite | **223/223 pass** |
| Frontend suite | **17/17 pass** |
| RSL engine | **77/77 pass** |
| RSL service | **11/11 pass** |
| MQTT + ingestion + services subset | **44/44 pass** |
| Sheet/importer/legacy subset | **54/54 pass** |
| Phase 8 E2E | pass |
| Phase 9 E2E | pass |
| Phase 10 E2E | pass |
| Phase 10.1 E2E | pass |
| Phase 10.2 E2E | pass |
| Backend syntax (`node --check`) | pass |
| Frontend production build | pass |
| Production Compose config (`docker compose -f docker-compose.prod.yml config --quiet`) | pass |
| Axe-core WCAG 2.2 A/AA | 0 violations on dashboard, RSL, chamber detail, history detail; 1 incomplete color-contrast check due background gradient |
| Responsive overflow | no page-level horizontal overflow at 390×844, 768×1024, 1440×900 |

The frontend test runner is dev-only; production dependencies were not added.

---

## I. Visual verification

Performed with `agent-browser` against the local Next.js dev server, local
backend on `:5099`, local RSL service on `:8001`, and an isolated Phase 11C
MongoDB database seeded with real engine-produced snapshots.

| Viewport | Result |
|---|---|
| 1440×900 | Dashboard, RSL tab, chamber detail, history snapshot inspected; no overflow; chart/table readable |
| 768×1024 | RSL tab uses card layouts for comparison/snapshots; no overflow; chart readable |
| 390×844 | RSL tab uses card layouts; no overflow; chamber selector and snapshot history usable |

Evidence:

- `docs/phase11c/dashboard-1440.png`
- `docs/phase11c/rsl-1440.png`
- `docs/phase11c/rsl-768.png`
- `docs/phase11c/rsl-390.png`

Browser console: no application errors; only dev Fast Refresh messages. Network:
API requests to `/api/chambers/:id`, `/api/rsl/snapshots`, `/api/auth/me`,
`/api/battery`, `/api/notifications`, and `/api/chambers` returned 200. Chamber
switching was exercised from Chamber 1 to Chamber 2; the new chamber data
replaced the old without leaking the previous chamber.

Local visual fixtures may have received a few local MQTT E2E readings because
the local broker is shared with the E2E backend. This was local-only test data;
no production broker or database was involved.

---

## J. Security and accessibility

### Security

- JWT authentication preserved; no client-side authorization assumptions added.
- The browser uses only the authenticated backend API; the internal RSL service
  URL is never exposed to the client.
- No secrets, production credentials, or production URLs were printed.
- New endpoint is authenticated, read-only, chamber-scoped, and bounded to 100
  snapshots.
- No new production runtime dependency; Vitest/Testing Library/jsdom are dev-only.
- `npm audit --omit=dev`:
  - Frontend: 2 production advisories (Next.js 14 critical/high and nested
    PostCSS high); fixing requires a major Next.js upgrade.
  - Backend: 5 advisories (1 high, 4 moderate); non-breaking fixes are available
    but were not force-applied in this phase.

### Accessibility

- Axe-core: 0 violations on the four reviewed pages.
- One incomplete color-contrast result remains because axe cannot determine
  contrast over the page’s CSS gradient; targeted foreground/background pairs
  were checked separately.
- Fixed: brand-600 primary actions and emerald-600 connected text moved to
  AA-passing brand-700/emerald-700.
- Added skip link, labeled navigation, semantic tables, aria-labels on the
  comparison table and snapshot table, and a table fallback for the decorative
  Recharts scatter chart.
- Keyboard focus remains visible via existing `focus-visible` classes.

---

## K. Remaining blockers

1. **Production deployment not performed.** This phase is local only.
2. **Next.js security upgrade.** Frontend production audit reports 2
   advisories requiring a major Next.js upgrade (Next 16); not safe to force in
   this phase.
3. **Backend dependency advisories.** 5 production advisories remain; a
   non-breaking `npm audit fix` is available but was not applied without a
   separate regression window.
4. **Authenticated production visual verification.** Local visual checks are
   complete; production dashboard/history still need authorized browser
   verification after deployment.
5. **M2/M3 continuous history.** The engine does not persist a continuous
   M1/M2/M3 time series. The historical view intentionally uses discrete
   persisted snapshots, not interpolated live data.
6. **Lint tooling.** `next lint` is not configured in the repository; it prompts
   for setup. The production build and tests pass, but a dedicated lint config
   remains a quality gap.
7. **Legacy active sessions.** Production deployment still requires the
   disposition of CH-009 and CH-010 to be resolved, per the prior phase.

---

## L. Production deployment readiness

Before production deployment:

1. Review and merge the Phase 11C changes.
2. Resolve the Next.js major-version security upgrade, or explicitly accept the
   risk with a documented mitigation.
3. Run the backend dependency audit fix in a separate change with the full
   backend suite and E2E rerun.
4. Deploy the backend and frontend together; the snapshot endpoint is additive
   and uses the existing `rslsnapshots` collection, so no database migration is
   required.
5. Verify the internal RSL service is healthy in production (`/health`,
   `/version`) without exposing its URL publicly.
6. Perform authenticated production smoke tests on `/dashboard`,
   `/analysis?tab=rsl&chamber=1`, `/chambers/1`, and `/history/<session>`.
7. Confirm `/api/rsl/snapshots` returns only persisted snapshots and that
   unavailable snapshots are not replaced by live estimates.
8. Resolve CH-009/CH-010 disposition before starting/stopping production
   experiments.
9. Do not change production `SHEET_URL`, import cursors/receipts, MQTT topics,
   Apps Script, firmware, or historical snapshots.

---

## M. Next phase recommendation

**Phase 11D — Production hardening and authenticated release verification.**

Dependencies:

- Next.js security upgrade plan and regression window.
- Backend dependency audit remediation.
- Authorized production credentials and a read-only production smoke window.
- CH-009/CH-010 disposition.
- Production RSL service health confirmation.

After Phase 11D, Phase 12 can cover release sign-off and post-deployment
monitoring, with the RSL UI already implemented and locally verified.
