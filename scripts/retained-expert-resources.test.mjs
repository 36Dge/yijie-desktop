import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyRetainedExpertResources } from './sync-desktop-expert-resources.mjs';

const bytes = readFileSync(new URL('../../yijie-skills/docs/provenance/FEAT-158-retained-resources-v0.24.0.json', import.meta.url));
const baseline = () => JSON.parse(bytes);

test('complete prior catalog remains valid when new resources are appended', () => {
  const next = baseline();
  next.skills.push({ id: 'new-review-only-example', version: '0.1.0' });
  verifyRetainedExpertResources(next, bytes);
});

test('preservation covers historical expert versions and all metadata, not only original JD or counts', () => {
  const missing = baseline();
  missing.skills = missing.skills.filter(item => !(item.expert?.expert_id === 'xiaohongshu-copywriter' && item.version === '0.1.0'));
  assert.throws(() => verifyRetainedExpertResources(missing, bytes), /retained exactly once/);
  const changed = baseline();
  changed.skills.find(item => item.expert?.expert_id === 'market-researcher').description = 'Changed meaning';
  assert.throws(() => verifyRetainedExpertResources(changed, bytes), /metadata\/archive changed/);
});
