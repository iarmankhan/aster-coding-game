# Ten follow-up mission designs

Status. Historical design set. One crate, one receipt is implemented in the version 4 source as the second mission; its current authoring and verification package is `research/delivery-v4.md`. The remaining nine chapters are planned, not playable. Their effects below remain acceptance proposals. Version 4 publication, human content review, and uncoached playtesting are separate gates under `docs/content-standard.md`.

The sequence changes the programming problem, not merely the map. These missions cover identity, parsing, ledgers, allocation policy, dependency scheduling, time windows, state transitions, retry timing, queue admission, and event reconciliation. Only dependency scheduling returns to a graph-shaped problem, and its output is concurrent job batches rather than a travel path.

## Shared authoring contract

`src/curriculum.ts` holds the player-facing plans. Each input below is a JSON object whose keys name function arguments. Each output is the returned JSON value. The check script verifies the signatures and both JSON blocks against that module, then evaluates every representative example with a small test-only reference function. Those functions are executable authoring references, not production mission implementations.

Unless a mission narrows these rules, IDs are case-sensitive strings matching `^[a-z][a-z0-9-]{0,31}$`. Arrays have 0 through 100 entries. All numbers are finite. Inputs satisfy the stated types and bounds. Do not mutate inputs or depend on state from a previous invocation. Equal-priority ordering and all returned ordering rules are part of acceptance. ASCII sorting means JavaScript string order, not locale-sensitive order. Undisclosed fixtures may vary values, order, and lengths only within disclosed rules.

Every mission starts with its stated starting world and a function stub with the exact signature below. Its body throws `new Error('Not implemented')`; no reference answer is prefilled. Types remain available beside the editor. The future UI must expose the full bounds and rules before a run. It must not accept a reference implementation merely because it matches an answer string.

All minute estimates are design targets within the proposed 25 to 45 minute session, not measured completion times. There are no playtest observations yet. Proposed extensions are optional and outside base acceptance. Before release, each failure below needs a runnable flawed solution and a captured simulation replay. The present check script proves data examples, not the proposed visual effects.

## 2. One crate, one receipt

ID `one-crate-one-receipt`. Target 30 minutes. Concept is stable deduplication and idempotent replay. Prerequisites are arrays, object fields, and membership lookup. First light introduced reading supplied data; this mission introduces identity across repeated requests.

### Problem and starting world

The dock scanner emits the same receipt more than once. Storage currently adds every scan. Write the acceptance policy so the first unseen receipt moves a crate into storage, while later copies do not add stock. The player owns receipt identity, not crate animation or inventory arithmetic.

### Typed contract

```ts
type Delivery = { receiptId: string; item: string; units: number };
function acceptDeliveries(deliveries: Delivery[], seen: string[]): { deliveries: Delivery[]; seen: string[] }
```

`seen` initially contains unique IDs in prior-acceptance order. Each delivery has integer `units` from 1 through 100. Receipt IDs may repeat with conflicting payloads. The first occurrence of an unseen receipt wins. Return accepted rows unchanged in input order. Return the original `seen` IDs followed by new IDs in acceptance order. Different receipt IDs for the same item are not duplicates. The returned `seen` list can contain up to 200 IDs.

Input:

```json
{"seen":["old"],"deliveries":[{"receiptId":"old","item":"seed","units":2},{"receiptId":"r1","item":"seed","units":3},{"receiptId":"r1","item":"seed","units":9},{"receiptId":"r2","item":"cell","units":1}]}
```

Output:

```json
{"deliveries":[{"receiptId":"r1","item":"seed","units":3},{"receiptId":"r2","item":"cell","units":1}],"seen":["old","r1","r2"]}
```

The old receipt was already accepted. The first `r1` has three units, so its later nine-unit payload cannot replace it.

### Acceptance and feedback

Include empty input, all duplicates, two distinct receipts for one item, conflicting copies, and a full replay using the returned `seen`. A replay accepts no rows and preserves `seen`. Accepted crates cross the dock threshold once; repeated scans stay beside the gate with the receipt ID visible. The enjoyable interaction is replaying a noisy scanner and watching storage remain stable.

Reference `acceptDeliveries` in `scripts/check-curriculum.ts` maintains a set seeded by `seen` and adds each receipt immediately when accepted. A valid alternate keeps an ordered list and uses membership scans at this bounded size.

Flawed approach one compares item IDs. It rejects two legitimate seed crates, leaving a receipt-marked crate outside despite a new receipt. Flawed approach two checks only the original `seen`, adding new IDs after the batch. It accepts both `r1` copies and the storage replay shows twelve units instead of three.

Hints progress from inspecting repeated receipt IDs, to separating receipt identity from item identity, to remembering an ID as soon as it is accepted. Debrief connects the replay behavior to idempotency, not merely duplicate removal.

Extension combines accepted deliveries with the stock ledger from mission 4, revisiting identity during state changes. Simplification is an explicitly supplied in-memory receipt history. Production needs durable records, atomic updates, and a policy for conflicting payloads and history retention.

## 3. Read the weather

ID `read-the-weather`. Target 35 minutes. Concept is parsing and normalization. Prerequisites are strings, arrays, arithmetic, and conditional branches. This mission has malformed external input rather than trusted domain objects.

### Problem and starting world

Weather probes report temperatures in two units. The greenhouse panel cannot distinguish a damaged packet from a cold reading. Write the decoder that produces valid Celsius readings and identifies rejected source lines.

### Typed contract

```ts
function parseTelemetry(lines: string[]): { readings: { sensor: string; celsius: number }[]; rejected: number[] }
```

Each line has at most 80 characters. Split on literal `|` into exactly three fields, then trim each field. Sensor IDs match `^[a-z][a-z0-9-]{0,15}$`. The number must match `^-?\d+(?:\.\d+)?$` and convert to a finite number. A leading plus, exponent, empty value, trailing decimal point, `NaN`, or `Infinity` is invalid. Units are case-sensitive `C` or `F`. Convert Fahrenheit with `(value - 32) * 5 / 9`. Accept only converted values in the inclusive range -50 through 80. No rounding is required; numeric output tolerance is 1e-9. Repeated valid sensor IDs remain separate readings. Both outputs preserve source order, and rejection indices are zero-based.

Input:

```json
{"lines":[" soil | 68 | F ","roof|21.5|C","roof|warm|C","soil|90|C","soil|0|C|extra"]}
```

Output:

```json
{"readings":[{"sensor":"soil","celsius":20},{"sensor":"roof","celsius":21.5}],"rejected":[2,3,4]}
```

The Fahrenheit packet becomes 20 Celsius. The word `warm`, converted out-of-range value, and extra field each reject their whole line.

### Acceptance and feedback

Include empty batches, both inclusive limits, whitespace, invalid IDs, non-finite numeric conversion, and a conversion near a range boundary. A valid line positions its probe thermometer. A rejected line stays in a packet tray with its original index. Clicking a packet compares the raw fields with the resulting dial. This makes unit mistakes visible without punishing typing speed.

Reference `parseTelemetry` validates field count and grammar before numeric conversion. A valid alternate uses an anchored whole-line pattern with explicit whitespace handling and the same conversion and range checks.

Flawed approach one calls `parseFloat` without grammar validation. A packet such as `soil|20bad|C` moves the dial despite a malformed value. Flawed approach two range-checks raw Fahrenheit as if it were Celsius. A valid `soil|86|F` packet lands in the rejected tray instead of setting 30 Celsius.

Hints start with comparing one raw packet and its dial, then distinguish syntax from semantic range, then suggest validating fields before conversion. Debrief names the boundary between untrusted text and normalized data.

Extension deduplicates packet IDs before normalization, revisiting mission 2 without confusing repeated readings with duplicate messages. Simplification is a tiny unquoted delimiter format and a fixed unit set. Production parsing needs a specified encoding, schema versions, precision policy, and useful diagnostic reasons rather than indices alone.

## 4. Balance the store

ID `balance-the-store`. Target 35 minutes. Concept is ordered aggregation with a nonnegative-stock invariant. Prerequisites are keyed collections, loops, and integer arithmetic.

### Problem and starting world

The store has partly filled bins and a ledger of arrivals and withdrawals. Some withdrawals exceed available stock. Apply each row atomically while allowing later valid rows to proceed. The player owns ledger semantics, not drag-and-drop bin placement.

### Typed contract

```ts
type StockChange = { id: string; item: string; delta: number };
function balanceStock(stock: Record<string, number>, changes: StockChange[]): { balances: { item: string; units: number }[]; rejected: string[] }
```

Stock has at most 100 own keys with integer counts from 0 through 1000. Change IDs are unique within the batch. Deltas are integers from -100 through 100. Missing items start at zero. Apply rows in order; reject a whole row if its result would be negative, without modifying that item. Continue after rejection. Keep original zero balances, and create a missing item only after an accepted row, including a zero delta. Sort balances by item ID in ASCII order. Rejected change IDs remain in input order. Final counts may exceed 1000.

Input:

```json
{"stock":{"cell":2,"seed":4},"changes":[{"id":"a","item":"seed","delta":-3},{"id":"b","item":"cell","delta":-3},{"id":"c","item":"cell","delta":2},{"id":"d","item":"water","delta":5},{"id":"e","item":"seed","delta":-2}]}
```

Output:

```json
{"balances":[{"item":"cell","units":4},{"item":"seed","units":1},{"item":"water","units":5}],"rejected":["b","e"]}
```

The rejected cell withdrawal leaves two cells available before the next delivery adds two. A rejected change does not abort the ledger.

### Acceptance and feedback

Include exact depletion to zero, an unknown-item withdrawal, an unknown zero delta, rejected rows followed by accepted rows, and IDs such as `constructor`. Initial input must remain unchanged. Step through the ledger to see one bin and one row highlighted. A rejected request waits beside its unchanged bin. Enjoyment comes from getting a busy store to agree with its ledger, not from a final sum alone.

Reference `balanceStock` copies own entries into a map and checks a candidate total before storing it. A valid alternate uses a fresh dictionary with own-property checks.

Flawed approach one sums all deltas per item before checking. It accepts an early impossible withdrawal because a later delivery covers it; replay exposes the empty bin at the withdrawal time. Flawed approach two clamps a negative count to zero. It partly consumes a rejected withdrawal and the next delivery leaves the wrong stock count.

Hints first inspect the earliest divergent ledger row, then distinguish ordered transactions from a final aggregate, then calculate a candidate count before committing it. Debrief explains the invariant and the atomicity of one row.

Extension accepts replayed receipt batches through mission 2 before updating stock. Simplification is one serialized ledger with integers and no persistence. Production needs transaction isolation, durable audit records, reservations, and concurrent-write handling.

## 5. Share the battery

ID `share-the-battery`. Target 35 minutes. Concept is deterministic priority allocation. Prerequisites are sorting, tie-breaking, and a running budget. This is a policy exercise, not an undisclosed optimization puzzle.

### Problem and starting world

The battery holds less energy than all appliances request. The pump, heater, and beacon need indivisible allocations. Implement the stated priority policy so the player can predict what runs and why.

### Typed contract

```ts
type PowerRequest = { id: string; demand: number; priority: number };
function allocatePower(energy: number, requests: PowerRequest[]): { powered: string[]; remaining: number }
```

Energy is an integer from 0 through 100. Request IDs are unique. Demand is an integer from 1 through 20; priority is an integer from 0 through 5. Process descending priority, then original input order for ties. Grant a full request if it fits; otherwise skip it and continue. Return powered IDs in allocation order and the exact unspent energy. No partial grants, fairness guarantee, knapsack objective, or maximum appliance count is required.

Input:

```json
{"energy":7,"requests":[{"id":"heater","demand":5,"priority":2},{"id":"pump","demand":4,"priority":3},{"id":"beacon","demand":2,"priority":2}]}
```

Output:

```json
{"powered":["pump","beacon"],"remaining":1}
```

The pump leaves three units. The heater cannot fit, but skipping it still allows the beacon to receive two.

### Acceptance and feedback

Include zero energy, exact fit, priority ties, an oversized first request, and a later smaller request. Do not mutate the request array while sorting. The simulation lights granted appliances together and draws each grant against the gauge. The player can inspect a skipped appliance and experiment with a smaller budget without being told to optimize a different objective.

Reference `allocatePower` sorts indexed copies and subtracts only full grants. A valid alternate scans each of the six priority buckets in input order.

Flawed approach one stops at the first oversized request. The beacon remains dark despite two affordable units on the gauge. Flawed approach two sorts only by cheapest demand. The replay powers low-priority devices while a higher-priority pump loses its allocation.

Hints first compare dark appliances with remaining energy, then name the priority and tie policy, then separate the visit order from the fit decision. Debrief distinguishes a specified greedy policy from globally optimal allocation.

Extension draws available energy from a stock ledger, revisiting mission 4 and requiring consistent resource accounting. Simplification is one static integer budget with instant grants. Production power control must account for time, safety, startup costs, and uncertain demand.

## 6. Open the workshop

ID `open-the-workshop`. Target 40 minutes. Concept is dependency scheduling with waves and blocked work. Prerequisites are membership sets, repeated scans, and First light's distinction between connected possibilities and impossible outcomes.

### Problem and starting world

Workshop benches need parts made by other benches. Some specifications name missing parts; others depend on each other. Return safe batches that can complete together, without blocking independent work.

### Typed contract

```ts
type RepairJob = { id: string; requires: string[] };
function scheduleRepairs(jobs: RepairJob[], done: string[]): { batches: string[][]; blocked: string[] }
```

Job IDs are unique. `done` and each `requires` array contain unique IDs, at most 100 each. A requirement may name a job, a previously completed external part, an absent part, or the job itself. IDs present in `done` are complete even when they also occur in `jobs`. At each wave, take every unfinished job whose requirements were complete before the wave, in original job order. Complete that batch together. Do not let one job unlock another in the same batch. Stop when no jobs are ready and do not emit an empty batch. Return all remaining unfinished IDs in original order as blocked. No cycle classification or capacity limit is required.

Input:

```json
{"jobs":[{"id":"panels","requires":["frame"]},{"id":"frame","requires":[]},{"id":"heater","requires":["panels"]},{"id":"sign","requires":["paint"]},{"id":"a","requires":["b"]},{"id":"b","requires":["a"]}],"done":[]}
```

Output:

```json
{"batches":[["frame"],["panels"],["heater"]],"blocked":["sign","a","b"]}
```

Frame, panels, and heater complete in separate waves. The missing paint and two-job cycle do not stop that independent repair chain.

### Acceptance and feedback

Include parallel roots, input order opposite to dependency order, all jobs already done, external done IDs, self-dependency, cycles with downstream dependents, and missing parts. Benches in one batch animate together; unavailable input links remain visible. The enjoyable result is a workshop that makes useful progress even when part of its plan is impossible. This is not another path-to-a-destination mission.

Reference `scheduleRepairs` repeatedly collects ready jobs against a completed set, then commits the entire batch. A valid alternate uses indegree counts and a wave-based ready collection, while separately retaining unresolved external requirements.

Flawed approach one commits jobs while scanning a single wave. Frame and panels animate together even though the panels' material did not exist at wave start. Flawed approach two treats any unknown requirement as complete. The sign paints itself without paint, and its missing-input link exposes the invented resource.

Hints inspect the state at a wave boundary, then distinguish dependency readiness from job order, then suggest collecting all ready jobs before marking any complete. Debrief connects waves to dependency graphs and explains why blocked does not always mean cyclic.

Extension limits each wave by mission 5's energy policy, revisiting allocation without changing the base contract. Simplification assumes every ready job succeeds in one wave. Production schedulers need durations, retries, cancellation, concurrent completion, and failure propagation.

## 7. Steady the sensors

ID `steady-the-sensors`. Target 40 minutes. Concept is per-stream time-window aggregation. Prerequisites are arrays, timestamps, averages, and normalized numeric readings from mission 3.

### Problem and starting world

Raw moisture values make the irrigation display oscillate. Return a recent mean for each arrival without mixing probes or retaining expired readings. The player owns the filter, not valve timing or a hidden tuning parameter.

### Typed contract

```ts
type SensorSample = { t: number; sensor: string; value: number };
function smoothSensors(samples: SensorSample[], window: number): { t: number; sensor: string; mean: number }[]
```

There are at most 200 samples in nondecreasing timestamp order. `t` is an integer from 0 through 10000; `window` is an integer from 1 through 1000 in the same simulation time unit. Values are finite numbers from 0 through 100. For each arrival, average only processed samples of that sensor in the inclusive interval `[t - window, t]`, including the current one. Later arrivals sharing the timestamp are not visible yet. Return one result per arrival in input order. No rounding is required; numeric tolerance is 1e-9. This bounded mission has no asymptotic-performance acceptance test.

Input:

```json
{"window":3,"samples":[{"t":0,"sensor":"soil","value":10},{"t":2,"sensor":"air","value":20},{"t":3,"sensor":"soil","value":16},{"t":6,"sensor":"soil","value":22}]}
```

Output:

```json
[{"t":0,"sensor":"soil","mean":10},{"t":2,"sensor":"air","mean":20},{"t":3,"sensor":"soil","mean":13},{"t":6,"sensor":"soil","mean":19}]
```

At time 3, the soil sample at time 0 is still inside the window. At time 6, it has expired, while time 3 remains included. The air value never contributes to the soil mean.

### Acceptance and feedback

Include empty input, one sample, equal timestamps, a timestamp exactly at the lower boundary, a large gap, interleaved probes, and non-integer means. A paused replay shades the active window and highlights contributing samples for one probe. The raw trace remains visible beside the mean, so the player can see smoothing lag rather than receiving a claim that smoothing is always better.

Reference `smoothSensors` filters each processed prefix at this small bound. A valid alternate maintains one queue and running sum per sensor, expiring timestamps strictly below the lower bound.

Flawed approach one keeps the last N readings instead of the last time interval. A long silent gap leaves old wet samples holding the valve display down. Flawed approach two uses a single queue for all sensors. The air reading moves the soil mean despite a different probe label.

Hints inspect which dots contribute to one output, then name time windows and stream keys, then compare timestamps to `t - window`. Debrief distinguishes count windows, time windows, and causal processing.

Extension parses mixed-unit packets with mission 3 before applying independent windows. Simplification assumes already sorted event times and no clock skew. Production telemetry needs late-arrival rules, event-time watermarks, missing-data policy, and numerical error analysis.

## 8. Raise the seedlings

ID `raise-the-seedlings`. Target 35 minutes. Concept is a finite-state machine. Prerequisites are branches, object snapshots, and ordered iteration. Growth is a state-transition problem, not a resource sum.

### Problem and starting world

A repaired bed has seeds but unreliable daily water and light. Implement its daily growth transitions. The player needs to see why one favorable day germinates a seed without also advancing the new sprout twice.

### Typed contract

```ts
type GrowthState = { phase: "seed" | "sprout" | "ready" | "wilted"; streak: number };
type GrowthDay = { water: boolean; light: boolean };
function growBed(initial: GrowthState, days: GrowthDay[]): { timeline: GrowthState[]; final: GrowthState }
```

Valid initial states have `streak` 0 for seed, ready, or wilted, and integer 0 through 2 for sprout. A favorable day has both water and light. A seed stays unchanged on an unfavorable day. Its first favorable day makes a sprout with streak 0. A sprout gains one streak on each favorable day. Reaching streak 3 makes it ready with streak 0. An unfavorable day makes a sprout wilted with streak 0. Ready and wilted are absorbing terminal states. Record one independent state after every day; return final equal to the last state, or a copy of initial when days is empty.

Input:

```json
{"initial":{"phase":"seed","streak":0},"days":[{"water":false,"light":true},{"water":true,"light":true},{"water":true,"light":true},{"water":true,"light":true},{"water":true,"light":true},{"water":false,"light":false}]}
```

Output:

```json
{"timeline":[{"phase":"seed","streak":0},{"phase":"sprout","streak":0},{"phase":"sprout","streak":1},{"phase":"sprout","streak":2},{"phase":"ready","streak":0},{"phase":"ready","streak":0}],"final":{"phase":"ready","streak":0}}
```

The first dry day cannot kill an ungerminated seed. Four subsequent favorable days germinate it and grow the sprout to ready. The final dry day cannot change a terminal ready state.

### Acceptance and feedback

Include empty days, each initial phase, each sprout streak, water without light, light without water, an unfavorable sprout day, and favorable days after wilting. The day slider renders returned snapshots and displays the day's water and light beside the transition. Growing a bed feels earned because the player can identify the exact day that changed its outcome.

Reference `growBed` chooses exactly one branch from the phase at day start and copies every timeline state. A valid alternate uses a pure single-day transition function inside a fold.

Flawed approach one uses independent `if` statements that observe a newly mutated phase. A seed germinates and increments its streak on one day, so the bed becomes ready early. Flawed approach two treats good weather as a universal increment or revival. A wilted bed grows again even though its terminal-state badge says it cannot recover.

Hints first find the earliest incorrect day, then name the starting phase and transition, then separate one-day transitions from the timeline loop. Debrief distinguishes a state machine from unrelated counters and explains immutable replay snapshots.

Extension supplies daily water decisions from mission 5's allocator, revisiting scarcity and showing consequences over time. Simplification uses deterministic binary weather and deliberately simple biology. Real cultivation needs continuous conditions, uncertainty, and species-specific models.

## 9. Give the radio a rest

ID `give-the-radio-a-rest`. Target 35 minutes. Concept is capped exponential backoff and retry budgets. Prerequisites are arithmetic, arrays, and explicit time units.

### Problem and starting world

The radio repeats failed messages immediately and fills its timeline with retries. Compute each next scheduled send, or mark the message exhausted. The player owns the timing policy, not real network requests.

### Typed contract

```ts
type FailedSend = { id: string; attempt: number; failedAt: number };
function scheduleRetries(failures: FailedSend[], baseDelay: number, maxDelay: number, maxAttempts: number): { retries: { id: string; attempt: number; dueAt: number }[]; exhausted: string[] }
```

Failure IDs are unique within the input. Attempts are integers from 1 through 10 and count the send that just failed. `maxAttempts` is an integer from 1 through 10. `failedAt` is an integer from 0 through 1000000 ticks. Delays are integers from 1 through 10000, with `maxDelay >= baseDelay`. If `attempt >= maxAttempts`, exhaust that ID. Otherwise schedule attempt plus one at `failedAt + min(maxDelay, baseDelay * 2 ** (attempt - 1))`. Preserve input order separately in retries and exhausted. Do not sort by due time, wait in real time, add jitter, or schedule more than one retry per input failure.

Input:

```json
{"failures":[{"id":"a","attempt":1,"failedAt":100},{"id":"b","attempt":3,"failedAt":100},{"id":"c","attempt":4,"failedAt":90}],"baseDelay":10,"maxDelay":25,"maxAttempts":4}
```

Output:

```json
{"retries":[{"id":"a","attempt":2,"dueAt":110},{"id":"b","attempt":4,"dueAt":125}],"exhausted":["c"]}
```

The first failed send waits ten ticks. The third failed send's forty-tick delay caps at twenty-five. The fourth failed send has no budget left.

### Acceptance and feedback

Include no failures, one allowed attempt, a delay below the cap, exactly at the cap, above the cap, and an input attempt already above the maximum. Timeline markers carry attempt numbers and delay brackets; exhausted messages move to a tray. Scrubbing the radio timeline shows spacing and cap behavior without requiring the player to wait through actual delays.

Reference `scheduleRetries` separates exhausted IDs before calculating the next attempt. A valid alternate computes the capped delay by repeated doubling at most nine times.

Flawed approach one uses exponent `attempt` instead of `attempt - 1`. The first retry marker appears twenty rather than ten ticks after failure. Flawed approach two checks `attempt > maxAttempts`. A message at its final allowed attempt schedules an extra pulse instead of moving to the exhausted tray.

Hints inspect the gap after attempt one, then separate attempt numbering from delay growth, then calculate the delay before adding it to failure time. Debrief explains bounded retries and why fixed synchronized backoff can still collide.

Extension deduplicates repeated failure notifications using mission 2 before scheduling. Simplification has no jitter, network side effects, real timer drift, or cancellation. Production retry policies need error classification, idempotency, deadlines, randomized spreading, and durable scheduling when restarts matter.

## 10. Keep the airlock clear

ID `keep-the-airlock-clear`. Target 40 minutes. Concept is bounded FIFO admission over explicit tick phases. Prerequisites are queues, loops, and independent snapshots. Allocation in mission 5 was stateless within a batch; this mission carries a waiting queue across ticks.

### Problem and starting world

The airlock's painted waiting lane has limited space. Carts arrive in bursts. Simulate which old carts depart, which new carts enter the lane, and which arrivals are turned away.

### Typed contract

```ts
type QueueTick = { arrivals: string[]; slots: number };
type QueueFrame = { started: string[]; waiting: string[]; rejected: string[] };
function queueTimeline(capacity: number, ticks: QueueTick[]): { history: QueueFrame[]; waiting: string[] }
```

Capacity is an integer from 0 through 20. Each tick has at most 20 arrivals and integer slots from 0 through 20. Cart IDs are unique across the full timeline. Start empty. First serve up to slots from the old queue in FIFO order. Then examine arrivals in order and admit a cart only if waiting length is below capacity. Reject other arrivals permanently. New arrivals cannot use that tick's unused slots. Capacity counts only waiting carts after departures, not departed carts. Save an independent waiting snapshot after each tick. Return the final queue too. An empty ticks array returns empty history and waiting arrays. A tick with no arrivals still produces a history frame.

Input:

```json
{"capacity":2,"ticks":[{"arrivals":["a","b","c"],"slots":1},{"arrivals":["d"],"slots":1},{"arrivals":[],"slots":3}]}
```

Output:

```json
{"history":[{"started":[],"waiting":["a","b"],"rejected":["c"]},{"started":["a"],"waiting":["b","d"],"rejected":[]},{"started":["b","d"],"waiting":[],"rejected":[]}],"waiting":[]}
```

The initial slot is unused because the old queue is empty. Tick two serves `a` before admitting `d`; tick three serves `b` then `d`. Cart `c` never enters the lane.

### Acceptance and feedback

Include capacity zero, slots zero, more slots than old carts, arrivals at exact capacity, and a tick with both departures and overflow. Every cart must appear in exactly one waiting, started, or rejected position per relevant frame, with no later service of a rejected ID. Playback separates departures from admission with visible tick labels. The enjoyable behavior is a lane that drains predictably during bursts rather than a counter that merely stays below a limit.

Reference `queueTimeline` removes an old prefix, then admits arrivals one at a time and copies the waiting list. A valid alternate uses a head index and bounded list, materializing slices for output frames.

Flawed approach one admits before serving old carts. It rejects `d` on tick two despite the space freed by `a`. Flawed approach two serves newly arriving carts using leftover slots. Cart `a` crosses on tick one even though the phase rule says it must wait until tick two. A third failure worth keeping in review is aliasing every history frame to one mutable queue, which changes the past during replay.

Hints inspect departures and admissions separately, then name FIFO order and waiting capacity, then suggest a snapshot at each tick end. Debrief distinguishes queue capacity, service capacity, and phase ordering.

Extension allows mission 9's due retries to become arrivals, revisiting time scheduling and showing that retry traffic consumes queue capacity. Simplification has instantaneous service and no queue cancellation, transit time, or retries for rejected carts. Production admission needs backpressure, timeout policy, fair sharing, and durable ownership of accepted work.

## 11. Agree on the beacon

ID `agree-on-the-beacon`. Target 45 minutes. Concept is versioned reconciliation with tombstones. Prerequisites are maps, ordered events, and mission 2's identity distinction. This mission selects newer state, not merely unique events.

### Problem and starting world

Delayed beacon updates arrive out of order. Some delete a beacon; older packets can arrive after deletion. Reconstruct the newest accepted state without resurrecting old values.

### Typed contract

```ts
type BeaconEvent = { id: string; version: number } & ({ kind: "set"; value: string } | { kind: "delete" });
function reconcileBeacons(events: BeaconEvent[]): { entities: { id: string; value: string; version: number }[]; tombstones: { id: string; version: number }[]; ignored: number[] }
```

Versions are integers from 0 through 10000. Set values are strings of at most 40 characters, including empty strings. Delete events have no value. Start with no state. Process arrival order and accept the first event for an ID, including version 0 or a delete. Subsequently accept only strictly greater versions. Ignore older or equal versions and record their zero-based indices in arrival order. First arrival wins equal versions, even conflicting kinds or payloads. A deletion retains its version as a tombstone. A strictly newer set can recreate the entity. Return current set states in entities and current delete states in tombstones, each sorted by ID in ASCII order. Do not emit both for one ID.

Input:

```json
{"events":[{"id":"sprout","version":2,"kind":"set","value":"lit"},{"id":"sprout","version":4,"kind":"delete"},{"id":"sprout","version":3,"kind":"set","value":"dry"},{"id":"pump","version":1,"kind":"set","value":"on"},{"id":"pump","version":1,"kind":"set","value":"off"},{"id":"sprout","version":5,"kind":"set","value":"growing"},{"id":"gate","version":2,"kind":"delete"},{"id":"gate","version":1,"kind":"set","value":"open"}]}
```

Output:

```json
{"entities":[{"id":"pump","value":"on","version":1},{"id":"sprout","value":"growing","version":5}],"tombstones":[{"id":"gate","version":2}],"ignored":[2,4,7]}
```

The sprout's version 3 cannot override its deletion at version 4, but version 5 can recreate it. The pump keeps the first version 1 value. The gate's tombstone blocks its delayed version 1 set.

### Acceptance and feedback

Include no events, a first version 0, repeated equal versions, equal-version set/delete conflicts, deletion before any set, empty set values, stale sets after delete, and newer recreation. A packet rail shows arrivals beside beacon state and retained tombstones. Scrubbing backward must reproduce the same intermediate states. Enjoyment comes from a visibly stable settlement despite packets arriving in a misleading order.

Reference `reconcileBeacons` keeps the highest accepted event per ID, retaining delete events, then materializes sorted outputs. A valid alternate folds immutable per-ID state with an explicit set-or-tombstone tagged union. Both preserve first arrival on version ties.

Flawed approach one deletes the map entry on a delete. The gate lights from its delayed version 1 packet because its version 2 tombstone was forgotten. Flawed approach two accepts `>=` instead of `>`. The pump switches from on to off at the same version, exposing a tie-rule violation.

Hints inspect an old set after a delete, then distinguish absence from remembered deletion, then retain the last accepted version even for deleted entities. Debrief explains tombstones and why this single-authority version rule is not a general distributed merge algorithm.

Extension deduplicates transport IDs from mission 2 separately from entity versions and runs arrivals through mission 10's queue. Simplification assumes comparable versions assigned by one authority and unbounded tombstone retention within a small batch. Production reconciliation needs an explicit version authority, conflict semantics, persistence, compaction rules, and authenticated events.
