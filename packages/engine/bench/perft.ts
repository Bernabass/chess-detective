// Perft speed benchmark: pnpm --filter @retrograde/engine perft [depth] [fen]
import { START_FEN, parseFen, perft } from '../src/index';

const depth = Number(process.argv[2] ?? '5');
const fen = process.argv.slice(3).join(' ') || START_FEN;

const parsed = parseFen(fen);
if (!parsed.ok) {
  console.error(parsed.error.map((e) => e.message).join('\n'));
  process.exit(1);
}

perft(parsed.value, Math.min(depth, 3)); // warm up the JIT

const start = performance.now();
const nodes = perft(parsed.value, depth);
const seconds = (performance.now() - start) / 1000;

console.log(`fen      ${fen}`);
console.log(`depth    ${String(depth)}`);
console.log(`nodes    ${nodes.toLocaleString('en-US')}`);
console.log(`time     ${seconds.toFixed(2)} s`);
console.log(`speed    ${Math.round(nodes / seconds).toLocaleString('en-US')} nodes/s`);
