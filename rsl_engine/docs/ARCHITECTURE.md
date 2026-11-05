# Architecture

## Single source of truth

The mathematics lives in the frozen v2.3 modules vendored under `src/v2_3/` in
this package. They are a byte-identical snapshot of the research tree used for
the published v2.3 artifacts. The runtime package is self-contained; it does not
require a developer checkout or `TOFUSENSE_REPO_SRC`.

| Concern | Canonical implementation | Engine module |
|---|---|---|
| M1 envelope arithmetic | `src/v2_3/conditional_rsl.py::empirical_envelope` | `methods/m1_empirical_envelope.py` |
| Turnbull conditional support | `src/v2_3/turnbull.py::conditional_support` | `methods/m2_turnbull.py` |
| Turnbull fitting (offline only) | `src/v2_3/turnbull.py::turnbull` | offline research build (not shipped at runtime) |
| Weibull conditional quantiles | `src/v2_3/weibull_comparator.py::WeibullComparator` | `methods/m3_weibull_a0.py` |
| Weibull A0 fit (offline only) | `src/v2_3/weibull_comparator.py::WeibullComparator.fit` | offline research build (not shipped at runtime) |
| Input-validation rules | `src/v2_3/conditional_rsl.py::_validate` | `engine._validate` (same rules, engine error type) |
| Statuses and caveats | `src/v2_3/conditional_rsl.py`, `src/v2_3/schemas.py` | `schemas.py` |

`_canonical.py` resolves `v2_3` beside the package (`src/v2_3`) or inside the
installed site-packages (`site-packages/v2_3`). An optional
`TOFUSENSE_REPO_SRC` override remains for parity testing against the original
research checkout, but is not required in production. If the canonical modules are
absent, import fails with an actionable error.

The vendored snapshot is tested against the original 81-test v2.3 suite and the
frozen baseline artifacts. Do not edit the formulas in only one copy; regenerate
the snapshot and re-run parity.

## Modules

- `engine.py` — validates input, loads references once per process, runs M1, M2,
  M3 and assembles the response. It never mixes the three into one number.
- `schemas.py` — status constants, caveats, and a JSON schema for the response.
- `reference_data.py` — loads and validates the four reference JSON files.
- `_canonical.py` — the only place that touches the vendored canonical modules.
- `methods/m1_empirical_envelope.py` — primary range. Lower bound uses the
  smallest reference `L` over all sessions, clamped at zero; upper bound uses the
  largest remaining `U` among sessions with `U_i > elapsed_h`, unrounded.
- `methods/m2_turnbull.py` — conditional support components from the stored NPMLE
  masses. Disconnected components are preserved. No exact mean is produced.
- `methods/m3_weibull_a0.py` — conditional 10th/90th percentiles from stored
  parameters, with the `EXCEEDS_EMPIRICAL_SUPPORT` suppression rule.

## Data flow

```text
reference/*.json ──► reference_data.load_reference_data() ──► ReferenceData
                                                               │
elapsed_h ──► engine._validate ────────────────────────────────┤
                                                               ▼
                                    ┌──────────────┬──────────────┬──────────────┐
                                    │ M1 canonical │ M2 canonical │ M3 canonical │
                                    └──────┬───────┴──────┬───────┴──────┬───────┘
                                           ▼              ▼              ▼
                                        response dict with primary_rsl + methods + status
```

## Determinism

All calculations are closed-form or table lookups; there is no RNG and no fitting
at runtime. Repeated calls return identical dictionaries.
