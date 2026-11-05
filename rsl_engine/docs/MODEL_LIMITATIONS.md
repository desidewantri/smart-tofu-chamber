# Limitations

**POST_HOC_EXPLORATORY · DESCRIPTIVE · N = 3 INFORMATIVE DRY ENDPOINTS · TVOC_CONTRIBUTION = NOT_ESTABLISHED**

## Evidence base

- Three informative dry-storage endpoints only: S3, S4, S5.
- S1 and S2 are water-storage sessions and are excluded from every dry calculation.
- Batch independence is **UNVERIFIED**.
- S4 and S5 chamber-entry times are unknown.
- S4 and S5 tofu age before monitoring is unknown, so RSL is not total shelf life
  from production.
- Elapsed time always begins at the **first sensor timestamp**.
- The endpoint is operational **organoleptic** spoilage, not microbiological
  safety.
- S3 and S5 include single-panelist endpoint observations.
- The inspection schedule may be informative.

## M1 — empirical interval envelope

**EMPIRICAL INTERVAL ENVELOPE — NOT A PROBABILISTIC PREDICTION INTERVAL OR CONFIDENCE INTERVAL.**

It summarises which remaining times are compatible with the historical intervals.
It does not guarantee that a new sample spoils inside the range. The lower bound
can be zero and stays zero once the smallest reference `L` is passed. The number
of at-risk sessions falls as elapsed time grows, and only one session remains from
32.23 h to 42.89 h.

## M2 — Turnbull NPMLE

- Nonparametric interval-censored estimator, not a machine-learning model.
- Mass inside an innermost support interval is not identified. Support boundaries
  are not event times.
- Components are estimator-dependent and can be narrower than the evidence
  supports; do not read them as conservative individual ranges.
- No exact conditional mean and no calibrated individual probabilities are
  produced.
- The support can end earlier than the empirical envelope: after 32.23 h only M1
  continues, up to 42.89 h.

## M3 — Weibull A0

- Two-parameter parametric assumption on three intervals; the fitted shape (7.70)
  is unstable.
- A smooth distribution does not establish predictive reliability.
- Upper quantiles whose endpoint exceeds 42.89 h are flagged
  `EXCEEDS_EMPIRICAL_SUPPORT` and suppressed from display.
- At `elapsed_h >= 42.89` the comparator returns `OUTSIDE_SUPPORT`.

## TVOC and the model claim

`TVOC_CONTRIBUTION = NOT_ESTABLISHED`. The v2.2 verdict `NOT_SUPPORTED` is
unchanged. Nothing in this engine uses sensor features, so it cannot demonstrate
sensor contribution.

The engine does **not** provide validated individual predictive reliability,
validated sensor-driven RSL prediction, incremental TVOC contribution, early
warning, or a food-safety determination.
