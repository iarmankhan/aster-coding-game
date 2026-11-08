# Game concept

Status: proposed creative direction. Names, story, and progression are illustrative.

## Three possible worlds

| World | What the player does | Main risk |
| --- | --- | --- |
| Orbital settlement | Restores a quiet, damaged habitat using drones, transport, and communication systems. | Can become a technical dashboard with space decoration. |
| Living archipelago | Builds routes and machines across small islands with weather and moving inhabitants. | Nature metaphors can misrepresent advanced computing concepts. |
| Clockwork workshop | Designs and repairs visible mechanical contraptions. | Can feel too close to a production-optimization job. |

Initial recommendation was an orbital settlement. The user's later feedback selects a grounded hex-tile settlement inspired by the composition of Dorfromantik. Separate districts still provide a reason for routes, delayed messages, limited capacity, and independent workers. The greenhouse repair and its programming contract remain unchanged.

This is a creative hypothesis. Attractive space art alone will not establish whether the game is fun.

## The player fantasy

You arrive at a partly abandoned settlement. Its machines work in pieces. You restore useful behavior, district by district.

The settlement changes as you succeed. Dark rooms become occupied. Transit starts moving. Residents use what you repaired.

The story stays brief. Characters provide concrete reasons to care about a repair without interrupting every attempt with dialogue.

The player has room to experiment and explore. Avoid a constant emergency tone that recreates being on call.

## The visual direction

Proposed look: a compact, isometric 3D diorama with readable silhouettes, warm interior lights, and restrained effects.

The world should be pleasant to watch even before the editor opens. Drones dock, doors move, workshops operate, and residents travel.

The graphics explain behavior. A drone's route remains visible. A queue has a readable length. A delayed message can be selected and inspected.

Particle effects are secondary to causality. Color alone never communicates failure. Labels, shape, and optional overlays provide the same information.

GPU rendering is a means to this experience. The renderer remains undecided. WebGL is a candidate baseline. WebGPU-only effects must not become a prerequisite for the first mission.

## The play loop

1. Explore the district and observe a specific failure.
2. Inspect the relevant objects, inputs, and existing code.
3. Write a bounded piece of behavior in a real editor.
4. Run the world, inspect the outcome, and revise the program.
5. Complete the repair and choose an optional challenge or the next destination.

The simulation pauses while the player thinks. Running a program creates a replayable attempt. An infinite loop must not freeze the game.

Direct controls support observation, layout, and inspection. Code controls the behavior under practice. Decorative code that does not affect outcomes fails the concept.

## First mission proposal: First light

The repair drone cannot reach an unpowered greenhouse. A damaged corridor blocks its existing route.

The player sees the failed journey immediately. The drone stops at the obstruction. The greenhouse remains dark.

The player writes a route function against a small graph. The editor provides the input shape, a working caller, and a few examples. Project setup is already complete.

The function returns a route or reports that no route exists. The drone follows that route in the world.

The baseline map has equal travel costs. Any valid route satisfies the story objective. The game does not secretly require one algorithm.

The player can inspect a returned route before running it. Invalid steps show the offending connection. An unreachable target produces an understandable result rather than a generic failure.

After the first success, an optional scenario changes the blocked corridor. This checks whether the program handles changed inputs rather than one memorized path.

The payoff is a short sequence. The drone docks, power returns, greenhouse shutters open, and a resident enters. The repaired greenhouse remains visible afterward.

Target duration is 25 to 35 minutes, subject to playtesting. A direction prototype now implements the route, drone journey, and greenhouse restoration. The broader narrative and duration remain unvalidated.

## How the world can grow

These are candidate chapters. Each needs several designed missions and prerequisite checks before it becomes a curriculum.

| Chapter | New situation | Programming and design topics |
| --- | --- | --- |
| Routes and repairs | Machines cannot reach their destinations. | Graphs, state, validation, debugging. |
| Busy workshops | Jobs arrive faster than workers finish them. | Queues, scheduling, bounded concurrency, backpressure. |
| Unreliable deliveries | Acknowledgments get lost and senders retry. | Retry budgets, idempotency, deduplication. |
| Distant districts | Local copies disagree after delayed updates. | Caching, invalidation, replication, consistency tradeoffs. |
| A growing settlement | Demand exceeds one district's capacity. | Partitioning, load distribution, bottlenecks, failure recovery. |

An advanced delivery mission could expose duplicate execution after a lost acknowledgment. The player observes both the retry and the duplicate effect.

A correct repair must prevent duplicate effects while still allowing distinct jobs. Rejecting every repeated-looking message is not automatically correct.

Later scenarios test assumptions. A deduplication policy can expire records too early. A cache can return stale data. More workers can overload a shared dependency.

Do not introduce consensus merely because it sounds senior. Advanced topics enter when the game can represent their tradeoffs honestly.

## What makes this a game

Players choose repairs, test ideas with visible consequences, and gain access to places they helped restore.

The same simulation supports optional constraints and alternate approaches. Replaying a mission should reveal a new decision, not require typing the same solution again.

Rewards change the world or create a new possibility. Experience points alone are insufficient.

The first prototype must establish that the act of editing, running, and watching is satisfying. A campaign cannot compensate for a dull core interaction.
