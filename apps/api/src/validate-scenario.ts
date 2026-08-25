import { resolve } from 'node:path';
import { loadScenario } from './scenario-loader';

const filename = process.argv[2];
if (!filename) throw new Error('Укажите путь: pnpm scenario:validate <scenario.json>');

const scenario = loadScenario(resolve(process.env.INIT_CWD ?? process.cwd(), filename));
console.log(
  `Сценарий ${scenario.id} v${scenario.version}: шаблонов — ${scenario.rounds.length}, режим ${scenario.rules.roundMode}`,
);
