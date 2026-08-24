# AI SDLC RPG project guide

## Project purpose

AI SDLC RPG is a web application for an interactive talk. A host controls the game, players vote
from their phones, and a shared screen shows how each decision changes the SDLC.

The current priority is a reliable technical MVP. The five-round scenario and its balance are
still a technical draft and will be refined separately.

## Repository map

- **apps/web** — React, TypeScript, Vite, and HashRouter; host, player, and shared-screen views.
- **apps/api** — Fastify HTTP and WebSocket API backed by SQLite.
- **packages/contracts** — shared API and game-state types.
- **packages/game-engine** — pure deterministic game logic with no HTTP, database, or randomness.
- **docs** — product rules and the MVP architecture.

## Core invariants

- The server is the only source of truth. Clients never calculate game consequences.
- The main flow is LOBBY → VOTING → RESULT → EVENT → FEEDBACK; terminal states are WON and BROKEN.
- **transitionVersion** changes only after a host command. **revision** changes after every mutation,
  including joins and votes.
- Host commands run in short transactions and check the expected transition version.
- A player's vote is an upsert and may change only while the game is in VOTING.
- WebSocket messages contain only the latest revision. A client fetches the full state over HTTP
  after a notification or reconnect.
- Public responses must not expose effect, addProperties, stageChanges, or other hidden consequences
  before the appropriate phase.
- **myVoteOptionId** is returned only when the state request has a valid player token.
- A new game snapshots its scenario and rules in SQLite. Later content edits must not alter an
  existing room.

## Content source of truth

The MVP currently has one scenario. Its source of truth is
**packages/game-engine/src/scenario.ts**:

- **rounds** contains situations, options, effects, and event-selection rules;
- **defaultRules** contains tunable game rules such as thresholds, round count, and win conditions;
- **defaultScenario** binds content to rules and defines the scenario id, version, and status.

Do not copy scenario text or balance values into React components, HTTP handlers, or SQL. The
frontend should render the scenario and rules received from the API.

## Adding or changing content

Add a ScenarioRound to the rounds array in **packages/game-engine/src/scenario.ts**. Each round must
have:

- a stable unique id and a sequential number;
- short title and situation text that works on a projected screen;
- exactly four options with unique id and key values, an SDLC stage, effects, and properties;
- ordered eventRules: specific conditions first and one unconditional fallback event last.

Decision consequences belong in effect, addProperties, and stageChanges. Event consequences belong
in event.effect and event.stageChanges. Mark content as FACT only when it has a verified basis; mark
simulations and hypotheses as SCENARIO. Give every option useful individual shortFeedback before
treating the content as final.

After a content change:

1. Keep defaultRules.roundLimit equal to the number of rounds.
2. Increment defaultScenario.version.
3. Add or update focused tests for event selection and effect calculation.
4. Verify that conditional events follow from earlier decisions instead of acting as random
   penalties.
5. Create a new room when checking the change; existing rooms use their stored snapshot.

When the project gains a second independent scenario, move scenarios to
**packages/game-engine/src/scenarios/<scenario-id>.ts** and add an explicit scenario registry. Do not
select scenarios through incidental imports or filenames.

## Configuration rules

There are three configuration layers:

- scenario content and game balance in the typed game-engine scenario;
- API runtime settings in environment variables documented by **apps/api/.env.example**;
- web build settings in environment variables documented by **apps/web/.env.example**.

Never repeat configurable values as magic literals. Round count, initial metrics, metric limits,
property bonuses, critical thresholds, and win conditions must have one typed configuration source
rather than copies such as 5, 60, 100, 15, or 3 across the codebase.

When adding a tunable setting:

1. Add it to a typed configuration contract.
2. Define it once in the scenario or environment, depending on its purpose.
3. Pass it explicitly to the code that uses it.
4. Include gameplay-affecting values in the new-game snapshot.
5. Add a test with a non-default value to prove the implementation does not depend on the default.

Current configuration debt: initial metrics, metric bounds, and process-property bonuses still live
in **packages/game-engine/src/resolve.ts**. Move them into the typed scenario configuration before
changing balance, persist them with each new game, and do not add more tuning constants there.

Runtime configuration:

- **apps/api/.env.example** documents PORT, HOST, DATABASE_PATH, and CORS_ORIGINS.
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

## How to change code

1. Read this file and the relevant document in **docs**.
2. Reproduce the behavior and identify the owning layer before editing.
3. Change **packages/contracts** first when the shared HTTP or state shape changes.
4. Put deterministic rules in **packages/game-engine** and cover them with focused unit tests.
5. Keep persistence, authentication, transitions, and broadcasting in **apps/api**.
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
- Keep transactions short and preserve foreign_keys, WAL, and busy_timeout.

The SQLite MVP supports one API process with a persistent disk. Use PostgreSQL if a deployment needs
multiple API replicas or has no persistent disk.

### Web changes

- Use the API client in **apps/web/src/api**; do not call fetch independently from page components.
- Treat WebSocket messages as invalidation signals and refresh state over HTTP.
- Keep routes compatible with HashRouter and GitHub Pages subpaths.
- Derive labels and visible state from shared contracts or server data rather than duplicating game
  rules in components.
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
pnpm exec vitest run packages/game-engine/src/resolve.test.ts apps/api/src/game-flow.test.ts
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
