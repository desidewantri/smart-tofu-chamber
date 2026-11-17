const env = require('../config/env');

function createRslClient({ url, timeoutMs = 4000, fetchImpl = fetch } = {}) {
  const baseUrl = (url || 'http://127.0.0.1:8001').replace(/\/$/, '');

  async function estimate(input) {
    const payload = {
      session_id: input.sessionId,
      monitoring_start_at:
        input.startAt instanceof Date ? input.startAt.toISOString() : input.startAt,
      current_timestamp:
        input.now instanceof Date ? input.now.toISOString() : input.now,
      temp_c: input.tempC !== undefined ? input.tempC : undefined,
      humid_pct: input.humidPct !== undefined ? input.humidPct : undefined,
      esp32_connected: input.connected !== undefined ? input.connected : undefined,
    };

    let res;
    try {
      res = await fetchImpl(`${baseUrl}/estimate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new Error(`rsl service request failed: ${err.message}`);
    }

    if (!res.ok) {
      throw new Error(`rsl service membalas HTTP ${res.status}`);
    }

    let body;
    try {
      body = await res.json();
    } catch (err) {
      throw new Error(`rsl service JSON parse failed: ${err.message}`);
    }

    if (!body || typeof body !== 'object' || typeof body.estimate !== 'object' || body.estimate === null) {
      throw new Error('Respons rsl tidak valid: missing estimate object');
    }

    return {
      applicationState: body.application_state,
      domainStatus: body.domain_status,
      failureCategory: body.failure_category,
      researchDisplayEligible: Boolean(body.research_display_eligible),
      medianRslHours: body.estimate.median_rsl_hours ?? null,
      pi80LowerHours: body.estimate.pi80_lower_hours ?? null,
      pi80UpperHours: body.estimate.pi80_upper_hours ?? null,
      lastCalculatedAt: body.last_calculated_at ? new Date(body.last_calculated_at) : null,
      headline: body.headline_id || null,
      disclaimer: body.research_disclaimer_id || null,
      raw: body,
    };
  }

  return { estimate };
}

const defaultClient = createRslClient({
  url: env.rsl?.url,
  timeoutMs: env.rsl?.timeoutMs,
});

module.exports = {
  createRslClient,
  estimate: defaultClient.estimate,
};
