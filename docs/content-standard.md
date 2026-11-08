# Content standard

Status: proposed release standard. No missions have passed it yet.

## Authorship and responsibility

Every released mission has an accountable human author and engineering reviewer. Writing, pedagogy, and playtesting require explicit review.

AI may help draft alternatives, fixtures, and test cases. Generated material is working material until a person checks the full playable experience.

Do not publish an endless feed of generated levels. Reuse a strong simulation with carefully designed situations before adding more content.

## A mission has to earn its place

Each mission must answer five questions.

1. What does the player want to accomplish in the world?
2. Which decision or code do they own?
3. What visible behavior reveals whether their approach works?
4. What new situation tests whether they understood the idea?
5. What makes this mission enjoyable beyond receiving a correct answer?

If the task can be replaced by a paragraph and a green checkmark without losing anything, revisit the design.

## The authoring package

A proposed mission includes a short brief, prerequisite concepts, the starting world, starter code, and the observable success conditions.

The author records expected approaches and at least one valid alternative where alternatives exist. Evaluation checks behavior rather than matching a reference implementation.

The package also includes the following evidence.

- A reference solution and deliberately flawed solutions that fail for distinct reasons.
- Scenario tests, boundary cases, and safeguards against hard-coded answers.
- A visual explanation of each failure and its relevant simulation state.
- Layered hints and a post-mission explanation of the engineering concept.
- Known simplifications, playtest observations, and revisions made after testing.

Mission success conditions are available to the player. Undisclosed test inputs may check generality, but must not introduce undisclosed requirements.

## Simulation honesty

Every visible outcome must come from simulation state. A success animation cannot substitute for running the player's behavior.

Tests and the rendered world use the same behavioral rules. Attempts can be replayed from recorded inputs and controlled randomness.

The explanation distinguishes a game model from a production guarantee. For example, an in-memory deduplication table does not survive a process restart.

Performance claims need a stated workload and model. A synthetic capacity result is not a real cloud sizing recommendation.

## Difficulty and feedback

Each mission introduces a manageable conceptual change. Later missions revisit earlier concepts in unfamiliar conditions.

Failures explain what happened and provide inspectable evidence. They do not immediately reveal the answer or shame the player.

Hints first point toward an observation. Later hints name the relevant concept, then provide a partial approach. A full solution stays available on request.

The game records whether completion required substantial help without treating assistance as a moral failure. That context matters when interpreting learning results.

## Release review

A mission is not ready merely because its tests pass.

The engineering reviewer checks technical accuracy and rejects solutions that pass through a loophole. Playtesters use the mission without live coaching from its author.

The content review checks whether players understand the goal, read the world correctly, and experience a satisfying result. Repeated confusion requires a revision.

The first playtest document defines provisional observations for the initial mission. Passing a small playtest is permission to keep testing, not proof of broad product fit.
