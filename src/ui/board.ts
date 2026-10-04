import type { SolveResult } from '../engine';
import { formatSI } from '../format';
import {
  addWire,
  bounds,
  type Circuit,
  type Element,
  itemAt,
  junctions,
  key,
  LABELS,
  move,
  moveWireEnd,
  normalize,
  type Point,
  terminals,
} from '../model';
import { glowStyle, labelPos, meterLetter, symbol, transform, U } from './symbols';

export interface View {
  circuit: Circuit;
  /** Steady-state result: DC values, or RMS values for AC circuits. */
  result: SolveResult | null;
  /** Instantaneous result that drives the animation in AC circuits; null for DC. */
  live: SolveResult | null;
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
  /** Element or wire under the mouse, and the mouse position. */
  hover(id: string | null, at: Point | null): void;
  /** Text for screen readers (keyboard cursor). */
  announce(text: string): void;
}

/** Speed of the current dots in pixels per second per ampere, and the cap. */
const FLOW_SPEED = 3000;
const FLOW_MAX = 400;

interface Flow {
  line: SVGLineElement;
  id: string;
  speed: number;
}

/** What a press landed on, to replay as a tap when a pan gesture does not move. */
interface Tap {
  element: string | null;
  wire: string | null;
}

type Gesture =
  | { type: 'none' }
  | { type: 'press-element'; id: string; start: Point; origin: Circuit; grab: Point }
  | { type: 'drag-element'; id: string; origin: Circuit; grab: Point }
  | { type: 'press-handle'; id: string; end: 1 | 2; start: Point; origin: Circuit }
  | { type: 'drag-handle'; id: string; end: 1 | 2; origin: Circuit }
  | { type: 'press-empty'; start: Point; from: Point; wire: string | null }
  | { type: 'wire'; from: Point; to: Point }
  | { type: 'pan'; last: Point; start: Point; tap: Tap | null }
  | { type: 'pinch'; dist: number; scale: number; world: Point };

const MIN_SCALE = 0.35;
const MAX_SCALE = 2.5;

export class Board {
  readonly svg: SVGSVGElement;
  /** One finger (or the left mouse button) moves the view instead of drawing wires. */
  panMode = false;
  /** Space is held down: the left mouse button moves the view. */
  spaceHeld = false;
  /** True after the board was used with the keyboard, until the next pointer press. */
  keyboardUsed = false;
  private world: SVGGElement;
  private layers: Record<'wires' | 'elements' | 'marks' | 'labels' | 'overlay' | 'cursor', SVGGElement>;
  private camera = { x: 0, y: 0, scale: 1 };
  private pointers = new Map<number, Point>();
  private gesture: Gesture = { type: 'none' };
  private view: View | null = null;
  private flows: Flow[] = [];
  /** Dot offset of each wire, kept across renders so the dots do not jump. */
  private phase = new Map<string, number>();
  private hovered: string | null = null;
  /** Keyboard cursor, and the start of a wire being drawn with the keyboard. */
  cursor: Point = { x: 0, y: 0 };
  private cursorVisible = false;
  private keyWireFrom: Point | null = null;

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
        <g class="wires"></g><g class="elements"></g><g class="marks"></g><g class="labels"></g>
        <g class="overlay"></g><g class="cursor"></g>
      </g>`;
    this.world = svg.querySelector('.world')!;
    const layer = (name: string) => svg.querySelector<SVGGElement>(`.${name}`)!;
    this.layers = {
      wires: layer('wires'),
      elements: layer('elements'),
      marks: layer('marks'),
      labels: layer('labels'),
      overlay: layer('overlay'),
      cursor: layer('cursor'),
    };

    svg.addEventListener('pointerdown', (e) => this.down(e));
    svg.addEventListener('pointermove', (e) => this.moveEvent(e));
    svg.addEventListener('pointerup', (e) => this.up(e));
    svg.addEventListener('pointercancel', (e) => this.cancel(e));
    svg.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    svg.addEventListener('contextmenu', (e) => e.preventDefault());
    svg.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') this.setHover(null, null);
    });
    svg.addEventListener('keydown', (e) => this.key(e));
    svg.addEventListener('focus', () => {
      if (!svg.matches(':focus-visible')) return;
      this.cursorVisible = true;
      this.drawCursor();
      this.announceCursor();
    });
    svg.addEventListener('blur', () => {
      this.cursorVisible = false;
      this.keyWireFrom = null;
      this.drawCursor();
    });
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
    // Wider at the sides, where the labels of vertical parts go.
    const w = (b.maxX - b.minX + 2 * 2.5) * U;
    const h = (b.maxY - b.minY + 2 * 1.5) * U;
    const scale = clamp(Math.min(r.width / w, r.height / h), MIN_SCALE, 1.4);
    this.camera.scale = scale;
    this.camera.x = r.width / 2 - ((b.minX + b.maxX) / 2) * U * scale;
    this.camera.y = r.height / 2 - ((b.minY + b.maxY) / 2) * U * scale;
    this.applyCamera();
  }

  /** Pans just enough to bring a grid point into view. */
  private reveal(p: Point): void {
    const r = this.svg.getBoundingClientRect();
    const c = this.toClient(p);
    const pad = U * this.camera.scale;
    if (c.x < r.left + pad) this.camera.x += r.left + pad - c.x;
    if (c.x > r.right - pad) this.camera.x -= c.x - (r.right - pad);
    if (c.y < r.top + pad) this.camera.y += r.top + pad - c.y;
    if (c.y > r.bottom - pad) this.camera.y -= c.y - (r.bottom - pad);
    this.applyCamera();
  }

  // Rendering --------------------------------------------------------------

  render(view: View): void {
    this.view = view;
    const { circuit, result, selected, showValues } = view;
    const parts = result?.parts;
    const shortLoop = new Set(result?.status === 'short' ? result.shortLoop : []);
    const ac = !!result?.ac;

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

    // Current dots, on every wire while the circuit works; their speed is set in updateLive().
    this.flows = [];
    if (result?.status === 'ok') {
      for (const line of this.layers.wires.querySelectorAll<SVGLineElement>('line.flow')) {
        const id = line.dataset.flow!;
        this.flows.push({ line, id, speed: 0 });
        line.style.strokeDashoffset = String(-(this.phase.get(id) ?? 0));
      }
    }

    let elements = '';
    let labels = '';
    for (const e of circuit.elements) {
      const cls = ['element', e.kind, e.id === selected ? 'selected' : '', shortLoop.has(e.id) ? 'short' : ''].join(' ');
      elements += `<g class="${cls}" data-id="${e.id}" transform="${transform(e)}">
        ${symbol(e.kind, { glow: 0, closed: e.closed, vf: e.vf, burnt: e.burnt })}
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
        const unit = e.kind === 'ammeter' ? 'A' : 'V';
        const reading = !showValues ? '?' : !valid ? '—' : formatSI(e.kind === 'ammeter' ? r.i : r.v, unit) + (ac ? '~' : '');
        const bottom = labelPos(e, 1);
        labels += `<text class="reading" data-reading="${e.id}" x="${bottom.x}" y="${bottom.y}" text-anchor="${bottom.anchor}">${reading}</text>`;
      }
    }
    this.layers.elements.innerHTML = elements;
    this.layers.labels.innerHTML = labels;

    // Junction dots, unconnected terminals and the handles of the selected wire.
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
    const wire = circuit.wires.find((w) => w.id === selected);
    if (wire) {
      marks += `<circle class="handle" data-handle="${wire.id}" data-end="1" cx="${wire.x1 * U}" cy="${wire.y1 * U}" r="8"/>`;
      marks += `<circle class="handle" data-handle="${wire.id}" data-end="2" cx="${wire.x2 * U}" cy="${wire.y2 * U}" r="8"/>`;
    }
    this.layers.marks.innerHTML = marks;
    this.applyCamera();
    this.updateLive(view.live ?? view.result);
    this.drawCursor();
  }

  /**
   * Dot speeds and LED and lamp brightness. Called on render and, in AC
   * circuits, on every animation frame with the instantaneous result.
   */
  updateLive(live: SolveResult | null): void {
    const view = this.view;
    if (!view) return;
    for (const f of this.flows) {
      const i = live?.parts.get(f.id)?.i ?? 0;
      f.speed = Math.sign(i) * Math.min(FLOW_MAX, Math.abs(i) * FLOW_SPEED);
      f.line.classList.toggle('on', Math.abs(i) >= 1e-6);
    }
    for (const e of view.circuit.elements) {
      if (e.kind !== 'led' && e.kind !== 'lamp') continue;
      // LEDs follow the instantaneous current; a lamp's filament averages it, so it uses the RMS value.
      const source = e.kind === 'led' ? live : view.result;
      const r = view.showValues && source?.status === 'ok' ? source.parts.get(e.id) : undefined;
      let glow = 0;
      if (r && !e.burnt) {
        glow = e.kind === 'led' ? r.i / 0.02 : e.value ? Math.abs(r.i) / ((e.rated ?? 6) / e.value) : 0;
        glow = clamp(glow, 0, 1);
      }
      const g = this.layers.elements.querySelector(`[data-id="${e.id}"]`);
      if (!g) continue;
      const look = glowStyle(e.kind, glow, e.vf, e.burnt);
      g.querySelector('.glow')?.setAttribute('opacity', look.glow);
      g.querySelector('.body')?.setAttribute('style', look.body);
    }
  }

  /** Advances the current dots by dt seconds. */
  tick(dt: number): void {
    for (const f of this.flows) {
      const phase = ((this.phase.get(f.id) ?? 0) + f.speed * dt) % 10000;
      this.phase.set(f.id, phase);
      f.line.style.strokeDashoffset = String(-phase);
    }
  }

  // Keyboard ---------------------------------------------------------------

  private drawCursor(): void {
    if (!this.cursorVisible) {
      this.layers.cursor.innerHTML = '';
      return;
    }
    const { x, y } = this.cursor;
    let html = '';
    if (this.keyWireFrom) html += wirePreview(this.keyWireFrom, this.cursor);
    html += `<circle class="kb-cursor" cx="${x * U}" cy="${y * U}" r="11"/>
      <path class="kb-cursor" d="M${x * U - 18} ${y * U} h8 M${x * U + 10} ${y * U} h8 M${x * U} ${y * U - 18} v8 M${x * U} ${y * U + 10} v8"/>`;
    this.layers.cursor.innerHTML = html;
  }

  private announceCursor(): void {
    const c = this.view?.circuit;
    const id = c ? itemAt(c, this.cursor) : null;
    const e = c?.elements.find((x) => x.id === id);
    const what = e ? `${e.name}, ${LABELS[e.kind]}` : id ? 'fio' : 'vazio';
    const wire = this.keyWireFrom ? ' A desenhar um fio: Enter termina, Escape cancela.' : '';
    this.host.announce(`Cursor em ${this.cursor.x}, ${this.cursor.y}: ${what}.${wire}`);
  }

  /**
   * Arrows move the cursor (Shift + arrows move the selected component),
   * Enter starts and ends a wire, Space selects what is under the cursor.
   */
  private key(e: KeyboardEvent): void {
    if (!this.view) return;
    const arrows: Record<string, Point> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    const d = arrows[e.key];
    // Only arrows and Enter bring up the cursor; otherwise Space keeps its pan role.
    if (!this.cursorVisible && !d && e.key !== 'Enter') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    this.keyboardUsed = true;
    if (!this.cursorVisible) {
      this.cursorVisible = true;
      this.cursor = this.centre();
    }
    const circuit = this.view.circuit;
    const selected = circuit.elements.find((x) => x.id === this.view!.selected);

    if (d && e.shiftKey && selected) {
      const moved = normalize(move(circuit, selected.id, selected.x + d.x, selected.y + d.y));
      this.host.commit(moved);
      this.cursor = { x: selected.x + d.x, y: selected.y + d.y };
    } else if (d) {
      this.cursor = { x: this.cursor.x + d.x, y: this.cursor.y + d.y };
    } else if (e.key === 'Enter') {
      if (!this.keyWireFrom) {
        this.keyWireFrom = { ...this.cursor };
      } else {
        const from = this.keyWireFrom;
        this.keyWireFrom = null;
        if (from.x !== this.cursor.x || from.y !== this.cursor.y) this.host.commit(addWire(circuit, from, this.cursor));
      }
    } else if (e.key === ' ') {
      const id = itemAt(circuit, this.cursor);
      this.host.select(id);
      if (id && circuit.elements.find((x) => x.id === id)?.kind === 'switch') this.host.toggle(id);
    } else if (e.key === 'Escape' && this.keyWireFrom) {
      this.keyWireFrom = null;
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    this.reveal(this.cursor);
    this.drawCursor();
    this.announceCursor();
  }

  // Pointer handling -------------------------------------------------------

  private down(e: PointerEvent): void {
    if (!this.view) return;
    this.keyboardUsed = false;
    this.setHover(null, null);
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

    const start = { x: e.clientX, y: e.clientY };
    const target = e.target as globalThis.Element;
    const el = target.closest('[data-id]');
    const wire = target.closest('[data-wire]');

    if (e.button === 1 || e.button === 2) {
      this.gesture = { type: 'pan', last: start, start, tap: null };
      return;
    }
    if (this.panMode || this.spaceHeld) {
      const tap = { element: el?.getAttribute('data-id') ?? null, wire: wire?.getAttribute('data-wire') ?? null };
      this.gesture = { type: 'pan', last: start, start, tap };
      return;
    }

    const handle = target.closest('[data-handle]');
    if (handle) {
      this.gesture = {
        type: 'press-handle',
        id: handle.getAttribute('data-handle')!,
        end: handle.getAttribute('data-end') === '1' ? 1 : 2,
        start,
        origin: this.view.circuit,
      };
      return;
    }
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
    this.gesture = {
      type: 'press-empty',
      start,
      from: this.toGrid(e.clientX, e.clientY),
      wire: wire ? wire.getAttribute('data-wire') : null,
    };
  }

  private setHover(id: string | null, at: Point | null): void {
    if (id === this.hovered && !id) return;
    this.hovered = id;
    this.host.hover(id, at);
  }

  private moveEvent(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && this.gesture.type === 'none') {
      const target = e.target as globalThis.Element;
      const item = target.closest('[data-id]') ?? target.closest('[data-wire]');
      const id = item?.getAttribute('data-id') ?? item?.getAttribute('data-wire') ?? null;
      this.setHover(id, id ? { x: e.clientX, y: e.clientY } : null);
    }
    if (!this.pointers.has(e.pointerId)) return;
    const prev = this.pointers.get(e.pointerId)!;
    const now = { x: e.clientX, y: e.clientY };
    this.pointers.set(e.pointerId, now);
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
        this.camera.x += now.x - prev.x;
        this.camera.y += now.y - prev.y;
        if (dist(g.start, now) > threshold) g.tap = null;
        this.applyCamera();
        break;
      case 'press-element':
        if (dist(g.start, now) > threshold) {
          this.gesture = { type: 'drag-element', id: g.id, origin: g.origin, grab: g.grab };
          this.dragTo(e);
        }
        break;
      case 'drag-element':
        this.dragTo(e);
        break;
      case 'press-handle':
        if (dist(g.start, now) > threshold) {
          this.gesture = { type: 'drag-handle', id: g.id, end: g.end, origin: g.origin };
          this.dragHandle(e);
        }
        break;
      case 'drag-handle':
        this.dragHandle(e);
        break;
      case 'press-empty':
        if (dist(g.start, now) > threshold) {
          this.gesture = { type: 'wire', from: g.from, to: this.toGrid(e.clientX, e.clientY) };
          this.layers.overlay.innerHTML = wirePreview(g.from, this.toGrid(e.clientX, e.clientY));
        }
        break;
      case 'wire':
        g.to = this.toGrid(e.clientX, e.clientY);
        this.layers.overlay.innerHTML = wirePreview(g.from, g.to);
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

  private dragHandle(e: PointerEvent): void {
    const g = this.gesture;
    if (g.type !== 'drag-handle') return;
    const w = g.origin.wires.find((x) => x.id === g.id)!;
    const fixed = g.end === 1 ? { x: w.x2, y: w.y2 } : { x: w.x1, y: w.y1 };
    const to = this.toGrid(e.clientX, e.clientY);
    // Hide the old wire while the new path is previewed.
    this.host.preview({ ...g.origin, wires: g.origin.wires.filter((x) => x.id !== g.id) });
    this.layers.overlay.innerHTML = wirePreview(fixed, to);
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
      case 'pan':
        if (g.tap) this.tap(g.tap.element, g.tap.wire);
        break;
      case 'press-element':
        this.tap(g.id, null);
        break;
      case 'drag-element': {
        const moved = this.view.circuit;
        const a = g.origin.elements.find((x) => x.id === g.id);
        const b = moved.elements.find((x) => x.id === g.id);
        this.host.preview(g.origin);
        if (a && b && (a.x !== b.x || a.y !== b.y)) this.host.commit(normalize(moved));
        this.host.select(g.id);
        break;
      }
      case 'press-handle':
        break;
      case 'drag-handle': {
        this.host.preview(g.origin);
        const next = moveWireEnd(g.origin, g.id, g.end, this.toGrid(e.clientX, e.clientY));
        this.host.commit(next);
        // Keep the moved wire selected: it is the one that now ends at the dropped point.
        const to = this.toGrid(e.clientX, e.clientY);
        const moved = next.wires.find((w) => (w.x1 === to.x && w.y1 === to.y) || (w.x2 === to.x && w.y2 === to.y));
        this.host.select(moved?.id ?? null);
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

  private tap(element: string | null, wire: string | null): void {
    if (element) {
      this.host.select(element);
      const item = this.view?.circuit.elements.find((x) => x.id === element);
      if (item?.kind === 'switch') this.host.toggle(element);
    } else {
      this.host.select(wire);
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
    if (g.type === 'drag-element' || g.type === 'press-element' || g.type === 'drag-handle') this.host.preview(g.origin);
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
}

/** Dashed preview of a wire from p to q, as addWire would draw it. */
function wirePreview(p: Point, q: Point): string {
  const pts = p.x === q.x || p.y === q.y ? [p, q] : [p, { x: q.x, y: p.y }, q];
  const d = pts.map((pt, i) => `${i ? 'L' : 'M'}${pt.x * U} ${pt.y * U}`).join(' ');
  return `<path class="wire-preview" d="${d}"/>
    <circle class="wire-end" cx="${p.x * U}" cy="${p.y * U}" r="5"/>
    <circle class="wire-end" cx="${q.x * U}" cy="${q.y * U}" r="5"/>`;
}

export function valueText(e: Element): string {
  const r = e.r ? ` r ${formatSI(e.r, 'Ω')}` : '';
  if (e.kind === 'battery' && e.value !== undefined) return formatSI(e.value, 'V') + r;
  if (e.kind === 'ac' && e.value !== undefined) return `${formatSI(e.value, 'V')}~ ${formatSI(e.freq ?? 50, 'Hz')}${r}`;
  if ((e.kind === 'resistor' || e.kind === 'lamp') && e.value !== undefined) return formatSI(e.value, 'Ω');
  return '';
}

function dist(p: Point, q: Point): number {
  return Math.hypot(p.x - q.x, p.y - q.y);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
