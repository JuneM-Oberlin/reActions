import assert from 'node:assert/strict';
import test from 'node:test';
import { duration, jobText, parseRemote } from './reactions.js';

test('parseRemote', () => {
  assert.equal(parseRemote('https://github.com/you/app.git'), 'you/app');
  assert.equal(parseRemote('https://github.com/you/app'), 'you/app');
  assert.equal(parseRemote('git@github.com:you/app.git'), 'you/app');
  assert.equal(parseRemote('ssh://git@github.com/you/my.app.git'), 'you/my.app');
  assert.throws(() => parseRemote('https://gitlab.com/you/app.git'), /not a GitHub/);
  assert.throws(() => parseRemote('https://github.com/you/app?x=1'), /not a GitHub/);
});

test('duration', () => {
  assert.equal(duration(42_000), '0:42');
  assert.equal(duration(192_000), '3:12');
});

test('jobText', () => {
  const t = '2026-01-01T00:00:00Z';
  const now = Date.parse(t) + 70_000;
  assert.equal(jobText({ name: 'build', status: 'completed', conclusion: 'success', started_at: t, completed_at: '2026-01-01T00:00:42Z' }, now), 'build ok 0:42');
  assert.equal(jobText({ name: 'test', status: 'completed', conclusion: 'failure', started_at: t, completed_at: '2026-01-01T00:00:42Z' }, now), 'test failure 0:42');
  assert.equal(jobText({ name: 'test', status: 'in_progress', conclusion: null, started_at: t, completed_at: null }, now), 'test running 1:10');
  assert.equal(jobText({ name: 'lint', status: 'queued', conclusion: null, started_at: t, completed_at: null }, now), 'lint queued');
});
