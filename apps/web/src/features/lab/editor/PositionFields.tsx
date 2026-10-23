import { normalizeCastling, type LabFields } from '../labState';

const CASTLING = [
  { right: 'K', label: 'White O-O' },
  { right: 'Q', label: 'White O-O-O' },
  { right: 'k', label: 'Black O-O' },
  { right: 'q', label: 'Black O-O-O' },
] as const;

/** Side to move, castling rights and en passant square (SPEC §9.1). */
export function PositionFields({
  fields,
  onChange,
}: {
  fields: LabFields;
  onChange: (f: LabFields) => void;
}) {
  // The en passant square is behind a pawn that just double-pushed: rank 6 if White is to move.
  const epRank = fields.side === 'w' ? '6' : '3';
  const epOptions = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((f) => `${f}${epRank}`);
  // A pasted FEN may state a square on the other rank; keep it selectable (the analysis says why
  // it's wrong).
  if (fields.enPassant !== '' && !epOptions.includes(fields.enPassant))
    epOptions.unshift(fields.enPassant);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <fieldset>
        <legend className="mb-1 text-sm font-medium">Side to move</legend>
        <div className="inline-flex rounded-md border border-card-edge bg-paper p-0.5">
          {(['w', 'b'] as const).map((side) => (
            <label
              key={side}
              className={`cursor-pointer rounded px-3 py-1 text-sm has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-focus ${
                fields.side === side ? 'bg-card font-semibold shadow-sm' : 'text-ink-soft'
              }`}
            >
              <input
                type="radio"
                name="side-to-move"
                value={side}
                checked={fields.side === side}
                onChange={() => {
                  onChange({ ...fields, side, enPassant: '' });
                }}
                className="sr-only"
              />
              {side === 'w' ? 'White' : 'Black'}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="sm:order-last sm:col-span-2">
        <legend className="mb-1 text-sm font-medium">Castling rights</legend>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm whitespace-nowrap">
          {CASTLING.map((c) => (
            <label key={c.right} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={fields.castling.includes(c.right)}
                onChange={(e) => {
                  const rights = e.target.checked
                    ? fields.castling + c.right
                    : fields.castling.replace(c.right, '');
                  onChange({ ...fields, castling: normalizeCastling(rights) });
                }}
                className="accent-accent"
              />
              {c.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="en-passant" className="mb-1 block text-sm font-medium">
          En passant square
        </label>
        <select
          id="en-passant"
          value={fields.enPassant}
          onChange={(e) => {
            onChange({ ...fields, enPassant: e.target.value });
          }}
          className="w-full rounded-md border border-card-edge bg-paper px-2 py-1.5 text-sm"
        >
          <option value="">None</option>
          {epOptions.map((sq) => (
            <option key={sq} value={sq}>
              {sq}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
