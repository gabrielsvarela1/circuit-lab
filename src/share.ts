import { type Circuit, type Element, type ElementKind, KINDS, newId, type Rotation } from './model';

/**
 * Compact text form of a circuit, used in the URL and in localStorage:
 * { e: [[kind, name, x, y, rot, value, extra]], w: [[x1, y1, x2, y2]] }
 * where extra is the switch state, the LED forward voltage or the lamp rating.
 */
type Row = [number, string, number, number, number, number | null, number | null];

export function encode(c: Circuit): string {
  const e: Row[] = c.elements.map((el) => [
    KINDS.indexOf(el.kind),
    el.name,
    el.x,
    el.y,
    el.rot,
    el.value ?? null,
    el.kind === 'switch' ? (el.closed ? 1 : 0) : el.kind === 'led' ? el.vf ?? null : el.kind === 'lamp' ? el.rated ?? null : null,
  ]);
  const w = c.wires.map((wi) => [wi.x1, wi.y1, wi.x2, wi.y2]);
  return toBase64Url(JSON.stringify({ e, w }));
}

/** Returns null if the text is not a valid circuit. */
export function decode(text: string): Circuit | null {
  try {
    const data = JSON.parse(fromBase64Url(text));
    const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
    const elements: Element[] = [];
    for (const row of data.e ?? []) {
      const [k, name, x, y, rot, value, extra] = row as Row;
      const kind: ElementKind | undefined = KINDS[k];
      if (!kind || typeof name !== 'string' || !num(x) || !num(y) || ![0, 1, 2, 3].includes(rot)) continue;
      const el: Element = { id: newId(), kind, name: name.slice(0, 8), x, y, rot: rot as Rotation };
      if (num(value)) el.value = value!;
      if (kind === 'switch') el.closed = extra === 1;
      if (kind === 'led') el.vf = num(extra) ? extra! : 1.8;
      if (kind === 'lamp' && num(extra)) el.rated = extra!;
      elements.push(el);
    }
    const wires = [];
    for (const row of data.w ?? []) {
      if (!Array.isArray(row) || row.length !== 4 || !row.every(num)) continue;
      const [x1, y1, x2, y2] = row;
      wires.push({ id: newId(), x1, y1, x2, y2 });
    }
    return { elements, wires };
  } catch {
    return null;
  }
}

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

const STORAGE_KEY = 'circuit-lab';

export function save(c: Circuit): void {
  try {
    localStorage.setItem(STORAGE_KEY, encode(c));
  } catch {
    // Storage may be full or blocked; the circuit still lives in memory.
  }
}

export function load(): Circuit | null {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    return text ? decode(text) : null;
  } catch {
    return null;
  }
}

export function shareUrl(c: Circuit): string {
  const url = new URL(location.href);
  url.hash = 'c=' + encode(c);
  return url.toString();
}

export function fromUrl(): Circuit | null {
  const match = location.hash.match(/^#c=([\w-]+)$/);
  return match ? decode(match[1]) : null;
}
