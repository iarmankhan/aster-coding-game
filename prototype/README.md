# Aster prototype

The playable game and its toolchain live in this directory. See the [project README](../README.md) for setup, play instructions, runtime limits, and deployment.

```sh
npm ci
npm run dev
```

`npm run check` runs strict type checking and the current unit/security/content checks. `npm run build` creates `dist`. To check the complete campaign against a served production build, install Playwright Chromium and run `APP_URL=<url> npm run check:all-missions`.

All eleven missions are playable. Historical design and authoring records may describe earlier one- or two-mission releases.
