import { ENGINE_VERSION } from '@retrograde/engine';

/** Help text printed by the CLI. The commands arrive in v0.5.0 (ARCHITECTURE.md §7.1). */
export function usage(): string {
  return [
    `retrograde generator (engine ${ENGINE_VERSION})`,
    '',
    'Usage:',
    '  generator generate --count <n> --seed <n> [--min-plies <n>] [--max-plies <n>] [--jobs <n>] --out <file>',
    '  generator verify <file.jsonl>',
    '  generator stats <file.jsonl>',
    '',
    'Not implemented yet: the generator is built in v0.5.0.',
  ].join('\n');
}
