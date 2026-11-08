# First playtest

Status: proposed user study. A first-level direction prototype exists in `prototype`. Direct product-owner feedback is recorded below. The proposed five-engineer study has not run.

## Observed feedback from the first passes

The user liked the 3D world and the overall direction, but found the interface crowded. Tab initially moved out of the editor rather than indenting. The Monaco revision corrected normal editing behavior.

The later revision still failed to explain the task. The user saw code without understanding what to implement or how the dataset worked. The walkthrough was acceptable but did not solve that confusion. The all-monospace font was disliked. The user preferred the simulated hex-world reference and asked for ten distinct follow-up exercise designs.

The demo also failed to start its sandbox on the user's connection. Controlled worker and WASM download delays reproduced the exact six-second startup error. The staged repair passes those delayed-download cases with separate execution limits unchanged.

The next candidate therefore uses a problem-first brief, explained examples, mixed UI and code typography, and a grounded hex settlement. These changes still need a fresh hands-on playtest. Automated browser checks cannot establish that someone understands the problem.

## The question

Does controlling a visually appealing world through handwritten code make an experienced engineer want another session?

The first experiment tests this interaction. It does not test a whole curriculum, business model, or interview-readiness claim.

## The smallest credible slice

Build one compact district and one complete mission, First light, described in the game concept.

The slice contains a readable world, an editor, run and reset controls, inspectable failures, a success sequence, and one changed-input challenge.

Use one language and a small supplied code interface. Deliver one polished sequence rather than a mission-selection screen full of placeholders.

Accounts, payments, campaign persistence, procedural generation, and advanced system-design chapters remain outside this experiment. Saving one local attempt is sufficient for resuming a test session.

## Presentation requirements

Art must be consistent enough for testers to judge the proposed fantasy. Placeholder geometry is acceptable only when the scene still communicates routes, obstructions, and the repair payoff.

Text stays legible beside the world. Players can resize the editor and inspect objects without camera precision. Audio and motion can be reduced or disabled.

Select a reference laptop and browser before measuring frame rate. Establish loading and responsiveness targets against that device instead of claiming universal GPU performance.

The world must remain responsive when player code fails. User code is untrusted. Execution isolation, time limits, and access restrictions require a technical design before running arbitrary submissions.

A Web Worker alone is not a security boundary for arbitrary code. The first implementation must not silently give submissions access to the host application's credentials or storage.

## Playtest procedure

Recruit five engineers who already know the chosen language. This sample can reveal usability failures, but cannot establish market demand.

1. Ask about recent hands-on coding and their current use of AI.
2. Let each person start the mission without an author explaining the solution.
3. Observe a session of up to 40 minutes, with the player free to stop.
4. Offer an optional changed-input challenge and an optional later return session.
5. Ask which moments felt playful, frustrating, educational, or like unpaid work.

Tell testers which assistance is built in. Record use of hints and outside tools so completions remain interpretable.

## Evidence to collect

Record time to the first meaningful code change and time to the first visible consequence. Record where players ask for help or misread the world.

Keep anonymized observations, consented recordings, attempted programs, simulation replays, and assistance use. Do not record unrelated editor contents or credentials.

Ask players to predict the changed scenario before running it. Their explanation and program behavior provide better evidence of understanding than a completion badge.

Observe whether they choose the optional challenge and whether they attend an offered return session. Separate observed behavior from stated enthusiasm.

## Provisional decision rules

These are experiment targets, not validated benchmarks.

- Aim for four of five testers to explain the goal without author coaching.
- Aim for four of five to identify how their code changed the simulation.
- Aim for at least three to try the optional challenge voluntarily.
- Investigate every instance where the player calls the experience homework or cannot explain a failure.
- Treat return-session attendance as an early signal only. Record scheduling constraints and reasons for declining.

Failure does not automatically mean adding content. First inspect the fantasy, coding scope, feedback, and payoff.

If those work, the next experiment introduces one deeper systems mission. If they do not, revise the core interaction before building a campaign.
