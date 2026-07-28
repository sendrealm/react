# React Web Push SDK release

The Web SDK is released from this repository. The older workspace-level SDK
release helper assumes a monorepo and must not be used for this repository.

## One-time npm setup

Configure `@sendrealm/react` on npm with a GitHub Actions trusted publisher:

- Organization: `sendrealm`
- Repository: `react`
- Workflow filename: `release.yml`
- Allowed action: `npm publish`

The workflow uses a GitHub-hosted runner, Node 22.14.0, npm 11.5.1, and OIDC.
No long-lived npm publish token is required.

## Release process

1. Confirm the working tree is clean and CI passes on `main`.
2. Run `pnpm run release:check` locally.
3. Confirm the package version and changelog match.
4. Create and publish a GitHub release tagged `react-sdk-vX.Y.Z`.
5. Verify the release workflow and the published npm package.

The workflow rejects a tag that does not exactly match `package.json`, reruns
the full release checks, and publishes only after those checks pass.

## External browser sign-off

Before promoting a new version to production applications, run the demo from
the real production HTTPS origin and verify permission, subscription,
foreground delivery, background delivery, notification click/deep-link, and
opt-out behavior in the supported browser/device matrix. iOS and iPadOS web
push must be tested from a Home Screen web app on physical devices.
