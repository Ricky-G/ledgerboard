'use strict';

const path = require('node:path');

/** Absolute path to the repository root, resolved from this file's location. */
const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');

/** Resolve a path relative to the repository root. */
function repositoryPath(...segments) {
  return path.join(REPOSITORY_ROOT, ...segments);
}

module.exports = { REPOSITORY_ROOT, repositoryPath };
