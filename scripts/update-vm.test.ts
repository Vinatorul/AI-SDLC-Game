import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';

const script = resolve('scripts/update-vm.sh');
const temporaryDirectories: string[] = [];
const sharedConfig = `# Shared proxy
game.example.com {
    reverse_proxy ai-sdlc-web:80
}

wedding.example.com {
    reverse_proxy wedding-web:80
}
`;
const preparationScript = `source "$1"
configure_target "$2"
docker() {
  printf '%s\\n' "$*" >>"$DOCKER_LOG"
  if [[ "$1" == run ]]; then return "$VALIDATION_STATUS"; fi
}
prepare_caddy "$3"
printf 'prepared\\n'`;

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'ai-sdlc-update-vm-test-'));
  temporaryDirectories.push(directory);
  return { directory, file: join(directory, 'Caddyfile'), log: join(directory, 'docker.log') };
}

function prepare(directory: string, domain = 'game.example.com', validationStatus = 0) {
  return spawnSync('bash', ['-c', preparationScript, 'update-vm-test', script, domain, directory], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DOCKER_LOG: join(directory, 'docker.log'),
      VALIDATION_STATUS: String(validationStatus),
    },
  });
}

it('создаёт конфигурацию игры при первом запуске и проверяет её', () => {
  const { directory, file, log } = fixture();
  const result = prepare(directory);
  expect(result.status, result.stderr).toBe(0);
  expect(readFileSync(file, 'utf8')).toBe(
    'game.example.com {\n    reverse_proxy ai-sdlc-web:80\n}\n',
  );
  expect(statSync(file).mode & 0o777).toBe(0o644);
  expect(readFileSync(log, 'utf8')).toContain('caddy validate --config /etc/caddy/Caddyfile');
});

it.each([
  'game.example.com',
  'new-game.example.com',
])('не меняет общий Caddyfile и права при запуске с доменом %s', (domain) => {
  const { directory, file, log } = fixture();
  writeFileSync(file, sharedConfig, { mode: 0o600 });
  const before = statSync(file);
  const result = prepare(directory, domain);
  expect(result.status, result.stderr).toBe(0);
  expect(readFileSync(file, 'utf8')).toBe(sharedConfig);
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(statSync(file).mtimeMs).toBe(before.mtimeMs);
  expect(statSync(file).ino).toBe(before.ino);
  expect(readFileSync(log, 'utf8')).toContain(`-v ${file}:/etc/caddy/Caddyfile:ro`);
});

it('останавливает подготовку при неуспешной проверке, не меняя существующий файл', () => {
  const { directory, file } = fixture();
  writeFileSync(file, 'invalid configuration');
  const result = prepare(directory, 'game.example.com', 12);
  expect(result.status).toBe(12);
  expect(result.stdout).not.toContain('prepared');
  expect(readFileSync(file, 'utf8')).toBe('invalid configuration');
});

it('при запуске по IP не создаёт Caddyfile и не вызывает Docker для Caddy', () => {
  const { directory, file, log } = fixture();
  const result = prepare(directory, '203.0.113.10');
  expect(result.status, result.stderr).toBe(0);
  expect(existsSync(file)).toBe(false);
  expect(existsSync(log)).toBe(false);
});
