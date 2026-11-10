#!/usr/bin/env node
// reactions: show the GitHub Actions runs for the commit at HEAD.
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

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

// One job as text, for example "build ok 0:42" or "test running 1:10".
export function jobText(job, now) {
  const started = Date.parse(job.started_at);
  if (job.status === 'in_progress') return `${job.name} running ${duration(now - started)}`;
  // Not started yet: queued, waiting, requested or pending. No duration to show.
  if (job.status !== 'completed') return `${job.name} ${job.status}`;

  const result = job.conclusion === 'success' ? 'ok' : job.conclusion;
  const finished = Date.parse(job.completed_at);
  return `${job.name} ${result} ${duration(finished - started)}`;
}

async function watch() {
  const sha = runCmd('git', ['rev-parse', '--verify', 'HEAD']);
  const branch = runCmd('git', ['branch', '--show-current']) || 'detached';
  const repo = parseRemote(runCmd('git', ['remote', 'get-url', 'origin']));
  const token = getToken();

  // ponytail: first page only (100 runs, 100 jobs per run). The "+N more"
  // marker below shows when that was not enough; paginate then.
  const runList = await api(`/repos/${repo}/actions/runs?head_sha=${sha}&per_page=100`, token);
  const runs = runList.workflow_runs;
  const runCount = runList.total_count;
  console.log(`${repo} @ ${sha.slice(0, 7)} (${branch})   ${runCount} ${runCount === 1 ? 'run' : 'runs'}`);

  const nameWidth = Math.max(0, ...runs.map((run) => run.name.length));
  const now = Date.now();
  for (const run of runs) {
    const jobList = await api(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`, token);
    const jobs = jobList.jobs;

    // A run that was just queued has no jobs yet, so show the run's own status.
    let line = jobs.length > 0 ? jobs.map((job) => jobText(job, now)).join('    ') : run.status;
    const notShown = jobList.total_count - jobs.length;
    if (notShown > 0) line += `    +${notShown} more`;

    console.log(`  ${run.name.padEnd(nameWidth)}   ${line}`);
  }
}

async function main() {
  const { positionals } = parseArgs({ allowPositionals: true });
  if (positionals.length !== 1 || positionals[0] !== 'watch') {
    throw new Error('usage: reactions watch');
  }
  await watch();
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
