import type { Part, PartKind } from './engine';

/** Circuit as drawn on the grid. Coordinates are in grid cells. */

export type ElementKind = Exclude<PartKind, 'wire'>;
export type Rotation = 0 | 1 | 2 | 3;

export interface Point {
  x: number;
  y: number;
}

/** A two-terminal component centred on (x, y), with its terminals one cell either side. */
export interface Element {
  id: string;
  kind: ElementKind;
  name: string;
  x: number;
  y: number;
  rot: Rotation;
  value?: number;
  closed?: boolean;
  vf?: number;
  burnt?: boolean;
  rated?: number;
}

export interface Wire {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Circuit {
  elements: Element[];
  wires: Wire[];
}

export const KINDS: ElementKind[] = ['battery', 'resistor', 'lamp', 'led', 'switch', 'ammeter', 'voltmeter'];

export const LABELS: Record<ElementKind, string> = {
  battery: 'Pilha',
  resistor: 'Resistência',
  lamp: 'Lâmpada',
  led: 'LED',
  switch: 'Interruptor',
  ammeter: 'Amperímetro',
  voltmeter: 'Voltímetro',
};

const PREFIX: Record<ElementKind, string> = {
  battery: 'E',
  resistor: 'R',
  lamp: 'L',
  led: 'D',
  switch: 'S',
  ammeter: 'A',
  voltmeter: 'V',
};

const DEFAULTS: Record<ElementKind, Partial<Element>> = {
  battery: { value: 9 },
  resistor: { value: 100 },
  lamp: { value: 30, rated: 9 },
  led: { vf: 1.8 },
  switch: { closed: false },
  ammeter: {},
  voltmeter: {},
};

export const LED_COLORS = [
  { vf: 1.8, name: 'Vermelho', color: '#e5322d' },
  { vf: 2.0, name: 'Amarelo', color: '#f2b705' },
  { vf: 2.2, name: 'Verde', color: '#2bb24c' },
  { vf: 3.0, name: 'Azul', color: '#2f6fe4' },
];

export function ledColor(vf = 1.8): string {
  return LED_COLORS.find((c) => c.vf === vf)?.color ?? LED_COLORS[0].color;
}

export const empty = (): Circuit => ({ elements: [], wires: [] });

let counter = 0;
export function newId(): string {
  counter++;
  return `${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

const DIRS: Point[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];

export function terminals(e: Element): [Point, Point] {
  const d = DIRS[e.rot];
  return [
    { x: e.x - d.x, y: e.y - d.y },
    { x: e.x + d.x, y: e.y + d.y },
  ];
}

export const key = (p: Point) => `${p.x},${p.y}`;
const same = (p: Point, q: Point) => p.x === q.x && p.y === q.y;

export function nextName(c: Circuit, kind: ElementKind): string {
  const names = new Set(c.elements.map((e) => e.name));
  let n = 1;
  while (names.has(PREFIX[kind] + n)) n++;
  return PREFIX[kind] + n;
}

export function createElement(c: Circuit, kind: ElementKind, x: number, y: number, rot: Rotation = 0): Element {
  return { id: newId(), kind, name: nextName(c, kind), x, y, rot, ...DEFAULTS[kind] };
}

/** Netlist for the engine: each grid point is a node. */
export function toParts(c: Circuit): Part[] {
  const parts: Part[] = c.elements.map((e) => {
    const [a, b] = terminals(e);
    return {
      id: e.id,
      kind: e.kind,
      a: key(a),
      b: key(b),
      value: e.value,
      closed: e.closed,
      vf: e.vf,
      burnt: e.burnt,
      rated: e.rated,
    };
  });
  for (const w of c.wires) {
    parts.push({
      id: w.id,
      kind: 'wire',
      a: key({ x: w.x1, y: w.y1 }),
      b: key({ x: w.x2, y: w.y2 }),
      length: Math.hypot(w.x2 - w.x1, w.y2 - w.y1),
    });
  }
  return parts;
}

export function update(c: Circuit, id: string, change: Partial<Element>): Circuit {
  return { ...c, elements: c.elements.map((e) => (e.id === id ? { ...e, ...change } : e)) };
}

export function remove(c: Circuit, id: string): Circuit {
  return {
    elements: c.elements.filter((e) => e.id !== id),
    wires: c.wires.filter((w) => w.id !== id),
  };
}

/** Moves wire endpoints sitting on `from[i]` to `to[i]`, so wires stay attached. */
function dragWires(wires: Wire[], from: Point[], to: Point[]): Wire[] {
  return wires.map((w) => {
    let { x1, y1, x2, y2 } = w;
    from.forEach((f, i) => {
      if (x1 === f.x && y1 === f.y) ({ x: x1, y: y1 } = to[i]);
      if (x2 === f.x && y2 === f.y) ({ x: x2, y: y2 } = to[i]);
    });
    return x1 === w.x1 && y1 === w.y1 && x2 === w.x2 && y2 === w.y2 ? w : { ...w, x1, y1, x2, y2 };
  });
}

/** Moves an element; wires attached to its terminals follow. */
export function move(c: Circuit, id: string, x: number, y: number): Circuit {
  const e = c.elements.find((el) => el.id === id);
  if (!e || (e.x === x && e.y === y)) return c;
  const moved = { ...e, x, y };
  return {
    elements: c.elements.map((el) => (el.id === id ? moved : el)),
    wires: dragWires(c.wires, terminals(e), terminals(moved)),
  };
}

/** Rotates an element 90° clockwise around its centre; attached wires follow. */
export function rotate(c: Circuit, id: string): Circuit {
  const e = c.elements.find((el) => el.id === id);
  if (!e) return c;
  const turned = { ...e, rot: ((e.rot + 1) % 4) as Rotation };
  return normalize({
    elements: c.elements.map((el) => (el.id === id ? turned : el)),
    wires: dragWires(c.wires, terminals(e), terminals(turned)),
  });
}

/** Adds a wire from p to q, as one straight segment or an L (horizontal first). */
export function addWire(c: Circuit, p: Point, q: Point): Circuit {
  if (same(p, q)) return c;
  const wires = [...c.wires];
  if (p.x === q.x || p.y === q.y) {
    wires.push({ id: newId(), x1: p.x, y1: p.y, x2: q.x, y2: q.y });
  } else {
    wires.push({ id: newId(), x1: p.x, y1: p.y, x2: q.x, y2: p.y });
    wires.push({ id: newId(), x1: q.x, y1: p.y, x2: q.x, y2: q.y });
  }
  return normalize({ ...c, wires });
}

/** Grid points strictly inside the segment, in order from (x1, y1). */
function interiorPoints(w: Wire): Point[] {
  const dx = w.x2 - w.x1;
  const dy = w.y2 - w.y1;
  const steps = gcd(Math.abs(dx), Math.abs(dy));
  const out: Point[] = [];
  for (let k = 1; k < steps; k++) out.push({ x: w.x1 + (dx / steps) * k, y: w.y1 + (dy / steps) * k });
  return out;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * Splits wires at every terminal or wire end that lies on them, so those
 * points become connections, and drops empty and duplicated wires.
 * Wires that merely cross each other stay unconnected.
 */
export function normalize(c: Circuit): Circuit {
  const anchors = new Set<string>();
  for (const e of c.elements) for (const t of terminals(e)) anchors.add(key(t));
  for (const w of c.wires) {
    anchors.add(key({ x: w.x1, y: w.y1 }));
    anchors.add(key({ x: w.x2, y: w.y2 }));
  }

  const wires: Wire[] = [];
  const seen = new Set<string>();
  const push = (w: Wire) => {
    if (w.x1 === w.x2 && w.y1 === w.y2) return;
    const ends = [key({ x: w.x1, y: w.y1 }), key({ x: w.x2, y: w.y2 })].sort().join('|');
    if (seen.has(ends)) return;
    seen.add(ends);
    wires.push(w);
  };

  for (const w of c.wires) {
    const cuts = interiorPoints(w).filter((p) => anchors.has(key(p)));
    if (cuts.length === 0) {
      push(w);
      continue;
    }
    let start: Point = { x: w.x1, y: w.y1 };
    cuts.forEach((p, k) => {
      push({ id: k === 0 ? w.id : newId(), x1: start.x, y1: start.y, x2: p.x, y2: p.y });
      start = p;
    });
    push({ id: newId(), x1: start.x, y1: start.y, x2: w.x2, y2: w.y2 });
  }
  return { elements: c.elements, wires };
}

/** Points where three or more wire ends or terminals meet. */
export function junctions(c: Circuit): Point[] {
  const count = new Map<string, number>();
  const add = (p: Point) => count.set(key(p), (count.get(key(p)) ?? 0) + 1);
  for (const e of c.elements) terminals(e).forEach(add);
  for (const w of c.wires) {
    add({ x: w.x1, y: w.y1 });
    add({ x: w.x2, y: w.y2 });
  }
  return [...count].filter(([, n]) => n >= 3).map(([k]) => {
    const [x, y] = k.split(',').map(Number);
    return { x, y };
  });
}

export function bounds(c: Circuit): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const e of c.elements) {
    for (const t of terminals(e)) {
      xs.push(t.x);
      ys.push(t.y);
    }
  }
  for (const w of c.wires) {
    xs.push(w.x1, w.x2);
    ys.push(w.y1, w.y2);
  }
  if (xs.length === 0) return null;
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** A grid point near `p` where a new horizontal element does not overlap anything. */
export function freeSpot(c: Circuit, p: Point): Point {
  const used = new Set<string>();
  for (const e of c.elements) {
    used.add(key(e));
    for (const t of terminals(e)) used.add(key(t));
  }
  for (const w of c.wires) for (const q of [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }, ...interiorPoints(w)]) used.add(key(q));
  const fits = (q: Point) =>
    [-2, -1, 0, 1, 2].every((dx) => [-1, 0, 1].every((dy) => !used.has(key({ x: q.x + dx, y: q.y + dy }))));
  for (let r = 0; r < 30; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const q = { x: p.x + dx, y: p.y + dy };
        if (fits(q)) return q;
      }
    }
  }
  return p;
}
