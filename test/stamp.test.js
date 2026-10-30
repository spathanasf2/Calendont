import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentBlock, expectedBlock } from '../scripts/stamp.js';

test('sw.js caches every app file under the current version', () => {
  assert.equal(currentBlock(), expectedBlock(), 'app/ changed since sw.js was stamped: run `npm run stamp`');
});
