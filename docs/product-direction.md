# Product direction

Status: working proposal. User-confirmed goals appear in the project README. Other decisions here need discussion or playtesting.

## The problem

Some experienced engineers spend much of their workday directing AI agents. They still understand software, but write less code themselves.

They want to retain the ability to produce code, investigate failures, and solve problems without handing every hard step to an agent. Work deadlines make manual practice during paid work difficult.

The product must earn time outside work. A collection of exercises with badges does not yet explain why someone would choose it over a game.

## The proposed promise

Spend an evening making a small world work through code you wrote yourself.

The world reacts to the actual program. A successful repair opens a route, restores a workshop, or helps a resident reach home. The player keeps the result.

The central hypothesis is that visible progress and enjoyable systems can make deliberate programming practice worth returning to.

## The audience

Start with engineers who already know a programming language and miss hands-on work. Do not assume that seniority means recent fluency.

The first session should let players discover what they remember without a placement exam or a beginner syntax course.

TypeScript is selected for the app and player-written mission code. Additional languages remain outside the first experiment.

## The desired session

Proposed session length is 25 to 45 minutes. This is a design target, not a measured result.

The player sees an interesting problem before seeing editable code. A concise brief explains the goal, data, inputs, and expected output through concrete examples. They inspect the world, deliberately open the module, edit a bounded part of its behavior, and run the simulation. Instructions remain accessible beside the code.

They can pause, inspect, replay, and try again. Coding speed does not determine success. A session can end with a completed repair and a saved world.

## Progress without another obligation

Progress comes from places restored, useful capabilities gained, and new situations that test earlier decisions.

Optional challenges offer different tradeoffs. A cheaper solution or a more resilient design can earn recognition without making the first working solution feel inadequate.

No daily streak penalties, public speed rankings, or forced grind. A player who returns after three weeks should find a short reminder and a clear next mission.

## Advanced learning

System design should emerge from the world. More activity creates contention. More distance creates delay. More independent workers create coordination problems.

Later missions can combine topology choices with player-written policies. Dragging a cache onto a map alone does not exercise programming fluency.

A short post-mission explanation connects observed behavior to engineering terms. It also explains where the simulation differs from a real distributed system.

Interview practice is optional. A player might explain a tradeoff, estimate a capacity limit, or apply an idea in an unfamiliar scenario. Do not claim interview readiness from mission completion.

## Product boundaries

The initial experiment excludes multiplayer, a broad language catalog, generated daily missions, and a large persistent campaign.

AI assistance is not the main interaction. Proposed hints move from observations to concepts before revealing implementation details. Full solutions appear on request.

Do not police whether players use outside AI. Explain the practice goal and let players choose their assistance level.

## Decisions still open

1. Which fantasy makes the user want to spend time in this world?
2. Should sessions emphasize construction, recovery, exploration, or a mixture?
3. How much TypeScript editor assistance should the first mission provide?
4. How much editor time feels satisfying compared with simulation time?
5. Should interview-oriented material remain optional or shape the main campaign?
