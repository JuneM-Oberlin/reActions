import assert from 'node:assert/strict';
import test from 'node:test';
import { duration, exitCode, jobText, latestPerWorkflow, nextDelay, parseRemote, render } from './reactions.js';

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
  const steps = [
    { name: 'Set up job', status: 'completed' },
    { name: 'Run npm test', status: 'in_progress' },
    { name: 'Post checkout', status: 'pending' },
  ];
  assert.equal(jobText({ name: 'test', status: 'in_progress', conclusion: null, started_at: t, completed_at: null, steps }, now), 'test running 1:10  (step 2/3: Run npm test)');
  // Between steps there is no step in progress, so no step text.
  assert.equal(jobText({ name: 'test', status: 'in_progress', conclusion: null, started_at: t, completed_at: null, steps: [] }, now), 'test running 1:10');
  assert.equal(jobText({ name: 'lint', status: 'queued', conclusion: null, started_at: t, completed_at: null }, now), 'lint queued');
});

test('latestPerWorkflow', () => {
  const runs = [
    { id: 1, workflow_id: 10, created_at: '2026-01-01T00:00:00Z' },
    { id: 2, workflow_id: 10, created_at: '2026-01-03T00:00:00Z' },
    { id: 3, workflow_id: 10, created_at: '2026-01-02T00:00:00Z' },
    { id: 4, workflow_id: 20, created_at: '2026-01-01T00:00:00Z' },
  ];
  assert.deepEqual(latestPerWorkflow(runs).map((run) => run.id), [2, 4]);
  assert.deepEqual(latestPerWorkflow([]), []);
});

test('exitCode', () => {
  assert.equal(exitCode([{ conclusion: 'success' }, { conclusion: 'skipped' }, { conclusion: 'neutral' }]), 0);
  assert.equal(exitCode([{ conclusion: 'success' }, { conclusion: 'failure' }]), 1);
  assert.equal(exitCode([{ conclusion: 'cancelled' }]), 1);
  assert.equal(exitCode([{ conclusion: 'timed_out' }]), 1);
});

test('nextDelay', () => {
  assert.equal(nextDelay(3_000), 3_750);
  assert.equal(nextDelay(18_000), 20_000);
  assert.equal(nextDelay(20_000), 20_000);
});

test('render', () => {
  const t = '2026-01-01T00:00:00Z';
  const job = { name: 'build', status: 'completed', conclusion: 'success', started_at: t, completed_at: '2026-01-01T00:00:42Z' };
  const entries = [
    { run: { name: 'CI', status: 'completed' }, jobList: { total_count: 3, jobs: [job] } },
    { run: { name: 'Lint', status: 'queued' }, jobList: { total_count: 0, jobs: [] } },
  ];
  assert.deepEqual(render('you/app @ a1b2c3d (main)', entries, Date.parse(t)), [
    'you/app @ a1b2c3d (main)   2 runs',
    '  CI     build ok 0:42    +2 more',
    '  Lint   queued',
  ]);
});
