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

module.exports = {
  RSL_DOMAIN,
  deriveRslDomain,
};
