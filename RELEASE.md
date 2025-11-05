# Release Checklist

1. Update version in package.json and src/runtime.ts.
2. Run pnpm install to refresh the lockfile if dependencies changed.
3. pnpm check
4. pnpm test
5. pnpm build
6. npm pack --dry-run to inspect the tarball.
7. Verify git status is clean.
8. git commit && git push.
9. pnpm publish --tag latest
10. Tag the release (git tag v<version> && git push --tags).
