# Contributing to reActions

Thanks for wanting to help. reActions is a small project, and a few ground rules keep it that way.

## Getting set up

You need Node.js 18 or later and git.

1. Fork the repository on GitHub.
2. Clone your fork and move into it:

   ```
   git clone https://github.com/<your-username>/reActions.git
   cd reActions
   ```

3. There is nothing to install. reActions has no npm dependencies.

To try your changes without installing the command globally, run the tool directly:

```
node reactions.js watch
```

## Running the tests

```
npm test
```

The tests use Node's built-in test runner. The whole tool is one file, `reactions.js`, with its tests in `reactions.test.js`.

## Ground rules

- No npm dependencies. Use what Node ships with.
- Plain, readable JavaScript. Every line should be easy to explain.
- One feature per commit, with a test for any new logic.
- Please open an issue before starting on a large change.

## Picking an issue

- Small, well-described issues carry the "good first issue" label. Start there if you are new.
- The Roadmap section of the README lists what is planned and what is not. Please check it before proposing something new.
- Comment on the issue before you start, so two people do not do the same work.
- If you are not sure whether an idea fits, open an issue and ask first.

## Sending a pull request

1. Create a branch from `main`:

   ```
   git checkout -b my-change
   ```

2. Make your change and run `npm test`.
3. Commit with a short, clear message.
4. Push the branch to your fork and open a pull request against `main`.
5. In the description, say what changed and why. If it fixes an issue, write `Closes #<number>`.