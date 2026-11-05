# Phase 11C — Architecture Audit

**Scope:** local implementation audit of the TofuSense web application and its
RSL integration. The task named `/home/toscha/smart-tofu-chamber`; the actual
local workspace available for this phase is
`/Users/vino/Downloads/capstone/smart-tofu-chamber-main`. No production host,
database, container, Sheet, broker, or credential was used.

---

## 1. Frontend architecture

| Item | Actual implementation |
|---|---|
| Framework | Next.js `14.2.35`, App Router |
| UI runtime | React `18.3.1`, React DOM `18.3.1` |
| Styling | Tailwind CSS `3.4.13`, global component classes in `src/app/globals.css`, brand tokens in `tailwind.config.js` |
| Charts | Recharts `2.12.7` |
| Icons | `lucide-react` `0.441.0` |
| Language | JavaScript/JSX (no TypeScript), `jsconfig.json` path alias `@/* -> src/*` |
| Data fetching | `usePolling` in `src/lib/hooks.js`; polling intervals 10 s dashboard/chamber, 30 s condition analysis, on-demand history |
| Auth | JWT stored in `localStorage` by `src/services/api.js`; `AuthContext` resolves `/auth/me`; protected `(main)` layout redirects to `/login` |
| API client | Single `src/services/api.js`; mock mode via `NEXT_PUBLIC_USE_MOCK=true` |
| Existing tests | None before Phase 11C; Vitest + Testing Library added as dev-only tooling |

### Routes

| Route | Purpose |
|---|---|
| `/dashboard` | Active/idle chamber cards, M1 headline, sensor tiles, sample status, experiment context |
| `/chambers`, `/chambers/[id]` | Chamber list/detail, live session, sensor snapshot, RSL detail |
| `/analysis` | Tabs: condition analysis, new **Model RSL** tab, cost/benefit, seasonal |
| `/history`, `/history/[sessionId]` | Session history and final RSL snapshot detail |
| `/guide`, `/settings`, `/login`, `/register` | Existing supporting pages |

### Existing RSL components before Phase 11C

- `components/dashboard/RslHeadline.jsx` — M1 headline or explicit unavailable reason.
- `components/analysis/RslAnalysisPanel.jsx` — detailed M2 Turnbull and M3 Weibull cards.
- `components/dashboard/ChamberCard.jsx` — M1 headline + sample status in active cards.
- `components/dashboard/SampleStatusControl.jsx` — explicit operator sample status.
- `components/common/ProvenanceBadge.jsx` — sensor source/timestamp provenance.

**Gap:** M2/M3 existed only in the analysis panel/history snapshot, not in a
reusable comparison; reference metadata and calculation time were not visible;
there was no historical RSL snapshot timeline; there was no chamber-switch
isolation test; and no frontend test harness existed.

---

## 2. Backend architecture

| Item | Actual implementation |
|---|---|
| Runtime | Node.js, Express `4.19.2` |
| Database | MongoDB via Mongoose `8.5.1` |
| Auth | Bearer JWT (`requireAuth`) for all non-public routes |
| RSL adapter | `backend/src/services/rslService.js` |
| Snapshot reconciliation | `backend/src/services/rslSnapshotService.js` |
| Snapshot model | `backend/src/models/RslSnapshot.js`, collection `rslsnapshots` |
| RSL service | Python internal HTTP service on `:8001`, `/health`, `/version`, `/estimate` |
| RSL engine | `rsl_engine` frozen v2.3 reference, M1/M2/M3 |

The backend resolves experiment/session context, computes elapsed time from
`Experiment.startedAt`, enforces operator sample status and DRY storage, calls
the internal service with a bounded timeout, validates the canonical response,
and normalizes it for the API. Sensor values are never sent to the RSL engine.

### RSL response mapping (actual)

| Engine | Adapter field | Frontend use |
|---|---|---|
| `primary_rsl.lower_h/upper_h` | `primary.lowerHours/upperHours`, `primary.display` | M1 headline and full bounds |
| `methods.M2` | `supporting.M2` (`status`, `advisory`, `components[]`) | M2 support comparison |
| `methods.M3` | `supporting.M3` (`available`, `shape`, `scale`, `r10Hours`, `r90Hours`, `supportWarning`, `suppressFromDashboard`) | M3 comparator comparison |
| `metadata` from service | `metadata.engineVersion`, `referenceVersion`, `referencePopulation`, `referenceStorageCondition`, `elapsedOrigin`, `tvocContribution`, `researchStatus`, `caveats` | reference/methodology UI |
| adapter context | `status`, `reason`, `message`, `generatedAt`, `sampleStatus`, `storageCondition`, `elapsedHours` | availability and provenance |

Verified live values on the local service: engine `1.0.0`, reference
`v2.3-frozen-2026-11-04`, population `3`, storage condition `DRY`. These are
read from the service response, not hardcoded in the UI.

---

## 3. API contract inventory (RSL-relevant)

All routes below are under `/api` and require `Authorization: Bearer <token>`
except `/health`, auth, and device ingestion.

| Method | Route | Query/body | Response | Provenance |
|---|---|---|---|---|
| GET | `/dashboard` | — | active/idle chamber cards; each active card may contain `rsl` | live calculation per request |
| GET | `/chambers/:id` | `:id` 1/2 | `chamber`, `experiment`, `activeSession`, `latestReading`, `sensors`, `rsl`, `recentSessions` | live RSL + persisted readings |
| GET | `/analysis/condition` | `chamberId`, `period` | condition/trend/history/stats/dataQuality + `rsl` | live RSL for active session |
| GET | `/experiments/:id/rsl/:chamberId` | path IDs | M1/M2/M3 live result | calculated on request |
| GET | `/experiments/:id/rsl/:chamberId/analysis` | path IDs | supporting + metadata only | calculated on request |
| GET | `/rsl/snapshots` | `chamberId`, `limit` | immutable snapshot list | persisted `rslsnapshots` |
| GET | `/sesi/:id` | ObjectId or `CH-xxx` | session, stats, readings, predictions, `rslSnapshot` | persisted snapshot |
| PATCH | `/experiments/:id/sessions/:sessionId/sample-status` | `sampleStatus`, optional `storageCondition` | updated experiment/session | operator action |

### Nullability and errors

- `rsl` is `null` on legacy sessions without an experiment or when no active
  experiment exists. The frontend must show an empty state, not stale data.
- `primary` is `null` when unavailable; `supporting.M2/M3` may be `null` or
  partial. The frontend renders explicit unavailable states.
- `metadata` is present on normalized engine responses; if absent, the UI says
  “metadata referensi tidak tersedia” rather than inventing values.
- RSL HTTP errors become explicit `reason` codes (`RSL_TIMEOUT`,
  `RSL_UNAVAILABLE`, `ENGINE_INVALID_RESPONSE`, etc.).
- Snapshot list is additive; no existing endpoint response shape changed.

### Smallest justified API addition

`GET /api/rsl/snapshots?chamberId=&limit=` was added because the existing
`/sesi/:id` and `/experiments/:id` endpoints expose one snapshot at a time, and
the historical RSL timeline needs persisted snapshots across experiments. It is
read-only, authenticated, chamber-scoped, and never recalculates snapshots.

---

## 4. Existing product behavior preserved

- Chamber identity, sensor tiles (TVOC, temperature, humidity), battery, sampling
  timestamps, freshness/offline state, experiment elapsed time, sample status,
  and session lifecycle indicators remain unchanged.
- Legacy mock predictions remain visible only when RSL is absent or on explicitly
  labeled historical legacy sections.
- M1 remains the headline; M2/M3 remain supporting and are never promoted.
- The dashboard greeting now uses RSL availability when RSL exists instead of
  claiming “waiting for first prediction”.
- Historical snapshots remain immutable and are never replaced by live values.

---

## 5. Design and component decisions

- Existing Tailwind tokens and `card`/`btn` conventions were preserved; no new
  design system or chart dependency was introduced.
- New reusable components:
  - `RslModelComparison` — M1 primary vs M2/M3 supporting; responsive table/cards.
  - `RslReferenceMetadata` — frozen reference, DRY scope, caveats.
  - `RslDataQuality` — measurement/receipt/model/snapshot time separation.
  - `RslSnapshotTimeline` — persisted M1 bounds scatter + snapshot table/cards.
  - `RslOverview` — composition used by live and snapshot contexts.
  - `RslModelTab` — chamber-scoped live RSL + historical timeline.
- Mobile uses cards for comparison/snapshots; desktop uses tables. No page-level
  horizontal overflow at 390×844, 768×1024, or 1440×900.
- Chart is supplementary; the table is the accessible data representation.

---

## 6. Known limitations and deferred items

- The RSL engine does not persist a continuous M1/M2/M3 time series. The trend
  view therefore uses **discrete persisted snapshots**, not interpolated live
  history. No synthetic series was created.
- M2 is a support distribution, not a single estimate; M3 provides r10/r90, not
  an interval comparable to M1. The UI presents model-specific outputs rather
  than forcing them into one shared “estimate” quantity.
- The existing Next.js 14 production dependency has open security advisories;
  fixing them requires a major Next.js upgrade (see report blockers).
- Production visual verification was not performed; all browser checks were
  against local seeded fixtures.
EOF