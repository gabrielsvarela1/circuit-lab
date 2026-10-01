import type { SolveResult } from '../engine';
import { formatSI } from '../format';
import {
  addWire,
  bounds,
  type Circuit,
  type Element,
  junctions,
  key,
  move,
  normalize,
  type Point,
  terminals,
} from '../model';
import { labelPos, meterLetter, symbol, transform, U } from './symbols';

export interface View {
  circuit: Circuit;
  result: SolveResult | null;
  selected: string | null;
  /** False during exercises: readings stay hidden until the answer is checked. */
  showValues: boolean;
}

export interface BoardHost {
  /** Temporary change while dragging (no undo step). */
  preview(c: Circuit): void;
  commit(c: Circuit): void;
  select(id: string | null): void;
  toggle(id: string): void;
}

type Gesture =
  | { type: 'none' }
  | { type: 'press-element'; id: string; start: Point; origin: Circuit; grab: Point }
  | { type: 'drag-element'; id: string; origin: Circuit; grab: Point }
  | { type: 'press-empty'; start: Point; from: Point; wire: string | null }
  | { type: 'wire'; from: Point; to: Point }
  | { type: 'pan'; last: Point }
  | { type: 'pinch'; dist: number; scale: number; world: Point };
const MIN_SCALE = 0.35;
const MAX_SCALE = 2.5;

export class Board {
  readonly svg: SVGSVGElement;
  private world: SVGGElement;
  private layers: Record<'wires' | 'elements' | 'marks' | 'labels' | 'overlay', SVGGElement>;
  private camera = { x: 0, y: 0, scale: 1 };
  private pointers = new Map<number, Point>();
  private gesture: Gesture = { type: 'none' };
  private view: View | null = null;

  constructor(
    svg: SVGSVGElement,
    private host: BoardHost,
  ) {
    this.svg = svg;
    svg.innerHTML = `
      <defs>
        <pattern id="grid" width="${U}" height="${U}" patternUnits="userSpaceOnUse" x="${-U / 2}" y="${-U / 2}">
          <circle cx="${U / 2}" cy="${U / 2}" r="1.6" class="grid-dot"/>
        </pattern>
      </defs>
      <g class="world">
        <rect class="grid" x="-200000" y="-200000" width="400000" height="400000" fill="url(#grid)"/>
        <g class="wires"></g><g class="elements"></g><g class="marks"></g><g class="labels"></g><g class="overlay"></g>
      </g>`;
    this.world = svg.querySelector('.world')!;
    const layer = (name: string) => svg.querySelector<SVGGElement>(`.${name}`)!;
    this.layers = {
      wires: layer('wires'),
      elements: layer('elements'),
      marks: layer('marks'),
      labels: layer('labels'),
      overlay: layer('overlay'),
    };

    svg.addEventListener('pointerdown', (e) => this.down(e));
    svg.addEventListener('pointermove', (e) => this.moveEvent(e));
    svg.addEventListener('pointerup', (e) => this.up(e));
    svg.addEventListener('pointercancel', (e) => this.cancel(e));
    svg.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    svg.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // Camera -----------------------------------------------------------------

  private applyCamera(): void {
    const { x, y, scale } = this.camera;
    this.world.setAttribute('transform', `translate(${x} ${y}) scale(${scale})`);
  }

  /** Client (screen) coordinates to world coordinates. */
  toWorld(clientX: number, clientY: number): Point {
    const r = this.svg.getBoundingClientRect();
    return {
      x: (clientX - r.left - this.camera.x) / this.camera.scale,
      y: (clientY - r.top - this.camera.y) / this.camera.scale,
    };
  }

  /** Nearest grid point to a client position. */
  toGrid(clientX: number, clientY: number): Point {
    const w = this.toWorld(clientX, clientY);
    return { x: Math.round(w.x / U), y: Math.round(w.y / U) };
  }

  /** Client coordinates of a grid point. */
  toClient(p: Point): Point {
    const r = this.svg.getBoundingClientRect();
    return {
      x: r.left + this.camera.x + p.x * U * this.camera.scale,
      y: r.top + this.camera.y + p.y * U * this.camera.scale,
    };
  }

  contains(clientX: number, clientY: number): boolean {
    const r = this.svg.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }

  /** Grid point at the centre of the visible area. */
  centre(): Point {
    const r = this.svg.getBoundingClientRect();
    return this.toGrid(r.left + r.width / 2, r.top + r.height / 2);
  }

  zoom(factor: number, clientX?: number, clientY?: number): void {
    const r = this.svg.getBoundingClientRect();
    const cx = clientX ?? r.left + r.width / 2;
    const cy = clientY ?? r.top + r.height / 2;
    const before = this.toWorld(cx, cy);
    this.camera.scale = clamp(this.camera.scale * factor, MIN_SCALE, MAX_SCALE);
    this.camera.x = cx - r.left - before.x * this.camera.scale;
    this.camera.y = cy - r.top - before.y * this.camera.scale;
    this.applyCamera();
  }

  /** Fits the circuit (or an empty area around the origin) in view. */
  fit(c: Circuit): void {
    const r = this.svg.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const b = bounds(c) ?? { minX: -4, minY: -3, maxX: 4, maxY: 3 };
    const margin = 1.5;
    const w = (b.maxX - b.minX + 2 * margin) * U;
    const h = (b.maxY - b.minY + 2 * margin) * U;
    const scale = clamp(Math.min(r.width / w, r.height / h), MIN_SCALE, 1.4);
    this.camera.scale = scale;
    this.camera.x = r.width / 2 - ((b.minX + b.maxX) / 2) * U * scale;
    this.camera.y = r.height / 2 - ((b.minY + b.maxY) / 2) * U * scale;
    this.applyCamera();
  }

  // Rendering --------------------------------------------------------------

  render(view: View): void {
    this.view = view;
    const { circuit, result, selected, showValues } = view;
    const parts = result?.parts;
    const shortLoop = new Set(result?.status === 'short' ? result.shortLoop : []);

    let wires = '';
    for (const w of circuit.wires) {
      const cls = ['wire', w.id === selected ? 'selected' : '', shortLoop.has(w.id) ? 'short' : ''].join(' ');
      const [x1, y1, x2, y2] = [w.x1 * U, w.y1 * U, w.x2 * U, w.y2 * U];
      wires += `<g data-wire="${w.id}">
        <line class="${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>
        <line class="flow" data-flow="${w.id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>
        <line class="hit" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>
      </g>`;
    }
    this.layers.wires.innerHTML = wires;

    let elements = '';
    let labels = '';
    for (const e of circuit.elements) {
      const glow = view.result && e.kind !== 'battery' ? this.glowOf(e) : 0;
      const cls = ['element', e.kind, e.id === selected ? 'selected' : '', shortLoop.has(e.id) ? 'short' : ''].join(' ');
      elements += `<g class="${cls}" data-id="${e.id}" transform="${transform(e)}">
        ${symbol(e.kind, { glow, closed: e.closed, vf: e.vf, burnt: e.burnt })}
        <rect class="hit" x="-28" y="-20" width="56" height="40"/>
      </g>`;
      const letter = meterLetter(e.kind);
      if (letter) elements += `<text class="meter-letter" x="${e.x * U}" y="${e.y * U + 5}">${letter}</text>`;

      const top = labelPos(e, -1);
      const value = valueText(e);
      labels +=
        e.rot % 2 === 0
          ? `<text class="label" x="${top.x}" y="${top.y}" text-anchor="middle">${e.name}${value ? ' · ' + value : ''}</text>`
          : `<text class="label" x="${top.x}" y="${top.y - (value ? 8 : 0)}" text-anchor="${top.anchor}">${e.name}` +
            (value ? `<tspan x="${top.x}" dy="16">${value}</tspan>` : '') +
            '</text>';
      const r = parts?.get(e.id);
      if ((e.kind === 'ammeter' || e.kind === 'voltmeter') && r) {
        const valid = result?.status !== 'short' && result?.status !== 'error';
        const reading = !showValues ? '?' : !valid ? '—' : e.kind === 'ammeter' ? formatSI(r.i, 'A') : formatSI(r.v, 'V');
        const bottom = labelPos(e, 1);
        labels += `<text class="reading" data-reading="${e.id}" x="${bottom.x}" y="${bottom.y}" text-anchor="${bottom.anchor}">${reading}</text>`;
      }
    }
    this.layers.elements.innerHTML = elements;
    this.layers.labels.innerHTML = labels;

    // Junction dots and unconnected terminals.
    let marks = '';
    for (const p of junctions(circuit)) marks += `<circle class="junction" cx="${p.x * U}" cy="${p.y * U}" r="4.5"/>`;
    const count = new Map<string, number>();
    const bump = (p: Point) => count.set(key(p), (count.get(key(p)) ?? 0) + 1);
    for (const e of circuit.elements) terminals(e).forEach(bump);
    for (const w of circuit.wires) [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }].forEach(bump);
    for (const e of circuit.elements) {
      for (const t of terminals(e)) {
        if (count.get(key(t)) === 1) marks += `<circle class="terminal" cx="${t.x * U}" cy="${t.y * U}" r="3.5"/>`;
      }
    }
    this.layers.marks.innerHTML = marks;
    this.applyCamera();
  }

  private glowOf(e: Element): number {
    const r = this.view?.result?.parts.get(e.id);
    if (!r || !this.view?.showValues) return 0;
    if (e.kind === 'led') return e.burnt ? 0 : Math.min(1, Math.max(0, r.i / 0.02));
    if (e.kind === 'lamp' && e.value) return Math.min(1, Math.abs(r.i) / ((e.rated ?? 6) / e.value));
    return 0;
  }

  // Pointer handling -------------------------------------------------------

  private down(e: PointerEvent): void {
    if (!this.view) return;
    this.svg.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pointers.size === 2) {
      this.abortGesture();
      const [p, q] = [...this.pointers.values()];
      const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      this.gesture = { type: 'pinch', dist: dist(p, q), scale: this.camera.scale, world: this.toWorld(mid.x, mid.y) };
      return;
    }
    if (this.pointers.size > 2) return;

    if (e.button === 1 || e.button === 2) {
      this.gesture = { type: 'pan', last: { x: e.clientX, y: e.clientY } };
      return;
    }

    const target = e.target as globalThis.Element;
    const el = target.closest('[data-id]');
    const start = { x: e.clientX, y: e.clientY };
    if (el) {
      const id = el.getAttribute('data-id')!;
      const item = this.view.circuit.elements.find((x) => x.id === id)!;
      const w = this.toWorld(e.clientX, e.clientY);
      this.gesture = {
        type: 'press-element',
        id,
        start,
        origin: this.view.circuit,
        grab: { x: w.x - item.x * U, y: w.y - item.y * U },
      };
      return;
    }
    const wire = target.closest('[data-wire]');
    this.gesture = {
      type: 'press-empty',
      start,
      from: this.toGrid(e.clientX, e.clientY),
      wire: wire ? wire.getAttribute('data-wire') : null,
    };
  }

  private moveEvent(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) return;
    const prev = this.pointers.get(e.pointerId)!;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = this.gesture;
    const threshold = e.pointerType === 'mouse' ? 4 : 8;

    switch (g.type) {
      case 'pinch': {
        const [p, q] = [...this.pointers.values()];
        const r = this.svg.getBoundingClientRect();
        const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
        this.camera.scale = clamp((g.scale * dist(p, q)) / g.dist, MIN_SCALE, MAX_SCALE);
        this.camera.x = mid.x - r.left - g.world.x * this.camera.scale;
        this.camera.y = mid.y - r.top - g.world.y * this.camera.scale;
        this.applyCamera();
        break;
      }
      case 'pan':
        this.camera.x += e.clientX - prev.x;
        this.camera.y += e.clientY - prev.y;
        this.applyCamera();
        break;
      case 'press-element':
        if (dist(g.start, { x: e.clientX, y: e.clientY }) > threshold) {
          this.gesture = { type: 'drag-element', id: g.id, origin: g.origin, grab: g.grab };
          this.dragTo(e);
        }
        break;
      case 'drag-element':
        this.dragTo(e);
        break;
      case 'press-empty':
        if (dist(g.start, { x: e.clientX, y: e.clientY }) > threshold) {
          this.gesture = { type: 'wire', from: g.from, to: this.toGrid(e.clientX, e.clientY) };
          this.drawWirePreview();
        }
        break;
      case 'wire':
        g.to = this.toGrid(e.clientX, e.clientY);
        this.drawWirePreview();
        break;
    }
  }

  private dragTo(e: PointerEvent): void {
    const g = this.gesture;
    if (g.type !== 'drag-element') return;
    const w = this.toWorld(e.clientX, e.clientY);
    const x = Math.round((w.x - g.grab.x) / U);
    const y = Math.round((w.y - g.grab.y) / U);
    this.host.preview(move(g.origin, g.id, x, y));
  }

  private drawWirePreview(): void {
    const g = this.gesture;
    if (g.type !== 'wire') return;
    const { from: p, to: q } = g;
    const pts = p.x === q.x || p.y === q.y ? [p, q] : [p, { x: q.x, y: p.y }, q];
    const d = pts.map((pt, i) => `${i ? 'L' : 'M'}${pt.x * U} ${pt.y * U}`).join(' ');
    this.layers.overlay.innerHTML = `<path class="wire-preview" d="${d}"/>
      <circle class="wire-end" cx="${p.x * U}" cy="${p.y * U}" r="5"/>
      <circle class="wire-end" cx="${q.x * U}" cy="${q.y * U}" r="5"/>`;
  }

  private up(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (g.type === 'pinch') {
      // Wait for every finger to lift before starting a new gesture.
      if (this.pointers.size === 0) this.gesture = { type: 'none' };
      return;
    }
    this.gesture = { type: 'none' };
    this.layers.overlay.innerHTML = '';
    if (!this.view) return;

    switch (g.type) {
      case 'press-element': {
        this.host.select(g.id);
        const item = this.view.circuit.elements.find((x) => x.id === g.id);
        if (item?.kind === 'switch') this.host.toggle(g.id);
        break;
      }
      case 'drag-element': {
        const moved = this.view.circuit;
        const a = g.origin.elements.find((x) => x.id === g.id);
        const b = moved.elements.find((x) => x.id === g.id);
        if (a && b && (a.x !== b.x || a.y !== b.y)) {
          this.host.preview(g.origin);
          this.host.commit(normalize(moved));
        } else {
          this.host.preview(g.origin);
        }
        this.host.select(g.id);
        break;
      }
      case 'press-empty':
        this.host.select(g.wire);
        break;
      case 'wire':
        if (g.from.x !== g.to.x || g.from.y !== g.to.y) this.host.commit(addWire(this.view.circuit, g.from, g.to));
        break;
    }
  }

  private cancel(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    this.abortGesture();
    this.gesture = { type: 'none' };
  }

  /** Undoes the visual effect of an unfinished gesture. */
  private abortGesture(): void {
    const g = this.gesture;
    if (g.type === 'drag-element' || g.type === 'press-element') this.host.preview(g.origin);
    this.layers.overlay.innerHTML = '';
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
      this.zoom(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX, e.clientY);
    } else {
      this.camera.x -= e.deltaX;
      this.applyCamera();
    }
  }

  /** Flow lines for the current animation (phase 3 uses them). */
  flowLines(): NodeListOf<SVGLineElement> {
    return this.layers.wires.querySelectorAll<SVGLineElement>('line.flow');
  }
}

function valueText(e: Element): string {
  if (e.kind === 'battery' && e.value !== undefined) return formatSI(e.value, 'V');
  if ((e.kind === 'resistor' || e.kind === 'lamp') && e.value !== undefined) return formatSI(e.value, 'Ω');
  return '';
}

function dist(p: Point, q: Point): number {
  return Math.hypot(p.x - q.x, p.y - q.y);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
