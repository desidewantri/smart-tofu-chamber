"""Consumer-Facing Indonesian Presentation Adapter (Workstream C Research-Only Policy)."""

from __future__ import annotations

from typing import Any, Mapping

from .estimation_state import ApplicationState

_INDONESIAN_MESSAGES: dict[ApplicationState, str] = {
    ApplicationState.INITIALIZING: "Menyiapkan pemantauan tahu...",
    ApplicationState.WAITING_FOR_DATA: "Sedang mengumpulkan data pemantauan.",
    ApplicationState.PROCESSING: "Sistem sedang menghitung estimasi.",
    ApplicationState.RETRYING: "Koneksi sedang dipulihkan. Sistem akan mencoba kembali secara otomatis.",
    ApplicationState.ACTION_REQUIRED: "Pengaturan waktu pemantauan perlu diperiksa. Silakan periksa pengaturan perangkat.",
    ApplicationState.TEMPORARILY_UNAVAILABLE: "Sistem sedang mengalami gangguan sementara. Pemantauan akan dilanjutkan secara otomatis.",
    ApplicationState.PROCESSING_FAILED: "Estimasi belum dapat dihitung. Silakan periksa perangkat atau hubungi dukungan.",
}

_RESEARCH_DISCLAIMER_ID = (
    "Perkiraan ini dihasilkan berdasarkan model penelitian TofuSense. "
    "Waktu aktual dapat berbeda. Hasil ini bukan jaminan masa simpan maupun keamanan pangan."
)


def to_consumer_presentation(api_response: Mapping[str, Any]) -> dict[str, Any]:
    """Map normalized orchestrator response into simple Indonesian UX without technical jargon or PI80 clutter."""
    app_state = ApplicationState(str(api_response["application_state"]))
    estimate = api_response.get("estimate") or {}
    median_h = estimate.get("median_rsl_hours")
    is_stale = bool(api_response.get("is_stale", False))
    eligible = bool(api_response.get("research_display_eligible", True)) and not is_stale

    if app_state == ApplicationState.ESTIMATE_AVAILABLE and median_h is not None and eligible:
        rounded_h = round(float(median_h), 1)
        headline = f"Perkiraan sisa waktu pemantauan (estimasi riset): sekitar {rounded_h:.1f} jam."
        availability_category = "AVAILABLE"
    else:
        rounded_h = None
        if api_response.get("failure_category") == "OUT_OF_DOMAIN":
            headline = "Durasi pemantauan telah melampaui batas data penelitian sehingga estimasi tidak ditampilkan."
            availability_category = "MODEL_OR_COMPUTATION_UNAVAILABLE"
        else:
            headline = _INDONESIAN_MESSAGES.get(
                app_state,
                "Estimasi belum dapat dihitung. Silakan periksa perangkat atau hubungi dukungan.",
            )
            if app_state in (
                ApplicationState.INITIALIZING,
                ApplicationState.WAITING_FOR_DATA,
                ApplicationState.PROCESSING,
                ApplicationState.RETRYING,
                ApplicationState.TEMPORARILY_UNAVAILABLE,
            ):
                availability_category = "TEMPORARILY_UNAVAILABLE_OR_IN_PROGRESS"
            elif app_state == ApplicationState.ACTION_REQUIRED:
                availability_category = "USER_ACTION_REQUIRED"
            else:
                availability_category = "MODEL_OR_COMPUTATION_UNAVAILABLE"

    monitoring = api_response.get("monitoring") or {}
    sensor_conn = monitoring.get("sensor_connection", "UNKNOWN")
    temp_c = monitoring.get("temp_c")
    humid_pct = monitoring.get("humid_pct")
    elapsed_h = monitoring.get("elapsed_hours")

    sensor_note = (
        "Sensor chamber terhubung (pemantauan lingkungan saja)."
        if sensor_conn == "CONNECTED"
        else "Sensor chamber terputus sementara, tetapi penghitungan waktu pemantauan tetap berjalan."
    )
    secondary_statuses = list(api_response.get("secondary_model_statuses") or [])
    high_unc_active = (
        api_response.get("model_status") == "HIGH_UNCERTAINTY" or "HIGH_UNCERTAINTY" in secondary_statuses
    )
    uncertainty_note_id = (
        "Ketidakpastian prediksi tinggi; hasil hanya sebagai referensi riset."
        if high_unc_active
        else None
    )

    return {
        "session_id": api_response["session_id"],
        "application_state": app_state.value,
        "availability_category": availability_category,
        "headline_id": headline,
        "display_rsl_hours": rounded_h,
        "elapsed_hours_display": None if elapsed_h is None else round(float(elapsed_h), 1),
        "temp_c_display": None if temp_c is None else round(float(temp_c), 1),
        "humid_pct_display": None if humid_pct is None else round(float(humid_pct), 1),
        "sensor_status_note_id": sensor_note,
        "secondary_model_statuses": secondary_statuses,
        "uncertainty_note_id": uncertainty_note_id,
        "research_disclaimer_id": _RESEARCH_DISCLAIMER_ID,
        "food_safety_disclaimer_id": _RESEARCH_DISCLAIMER_ID,
        "storage_guidance_id": "Simpan tahu di wadah bersih dan sejuk sesuai praktik higienis.",
        "operational_prediction_authorized": bool(api_response.get("operational_prediction_authorized", False)),
        "last_calculated_at": api_response.get("last_calculated_at"),
    }


__all__ = ["to_consumer_presentation"]
