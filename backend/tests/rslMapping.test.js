const test = require('node:test');
const assert = require('node:assert/strict');
const { RSL_DOMAIN, deriveRslDomain } = require('../src/utils/rslMapping');

test('deriveRslDomain: dalam domain termasuk AT_BOUNDARY', () => {
  assert.equal(deriveRslDomain({ domainStatus: 'WITHIN_DOMAIN', failureCategory: 'NONE' }), RSL_DOMAIN.IN);
  assert.equal(deriveRslDomain({ domainStatus: 'AT_BOUNDARY', failureCategory: 'NONE' }), RSL_DOMAIN.IN);
  assert.equal(deriveRslDomain({ domainStatus: 'BEYOND_DOMAIN', failureCategory: 'OUT_OF_DOMAIN' }), RSL_DOMAIN.OUT);
  assert.equal(deriveRslDomain({ domainStatus: 'INVALID_ELAPSED_TIME', failureCategory: 'INPUT_TIMESTAMP' }), null);
});
