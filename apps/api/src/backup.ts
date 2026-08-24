import { resolve } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

const [sourceArgument, targetArgument] = process.argv.slice(2);

if (!sourceArgument || !targetArgument) {
  throw new Error('Использование: node dist/backup.js <база.sqlite> <копия.sqlite>');
}

const source = resolve(sourceArgument);
const target = resolve(targetArgument);
const database = new DatabaseSync(source);

try {
  await backup(database, target);
  console.log(`Резервная копия сохранена: ${target}`);
} finally {
  database.close();
}
