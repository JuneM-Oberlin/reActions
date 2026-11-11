#!/usr/bin/env node
// reactions: follow the GitHub Actions runs for the commit at HEAD until they finish.
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const FIRST_POLL_MS = 3_000; // wait this long before the second poll
const MAX_POLL_MS = 20_000; // the wait grows toward this
const NO_RUNS_TIMEOUT_MS = 30_000; // give up if the commit never gets a run
const PASSING = ['success', 'skipped', 'neutral']; // run conclusions that count as a pass

// Run a command and return its trimmed stdout. Throws if it exits non-zero;
// the error message includes the command's stderr.
function runCmd(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// "https://github.com/you/app.git" or "git@github.com:you/app.git" -> "you/app"
export function parseRemote(url) {
  //                   scheme or user         host      owner       repo       optional tail
  const m = url.match(/^(?:https:\/\/|git@|ssh:\/\/git@)github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  if (!m) throw new Error(`origin is not a GitHub repository URL: ${url}`);
  const [, owner, name] = m;
  return `${owner}/${name}`;
}

// The token from gh if gh is installed, otherwise from GITHUB_TOKEN.
function getToken() {
  let token;
  try {
    token = runCmd('gh', ['auth', 'token']);
  } catch (err) {
    // ENOENT means gh is not installed. Any other failure is a real error.
    if (err.code !== 'ENOENT') {
      throw new Error(`gh is installed but "gh auth token" failed. Try "gh auth login".\n${err.stderr}`);
    }
    token = process.env.GITHUB_TOKEN;
  }
  if (!token) throw new Error('no GitHub token: install gh and run "gh auth login", or set GITHUB_TOKEN');
  return token;
}

// GET a GitHub REST API path and return the parsed JSON. Throws on any non-2xx.
async function api(path, token) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2026-03-10',
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} on ${path}: ${await res.text()}`);
  return res.json();
}

// 72000 ms -> "1:12"
export function duration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const mm = Math.floor(seconds / 60);
  const ss = String(seconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

// The step a running job is on, for example "  (step 4/7: Run npm test)".
// The API lists every step up front, so the position in the list is the progress.
export function stepText(job) {
  const index = job.steps.findIndex((step) => step.status === 'in_progress');
  if (index === -1) return ''; // between steps
  return `  (step ${index + 1}/${job.steps.length}: ${job.steps[index].name})`;
}

// One job as text, for example "build ok 0:42" or "test running 1:10  (step 4/7: Run npm test)".
export function jobText(job, now) {
  const started = Date.parse(job.started_at);
  if (job.status === 'in_progress') {
    return `${job.name} running ${duration(now - started)}${stepText(job)}`;
  }
  // Not started yet: queued, waiting, requested or pending. No duration to show.
  if (job.status !== 'completed') return `${job.name} ${job.status}`;

  const result = job.conclusion === 'success' ? 'ok' : job.conclusion;
  const finished = Date.parse(job.completed_at);
  return `${job.name} ${result} ${duration(finished - started)}`;
}

// A commit can have many runs of the same workflow (re-runs, schedules).
// Keep only the newest run of each workflow.
export function latestPerWorkflow(runs) {
  const newest = new Map();
  for (const run of runs) {
    const newestSoFar = newest.get(run.workflow_id);
    // created_at is an ISO timestamp, so comparing the strings compares the times.
    if (!newestSoFar || run.created_at > newestSoFar.created_at) {
      newest.set(run.workflow_id, run);
    }
  }
  return Array.from(newest.values());
}

// 0 if every run passed, 1 if any did not.
export function exitCode(runs) {
  return runs.every((run) => PASSING.includes(run.conclusion)) ? 0 : 1;
}

// Each wait is 25% longer than the last, up to the maximum.
export function nextDelay(ms) {
  return Math.min(MAX_POLL_MS, Math.round(ms * 1.25));
}

// The whole display as a list of lines. Each entry is { run, jobList }.
export function render(title, entries, now) {
  const count = entries.length;
  const lines = [`${title}   ${count} ${count === 1 ? 'run' : 'runs'}`];

  // Pad every run name to the longest one so the jobs line up in a column.
  let nameWidth = 0;
  for (const entry of entries) {
    nameWidth = Math.max(nameWidth, entry.run.name.length);
  }

  for (const entry of entries) {
    const run = entry.run;
    const jobs = entry.jobList.jobs;

    let line;
    if (jobs.length === 0) {
      // A run that was just queued has no jobs yet, so show the run's own status.
      line = run.status;
    } else {
      line = jobs.map((job) => jobText(job, now)).join('    ');
    }

    const notShown = entry.jobList.total_count - jobs.length;
    if (notShown > 0) line += `    +${notShown} more`;

    lines.push(`  ${run.name.padEnd(nameWidth)}   ${line}`);
  }
  return lines;
}

// Print the lines on top of the block drawn last time. Returns how many lines
// are now on screen, to pass back in as previousCount on the next call.
function redraw(lines, previousCount) {
  // Cut each line to the terminal width: a wrapped line would take two rows
  // and the cursor-up count below would be wrong. Some terminals report a
  // width of 0, which means unknown, so do not cut then.
  const columns = process.stdout.columns;
  let shown = lines;
  if (columns > 0) {
    shown = lines.map((line) => line.slice(0, columns - 1));
  }

  // ESC[nA moves the cursor up n lines, ESC[J clears from there to the end of the screen.
  let erase = '';
  if (previousCount > 0) {
    erase = `\x1b[${previousCount}A\x1b[J`;
  }

  process.stdout.write(erase + shown.join('\n') + '\n');
  return lines.length;
}

// Fetch the runs to follow for a commit, each paired with its list of jobs.
async function fetchEntries(repo, sha, token) {
  // ponytail: first page only (100 runs, 100 jobs per run). The "+N more"
  // marker shows when the jobs did not fit; paginate then.
  const runList = await api(`/repos/${repo}/actions/runs?head_sha=${sha}&per_page=100`, token);

  const entries = [];
  for (const run of latestPerWorkflow(runList.workflow_runs)) {
    const jobList = await api(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`, token);
    entries.push({ run, jobList });
  }
  return entries;
}

// Follow the runs for HEAD until they all complete. Returns the exit code.
async function watch() {
  const sha = runCmd('git', ['rev-parse', '--verify', 'HEAD']);
  const branch = runCmd('git', ['branch', '--show-current']) || 'detached';
  const repo = parseRemote(runCmd('git', ['remote', 'get-url', 'origin']));
  const token = getToken();

  const title = `${repo} @ ${sha.slice(0, 7)} (${branch})`;
  const startedAt = Date.now();
  let delay = FIRST_POLL_MS;
  let linesOnScreen = 0;

  while (true) {
    const entries = await fetchEntries(repo, sha, token);
    const runs = entries.map((entry) => entry.run);

    const found = runs.length > 0;
    const done = found && runs.every((run) => run.status === 'completed');

    let lines = [`${title}   waiting for runs`];
    if (found) {
      lines = render(title, entries, Date.now());
    }

    // In a terminal, redraw in place on every poll. When piped, print the final state once.
    if (process.stdout.isTTY) {
      linesOnScreen = redraw(lines, linesOnScreen);
    } else if (done) {
      console.log(lines.join('\n'));
    }

    if (done) return exitCode(runs);
    if (!found && Date.now() - startedAt > NO_RUNS_TIMEOUT_MS) {
      throw new Error(`no runs found for ${sha.slice(0, 7)} after ${NO_RUNS_TIMEOUT_MS / 1000}s`);
    }

    await sleep(delay);
    delay = nextDelay(delay);
  }
}

async function main() {
  const { positionals } = parseArgs({ allowPositionals: true });
  if (positionals.length !== 1 || positionals[0] !== 'watch') {
    throw new Error('usage: reactions watch');
  }
  process.exitCode = await watch();
}

// Only run when executed directly, not when the test file imports the helpers.
// realpath because npm installs the command as a symlink.
if (realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // EPIPE means the reader closed the pipe early, as in "reactions watch | head".
  // Nobody is left to read the output, so stop quietly.
  process.stdout.on('error', (err) => {
    if (err.code === 'EPIPE') process.exit(0);
    throw err;
  });
  main().catch((err) => {
    console.error(`reactions: ${err.message}`);
    process.exit(2);
  });
}
