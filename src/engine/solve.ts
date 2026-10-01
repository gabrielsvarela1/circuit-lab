import { solveLinear, SingularMatrixError, zeros } from './gauss';
import {
  LED_MAX_CURRENT,
  ledConductance,
  ledCurrent,
  ledModel,
  limitStep,
  type LedModel,
} from './led';
import { linkCurrents } from './links';
import type { Part, PartResult, SolveResult } from './types';
import { PotentialUnionFind, UnionFind } from './unionfind';

const MAX_ITERATIONS = 500;
const TOLERANCE = 1e-9;

/** Ideal conductors: their two terminals become a single node. */
export function isLink(p: Part): boolean {
  if (p.kind === 'wire') return true;
  if (p.kind === 'switch') return !!p.closed;
  if (p.kind === 'resistor' || p.kind === 'lamp') return !((p.value ?? 0) > 0);
  return false;
}

/** Parts that carry current between two different nodes and appear in the MNA system. */
function isBranch(p: Part): boolean {
  switch (p.kind) {
    case 'battery':
    case 'ammeter':
      return true;
    case 'resistor':
    case 'lamp':
      return (p.value ?? 0) > 0;
    case 'led':
      return !p.burnt;
    default:
      return false;
  }
}

function isSource(p: Part): boolean {
  return p.kind === 'battery' || p.kind === 'ammeter';
}

function emf(p: Part): number {
  return p.kind === 'battery' ? p.value ?? 0 : 0;
}

function emptyResult(parts: Part[]): SolveResult {
  const result: SolveResult = {
    status: 'empty',
    parts: new Map(),
    nodes: new Map(),
    shortLoop: [],
    openSources: [],
    overCurrent: [],
    converged: true,
    iterations: 0,
  };
  for (const p of parts) {
    result.parts.set(p.id, { v: 0, i: 0, p: 0 });
    result.nodes.set(p.a, 0);
    result.nodes.set(p.b, 0);
  }
  return result;
}

/**
 * Solves a DC circuit with modified nodal analysis.
 *
 * 1. Wires and closed switches merge their terminals into one node (union-find).
 * 2. Batteries and ammeters are ideal voltage sources. Adding them to a
 *    union-find that tracks potentials detects loops of sources: a loop with a
 *    net EMF is a short circuit.
 * 3. Each connected part of the circuit gets its own reference node.
 * 4. Resistors, lamps and LEDs are stamped as conductances, sources as extra
 *    rows and columns, and the system is solved by Gaussian elimination.
 *    LEDs are non-linear, so this repeats with Newton's method until the LED
 *    voltages stop changing.
 * 5. Currents in the wires are recovered afterwards from Kirchhoff's current law.
 */
export function solve(parts: Part[]): SolveResult {
  const result = emptyResult(parts);
  const batteries = parts.filter((p) => p.kind === 'battery');
  if (batteries.length === 0) return result;

  // 1. Merge nodes joined by ideal conductors.
  const nodeSets = new UnionFind();
  const links = parts.filter(isLink);
  for (const l of links) nodeSets.union(l.a, l.b);
  const group = (node: string) => nodeSets.find(node);

  // 2. Add sources, looking for loops of sources.
  const potentials = new PotentialUnionFind();
  const sources: Part[] = [];
  const redundant = new Set<string>();
  for (const p of parts) {
    if (!isSource(p)) continue;
    const ga = group(p.a);
    const gb = group(p.b);
    const e = emf(p);
    const diff = potentials.difference(ga, gb);
    if (diff === undefined) {
      potentials.union(ga, gb, e);
      sources.push(p);
    } else if (Math.abs(diff - e) > 1e-9 * Math.max(1, Math.abs(e))) {
      result.status = 'short';
      result.shortLoop = shortLoop(p, sources, links, group);
      return result;
    } else {
      // Same EMF as a parallel source: it carries no current of its own.
      redundant.add(p.id);
    }
  }

  // 3. Connected parts of the circuit and their reference nodes.
  const branches = parts.filter(isBranch);
  const islands = new UnionFind();
  for (const b of branches) islands.union(group(b.a), group(b.b));
  const reference = new Map<string, string>();
  for (const b of batteries) {
    const island = islands.find(group(b.b));
    if (!reference.has(island)) reference.set(island, group(b.b));
  }
  const groups = new Set<string>();
  for (const p of parts) {
    groups.add(group(p.a));
    groups.add(group(p.b));
  }
  const index = new Map<string, number>();
  for (const g of groups) {
    const island = islands.find(g);
    if (!reference.has(island)) reference.set(island, g);
    if (reference.get(island) !== g) index.set(g, index.size);
  }

  // 4. Assemble and solve, iterating for the LEDs.
  const n = index.size;
  const size = n + sources.length;
  const resistors = branches.filter((p) => p.kind === 'resistor' || p.kind === 'lamp');
  const leds = branches.filter((p) => p.kind === 'led');
  const models: LedModel[] = leds.map((p) => ledModel(p.vf));
  const vd = leds.map(() => 0);
  const at = (node: string) => index.get(group(node)) ?? -1;

  let x: number[] = [];
  const voltage = (node: string) => {
    const k = at(node);
    return k < 0 ? 0 : x[k];
  };

  result.converged = false;
  for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
    result.iterations = iter;
    const A = zeros(size, size);
    const z = new Array<number>(size).fill(0);

    const conductance = (a: string, b: string, g: number) => {
      const ia = at(a);
      const ib = at(b);
      if (ia >= 0) A[ia][ia] += g;
      if (ib >= 0) A[ib][ib] += g;
      if (ia >= 0 && ib >= 0) {
        A[ia][ib] -= g;
        A[ib][ia] -= g;
      }
    };
    // A current j flowing through the element from a to b.
    const current = (a: string, b: string, j: number) => {
      const ia = at(a);
      const ib = at(b);
      if (ia >= 0) z[ia] -= j;
      if (ib >= 0) z[ib] += j;
    };

    for (const r of resistors) conductance(r.a, r.b, 1 / r.value!);
    leds.forEach((led, k) => {
      // Linearise around the current guess: i = g * v + (id - g * vd).
      const g = ledConductance(models[k], vd[k]);
      const id = ledCurrent(models[k], vd[k]);
      conductance(led.a, led.b, g);
      current(led.a, led.b, id - g * vd[k]);
    });
    sources.forEach((s, k) => {
      const row = n + k;
      const ia = at(s.a);
      const ib = at(s.b);
      if (ia >= 0) {
        A[ia][row] += 1;
        A[row][ia] += 1;
      }
      if (ib >= 0) {
        A[ib][row] -= 1;
        A[row][ib] -= 1;
      }
      z[row] = emf(s);
    });

    try {
      x = solveLinear(A, z);
    } catch (e) {
      if (!(e instanceof SingularMatrixError)) throw e;
      result.status = 'error';
      return result;
    }

    let delta = 0;
    leds.forEach((led, k) => {
      const next = limitStep(models[k], voltage(led.a) - voltage(led.b), vd[k]);
      delta = Math.max(delta, Math.abs(next - vd[k]));
      vd[k] = next;
    });
    if (delta < TOLERANCE) {
      result.converged = true;
      break;
    }
  }

  // Results.
  const sameIsland = (a: string, b: string) => islands.connected(group(a), group(b));
  for (const node of result.nodes.keys()) result.nodes.set(node, voltage(node));
  const set = (p: Part, v: number, i: number) => result.parts.set(p.id, { v, i, p: v * i });
  const sourceIndex = new Map(sources.map((s, k) => [s.id, n + k]));
  const ledIndex = new Map(leds.map((l, k) => [l.id, k]));

  for (const p of parts) {
    const v = sameIsland(p.a, p.b) ? voltage(p.a) - voltage(p.b) : NaN;
    if (isLink(p)) continue;
    if (isSource(p)) {
      const k = sourceIndex.get(p.id);
      set(p, emf(p), k === undefined ? 0 : x[k]);
    } else if (p.kind === 'resistor' || p.kind === 'lamp') {
      set(p, v, v / p.value!);
    } else if (p.kind === 'led' && !p.burnt) {
      const i = ledCurrent(models[ledIndex.get(p.id)!], v);
      set(p, v, i);
      if (i > LED_MAX_CURRENT) result.overCurrent.push(p.id);
    } else {
      // Voltmeter, open switch, burnt LED: no current.
      set(p, v, 0);
    }
  }

  // 5. Currents in wires and closed switches.
  const currents = linkCurrents(parts, links, (p) => result.parts.get(p.id)!.i);
  for (const l of links) set(l, 0, currents.get(l.id) ?? 0);

  // Batteries with no closed path.
  for (const b of batteries) {
    if (redundant.has(b.id)) continue;
    const others = new UnionFind();
    for (const p of branches) if (p !== b) others.union(group(p.a), group(p.b));
    if (!others.connected(group(b.a), group(b.b))) result.openSources.push(b.id);
  }
  const live = batteries.filter((b) => !redundant.has(b.id));
  result.status = result.openSources.length === live.length ? 'open' : 'ok';
  return result;
}

/**
 * Returns the parts in the loop closed by `culprit`: the sources already
 * accepted that connect its terminals, plus the wires between them.
 */
function shortLoop(
  culprit: Part,
  sources: Part[],
  links: Part[],
  group: (node: string) => string,
): string[] {
  // Path of sources between the groups of culprit.b and culprit.a.
  const path = bfs(group(culprit.b), group(culprit.a), sources, (s) => [group(s.a), group(s.b)]);
  const loop = [culprit.id];
  let node = culprit.b;
  for (const s of path ?? []) {
    const [enter, exit] = group(s.a) === group(node) ? [s.a, s.b] : [s.b, s.a];
    loop.push(...(bfs(node, enter, links, (l) => [l.a, l.b]) ?? []).map((l) => l.id));
    loop.push(s.id);
    node = exit;
  }
  loop.push(...(bfs(node, culprit.a, links, (l) => [l.a, l.b]) ?? []).map((l) => l.id));
  return [...new Set(loop)];
}

/** Shortest path of edges from `from` to `to`, or null. */
function bfs(
  from: string,
  to: string,
  edges: Part[],
  ends: (e: Part) => [string, string],
): Part[] | null {
  const via = new Map<string, Part | null>([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const node = queue.shift()!;
    if (node === to) break;
    for (const e of edges) {
      const [a, b] = ends(e);
      const next = a === node ? b : b === node ? a : undefined;
      if (next !== undefined && !via.has(next)) {
        via.set(next, e);
        queue.push(next);
      }
    }
  }
  if (!via.has(to)) return null;
  const path: Part[] = [];
  let node = to;
  while (node !== from) {
    const e = via.get(node)!;
    path.unshift(e);
    const [a, b] = ends(e);
    node = a === node ? b : a;
  }
  return path;
}

/**
 * Solves the circuit and burns any LED above its maximum current, one at a
 * time (the worst first), until no LED is over the limit. Returns the updated
 * parts and the ids of the LEDs that burnt.
 */
export function solveWithBurnout(parts: Part[]): { parts: Part[]; result: SolveResult; burnt: string[] } {
  const burnt: string[] = [];
  let current = parts;
  for (;;) {
    const result = solve(current);
    if (result.overCurrent.length === 0) return { parts: current, result, burnt };
    let worst = result.overCurrent[0];
    for (const id of result.overCurrent) {
      if (result.parts.get(id)!.i > result.parts.get(worst)!.i) worst = id;
    }
    burnt.push(worst);
    current = current.map((p) => (p.id === worst ? { ...p, burnt: true } : p));
  }
}

/** 0 to 1. LEDs by current relative to 20 mA, lamps relative to their rated current. */
export function brightness(p: Part, r: PartResult | undefined): number {
  if (!r) return 0;
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  if (p.kind === 'led') return p.burnt ? 0 : clamp(r.i / 0.02);
  if (p.kind === 'lamp' && (p.value ?? 0) > 0) {
    const ratedCurrent = (p.rated ?? 6) / p.value!;
    return clamp(Math.abs(r.i) / ratedCurrent);
  }
  return 0;
}
