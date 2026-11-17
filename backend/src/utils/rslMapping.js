const RSL_DOMAIN = {
  IN: 'IN_DOMAIN',
  OUT: 'OUT_OF_DOMAIN',
  LEGACY: 'LEGACY',
};

function deriveRslDomain({ domainStatus, failureCategory } = {}) {
  if (failureCategory === 'OUT_OF_DOMAIN') {
    return RSL_DOMAIN.OUT;
  }
  if (failureCategory === 'NONE' && (domainStatus === 'WITHIN_DOMAIN' || domainStatus === 'AT_BOUNDARY')) {
    return RSL_DOMAIN.IN;
  }
  return null;
}

function sessionRslFields(result, { previous = {} } = {}) {
  const inDomain = result.rslDomain === RSL_DOMAIN.IN;
  const isNumeric = Number.isFinite(result.shelfLifeJam);
  const shelfLifeAwal = inDomain && isNumeric ? Math.round(result.shelfLifeJam * 100) / 100 : null;
  const prediksiDibuat = result.rslCalculatedAt ?? previous?.prediksiDibuat ?? null;

  return {
    shelfLifeAwal,
    prediksiDibuat,
    modelUsed: 'v21_weibull',
    rslDomain: result.rslDomain ?? null,
    rslState: result.rslState ?? null,
    rslPi80Low: inDomain && Number.isFinite(result.rslPi80Low) ? result.rslPi80Low : null,
    rslPi80High: inDomain && Number.isFinite(result.rslPi80High) ? result.rslPi80High : null,
    rslCalculatedAt: result.rslCalculatedAt ?? null,
  };
}

module.exports = {
  RSL_DOMAIN,
  deriveRslDomain,
  sessionRslFields,
};
