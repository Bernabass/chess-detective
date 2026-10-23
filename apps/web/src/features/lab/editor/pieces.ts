import type { PieceColor, PieceRole } from '../../../components/PieceIcon';

export interface PaletteItem {
  role: PieceRole;
  color: PieceColor;
}

/** What the palette has armed for click-to-place: a piece, the eraser, or nothing. */
export type Armed = PaletteItem | 'eraser' | null;

export function pieceName(p: PaletteItem): string {
  return `${p.color} ${p.role}`;
}
