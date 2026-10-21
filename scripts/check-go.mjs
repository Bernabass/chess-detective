// Go part of `pnpm check`: go vet, golangci-lint and the Go unit tests.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const apiDir = fileURLToPath(new URL('../services/api', import.meta.url));

const steps = [
  ['go vet', ['vet', './...']],
  ['golangci-lint', ['tool', '-modfile=tools/go.mod', 'golangci-lint', 'run', './...']],
  ['go test', ['test', './...']],
];

for (const [name, args] of steps) {
  console.log(`\n> ${name}`);
  const result = spawnSync('go', args, { cwd: apiDir, stdio: 'inherit' });
  if (result.error) {
    console.error(
      `check-go: could not run go (${result.error.message}). Install Go from https://go.dev/dl/ and reopen the terminal.`,
    );
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`check-go: ${name} failed.`);
    process.exit(result.status ?? 1);
  }
}
