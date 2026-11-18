"""Time-Only Interval-Censored & Right-Censored Survival Model Family (Missions A, C, D)."""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
from scipy.optimize import minimize
from scipy.special import erf, erfinv


def independent_unit_ic_nll(s_lower: np.ndarray, s_upper: np.ndarray) -> float:
    """Pure-Python independent mathematical oracle for unit-level interval/right-censored NLL."""
    total = 0.0
    n = len(s_lower)
    for sl, su in zip(s_lower, s_upper):
        p = max(float(sl) - float(su), 1e-15)
        total += -math.log(min(p, 1.0))
    return total / max(n, 1)


def _norm_cdf(z: np.ndarray) -> np.ndarray:
    return 0.5 * (1.0 + erf(z / math.sqrt(2.0)))


def _norm_ppf(p: float) -> float:
    return math.sqrt(2.0) * float(erfinv(2.0 * p - 1.0))


class _BaseTimeOnlyIC:
    """Exact unit-level interval- & right-censored parametric time-only survival model."""

    model_id: str = "BASE"
    n_params: int = 2

    def __init__(self, penalized: bool = False, sigma_min: float = 0.04) -> None:
        self.penalized = bool(penalized)
        self.sigma_min = float(sigma_min)
        self.mu_: float = 3.55
        self.sigma_: float = 0.25
        self.degenerate_mle_: bool = False
        self.converged_: bool = False

    def survival(self, t_h: np.ndarray) -> np.ndarray:
        raise NotImplementedError

    def _surv_from(self, t_h: np.ndarray, mu: float, sigma: float) -> np.ndarray:
        raise NotImplementedError

    def _inv_cdf(self, p_fail: float) -> float:
        raise NotImplementedError

    def _objective(self, theta: np.ndarray, lower: np.ndarray, upper: np.ndarray) -> float:
        mu = float(theta[0])
        sigma = float(math.exp(theta[1])) if len(theta) > 1 else 1.0
        s_l = self._surv_from(lower, mu, sigma)
        s_r = np.where(
            np.isfinite(upper),
            self._surv_from(np.where(np.isfinite(upper), upper, 1.0), mu, sigma),
            0.0,
        )
        probs = np.clip(s_l - s_r, 1e-15, 1.0)
        nll = -float(np.mean(np.log(probs)))
        if self.penalized and len(theta) > 1:
            # Weakly informative log-sigma shrinkage centered around log(0.28) (~k=3.6) scaled by 1/N
            n_units = max(len(lower), 1)
            prior_pen = (0.5 / n_units) * ((theta[1] - math.log(0.28)) / 0.65) ** 2
            return nll + prior_pen
        return nll

    def fit(self, lower_h: np.ndarray, upper_h: np.ndarray) -> "_BaseTimeOnlyIC":
        l_arr = np.maximum(np.asarray(lower_h, dtype=float), 1e-4)
        u_arr = np.asarray(upper_h, dtype=float)
        mids = np.where(np.isfinite(u_arr), 0.5 * (l_arr + u_arr), 1.35 * l_arr)
        mu0 = float(np.log(max(float(np.median(mids)), 1.0)))
        log_sig_min = math.log(self.sigma_min)

        if self.n_params == 1:
            res = minimize(
                self._objective,
                np.array([mu0]),
                args=(l_arr, u_arr),
                method="L-BFGS-B",
                bounds=[(0.5, 7.0)],
            )
            self.mu_ = float(res.x[0])
            self.sigma_ = 1.0
            self.degenerate_mle_ = False
            self.converged_ = bool(res.success)
            return self

        res = minimize(
            self._objective,
            np.array([mu0, math.log(0.28)]),
            args=(l_arr, u_arr),
            method="L-BFGS-B",
            bounds=[(0.5, 7.0), (log_sig_min, math.log(2.5))],
        )
        self.mu_ = float(res.x[0])
        self.sigma_ = float(math.exp(res.x[1]))
        self.degenerate_mle_ = bool(res.x[1] <= log_sig_min + 1e-3)
        self.converged_ = bool(res.success)
        return self

    def unit_ic_nll(self, lower_h: np.ndarray, upper_h: np.ndarray) -> float:
        s_l = self.survival(lower_h)
        s_r = np.where(
            np.isfinite(upper_h),
            self.survival(np.where(np.isfinite(upper_h), upper_h, 1.0)),
            0.0,
        )
        return independent_unit_ic_nll(s_l, s_r)

    def conditional_ic_nll(self, t_lm_h: np.ndarray, lower_h: np.ndarray, upper_h: np.ndarray) -> float:
        s_lm = np.maximum(self.survival(t_lm_h), 1e-15)
        s_l = self.survival(lower_h)
        s_r = np.where(
            np.isfinite(upper_h),
            self.survival(np.where(np.isfinite(upper_h), upper_h, 1.0)),
            0.0,
        )
        cond_p = np.clip((s_l - s_r) / s_lm, 1e-15, 1.0)
        return float(-np.mean(np.log(cond_p)))

    def conditional_survival(self, t_now_h: float, horizon_r_h: float) -> float:
        if horizon_r_h <= 0.0:
            return 1.0
        s_now = float(self.survival(np.array([max(t_now_h, 0.0)]))[0])
        if s_now <= 1e-15:
            return 0.0
        s_fut = float(self.survival(np.array([max(t_now_h, 0.0) + horizon_r_h]))[0])
        return min(max(s_fut / s_now, 0.0), 1.0)

    def conditional_rsl_quantiles(
        self,
        t_now_h: float,
        quantiles: tuple[float, float, float] = (0.90, 0.50, 0.10),
    ) -> dict[str, float]:
        """Exact analytical conditional RSL quantiles solving S(t + r) / S(t) = q."""
        t0 = max(float(t_now_h), 0.0)
        s_now = float(self.survival(np.array([t0]))[0])

        def _r_for_surv_q(q_surv: float) -> float:
            target_s = min(max(q_surv * s_now, 1e-12), 1.0 - 1e-12)
            t_target = self._inv_cdf(1.0 - target_s)
            return max(t_target - t0, 0.0)

        return {
            "q90_survival_h": _r_for_surv_q(quantiles[0]),  # 10th percentile failure (lower bound)
            "median_rsl_h": _r_for_surv_q(quantiles[1]),
            "q10_survival_h": _r_for_surv_q(quantiles[2]),  # 90th percentile failure (upper bound)
        }


class WeibullIC(_BaseTimeOnlyIC):
    """M0-A: Weibull Interval-Censored Survival (S(t) = exp(-(t/exp(mu))^(1/sigma)))."""

    model_id = "M0_A_WEIBULL"
    n_params = 2

    def _surv_from(self, t_h: np.ndarray, mu: float, sigma: float) -> np.ndarray:
        t_pos = np.maximum(np.asarray(t_h, dtype=float), 1e-9)
        u = np.clip((np.log(t_pos) - mu) / max(sigma, 1e-4), -40.0, 6.0)
        return np.exp(-np.exp(u))

    def survival(self, t_h: np.ndarray) -> np.ndarray:
        return self._surv_from(t_h, self.mu_, self.sigma_)

    def _inv_cdf(self, p_fail: float) -> float:
        p = min(max(p_fail, 1e-12), 1.0 - 1e-12)
        return math.exp(self.mu_ + self.sigma_ * math.log(-math.log(1.0 - p)))


class ExponentialIC(_BaseTimeOnlyIC):
    """M0-B: Memoryless Exponential Survival Baseline (Weibull with sigma=1.0, k=1.0)."""

    model_id = "M0_B_EXPONENTIAL"
    n_params = 1

    def _surv_from(self, t_h: np.ndarray, mu: float, sigma: float = 1.0) -> np.ndarray:
        t_pos = np.maximum(np.asarray(t_h, dtype=float), 0.0)
        rate = math.exp(-mu)
        return np.exp(-np.clip(rate * t_pos, 0.0, 60.0))

    def survival(self, t_h: np.ndarray) -> np.ndarray:
        return self._surv_from(t_h, self.mu_, 1.0)

    def _inv_cdf(self, p_fail: float) -> float:
        p = min(max(p_fail, 1e-12), 1.0 - 1e-12)
        return math.exp(self.mu_) * (-math.log(1.0 - p))


class LogNormalIC(_BaseTimeOnlyIC):
    """M0-C: Log-Normal Interval-Censored Survival."""

    model_id = "M0_C_LOGNORMAL"
    n_params = 2

    def _surv_from(self, t_h: np.ndarray, mu: float, sigma: float) -> np.ndarray:
        t_pos = np.maximum(np.asarray(t_h, dtype=float), 1e-9)
        z = (np.log(t_pos) - mu) / max(sigma, 1e-4)
        return 1.0 - _norm_cdf(z)

    def survival(self, t_h: np.ndarray) -> np.ndarray:
        return self._surv_from(t_h, self.mu_, self.sigma_)

    def _inv_cdf(self, p_fail: float) -> float:
        p = min(max(p_fail, 1e-12), 1.0 - 1e-12)
        return math.exp(self.mu_ + self.sigma_ * _norm_ppf(p))


class LogLogisticIC(_BaseTimeOnlyIC):
    """M0-D: Log-Logistic Interval-Censored Survival."""

    model_id = "M0_D_LOGLOGISTIC"
    n_params = 2

    def _surv_from(self, t_h: np.ndarray, mu: float, sigma: float) -> np.ndarray:
        t_pos = np.maximum(np.asarray(t_h, dtype=float), 1e-9)
        u = np.clip((np.log(t_pos) - mu) / max(sigma, 1e-4), -40.0, 40.0)
        return np.where(u > 0, np.exp(-u) / (1.0 + np.exp(-u)), 1.0 / (1.0 + np.exp(u)))

    def survival(self, t_h: np.ndarray) -> np.ndarray:
        return self._surv_from(t_h, self.mu_, self.sigma_)

    def _inv_cdf(self, p_fail: float) -> float:
        p = min(max(p_fail, 1e-12), 1.0 - 1e-12)
        return math.exp(self.mu_ + self.sigma_ * math.log(p / (1.0 - p)))


class BayesianWeibullIC:
    """M0-F: Deterministic 2D-Quadrature Bayesian Posterior Predictive Weibull Survival."""

    model_id = "M0_F_BAYESIAN_WEIBULL"

    def __init__(
        self,
        *,
        mu_prior_mean: float = math.log(36.0),
        mu_prior_sd: float = 0.75,
        log_sigma_prior_mean: float = math.log(0.28),
        log_sigma_prior_sd: float = 0.55,
        n_mu: int = 75,
        n_sigma: int = 55,
    ) -> None:
        self.mu_prior_mean = float(mu_prior_mean)
        self.mu_prior_sd = float(mu_prior_sd)
        self.log_sigma_prior_mean = float(log_sigma_prior_mean)
        self.log_sigma_prior_sd = float(log_sigma_prior_sd)
        self.mu_grid: np.ndarray = np.linspace(2.2, 4.9, n_mu)
        self.log_sig_grid: np.ndarray = np.linspace(math.log(0.06), math.log(1.2), n_sigma)
        self.post_weights: np.ndarray = np.ones((n_mu, n_sigma), dtype=float) / (n_mu * n_sigma)
        self.mu_post_mean_: float = mu_prior_mean
        self.mu_post_sd_: float = mu_prior_sd
        self.sigma_post_mean_: float = math.exp(log_sigma_prior_mean)
        self.externally_validated_: bool = False

    def fit(self, lower_h: np.ndarray, upper_h: np.ndarray) -> "BayesianWeibullIC":
        l_arr = np.maximum(np.asarray(lower_h, dtype=float), 1e-4)
        u_arr = np.asarray(upper_h, dtype=float)
        fin = np.isfinite(u_arr)

        M, LS = np.meshgrid(self.mu_grid, self.log_sig_grid, indexing="ij")
        SIG = np.exp(LS)
        log_prior = -0.5 * ((M - self.mu_prior_mean) / self.mu_prior_sd) ** 2 - 0.5 * (
            (LS - self.log_sigma_prior_mean) / self.log_sigma_prior_sd
        ) ** 2

        log_lik = np.zeros_like(M)
        for li, ui, is_fin in zip(l_arr, u_arr, fin):
            ul = np.clip((math.log(li) - M) / SIG, -40.0, 6.0)
            sl = np.exp(-np.exp(ul))
            if is_fin:
                ur = np.clip((math.log(ui) - M) / SIG, -40.0, 6.0)
                sr = np.exp(-np.exp(ur))
            else:
                sr = 0.0
            log_lik += np.log(np.clip(sl - sr, 1e-15, 1.0))

        log_post = log_prior + log_lik
        log_post -= float(np.max(log_post))
        w = np.exp(log_post)
        self.post_weights = w / float(np.sum(w))
        self.mu_post_mean_ = float(np.sum(self.post_weights * M))
        self.mu_post_sd_ = float(math.sqrt(np.sum(self.post_weights * (M - self.mu_post_mean_) ** 2)))
        self.sigma_post_mean_ = float(np.sum(self.post_weights * SIG))
        return self

    def survival(self, t_h: np.ndarray) -> np.ndarray:
        t_arr = np.maximum(np.asarray(t_h, dtype=float), 0.0)
        M = self.mu_grid[:, None]
        SIG = np.exp(self.log_sig_grid)[None, :]
        out = np.zeros_like(t_arr, dtype=float)
        for i, ti in enumerate(t_arr):
            if ti <= 0.0:
                out[i] = 1.0
            else:
                u = np.clip((math.log(float(ti)) - M) / SIG, -40.0, 6.0)
                out[i] = float(np.sum(self.post_weights * np.exp(-np.exp(u))))
        return out

    def unit_ic_nll(self, lower_h: np.ndarray, upper_h: np.ndarray) -> float:
        s_l = self.survival(lower_h)
        s_r = np.where(
            np.isfinite(upper_h),
            self.survival(np.where(np.isfinite(upper_h), upper_h, 1.0)),
            0.0,
        )
        return independent_unit_ic_nll(s_l, s_r)

    def conditional_ic_nll(self, t_lm_h: np.ndarray, lower_h: np.ndarray, upper_h: np.ndarray) -> float:
        s_lm = np.maximum(self.survival(t_lm_h), 1e-15)
        s_l = self.survival(lower_h)
        s_r = np.where(
            np.isfinite(upper_h),
            self.survival(np.where(np.isfinite(upper_h), upper_h, 1.0)),
            0.0,
        )
        cond_p = np.clip((s_l - s_r) / s_lm, 1e-15, 1.0)
        return float(-np.mean(np.log(cond_p)))

    def conditional_survival(self, t_now_h: float, horizon_r_h: float) -> float:
        if horizon_r_h <= 0.0:
            return 1.0
        t0 = max(float(t_now_h), 0.0)
        s_t0 = float(self.survival(np.array([t0]))[0])
        if s_t0 <= 1e-15:
            return 0.0
        s_fut = float(self.survival(np.array([t0 + horizon_r_h]))[0])
        return min(max(s_fut / s_t0, 0.0), 1.0)

    def conditional_rsl_quantiles(
        self,
        t_now_h: float,
        quantiles: tuple[float, float, float] = (0.90, 0.50, 0.10),
    ) -> dict[str, float]:
        """Monotone root-finding inversion of posterior predictive conditional survival S_post(t+r)/S_post(t) = q."""
        t0 = max(float(t_now_h), 0.0)
        s_now = float(self.survival(np.array([t0]))[0])

        def _bisect_r(q_surv: float) -> float:
            lo, hi = 0.0, 240.0
            for _ in range(36):
                mid = 0.5 * (lo + hi)
                s_mid = float(self.survival(np.array([t0 + mid]))[0]) / max(s_now, 1e-15)
                if s_mid > q_surv:
                    lo = mid
                else:
                    hi = mid
            return 0.5 * (lo + hi)

        return {
            "q90_survival_h": _bisect_r(quantiles[0]),
            "median_rsl_h": _bisect_r(quantiles[1]),
            "q10_survival_h": _bisect_r(quantiles[2]),
        }

    def save_artifact(self, path: str | Path, *, model_externally_validated: bool = False) -> str:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "model_id": self.model_id,
            "model_externally_validated": bool(model_externally_validated),
            "mu_prior_mean": self.mu_prior_mean,
            "mu_prior_sd": self.mu_prior_sd,
            "log_sigma_prior_mean": self.log_sigma_prior_mean,
            "log_sigma_prior_sd": self.log_sigma_prior_sd,
            "mu_post_mean": self.mu_post_mean_,
            "mu_post_sd": self.mu_post_sd_,
            "sigma_post_mean": self.sigma_post_mean_,
            "mu_grid": self.mu_grid.tolist(),
            "log_sig_grid": self.log_sig_grid.tolist(),
            "post_weights": self.post_weights.tolist(),
        }
        raw = json.dumps(payload, indent=2) + "\n"
        p.write_text(raw, encoding="utf-8")
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    @classmethod
    def load_artifact(cls, path: str | Path, expected_sha256: str | None = None) -> "BayesianWeibullIC":
        p = Path(path)
        raw = p.read_text(encoding="utf-8")
        actual = hashlib.sha256(raw.encode("utf-8")).hexdigest()
        if expected_sha256 is not None and actual != expected_sha256:
            raise ValueError(f"Model artifact SHA-256 mismatch: expected {expected_sha256}, got {actual}")
        data = json.loads(raw)
        obj = cls(
            mu_prior_mean=data["mu_prior_mean"],
            mu_prior_sd=data["mu_prior_sd"],
            log_sigma_prior_mean=data["log_sigma_prior_mean"],
            log_sigma_prior_sd=data["log_sigma_prior_sd"],
            n_mu=len(data["mu_grid"]),
            n_sigma=len(data["log_sig_grid"]),
        )
        obj.mu_grid = np.asarray(data["mu_grid"], dtype=float)
        obj.log_sig_grid = np.asarray(data["log_sig_grid"], dtype=float)
        obj.post_weights = np.asarray(data["post_weights"], dtype=float)
        obj.mu_post_mean_ = float(data["mu_post_mean"])
        obj.mu_post_sd_ = float(data["mu_post_sd"])
        obj.sigma_post_mean_ = float(data["sigma_post_mean"])
        obj.externally_validated_ = bool(data["model_externally_validated"])
        return obj


__all__ = [
    "BayesianWeibullIC",
    "ExponentialIC",
    "LogLogisticIC",
    "LogNormalIC",
    "WeibullIC",
    "independent_unit_ic_nll",
]
