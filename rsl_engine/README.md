# TofuSense RSL Engine (portable runtime)

This package is the deployable runtime snapshot of the frozen TofuSense v2.3
statistical Remaining Shelf Life engine. It is self-contained: the canonical
v2.3 modules are vendored under `src/v2_3/`, so no developer absolute path or
external research checkout is required at runtime.

- **M1** empirical interval envelope — primary displayed range.
- **M2** Turnbull NPMLE conditional support — supporting estimator.
- **M3** Weibull A0 conditional quantiles — exploratory comparator.
- No runtime fitting, retraining, network access, or sensor predictors.
- Reference data is frozen under `src/tofusense_rsl/reference/`.
- `TVOC_CONTRIBUTION = NOT_ESTABLISHED`.

Install and test:

```bash
python -m pip install -e "rsl_engine[dev]"
python -m pytest rsl_engine/tests -q
```

Use:

```python
from tofusense_rsl import estimate_rsl
estimate_rsl(elapsed_h=20.0, sample_status="NOT_SPOILED", storage_condition="DRY")
```

The service in `rsl_service/` is a thin HTTP wrapper around this package.
