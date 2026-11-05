# Data contract

## Inputs

| Field | Type | Rules |
|---|---|---|
| `elapsed_h` | float | finite, `>= 0`; hours of monitoring elapsed. Historical references use first-sensor time; the TofuSense application supplies `(serverNow - Experiment.startedAt)/3600000`. |
| `sample_status` | str | `NOT_SPOILED` or `SAMPLE_REPORTED_SPOILED` |
| `storage_condition` | str | `DRY` supported; anything else returns `UNSUPPORTED_CONDITION` |

Invalid types, `NaN`, `inf`, negative elapsed times and unknown statuses raise
`RSLInputError`. Water-storage sessions are never substituted for dry references.

## Output

```json
{
  "elapsed_h": 24.63,
  "elapsed_origin": "FIRST_SENSOR_TIMESTAMP",
  "storage_condition": "DRY",
  "sample_status": "NOT_SPOILED",
  "primary_method": "M1_EMPIRICAL_ENVELOPE",
  "primary_rsl": {"lower_h": 0.0, "upper_h": 18.2588, "interpretation": "EMPIRICAL_INTERVAL_ENVELOPE"},
  "methods": {
    "M1": {"status": "OK", "lower_h": 0.0, "upper_h": 18.2588,
            "interpretation": "EMPIRICAL_INTERVAL_ENVELOPE", "label": "EMPIRICAL INTERVAL ENVELOPE - NOT ...",
            "n_reference_sessions": 3, "n_at_risk_sessions": 3},
    "M2": {"status": "OK", "label": "TURNBULL_NPMLE_CONDITIONAL_SUPPORT",
            "advisory": "ESTIMATOR_DEPENDENT - POTENTIALLY ANTI-CONSERVATIVE",
            "n_components": 2, "components": [{"lower_h": 0.0, "upper_h": 0.0039, "mass": 0.33333},
                                               {"lower_h": 6.5088, "upper_h": 7.6032, "mass": 0.66667}]},
    "M3": {"status": "OK", "label": "WEIBULL_A0_PARAMETRIC_COMPARATOR",
            "available": true, "shape": 7.6967, "scale": 30.7571,
            "r10_h": 1.5134, "r90_h": 9.9858, "support_warning": null,
            "suppress_from_dashboard": false}
  },
  "n_reference_sessions": 3,
  "n_at_risk_sessions": 3,
  "tvoc_contribution": "NOT_ESTABLISHED",
  "status": "OK",
  "caveats": ["POST_HOC_EXPLORATORY", "DESCRIPTIVE", "THREE_INFORMATIVE_DRY_ENDPOINTS",
               "BATCH_INDEPENDENCE_UNVERIFIED", "TIME_ORIGIN_IS_FIRST_SENSOR_TIMESTAMP",
               "NOT_A_PROBABILISTIC_PREDICTION_INTERVAL", "TVOC_CONTRIBUTION_NOT_ESTABLISHED"]
}
```

Numbers above are illustrative formatting of the real engine output; see
`examples/example_output.json` for the full-precision values.

The engine's own `elapsed_origin` constant is `FIRST_SENSOR_TIMESTAMP`, inherited
from the historical reference protocol. The application service adds
`metadata.elapsedOrigin = EXPERIMENT_STARTED_AT` and the Node adapter exposes that
application origin; it never rewrites the canonical numeric fields.

## Statuses

| Status | Meaning | Range |
|---|---|---|
| `OK` | within the historical reference support | present |
| `OUTSIDE_SUPPORT` | elapsed time is at or beyond every reference `U` | absent |
| `SAMPLE_REPORTED_SPOILED` | the sample is already reported spoiled | absent |
| `UNSUPPORTED_CONDITION` | storage condition has no registered reference | absent |

## Reference files

| File | Contents | Validation |
|---|---|---|
| `dry_endpoints.json` | S3/S4/S5 primary intervals, full precision | exactly 3, DRY, `0 < L < U` |
| `turnbull_npmle.json` | support intervals, masses, convergence | lengths match, masses sum to 1 ± 1e-9, ordered disjoint support |
| `weibull_a0.json` | shape, scale, provenance | positive finite |
| `provenance.json` | research status, origin, TVOC status, hashes | status and TVOC labels enforced |

Any failure raises `ReferenceDataError`. There are no defaults.

## Semantic separations that the schema preserves

- M1 is an **empirical interval envelope**, not a prediction interval or
  confidence interval.
- M2 components are **estimator-dependent support**, not confidence intervals.
- M3 is a **comparator**, not the primary estimate.
- The three methods are never averaged or fused.
