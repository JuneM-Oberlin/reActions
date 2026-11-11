# reActions

[![CI](https://github.com/JuneM-Oberlin/reActions/actions/workflows/ci.yml/badge.svg)](https://github.com/JuneM-Oberlin/reActions/actions/workflows/ci.yml)

Watch your GitHub Actions runs from the terminal. After you push, `reactions watch` finds the workflow runs for your commit, follows them until they finish, and exits with a code your shell can act on.

```
$ git push
$ reactions watch
you/app @ 3335044 (main)   1 run
  CI   test (18) running 0:11  (step 4/7: Run npm test)    test (22) failure 0:15
```

The display redraws in place while the runs are in progress. When they finish:

```
you/app @ 3335044 (main)   1 run
  CI   test (18) cancelled 0:18    test (22) failure 0:15
$ echo $?
1
```

It runs entirely on your machine. There is no server, no webhook, and nothing to add to your workflow files. It only reads from GitHub, so it works on any repository you can read, including ones where you are just a contributor.

## Status

reActions is an early project. The `watch` command works today. Everything under [Roadmap](#roadmap) is planned and not built yet.

## Requirements

- Node.js 18 or later
- git
- A GitHub token, from either of these:
  - the [GitHub CLI](https://cli.github.com), logged in with `gh auth login`
  - a `GITHUB_TOKEN` environment variable (for private repositories, a classic token needs the `repo` scope)

reActions has no npm dependencies.

## Install

It is not on npm yet. Install it from a clone:

```sh
git clone https://github.com/JuneM-Oberlin/reActions.git
cd reActions
npm install -g .
```

This puts a `reactions` command on your PATH. You can also run it without installing:

```sh
node /path/to/reActions/reactions.js watch
```

## Usage

Run it inside a git repository whose `origin` remote is on GitHub:

```sh
reactions watch
```

It reads the commit at `HEAD`, waits for that commit's runs to appear, and follows them until every run has completed.

Because the exit code reflects the result, you can chain on it:

```sh
git push && reactions watch && echo "CI passed"
```

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | Every run passed (`success`, `skipped` or `neutral`). |
| 1 | At least one run did not pass (failed, cancelled, timed out). |
| 2 | No verdict: no run appeared within 30 seconds, or something went wrong (not a git repository, no token, an API error). |

### Output

- In a terminal, the display redraws in place on every poll, and lines are cut to the terminal width.
- When piped or redirected, nothing is redrawn. The final state is printed once.

## How it works

1. It asks git for the commit at `HEAD`, the current branch, and the `origin` URL.
2. It gets a token from `gh auth token` if the GitHub CLI is installed, otherwise from `GITHUB_TOKEN`.
3. It calls the GitHub REST API directly: [list workflow runs](https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-repository) filtered by the commit, then [list jobs](https://docs.github.com/en/rest/actions/workflow-jobs#list-jobs-for-a-workflow-run) for each run.
4. If a commit has several runs of the same workflow (re-runs, scheduled runs), it follows only the newest run of each workflow.
5. It polls again after 3 seconds, and each wait is 25% longer than the last, up to 20 seconds.
6. It sends ETags with each poll, so a poll where nothing changed does not count against the API rate limit. If the rate limit runs low anyway, it polls more slowly.

## Known limits

- Only the `origin` remote is checked. If you push to a fork, the runs must be on the repository that `origin` points to.
- It reads the first 100 runs for a commit and the first 100 jobs for a run.
- It stops as soon as every run it can see has completed. A workflow that only starts after the others finish can be missed.
- Job timers update when the next poll lands, not every second.

## Roadmap

Planned, in this order.

### Core

Answer "where is my CI, what broke, and is it my fault?"

1. Upstream and fork support: when the current branch has an open pull request, or an `upstream` remote exists, watch the checks in the upstream repository, because that is where a fork contributor's pull request CI runs.
2. Maintainer approval detection: recognize runs that are held for maintainer approval (`action_required`), say so clearly, and exit with a planned exit code 4 instead of reporting a failure.
3. Failure details: print the failing step and its annotations (file and line errors), falling back to the last 20 or so log lines.
4. Failure triage ("is it me?"): when a job fails, check that job's recent history on the default branch and say whether it was already failing, is flaky, or is likely your change. A planned exit code 3 will mark the first two.

### Daily use

5. `reactions push`: run `git push`, then start watching right away. An optional pre-push hook will do the same for a plain `git push`.
6. Desktop notifications with no dependencies: `osascript` on macOS, `notify-send` on Linux, a PowerShell toast on Windows, and the terminal bell as a fallback.
7. `reactions rerun --failed`: re-run only the failed jobs, which needs write access to the repository. Later, offer it when triage says "likely flaky".
8. `--json` output for scripts and AI coding agents.

### Adoption

9. Publish to npm so it runs with `npx`. The name `reactions` is already taken there, so this needs a different package name.
10. A demo GIF in this README showing push, watch, a failure, and the triage verdict.
11. `CONTRIBUTING.md` and "good first issue" labels.

Possible later: a tmux and zsh prompt segment, built as a fast cached `reactions status` command.

Not planned for now: Slack or Discord webhooks, a background daemon, a config file.

## Development

```sh
npm test
```

The tests use Node's built-in test runner. The whole tool is one file, [reactions.js](reactions.js), with its tests in [reactions.test.js](reactions.test.js).

Contributions are welcome. A few ground rules keep the project small:

- No npm dependencies. Use what Node ships with.
- Plain, readable JavaScript. Every line should be easy to explain.
- One feature per commit, with a test for any new logic.

Please open an issue before starting on a large change.

## License

[MIT](LICENSE)
