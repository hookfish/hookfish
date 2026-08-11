# Changesets

Add a changeset to any pull request that changes a published package:

```sh
pnpm changeset
```

Choose the affected packages and semantic version bumps, then commit the
generated Markdown file. After the pull request lands on `main`, the release
workflow creates or updates a version PR. Merging the version PR publishes the
new package versions to npm.
