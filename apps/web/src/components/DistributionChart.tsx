/**
 * A player's guess distribution (SPEC §8.5): how many solves took 1..6 guesses, and how many
 * attempts failed. One series in one hue (the "right move" green, validated against both card
 * surfaces), labelled by category on the left and by value at the bar's end in ink, never in
 * the bar colour. Screen readers get the same numbers as a table.
 */
export function DistributionChart({ counts }: { counts: readonly number[] }) {
  const rows = counts.slice(0, 7).map((n, i) => ({
    label: i < 6 ? String(i + 1) : 'Failed',
    name: i < 6 ? `Solved in ${String(i + 1)} guess${i === 0 ? '' : 'es'}` : 'Failed',
    n,
  }));
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <figure>
      <figcaption className="sr-only">Guess distribution</figcaption>
      <table className="sr-only">
        <thead>
          <tr>
            <th scope="col">Result</th>
            <th scope="col">Puzzles</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.name}</th>
              <td>{r.n}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div aria-hidden="true" className="space-y-[2px]" data-testid="distribution">
        {rows.map((r) => (
          <div
            key={r.label}
            title={`${r.name}: ${String(r.n)}`}
            className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-2 rounded hover:bg-card-edge/40"
          >
            <span className="text-right font-mono text-xs text-ink-soft">{r.label}</span>
            <span className="flex items-center gap-2">
              <span
                className={`h-5 rounded-r-[4px] ${r.n === 0 ? 'w-[2px] bg-card-edge' : 'bg-hit'}`}
                style={r.n === 0 ? undefined : { width: `max(4px, ${String((r.n / max) * 85)}%)` }}
              />
              <span className="font-mono text-xs text-ink">{r.n}</span>
            </span>
          </div>
        ))}
      </div>
    </figure>
  );
}
