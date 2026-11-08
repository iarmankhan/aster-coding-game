# Aster: The next crossing

A browser programming game set on a coastal hex island. Write TypeScript to restore the field station's services, watch your accepted results play out, and unlock the next mission.

**[Play Aster](https://aster-coding-game.vercel.app/)**

All eleven missions are playable. They cover graph traversal, receipt deduplication, parsing, stock accounting, resource allocation, dependency scheduling, sensor windows, state machines, retry schedules, queues, and versioned reconciliation.

This is an experimental game, not a validated programming curriculum. Automated tests verify behavior, not learning outcomes. The source is preserved here as a standalone project.

## Run locally

Requires Node.js 22 or newer.

```sh
cd prototype
npm ci
npm run dev
```

Open the local URL printed by Vite. No API keys, accounts, or backend are required.

## Play

1. Read the mission brief and its three public examples.
2. Write your solution in Monaco. Run examples to debug without earning progress.
3. Submit all cases. On success, your actual result drives the world playback and earns the next unlock.

Settings provides optional, confirmed demo insertion. A demo never submits itself. Each mission stores its code separately in your browser. Progress is local to that browser and origin, so a different host does not inherit another site's saves.

The workbench includes normal editing and Undo, a resizable brief and results dock, structured public-case feedback, hints, and playback inspection controls. Ctrl/Cmd+Enter runs examples. Ctrl/Cmd+Shift+Enter submits. Stop, Escape, edits, and navigation cancel an active attempt.

## Check and build

From `prototype`:

```sh
npm run check
npm run build
npm run preview
```

Browser checks use Playwright. Install its Chromium browser once:

```sh
npx playwright install chromium
APP_URL=http://localhost:4173 npm run check:all-missions
```

`check:all-missions` completes the eleven-mission campaign at desktop, laptop, and phone sizes. `check:program-gates`, `check:migration`, `check:workbench-ui`, and `check:mission-map-ui` exercise failure paths, saved progress, editing, and layouts. `check:program-webgl-gate` and `check:playback-gate` verify that unavailable WebGL cannot award progress. Browser output paths can be selected with `EVIDENCE_DIR`; existing installations can be selected with `PLAYWRIGHT_MODULE` and `BROWSER_EXECUTABLE`.

Some scripts and documents retain historical v3/v4 checks. They are not all current campaign acceptance gates. The current unit gate is `npm run check`; the full campaign browser gate is `check:all-missions`.

## Deploy

GitHub Actions checks and builds the game on pushes to `main` and pull requests. The public game uses a free Vercel Hobby project connected to this repository. The root `vercel.json` installs and builds the application in `prototype` and serves `prototype/dist`. No environment variables are required. Vercel deploys updates from `main` through its GitHub integration.

Any static host can serve the build. For a root-domain deployment, run the normal build. For a subpath, use `npm run build -- --base=/your-path/`. No paid hosting service is required.

## Runtime and limits

Monaco checks TypeScript before emission. Player JavaScript runs in a QuickJS WebAssembly worker, with a fresh runtime per fixture. Guest limits are 400ms, 24MiB heap, and 128KiB stack per case. Inputs are read-only and output is bounded JSON. This is not an operating-system security boundary or a third-party security audit.

Hidden cases are withheld from the normal UI but remain inspectable in a local browser. There is no secure server judge, leaderboard, or analytics. Only a complete passing submission followed by actual world playback earns progress. Reloaded history does not certify saved source. WebGL is required for progression; examples and editing remain available without it.

## Project layout

- `prototype/src` contains the game, mission content, editor, runner, and procedural world.
- `prototype/scripts` contains unit, security, protocol, and browser checks.
- `prototype/public` contains local fonts, their licenses, and the icon.
- `docs`, `prototype/DESIGN.md`, and selected `prototype/research` files retain design and mission-authoring context. Older scope descriptions are historical.

Private deployment records, workstation-specific evidence, credentials, dependencies, and generated builds are not included. The procedural geometry and sound are original. Manrope and JetBrains Mono are bundled under their SIL Open Font Licenses; historical IBM Plex Mono assets retain their license too. Reference-game artwork and music are not included.
