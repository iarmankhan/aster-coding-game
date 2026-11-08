# Problem-first curriculum authoring record

Status. Working draft for parent review, dated 2026-11-07. Only First light has executable mission behavior. The next ten entries are plans, not playable levels. No mission is declared release-ready, human-reviewed, production-ready, or validated by playtesting here.

## Goal and data shape

A player should understand what to implement without a guided tour or an algorithm lecture. First light asks them to deliver a power cell around a closed shortcut in a grounded hex-tile outpost. Ten later designs change the code they must write instead of changing only graph layouts.

`MissionBrief` is one typed object containing the first mission's goal, parameters, rules, and three examples. `PlannedExercise[]` is an ordered table of ten future contracts. Every displayed input and output is a preformatted JSON string, not a nested data object. These exports match the parent's shared UI contract. They carry no production reference implementations.

`src/curriculum.ts` imports `graph` and `navigationChecks` from `src/mission.ts`. It serializes those exact snapshots for the first examples rather than maintaining a second graph definition. The mission graph, starter, runner, main entry, and package configuration remain outside this lane's ownership.

## Throughput checkpoint

1. Blocking first steps. Read the primary content standard, product direction, product-v3 contract, snapshot mission, and runner before choosing wording or fixtures. Completed.
2. Independent workstreams. This is the parent's isolated content workstream. No nested delegation. Source and design documents stay together because their examples must agree.
3. Shared mutable state. An isolated content snapshot owns four assigned files. Primary files, other snapshot source, package configuration, and live build outputs are not edited. Parent owns imports and browser integration.
4. Smallest safe decomposition. One author owns the typed content, detailed designs, and a rerunnable check. Small reference functions live only in the test script. No new dependencies or runtime extension framework.

The parent already delegated this feature lane. No new agents, commits, publication, or deployment occur here. Architect fan-out, rebase, and PR steps belong to the parent or are explicitly prohibited in this lane. The content check is this lane's verifiable unit; rendered acceptance remains with the integrating owner.

## First light authoring package

### Problem, player decision, and prerequisites

Pip waits at `dock` with a replacement power cell. The greenhouse has lost power. The shortcut between `relay` and `greenhouse` is closed, but a longer working route remains. Write the function that returns Pip's travel steps. The player chooses their own way to find a route. No compulsory breadth-first or depth-first algorithm is named in the initial brief.

Prerequisites are TypeScript functions, arrays of strings, object-property lookup, loops or recursion, and conditional returns. The brief explains the unfamiliar graph shape rather than assuming the player remembers adjacency-list terminology.

The editable starting point is the existing `starter` export in `src/mission.ts`. Its TODO and `return [start, goal]` fallback remain intact. The task tells the player to replace that fallback with their code, not modify the dataset or paste a prewritten solution.

### Typed contract and starting world

```ts
function route(graph: Record<string, string[]>, start: string, goal: string): string[]
```

`Record<string, string[]>` means string station IDs map to arrays of directly reachable station IDs. For the current network, `graph["dock"]` is `["relay"]`. The relay's array contains `dock` and `junction`, not the greenhouse. Nearby ground hexes are scenery; only supplied graph entries authorize travel.

The actual six stations are `dock`, `relay`, `junction`, `observatory`, `garden`, and `greenhouse`. There are six working undirected connections in the current network. They are dock to relay, relay to junction, junction to observatory, junction to garden, observatory to garden, and garden to greenhouse. The missing relay-to-greenhouse shortcut is not an extra edge to enable.

For a reachable goal, include start first and goal last, and use only consecutive IDs connected in the supplied graph. Any valid route is accepted, not necessarily a shortest route. Return `[]` if unreachable. Return `[start]` when start equals goal. All station IDs have graph entries, and both endpoint IDs exist. Graphs can contain cycles. The function must finish, and its returned array may contain at most 100 IDs including endpoints. A finite valid route is not rejected merely for revisiting a station.

There are three runtime snapshots, all with the same six station IDs. The delivery snapshot is the base graph. The detour snapshot also removes the junction-to-garden connection, leaving the observatory route. The unreachable snapshot instead removes garden-to-greenhouse, isolating the goal. One implementation must handle all three. Same-location behavior is a documented function example, not a claim that the current delivery UI has a fourth snapshot or selectable endpoints.

### Representative examples

These JSON values are checked against `firstMission.examples`. Inputs use the exact graphs imported by the content module.

Delivery input:

```json
{"graph":{"dock":["relay"],"relay":["dock","junction"],"junction":["relay","observatory","garden"],"observatory":["junction","garden"],"garden":["junction","observatory","greenhouse"],"greenhouse":["garden"]},"start":"dock","goal":"greenhouse"}
```

One valid output:

```json
["dock","relay","junction","garden","greenhouse"]
```

Pip traverses four working connections and arrives with the power cell. Going through `observatory` before `garden` is also valid. The checker does not require the displayed answer's exact sequence for player code.

Unreachable input:

```json
{"graph":{"dock":["relay"],"relay":["dock","junction"],"junction":["relay","observatory","garden"],"observatory":["junction","garden"],"garden":["junction","observatory"],"greenhouse":[]},"start":"dock","goal":"greenhouse"}
```

Output:

```json
[]
```

The greenhouse has no working connection. An empty array reports that fact. It is not a request for an invented shortcut or a partial route.

Same-location input:

```json
{"graph":{"dock":["relay"],"relay":["dock","junction"],"junction":["relay","observatory","garden"],"observatory":["junction","garden"],"garden":["junction","observatory","greenhouse"],"greenhouse":["garden"]},"start":"greenhouse","goal":"greenhouse"}
```

Output:

```json
["greenhouse"]
```

Both endpoints are represented by the same one element. No movement is necessary.

### Acceptance, reference, and alternatives

Current runtime checks use `checkNavigation` and `validateRoute` from `src/mission.ts`. A returned route is evaluated against the actual supplied snapshot. First light's check script runs the existing `solution` through `executeInQuickJS`, checks all three displayed examples, and validates the same implementation across all three navigation checks. It also proves that the existing fallback fails and a longer observatory route succeeds.

The existing `solution` is a breadth-first search that keeps candidate paths and a visited set. It checks the current endpoint before expansion, returns a valid route on arrival, and returns `[]` after exhausting reachable stations. This also handles the same-location example. A depth-first search carrying a path and visited set is a valid alternate. Reconstructing a path from predecessor pointers is another valid approach. None is required by player acceptance.

Disclosed boundary cases include cycles, changed working connections, unreachable goals, and identical endpoints. The returned 100-ID bound is an actual runner and validator constraint, not a target number of visited stations. Do not imply arbitrary graphs larger than that bound are covered by this six-station slice. The sandbox has a 400 ms execution budget; it is a safety limit, not a measured algorithm benchmark. Browser worker startup and compilation have separate existing limits.

Flawed approach one returns `[start, goal]`. There is no dock-to-greenhouse connection, so the validated playback prefix stops at the dock. A more plausible wrong answer `['dock', 'relay', 'greenhouse']` reaches the relay and stops at the broken shortcut. The existing validator reports that specific connection.

Flawed approach two hard-codes the valid delivery path. It reaches the junction in the detour snapshot and stops because junction-to-garden is absent. On the unreachable snapshot, a memorized route eventually requests the absent final connection. Showing the changed graph alongside the stopped prefix explains why the function, not the map, needs to change.

Flawed approach three explores without preventing endless revisits. The cyclic relay and dock connections can trap it. The sandbox reports the execution limit, with no fabricated travel prefix or success animation. A future authored failure replay should distinguish a nonterminating search from a returned invalid path.

### Visible payoff, hints, and debrief

The existing intended payoff is Pip carrying the power cell along the returned, validated steps and restoring the greenhouse. Arrival must derive from the actual route. Unreachable checks must not produce a fake delivery animation. Browser behavior in the integrated UI is not verified by this content lane.

The pleasure comes from a small repair that changes a place the player can see. The closed shortcut makes the code necessary, and the detour checks whether the repair was general rather than memorized. No coding-speed score is needed.

Keep the existing layered hints behind a deliberate request. First point to the missing shortcut and network inspection. Next suggest remembering visited stations so cycles cannot trap exploration. Only the later hint names a queue of paths. The full solution remains available separately, not in the initial brief.

After completion, connect station lists to adjacency lists and route discovery to graph traversal. Explain why returning an ordered path differs from merely knowing that the goal is reachable. The detour and isolated goal show generality without changing undisclosed rules.

An optional extension revisits routing during mission 6 by asking which workshop dependencies can become ready together. Another later extension can add weighted travel costs, but shortest routes and weights are not required here. The current model has a static, in-memory graph and one trusted snapshot per call. Production navigation needs live topology, obstacles, motion constraints, failure handling, and route revalidation. Mission completion proves none of those guarantees.

## Follow-up review inventory

`research/next-ten-missions.md` contains each planned mission's problem, starting world, prerequisites, exact typed signature, JSON input and expected output, explanation, disclosed bounds, edge cases, reference approach, valid alternate, distinct flawed approaches, proposed visual feedback, layered hints, debrief, optional revisit, and production simplification.

The script's references deliberately use simple bounded approaches. For example, the time-window reference scans processed prefixes instead of introducing a streaming engine. This keeps the proof inspectable without turning a design document into a runtime framework. Production `src/curriculum.ts` remains data-only apart from serializing imported mission fixtures.

There are no runtime adapters, new mission selectors, hidden production implementations, persistence promises, or visual demonstration claims for these ten plans. An engineering reviewer must still implement and test each runner contract. A human content reviewer must check every full playable experience before release. Uncoached playtests must establish whether the stated estimates and proposed enjoyment survive actual use.

## Execution receipt and verification

Execution lane is native OpenCode with inherited parent `gpt-6.1-sol`, as requested in the parent handoff. The requested feature family comes from the parent's active Codex sheet. Actual effort is not exposed here and is not asserted. No nested agents, model fallback, commit, publish, or primary edit.

Completed commands from `/tmp/opencode/aster-curriculum-lane`:

```sh
./node_modules/.bin/tsx scripts/check-curriculum.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/tsc --ignoreConfig --noEmit --strict --target ES2022 --lib ES2022,DOM,DOM.Iterable,WebWorker --module ESNext --moduleResolution Bundler --skipLibCheck --types node,vite/client scripts/check-curriculum.ts
```

All three commands passed on the final source. `check-curriculum.ts` verified 3 displayed first-mission examples in QuickJS, the same solution across all 3 navigation snapshots, every one of the 10 planned JSON examples against test-only references, document-to-module fixture equality, metadata, starter preservation, and additional boundary cases. Both typecheck commands exited 0 with no diagnostics. The normal project config includes `src`, not `scripts`, so both typechecks matter.

The explicit script typecheck initially failed with TS5112 because TypeScript 6 requires `--ignoreConfig` when specifying source files beside a config. A second attempt exposed missing worker globals because that invocation did not inherit the project libraries. The final command above explicitly uses the project's ES2022, DOM, DOM.Iterable, and WebWorker libraries and passed. Neither failure required a source or package change.

Principle Model the Domain shaped the typed brief and ordered plan table, rather than UI-specific conditionals. Principle Prove It Works shaped the executable example checker and direct use of the existing QuickJS route contract. The smallest-change choice leaves production mission behavior and dependency configuration untouched.

Browser rendering, world animations, player understanding, and session durations remain unverified here. Parent integration owns browser evidence; human reviewers and playtesters own release acceptance.
