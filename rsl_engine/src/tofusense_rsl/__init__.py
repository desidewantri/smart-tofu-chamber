"""TofuSense RSL Estimation Engine.

POST_HOC_EXPLORATORY / DESCRIPTIVE / N_INFORMATIVE_DRY_ENDPOINTS = 3
TVOC_CONTRIBUTION = NOT_ESTABLISHED

The engine exposes M1 (empirical interval envelope, primary), M2 (Turnbull NPMLE
conditional support) and M3 (Weibull A0 parametric comparator). The mathematics is
imported from the frozen v2.3 research implementation; see ``_canonical.py``.
"""

from .engine import RSLInputError, default_reference, estimate_rsl
from .reference_data import DryEndpoint, ReferenceData, ReferenceDataError, load_reference_data
from .schemas import CAVEATS, ELAPSED_ORIGIN, TVOC_CONTRIBUTION

__version__ = "1.0.0"

__all__ = ["CAVEATS", "DryEndpoint", "ELAPSED_ORIGIN", "RSLInputError", "ReferenceData",
           "ReferenceDataError", "TVOC_CONTRIBUTION", "__version__", "default_reference",
           "estimate_rsl", "load_reference_data"]
