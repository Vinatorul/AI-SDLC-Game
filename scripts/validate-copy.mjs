import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

const root = process.cwd();
const defaultScenario = 'packages/game-engine/content/scenarios/technical-mvp.json';
const requestedScenarios = process.argv.slice(2);
const scenarioFiles = requestedScenarios.length > 0 ? requestedScenarios : bundledScenarios();
const issues = [];
const reasonKeys = new Set(['effectReasons', 'propertyEffectReasons', 'stageStateEffectReasons']);

const vaguePhrases = [
  [/в рамках/iu, 'назовите конкретное действие вместо «в рамках»'],
  [/данн(?:ый|ая|ое)/iu, 'назовите предмет прямо вместо «данный»'],
  [/осуществл/iu, 'замените канцеляризм простым глаголом'],
  [/(?<![А-ЯЁа-яё])является(?![А-ЯЁа-яё])/iu, 'скажите, что именно происходит'],
  [/суммарн\w* эффект/iu, 'перечислите, что именно дало плюс или минус'],
  [/накопленн\w* эффект/iu, 'назовите практику и её последствие'],
  [/продолжа(?:ет|ют) влиять/iu, 'скажите, что повторится и почему'],
  [/влияет на общий результат/iu, 'назовите конкретную метрику или последствие'],
  [/кубик остал(?:ся|ась) серым/iu, 'объясните, что команда получила вместо цвета кубика'],
  [/так на ход повлияло/iu, 'назовите причину напрямую'],
  [/фактически:/iu, 'перепишите фрагмент обычным предложением'],
  [/появился новый разрыв/iu, 'назовите конкретную проблему'],
  [/новая граница ответственности/iu, 'объясните, кто теперь что делает'],
  [/локальный результат/iu, 'назовите конкретное изменение'],
  [/эффекты дали/iu, 'назовите решение или событие'],
  [/не доказ/iu, 'назовите, какой проверки не хватило и кто не смог принять решение'],
  [/стало понятн/iu, 'назовите, кто получил нужную информацию и что теперь может сделать'],
  [/выпуск\w*/iu, 'используйте единый термин «релиз»'],
  [/возврат\w* (?:прошл\w*|рабоч\w*) верси/iu, 'используйте единый термин «откат»'],
  [/вернут\w* (?:прошл\w*|рабоч\w*) верси/iu, 'используйте единый термин «откат»'],
  [/поставил\w* наверх/iu, 'назовите, что именно AI предложил выбрать и по какому признаку'],
  [/собра(?:ть|л|ла|ли) картин/iu, 'перечислите данные, которые нужно было связать'],
  [/не увидел\w* результат/iu, 'назовите данные, которых не хватило после изменения'],
  [/не потерял\w* контроль/iu, 'назовите решение, которое осталось за человеком'],
  [/готов\w* путь назад/iu, 'назовите конкретный откат или способ исправления'],
];

const terminologyPhrases = [
  [/показател\w*/iu, 'используйте единый термин «метрика»'],
  [/ошибк\w*/iu, 'используйте «баг» для дефекта и «инцидент» для ситуации в проде'],
  [
    /(?<![А-ЯЁа-яё])сбо(?:й|я|ев|и|ю|ями|ях)(?![А-ЯЁа-яё])/iu,
    'используйте единый термин «инцидент»',
  ],
  [/продакш\w*/iu, 'используйте единый термин «прод»'],
  [/боев[А-ЯЁа-яё]*\s+окружени[А-ЯЁа-яё]*/iu, 'используйте единый термин «прод»'],
];

const visibleJsonKeys = new Set([
  'description',
  'label',
  'maximumDescription',
  'maximumLabel',
  'metricScaleDescription',
  'minimumDescription',
  'minimumLabel',
  'shortFeedback',
  'situation',
  'title',
]);

for (const filename of scenarioFiles) validateScenario(filename);
for (const directory of ['apps/web/src', 'apps/api/src']) validateSourceTree(directory);

if (issues.length > 0) {
  console.error(`Текст не прошёл проверку: ${issues.length}`);
  for (const issue of issues) console.error(`- ${issue}`);
  process.exitCode = 1;
} else {
  console.log(
    `Текст проверен: ${scenarioCountLabel(scenarioFiles.length)}, интерфейс и сообщения API`,
  );
}

function scenarioCountLabel(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} сценарий`;
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return `${count} сценария`;
  return `${count} сценариев`;
}

function validateScenario(filename) {
  const absolute = resolve(root, filename);
  const scenario = JSON.parse(readFileSync(absolute, 'utf8'));
  visitJson(scenario, relative(root, absolute), []);
}

function visitJson(value, filename, path) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      visitJson(item, filename, [...path, String(index)]);
    });
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    const itemPath = [...path, key];
    if (reasonKeys.has(key)) {
      validateEffectReasons(item, filename, itemPath);
    } else if (typeof item === 'string' && visibleJsonKeys.has(key)) {
      validateText(item, `${filename}:${itemPath.join('.')}`, key);
    } else {
      visitJson(item, filename, itemPath);
    }
  }
}

function bundledScenarios() {
  const directory = resolve(root, 'packages/game-engine/content/scenarios');
  const files = readdirSync(directory).filter((filename) => extname(filename) === '.json');
  return files.length > 0
    ? files.sort().map((filename) => join(directory, filename))
    : [defaultScenario];
}

function validateEffectReasons(value, filename, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const entries = Object.entries(value);
  const reasons = entries.filter((entry) => typeof entry[1] === 'string');
  for (const [key, item] of entries) {
    const nextPath = [...path, key];
    if (typeof item === 'string') {
      validateText(item, `${filename}:${nextPath.join('.')}`, 'effectReason');
    } else {
      validateEffectReasons(item, filename, nextPath);
    }
  }
  if (new Set(reasons.map((entry) => entry[1])).size !== reasons.length) {
    issues.push(`${filename}:${path.join('.')} — каждой метрике нужна своя причина`);
  }
}

function validateSourceTree(directory) {
  for (const filename of sourceFiles(resolve(root, directory))) validateSource(filename);
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(filename);
    if (!['.ts', '.tsx'].includes(extname(entry.name))) return [];
    return /\.(test|spec)\./u.test(entry.name) ? [] : [filename];
  });
}

function validateSource(filename) {
  const lines = readFileSync(filename, 'utf8').split('\n');
  lines.forEach((line, index) => {
    for (const [pattern, hint] of [...vaguePhrases, ...terminologyPhrases]) {
      if (pattern.test(line)) issues.push(`${relative(root, filename)}:${index + 1} — ${hint}`);
    }
  });
}

function validateText(text, location, key) {
  for (const [pattern, hint] of [...vaguePhrases, ...terminologyPhrases]) {
    if (pattern.test(text)) issues.push(`${location} — ${hint}`);
  }
  const maximum = fieldLimit(key);
  if (text.trim().length === 0) issues.push(`${location} — пустой текст`);
  if (text.length > maximum)
    issues.push(`${location} — ${text.length} знаков, максимум ${maximum}`);
  if (/\s{2,}/u.test(text)) issues.push(`${location} — лишние пробелы`);
  for (const sentence of text.split(/(?<=[.!?])\s+/u)) {
    if (sentence.length > 180) issues.push(`${location} — слишком длинное предложение`);
  }
}

function fieldLimit(key) {
  if (key === 'title' || key.endsWith('Label')) return 90;
  if (key === 'situation' || key === 'metricScaleDescription') return 200;
  if (key === 'shortFeedback') return 220;
  if (key === 'effectReason') return 220;
  return 300;
}
