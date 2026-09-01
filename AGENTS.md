# AI SDLC RPG project guide

## Project purpose

AI SDLC RPG is a web application for an interactive talk. A host controls the game, players vote
from their phones, and a shared screen shows how each decision changes the SDLC.

The current priority is a reliable technical MVP. The bundled scenario has one reusable turn
template; its copy and balance are still a technical draft.

## Repository map

- **apps/web** — React, TypeScript, Vite, and HashRouter; host, player, and shared-screen views.
- **apps/api** — Fastify HTTP and WebSocket API backed by SQLite.
- **packages/contracts** — shared API and game-state types.
- **packages/game-engine** — pure deterministic game logic with no HTTP, database, or randomness.
- **docs** — product rules and the MVP architecture.

## Core invariants

- The server is the only source of truth. Clients never calculate game consequences.
- A version 2 round has two ballots: STAGE VOTING → STAGE RESULT → ACTION VOTING →
  ACTION RESULT → EVENT → FEEDBACK. Terminal states are WON and BROKEN. Persisted version 1
  rooms keep their single legacy ballot.
- **transitionVersion** changes only after a host command. **revision** changes after every mutation,
  including joins and votes.
- Host commands run in short transactions and check the expected transition version.
- A player's vote is an upsert scoped to one ballot and may change only while that exact ballot is
  open. Every version 2 vote includes the current ballot id so a late stage vote cannot become an
  action vote.
- WebSocket messages contain only the latest revision. A client fetches the full state over HTTP
  after a notification or reconnect.
- Public responses must not expose effect, addProperties, stageChanges, actionIds for a later
  ballot, or other hidden consequences before the appropriate phase.
- Once an event is visible, public state may expose only the aggregate metricImpact needed to color
  its card. Keep numeric effects and contribution details hidden until consequences are applied.
- **myVoteChoiceId** and the deprecated **myVoteOptionId** are returned only when the state request
  has a valid player token.
- A new game snapshots its scenario and rules in SQLite. Later content edits must not alter an
  existing room.
- In CYCLIC mode, every turn is a new persisted round instance. Never reuse a prior round row or
  its ballots; clone immutable content from that room's saved turn templates.
- A stage may be selected again in a later round. Its current AS_IS/AI_ENABLED/BROKEN value is a
  summary; applied actions are stored as separate history records.
- Applying another eligible action may extend an AI-enabled stage or repair a broken stage. Do not
  treat AI_ENABLED as a one-time lock.

## Content source of truth

The bundled MVP scenario is the JSON file
**packages/game-engine/content/scenarios/technical-mvp.json**. The field guide and authoring
examples are in **packages/game-engine/content/README.md**.

- **stageActions** is the reusable catalog of actions, effects, availability, and repeatability;
- **rounds** contains persisted turn templates, stage choices, action references, and
  event-selection rules;
- the bundled turn template exposes all eight SDLC stages on every move;
- **rules** contains thresholds, round mode, template count, feedback share, and win conditions;
- **mechanics** contains metric labels, scale help, endpoint labels and descriptions, initial
  values, bounds, positive-effect requirements, process-property effects, and effects of each
  final stage state;
- top-level metadata defines the schema version, scenario id, content version, and status.

**packages/game-engine/src/scenario.ts** only imports and validates the bundled JSON. Do not put
scenario copy or tuning values back into that TypeScript file. The Zod boundary and semantic checks
live in **packages/game-engine/src/scenario-schema.ts**.

Do not copy scenario text, metric labels, endpoint descriptions, or balance values into React
components, HTTP handlers, or SQL. The frontend should render the scenario and rules received from
the API. Hardcoded metric copy is allowed only in an explicitly named compatibility fallback for
rooms or API responses created before scenario schema version 3.

## Adding or changing content

Edit **packages/game-engine/content/scenarios/technical-mvp.json** for the bundled scenario. The
top-level action catalog is reusable across rounds. Each round must have:

- a stable unique id and a sequential number;
- short title and situation text that works on a projected screen;
- all eight unique SDLC stage choices, each referencing existing actions for the same stage;
- ordered eventRules: specific conditions first and one unconditional fallback event last.

Action consequences belong in the reusable catalog entry. Its availability states decide whether
it can extend or repair the current stage, and **repeatable** controls whether the exact same action
may be applied again. Each action must use exactly one form of stage transition:

- **resultingStageState** when the action has the same result from every current state;
- **stageTransitions** when the result depends on the current state. This table must contain
  AS_IS, AI_ENABLED, and BROKEN, even when the action is unavailable in one of those states.

Do not define both fields. Different actions on the same stage remain valid in later rounds. Event
consequences belong in event.effect and event.stageChanges.

Every action or event with a non-zero metric in **effect** must explain that metric in its sibling
**effectReasons** map. The keys in **effectReasons** must match the non-zero effect keys exactly.
These strings are the source of truth for the host's metric explanation: the engine and frontend
must not invent a reason from the metric name, the sign of the delta, shortFeedback, or generic
fallback copy. Each reason should name the concrete cause of that one metric change.
The same rule applies to **mechanics.propertyEffects** / **propertyEffectReasons** and
**stageStateEffects** / **stageStateEffectReasons**.

When an event changes a stage to BROKEN, its title and description must say what actually failed
or overloaded that stage. Every negative effectReason must connect the same concrete failure to
that metric. Do not explain a deduction only with the later fact that the stage is broken. If the
copy says that a queue accumulated, require enough prior actions for a queue to exist.

If an AI integration cannot work yet but the team safely continues with the previous manual
process, leave the stage AS_IS. Reserve BROKEN for a stage that has become unreliable or unusable,
and describe the concrete failure in the event.

Positive action and event effects are checked against the final stage map for the current turn.
Configure this in **mechanics.positiveEffectRequirements**. When **requireActionStage** is true, a
positive contribution is blocked if the selected action's own stage remains BROKEN. Use
**additionalStages** for metric-specific dependencies: the bundled scenario lists the downstream
delivery stages for TTM. Block each positive action or event contribution before summing; never
hide a negative contribution in the same turn. Preserve the blocked amount and blocking stages in
effectContributions so the host can explain why the bonus was not awarded.

Stage state describes the work happening in that SDLC stage, not the category of technology used:

- use **AI_ENABLED** when AI performs a real task in the stage. A stage-specific MCP integration,
  skill, knowledge assistant, or dependency-graph analysis may be enough if it creates a working AI
  loop rather than merely installing infrastructure;
- use **AS_IS** for a process improvement or an asset that AI does not yet use in that stage. Such
  an action may be available in AS_IS and BROKEN, repair BROKEN to AS_IS, and still leave the cube
  gray;
- use **BROKEN** when the chosen setup makes the stage unreliable or unusable.

Place infrastructure actions in the stage whose work they change. For example, an MCP integration
that lets AI inspect a live deployment pipeline belongs to deployment, and a reusable test-
generation skill belongs to testing. Do not collect every AI-infrastructure choice under technical
discovery. Use properties and applied-action history to make foundations change later outcomes.

Do not equate the presence of a skill, MCP server, knowledge base, or graph with a working AI loop.
Use ordered event rules to check the foundations supplied by the same or neighboring stages. The
action may propose AI_ENABLED, while a missing prerequisite event overrides that stage to AS_IS or
BROKEN. Keep the action repeatable when players must be able to prepare the missing foundations and
try again. A successful rule should be reachable and covered by a focused combination test.

For a reusable process or foundation action, prefer a state-sensitive transition such as
AS_IS -> AS_IS, AI_ENABLED -> AI_ENABLED, and BROKEN -> AS_IS, and make it available in all three
states. This lets it prepare a gray stage, preserve an installed AI capability, or repair a broken
stage without pretending that the foundation itself is AI adoption. If such an action is
repeatable, keep both its action effect and its ordinary repeatable event numerically neutral. Its
payoff should come from the repaired state, an acquired property, or safer later events. Gate a
one-time score benefit with action history or make the action non-repeatable.

Use a generic process property only when every way of acquiring that property is genuinely enough
for the dependent outcome. When an outcome requires a concrete foundation, such as a particular
dependency graph, test-generation skill, or deployment MCP integration, check that action through
hasAppliedActions or missingAppliedActions instead of using a broad property as a proxy. If an AI
capability may be installed before its foundations, list their stable action ids in the capability's
**activationRequirements**. The engine activates it as soon as the current decision makes the full
set complete, including when the last missing foundation is added later. Keep matching negative
event rules for the failed early attempt so players see what was missing. Cover both orders with a
focused combination test. Use event.stageChanges only for a consequence specific to that event,
not as a second copy of the capability dependency graph.

Keep at least one action for each bundled stage choice repeatable and available in AS_IS,
AI_ENABLED, and BROKEN. This keeps all eight stages selectable after earlier actions have been
used. Remember that a repeatable action applies its numeric effect again, so treat repeatability as
an explicit balance decision.

Use descriptive stable catalog ids such as **review.context-and-human-risk**. Do not encode the
first round that happened to use an action in its id. A round references catalog ids and never owns
or duplicates their copy, balance, or effects.

Event conditions may use the selected action, pre-action process properties and stage states, and
the history of previously applied actions. Keep the last rule unconditional. Mark content as FACT
only when it has a verified basis; mark simulations and hypotheses as SCENARIO. Give every action
useful individual shortFeedback before treating the content as final.

The bundled scenario treats process properties as guards against specific bad events, not as
recurring score income: its propertyEffects are deliberately empty. Its stageStateEffects are also
empty: BROKEN blocks victory until repaired, but does not silently subtract points every later
turn. Keep ordinary successful event rewards to at most one positive point in total unless a
playtest justifies a stronger conditional result.

For an AI_ENABLED action, make the concrete AI task clear in the title and state the human decision
or check in the title or first sentence. Make autonomous scope equally explicit. For an AS_IS
process action, name the practice the team adds and say that it is not yet an AI integration. The
final stage map reuses these titles, so never mark generic infrastructure as AI_ENABLED unless the
final event leaves AI doing useful work in that stage.

### Scenario copy style

Write every player- or host-facing scenario string in natural spoken Russian. Build the sentence
around three concrete things: who acts, what they do or check, and what practical consequence
follows. An action should describe the actual choice; an event should say what happened; a
shortFeedback or effectReasons entry should explain why the concrete result follows from that
choice. Do not replace that explanation with an abstract metric summary such as "quality improved"
or "controllability decreased."

Avoid corporate filler, generic AI prose, invented metaphors, and implementation narration. Do not
describe a content result through cube colors or phrases such as "the stage received an effect."
Use MCP, skill, agent, context, and similar terms only when the exact technology matters, then say
what data or command it provides, who verifies the result, and what fails when a prerequisite is
missing.

In Russian copy and discussion, never use a generic abstract noun to mean a gap, mismatch, missing
dependency, or failed handoff. State exactly what differs, what is absent, which stage is
overloaded, or which decision cannot be made. The copy validator rejects the prohibited term in
all grammatical forms.

Treat the first factually correct draft as working notes. Rewrite it once in the vocabulary a host
would naturally use aloud, then read it aloud before accepting it. If it sounds like analysis,
documentation, a corporate memo, or generated copy, rewrite it again. **pnpm copy:validate** catches
only known structural and wording mistakes; passing it never replaces this manual edit and
read-aloud pass.

In Russian player- and host-facing copy, use **релиз** rather than **выпуск**, and **откат** rather
than phrases such as **возврат прошлой версии**. Reserve **восстановление** for service or persisted
game recovery when it does not mean rolling back a deployed version.

Use **метрика**, not **показатель**, and **прод**, not `production` or **боевое окружение**, in
Russian player- and host-facing copy. Use **баг** for a defect in code or product behavior and
**инцидент** for an operational situation in prod; do not alternate them with **ошибка** or
**сбой**. Keep **тест**, **автотест**, and **проверка** distinct: an autotest runs automatically, a
test is the test case or code, and a check is the broader verification step performed by a person
or tool.

After a content change:

1. Keep rules.roundLimit equal to the number of round templates. Set rules.roundMode to FINITE for
   one pass or CYCLIC to repeat the saved templates until the win condition is met.
2. Increment the top-level version.
3. Run `pnpm scenario:validate packages/game-engine/content/scenarios/technical-mvp.json`.
4. Run `pnpm copy:validate`, then manually read every changed visible string aloud.
5. Add or update focused tests for eligibility, event selection, history, and effect calculation.
6. Verify that a round cannot lose all useful stage or action choices on reachable histories.
7. Verify that conditional events follow from earlier decisions instead of acting as random
   penalties.
8. Create a new room when checking the change; existing rooms use their stored snapshot.

To add another scenario, copy the JSON to
**packages/game-engine/content/scenarios/<scenario-id>.json**, give it a new stable id, validate it,
and start the API with an absolute `SCENARIO_PATH`. A bad external file must stop API startup; never
silently fall back to the bundled scenario. Restart the API after changing an external file.

The API may load one active scenario per process. Scenario selection in the UI and a multi-scenario
catalog are outside the MVP. A new room snapshots its scenario id, version, rules, mechanics,
rounds, action catalog, stage choices, and events in SQLite, so replacing the source file cannot
change an existing room.

## Configuration rules

There are three configuration layers:

- scenario content and game balance in the validated JSON scenario;
- API runtime settings in environment variables documented by **apps/api/.env.example**;
- web build settings in environment variables documented by **apps/web/.env.example**.

Never repeat configurable values as magic literals. Round mode, template count, action-choice
shuffling, metric definitions, initial values, limits, positive-effect requirements, property
bonuses, stage-state effects, critical thresholds, and win conditions must have one typed
configuration source rather than copies of the current scenario defaults across the codebase. When
`rules.shuffleActionChoices` is enabled, shuffle only the action ballot once on the server and
persist that order for every client.

The metric keys are stable internal identifiers kept for persisted-room compatibility. Their
player-facing meaning comes from `mechanics.metricDefinitions`. The bundled scenario uses a
high-is-good score from -10 to +10, starts at 0, enters danger at -5, and breaks at -8. Treat those
numbers as scenario defaults, not engine constants. Keep action, event, and property effects in
small integer points; the current content uses 1 for a small effect, 2 for a noticeable effect, and
3 for a strong effect. Version 3 and later metric bounds must span zero because the web gauge uses zero as
the neutral origin; initial values may still be configured independently inside those bounds.

When adding a tunable setting:

1. Add it to a typed configuration contract.
2. Define it once in the scenario or environment, depending on its purpose.
3. Pass it explicitly to the code that uses it.
4. Include gameplay-affecting values in the new-game snapshot.
5. Add a test with a non-default value to prove the implementation does not depend on the default.

Runtime configuration:

- **apps/api/.env.example** documents PORT, HOST, DATABASE_PATH, CORS_ORIGINS, and SCENARIO_PATH.
- **apps/web/.env.example** documents VITE_API_BASE_URL and VITE_BASE_PATH.
- Real values belong in deployment settings or ignored local .env files.
- Never put the host token, player tokens, or any other secret in VITE_* variables.

## Set up and run locally

Use Node.js 24 and pnpm 11.19.0.

~~~bash
node --version
pnpm install
pnpm dev
~~~

The root dev script starts both applications:

- web — http://127.0.0.1:5173;
- API — http://127.0.0.1:8787;
- health check — http://127.0.0.1:8787/health.

Use pnpm dev:web or pnpm dev:api to run only one side. Defaults work without local .env files. Copy
the relevant .env.example to an ignored .env only when overriding a value.

In the Codex workspace, put the bundled Node.js and pnpm directories first in PATH:

~~~bash
export PATH="/Users/vinatorul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/vinatorul/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH"
pnpm dev
~~~

CORS must allow the exact web origin and the GET, HEAD, POST, PUT, and OPTIONS methods. Voting uses
PUT with an Authorization header and therefore sends a preflight request.

## Run the API in Docker

~~~bash
docker build -f apps/api/Dockerfile -t ai-sdlc-api .
docker run --rm -p 8787:8787 \
  -e CORS_ORIGINS=http://127.0.0.1:5173 \
  -v ai-sdlc-data:/data ai-sdlc-api
~~~

The container must run as a single API instance with a persistent volume mounted at /data.

## Run both applications on one VM without Compose

The bare-IP deployment uses two containers on the `ai-sdlc` Docker network. The web container
serves the Vite build through Nginx on public port 80 and proxies `/api`, `/health`, and WebSocket
upgrades to the container named `ai-sdlc-api`. The API container is not published on the host and
stores SQLite in the `ai-sdlc-data` volume.

Build the web image with `VITE_API_BASE_URL=http://<SERVER_IP>` and `VITE_BASE_PATH=/`. Start the API
with the exact same origin in `CORS_ORIGINS`. Do not hardcode a server IP in source files or the
Nginx configuration. The complete root-user commands are in **docs/deploy-single-vm.md**.

This HTTP-only mode is for a temporary demonstration. It does not replace the HTTPS/WSS production
requirements or the separate GitHub Pages deployment. Do not expose API port 8787 publicly, remove
the persistent volume during container updates, or run multiple API containers against it.

## How to change code

1. Read this file and the relevant document in **docs**.
2. Reproduce the behavior and identify the owning layer before editing.
3. Change **packages/contracts** first when the shared HTTP or state shape changes.
4. Put deterministic rules in **packages/game-engine** and cover them with focused unit tests.
5. Keep persistence, ballot lifecycle, authentication, transitions, and broadcasting in
   **apps/api**.
6. Keep **apps/web** focused on rendering server state and sending user intent.
7. Run formatting, type checks, and the narrow tests for the changed behavior.

Use strict TypeScript and ESM. Follow the existing Biome formatting. Prefer small functions with
explicit inputs over hidden module state. Keep new or substantially changed functions within 30
physical lines, and do not refactor unrelated code.

User-facing copy is in Russian. Keep it short, concrete, and suitable for a phone or projected
screen. Do not present simulated consequences as proven experience.

### API and database changes

- Validate external input at the HTTP boundary.
- Keep host transitions transactional and protected by transitionVersion.
- Mutations must update revision and publish a WebSocket revision notification.
- Return a full current state after reconnect; do not reconstruct it from missed events.
- Keep secrets hashed at rest and out of public game state.
- Make schema changes forward-compatible with existing SQLite files. Add an explicit migration; do
  not rely on deleting the local database.
- Keep legacy round_options and votes available while version 1 rooms still exist. New rooms use
  ballot ids, ballot-scoped votes, a snapshotted action catalog, and append-only applied-action
  history.
- Keep transactions short and preserve foreign_keys, WAL, and busy_timeout.

The SQLite MVP supports one API process with a persistent disk. Use PostgreSQL if a deployment needs
multiple API replicas or has no persistent disk.

### Web changes

- Use the API client in **apps/web/src/api**; do not call fetch independently from page components.
- Treat WebSocket messages as invalidation signals and refresh state over HTTP.
- Keep routes compatible with HashRouter and GitHub Pages subpaths.
- Derive labels and visible state from shared contracts or server data rather than duplicating game
  rules in components.
- Keep the joined player view phase-focused: waiting status and current metrics, a concise ballot
  while voting is open, then the same ballot cards with winner/tie styling and raw vote counts after
  it closes. Do not introduce a separate results list. Show the event and compact updated metric
  values after the turn. Hide metric descriptions and detailed metric reasons from the joined
  player view; keep the detailed explanations and action **shortFeedback** on the host screen.
  Always place the joined player's applied-action history as a separate list after the
  phase-specific content. Do not render the room header, full stage map, or catalog choice keys
  such as A, B, or C in the joined player view.
- Keep the shared-screen route as a stable dashboard without the site navigation or game header.
  Show only the generic current phase, compact metrics, all eight stage states, and the join QR.
  Do not show the selected action, event details, or applied-action history there. Use only one
  visible heading for the stage map: **Состояние SDLC**.
- Do not render the generic metric-scale explanation above metric cards. Metric labels, values,
  gauge bounds, and endpoint labels already carry the useful information.
- Keep stage-ballot cards square on the player and shared screens. Show applied-action history as a
  list below the ballot instead of stretching individual stage cards.
- Check host, player, and shared-screen layouts at narrow phone and projected-screen widths when a
  visual component changes.

## Validation commands

Format and check the repository:

~~~bash
pnpm format
pnpm check
~~~

Run only the focused engine and API flow tests:

~~~bash
pnpm exec vitest run \
  packages/game-engine/src/resolve.test.ts \
  packages/game-engine/src/scenario-schema.test.ts \
  apps/api/src/scenario-loader.test.ts \
  apps/api/src/db/database.test.ts \
  apps/api/src/game-flow.test.ts \
  apps/api/src/metric-impact.test.ts \
  apps/api/src/shuffle.test.ts \
  apps/web/src/components/MetricChangeNotes.test.tsx \
  apps/web/src/pages/PlayerPage.test.tsx \
  apps/web/src/pages/ScreenPage.test.tsx
~~~

Build both applications:

~~~bash
pnpm build
~~~

Do not run a broader suite unless focused checks cannot cover the change. For documentation-only
changes, git diff --check and link/path verification are sufficient.

## Files that must stay local

Never commit SQLite files, WAL/SHM files, backups, node_modules, .pnpm-store, dist, or local .env
files. Preserve unrelated user changes in a dirty worktree.

## GitHub Pages and publishing

The frontend is a static Vite site using HashRouter, configurable VITE_BASE_PATH, and public
VITE_API_BASE_URL. Production API and WebSocket endpoints must use HTTPS and WSS.

The Pages workflow deploys after a push to main and can also be started manually. Do not change
cloud infrastructure, the deployment target, or repository settings unless the user has explicitly
authorized that action. Do not commit or push unrelated changes.

## Out of scope for the MVP

- scenario editor;
- user accounts;
- detailed analytics;
- multiple API replicas;
- automatic publishing;
- final scenario copy and balance.
