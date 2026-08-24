import { resolve } from 'node:path';
import { createApp } from './app';
import { loadScenario } from './scenario-loader';

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '0.0.0.0';
const databasePath = resolve(process.env.DATABASE_PATH ?? 'data/game.sqlite');
const allowedOrigins = process.env.CORS_ORIGINS?.split(',').map((origin) => origin.trim());
const scenario = loadScenario(process.env.SCENARIO_PATH);

const app = await createApp({ allowedOrigins, databasePath, logger: true, scenario });

await app.listen({ host, port });

async function stop() {
  await app.close();
  process.exit(0);
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
