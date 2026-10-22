import { ENGINE_VERSION } from '@retrograde/engine';

/** Help text printed by the CLI (SPEC §7.1). */
export function usage(): string {
  return [
    `retrograde generator (engine ${ENGINE_VERSION})`,
    '',
    'Usage:',
    '  generator generate --count <n> --seed <n> --out <file> [--min-plies 5] [--max-plies 12] [--jobs 1]',
    '                     [--source both|beam|random] [--node-limit 200000] [--width 180] [--children 8] [--random <n>]',
    '  generator verify <file.jsonl> [--jobs 1] [--node-limit 200000]',
    '  generator stats <file.jsonl> [--samples <n per star level>]',
    '',
    'generate writes the puzzles (JSONL, sorted by candidate index) and <out>.stats.json (timings).',
    'Output is the same for a given seed, options and engine version, whatever --jobs is.',
  ].join('\n');
}
