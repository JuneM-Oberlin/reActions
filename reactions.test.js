import assert from 'node:assert/strict';
import test from 'node:test';
import {
  api,
  duration,
  exitCode,
  jobText,
  latestPerWorkflow,
  nextDelay,
  parseRemote,
  quotaDelay,
  rateLimit,
  render,
} from './reactions.js';

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

// Swap the real fetch for a fake that answers from a list and records the
// headers of every request. Returns those recorded headers.
function fakeFetch(t, responses) {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push(options.headers);
    return responses.shift();
  });
  return requests;
}

test('api sends the ETag back and reuses the body on a 304', async (t) => {
  const requests = fakeFetch(t, [
    new Response('{"total_count":1}', { status: 200, headers: { etag: '"abc"' } }),
    new Response(null, { status: 304 }),
    new Response('{"total_count":2}', { status: 200, headers: { etag: '"def"' } }),
    new Response(null, { status: 304 }),
  ]);

  assert.deepEqual(await api('/etag-test', 'token'), { total_count: 1 });
  assert.equal(requests[0]['If-None-Match'], undefined);

  // Unchanged: the ETag goes out and the first body comes back.
  assert.deepEqual(await api('/etag-test', 'token'), { total_count: 1 });
  assert.equal(requests[1]['If-None-Match'], '"abc"');

  // Changed: the new body and the new ETag replace the old ones.
  assert.deepEqual(await api('/etag-test', 'token'), { total_count: 2 });
  assert.deepEqual(await api('/etag-test', 'token'), { total_count: 2 });
  assert.equal(requests[3]['If-None-Match'], '"def"');
});

test('api keeps a separate ETag for each path', async (t) => {
  const requests = fakeFetch(t, [
    new Response('{"path":"one"}', { status: 200, headers: { etag: '"one"' } }),
    new Response('{"path":"two"}', { status: 200, headers: { etag: '"two"' } }),
  ]);
  await api('/etag-one', 'token');
  await api('/etag-two', 'token');
  assert.equal(requests[1]['If-None-Match'], undefined);
});

test('api throws on an error status', async (t) => {
  fakeFetch(t, [new Response('{"message":"Not Found"}', { status: 404 })]);
  await assert.rejects(api('/etag-missing', 'token'), /GitHub API 404 on \/etag-missing/);
});

test('quotaDelay', () => {
  const now = 1_000_000;
  const inTenMinutes = now + 600_000;

  // Plenty left: no extra wait.
  assert.equal(quotaDelay(5_000, inTenMinutes, now, 3), 0);
  assert.equal(quotaDelay(500, inTenMinutes, now, 3), 0);

  // 90 requests at 3 per poll is 30 polls, spread over 10 minutes: 20 seconds each.
  assert.equal(quotaDelay(90, inTenMinutes, now, 3), 20_000);

  // Not enough left for even one poll: wait for the reset.
  assert.equal(quotaDelay(2, inTenMinutes, now, 3), 600_000);
  assert.equal(quotaDelay(0, inTenMinutes, now, 3), 600_000);

  // The reset time has already passed: nothing to wait for.
  assert.equal(quotaDelay(0, now - 1_000, now, 3), 0);
});

test('api records the rate limit from every response, including a 304', async (t) => {
  fakeFetch(t, [
    new Response('{}', { status: 200, headers: { etag: '"q"', 'x-ratelimit-remaining': '42', 'x-ratelimit-reset': '1700000000' } }),
    new Response(null, { status: 304, headers: { 'x-ratelimit-remaining': '41', 'x-ratelimit-reset': '1700000000' } }),
    new Response('{}', { status: 200 }),
  ]);

  await api('/quota-test', 'token');
  assert.deepEqual(rateLimit, { remaining: 42, resetAt: 1_700_000_000_000 });

  await api('/quota-test', 'token');
  assert.equal(rateLimit.remaining, 41);

  // A response without the headers leaves the last known values alone.
  await api('/quota-other', 'token');
  assert.equal(rateLimit.remaining, 41);
});
