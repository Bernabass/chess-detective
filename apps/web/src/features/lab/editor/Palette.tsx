import { Icon } from '../../../components/Icon';
import { PieceIcon, type PieceColor, type PieceRole } from '../../../components/PieceIcon';
import { pieceName, type Armed, type PaletteItem } from './pieces';

const ROLES: PieceRole[] = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];

/**
 * The editor's piece palette. Drag a piece onto the board, or click it to arm "click-to-place"
 * and then click (or press Enter on) squares; the eraser removes pieces the same way.
 */
export function Palette({
  armed,
  onArm,
  onDragStart,
}: {
  armed: Armed;
  onArm: (a: Armed) => void;
  onDragStart: (item: PaletteItem, event: PointerEvent) => void;
}) {
  const isArmed = (item: PaletteItem): boolean =>
    armed !== null && armed !== 'eraser' && armed.role === item.role && armed.color === item.color;

  const row = (color: PieceColor) => (
    <div className="grid grid-cols-6 gap-1">
      {ROLES.map((role) => {
        const item = { role, color };
        const active = isArmed(item);
        return (
          <button
            key={role}
            type="button"
            aria-pressed={active}
            data-palette
            aria-label={`Place ${pieceName(item)}`}
            title={`${pieceName(item)}: drag onto the board, or click to place by clicking squares`}
            onPointerDown={(e) => {
              if (e.pointerType === 'mouse' && e.button !== 0) return;
              onDragStart(item, e.nativeEvent);
            }}
            onClick={() => {
              onArm(active ? null : item);
            }}
            className={`aspect-square touch-none rounded-md border p-0.5 transition ${
              active
                ? 'border-accent ring-2 ring-accent'
                : 'border-card-edge hover:border-accent/50'
            } bg-[var(--sq-light)]`}
          >
            <PieceIcon role={role} color={color} />
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-1">
      {row('white')}
      {row('black')}
      <button
        type="button"
        aria-pressed={armed === 'eraser'}
        data-palette
        onClick={() => {
          onArm(armed === 'eraser' ? null : 'eraser');
        }}
        className={`flex w-full items-center justify-center gap-2 rounded-md border px-2 py-1.5 text-sm transition ${
          armed === 'eraser'
            ? 'border-accent bg-accent/15'
            : 'border-card-edge bg-paper hover:border-accent/50'
        }`}
      >
        <Icon name="eraser" className="h-4 w-4" />
        Eraser
      </button>
    </div>
  );
}
