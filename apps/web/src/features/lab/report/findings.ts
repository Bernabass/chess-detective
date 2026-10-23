import type { Finding } from '@retrograde/engine';

export interface Highlight {
  squares: string[];
  arrows: [string, string][];
}

export interface NoteGroup {
  rule: string;
  severity: Finding['severity'];
  messages: string[];
  squares: string[];
  arrows: [string, string][];
}

/**
 * Findings grouped by rule, in first-seen order: four "can no longer castle" findings become one
 * note with four lines. Contradictions come first.
 */
export function groupFindings(findings: readonly Finding[]): NoteGroup[] {
  const groups = new Map<string, NoteGroup>();
  for (const f of findings) {
    const g = groups.get(f.rule) ?? {
      rule: f.rule,
      severity: f.severity,
      messages: [],
      squares: [],
      arrows: [],
    };
    groups.set(f.rule, g);
    if (!g.messages.includes(f.message)) g.messages.push(f.message);
    for (const sq of f.squares) if (!g.squares.includes(sq)) g.squares.push(sq);
    for (const a of f.arrows ?? []) {
      if (!g.arrows.some(([x, y]) => x === a[0] && y === a[1])) g.arrows.push([a[0], a[1]]);
    }
  }
  const all = [...groups.values()];
  return [
    ...all.filter((g) => g.severity === 'illegal'),
    ...all.filter((g) => g.severity !== 'illegal'),
  ];
}
