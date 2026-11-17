"""Phase 5 Fail-Closed Abstention Contract & Phase 6 Multi-Scenario Prospective Power Simulation."""

from __future__ import annotations

import math
from enum import Enum
from typing import Any, Sequence

import numpy as np

from tofu_ml.autonomous_rsl_v2.time_only_models import BayesianWeibullIC


class FailClosedStateV21(str, Enum):
    """Refined Phase 5 operational & epistemic abstention states."""

    VALID_ESTIMATE = "VALID_ESTIMATE"
    EXPLORATORY_ESTIMATE = "EXPLORATORY_ESTIMATE"
    HIGH_UNCERTAINTY = "HIGH_UNCERTAINTY"
    OUT_OF_VALIDATION_DOMAIN = "OUT_OF_VALIDATION_DOMAIN"
    TIME_ORIGIN_UNVERIFIED = "TIME_ORIGIN_UNVERIFIED"
    MODEL_NOT_VALIDATED = "MODEL_NOT_VALIDATED"
    MODEL_FAILURE = "MODEL_FAILURE"
    DATA_QUALITY_FAILURE = "DATA_QUALITY_FAILURE"
    INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"


def evaluate_fail_closed_contract_v21(
    *,
    elapsed_h: float,
    model_integrity_ok: bool,
    clock_monotonic_ok: bool,
    time_origin_verified: bool,
    model_externally_validated: bool,
    q90_survival_h: float | None,
    median_rsl_h: float | None,
    q10_survival_h: float | None,
    max_validation_domain_h: float = 42.8888,
    max_pi80_width_provisional_h: float = 40.0,
) -> dict[str, Any]:
    """Fail-closed contract distinguishing computational availability from operational authorization."""
    if not clock_monotonic_ok or elapsed_h < 0.0:
        state = FailClosedStateV21.TIME_ORIGIN_UNVERIFIED
        authorized = False
        reason = "Clock rollback or negative elapsed monitoring time."
    elif not model_integrity_ok:
        state = FailClosedStateV21.MODEL_FAILURE
        authorized = False
        reason = "Model artifact SHA-256 verification failed."
    elif elapsed_h < 0.25:
        state = FailClosedStateV21.INSUFFICIENT_EVIDENCE
        authorized = False
        reason = "Minimum 0.25h monitoring initiation window not yet elapsed."
    elif not time_origin_verified:
        state = FailClosedStateV21.TIME_ORIGIN_UNVERIFIED
        authorized = False
        reason = "Biological production/storage origin Delta_0 unverified; monitoring origin only."
    elif not model_externally_validated:
        state = FailClosedStateV21.MODEL_NOT_VALIDATED
        authorized = False
        reason = "External prospective validation absent; operational deployment blocked."
    elif elapsed_h > max_validation_domain_h:
        state = FailClosedStateV21.OUT_OF_VALIDATION_DOMAIN
        authorized = False
        reason = f"Elapsed {elapsed_h:.2f}h exceeds historical validation support {max_validation_domain_h:.2f}h."
    elif (
        q90_survival_h is None
        or q10_survival_h is None
        or (q10_survival_h - q90_survival_h) > max_pi80_width_provisional_h
    ):
        state = FailClosedStateV21.HIGH_UNCERTAINTY
        authorized = False
        reason = "Predictive 80% interval width exceeds provisional abstention threshold."
    else:
        state = FailClosedStateV21.VALID_ESTIMATE
        authorized = True
        reason = "All integrity, domain, uncertainty, and external validation gates passed."

    return {
        "runtime_state": state.value,
        "operational_prediction_authorized": authorized,
        "conditional_rsl_note": "Conditional on sample remaining unspoiled at t; NOT a physical condition or food-safety clearance.",
        "median_rsl_h": median_rsl_h,
        "q90_survival_h": q90_survival_h,
        "q10_survival_h": q10_survival_h,
        "reason": reason,
    }


def run_phase6_multi_scenario_power(
    *,
    sample_sizes: Sequence[int] = (10, 15, 20, 30, 40, 60),
    sigma_scenarios: Sequence[float] = (0.20, 0.30, 0.40),
    n_mc: int = 120,
    seed: int = 404,
) -> list[dict[str, Any]]:
    """Multi-scenario Monte Carlo power & precision study across varying lot heterogeneity."""
    rng = np.random.default_rng(seed)
    grid = np.arange(6.0, 84.0, 6.0)
    rows: list[dict[str, Any]] = []

    for sig_true in sigma_scenarios:
        for n_lots in sample_sizes:
            covs, widths, nlls = [], [], []
            for _ in range(n_mc):
                u_tr = rng.uniform(0.01, 0.99, size=n_lots)
                t_tr = np.exp(math.log(36.0) + sig_true * np.log(-np.log(1.0 - u_tr)))
                l_tr, u_tr_b = [], []
                for tt in t_tr:
                    if tt > 66.0:
                        l_tr.append(66.0)
                        u_tr_b.append(float("inf"))
                    else:
                        idx = int(np.searchsorted(grid, tt, side="left"))
                        l_tr.append(0.5 if idx == 0 else float(grid[idx - 1]))
                        u_tr_b.append(float(grid[idx]))

                u_te = rng.uniform(0.01, 0.99, size=40)
                t_te = np.exp(math.log(36.0) + sig_true * np.log(-np.log(1.0 - u_te)))
                l_te, u_te_b = [], []
                for tt in t_te:
                    if tt > 66.0:
                        l_te.append(66.0)
                        u_te_b.append(float("inf"))
                    else:
                        idx = int(np.searchsorted(grid, tt, side="left"))
                        l_te.append(0.5 if idx == 0 else float(grid[idx - 1]))
                        u_te_b.append(float(grid[idx]))
                l_te_arr, u_te_arr = np.asarray(l_te), np.asarray(u_te_b)

                bay = BayesianWeibullIC().fit(np.asarray(l_tr), np.asarray(u_tr_b))
                nlls.append(bay.unit_ic_nll(l_te_arr, u_te_arr))
                qs = bay.conditional_rsl_quantiles(0.0)
                widths.append(qs["q10_survival_h"] - qs["q90_survival_h"])
                covs.append(float(np.mean((qs["q10_survival_h"] >= l_te_arr) & (qs["q90_survival_h"] <= u_te_arr))))

            rows.append(
                {
                    "sigma_lot_heterogeneity": float(sig_true),
                    "n_independent_lots": int(n_lots),
                    "n_mc_replicates": int(n_mc),
                    "mean_heldout_unit_ic_nll": round(float(np.mean(nlls)), 4),
                    "mean_80pct_coverage": round(float(np.mean(covs)), 4),
                    "cov_mc_se": round(float(np.std(covs, ddof=1) / math.sqrt(n_mc)), 4),
                    "mean_pi80_width_h": round(float(np.mean(widths)), 2),
                }
            )
    return rows


__all__ = [
    "FailClosedStateV21",
    "evaluate_fail_closed_contract_v21",
    "run_phase6_multi_scenario_power",
]
