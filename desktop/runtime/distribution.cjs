'use strict';

// Distribution is embedded in package.json by the builder. Environment variables
// cannot turn a community installation into an official installation at runtime.
function desktopDistribution(value) {
  if (value === undefined || value === 'community') return 'community';
  if (value === 'official') return 'official';
  throw new Error('Unknown desktop distribution.');
}

module.exports = { desktopDistribution };
