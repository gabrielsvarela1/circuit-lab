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

/** A lamp blows when its current goes above this multiple of its rated current. */
export const LAMP_OVERLOAD = 1.5;

/**
 * Loops of ideal AC sources are also checked at these instants, so a loop is
 * not mistaken for a valid one just because the sine happens to be zero at `t`.
 */
const PROBE_TIMES = [0.013717, 0.029113];

/** Ideal conductors: their two terminals become a single node. */
export function isLink(p: Part): boolean {
  if (p.kind === 'wire') return true;
  if (p.kind === 'switch') return !!p.closed;
  if (p.kind === 'resistor') return !((p.value ?? 0) > 0);
  if (p.kind === 'lamp') return !p.burnt && !((p.value ?? 0) > 0);
  return false;
}

/** Batteries and AC sources. */
export function isGenerator(p: Part): boolean {
  return p.kind === 'battery' || p.kind === 'ac';
}

/** Ideal voltage sources: ammeters, and generators without internal resistance. */
function isIdealSource(p: Part): boolean {
  return p.kind === 'ammeter' || (isGenerator(p) && !((p.r ?? 0) > 0));
}

/** Parts that carry current between two different nodes and appear in the MNA system. */
function isBranch(p: Part): boolean {
  switch (p.kind) {
    case 'battery':
    case 'ac':
    case 'ammeter':
      return true;
    case 'resistor':
      return (p.value ?? 0) > 0;
    case 'lamp':
      return !p.burnt && (p.value ?? 0) > 0;
    case 'led':
      return !p.burnt;
    default:
      return false;
  }
}

/** EMF at time t. An AC source's `value` is its RMS voltage. */
export function emfAt(p: Part, t: number): number {
  if (p.kind === 'battery') return p.value ?? 0;
  if (p.kind === 'ac') return Math.SQRT2 * (p.value ?? 0) * Math.sin(2 * Math.PI * (p.freq ?? 50) * t);
  return 0;
}

/** Current above which a part burns, or Infinity. */
export function burnLimit(p: Part): number {
  if (p.kind === 'led') return LED_MAX_CURRENT;
  if (p.kind === 'lamp' && (p.value ?? 0) > 0) return (LAMP_OVERLOAD * (p.rated ?? 6)) / p.value!;
  return Infinity;
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
    ac: parts.some((p) => p.kind === 'ac'),
  };
  for (const p of parts) {
    result.parts.set(p.id, { v: 0, i: 0, p: 0 });
    result.nodes.set(p.a, 0);
    result.nodes.set(p.b, 0);
  }
  return result;
}

/**
 * Solves the circuit at time `t` (which only matters for AC sources) with
 * modified nodal analysis.
 *
 * 1. Wires and closed switches merge their terminals into one node (union-find).
 * 2. Ammeters and generators without internal resistance are ideal voltage
 *    sources. Adding them to a union-find that tracks potentials detects loops
 *    of sources: a loop with a net EMF is a short circuit.
 * 3. Each connected part of the circuit gets its own reference node.
 * 4. Resistors and lamps are stamped as conductances, generators with internal
 *    resistance as their Norton equivalent, ideal sources as extra rows and
 *    columns, and the system is solved by Gaussian elimination. LEDs are
 *    non-linear, so this repeats with Newton's method until the LED voltages
 *    stop changing.
 * 5. Currents in the wires are recovered afterwards from Kirchhoff's current law.
 */
export function solve(parts: Part[], t = 0): SolveResult {
  const result = emptyResult(parts);
  const generators = parts.filter(isGenerator);
  if (generators.length === 0) return result;

  // 1. Merge nodes joined by ideal conductors.
  const nodeSets = new UnionFind();
  const links = parts.filter(isLink);
  for (const l of links) nodeSets.union(l.a, l.b);
  const group = (node: string) => nodeSets.find(node);

  // 2. Add ideal sources, looking for loops of sources.
  const times = [t, ...PROBE_TIMES];
  const potentials = times.map(() => new PotentialUnionFind());
  const sources: Part[] = [];
  const redundant = new Set<string>();
  for (const p of parts) {
    if (!isIdealSource(p)) continue;
    const ga = group(p.a);
    const gb = group(p.b);
    if (potentials[0].difference(ga, gb) === undefined) {
      potentials.forEach((pu, k) => pu.union(ga, gb, emfAt(p, times[k])));
      sources.push(p);
      continue;
    }
    const consistent = potentials.every((pu, k) => {
      const e = emfAt(p, times[k]);
      return Math.abs(pu.difference(ga, gb)! - e) <= 1e-9 * Math.max(1, Math.abs(e));
    });
    if (!consistent) {
      result.status = 'short';
      result.shortLoop = shortLoop(p, sources, links, group);
      return result;
    }
    // Same EMF as a parallel source: it carries no current of its own.
    redundant.add(p.id);
  }

  // 3. Connected parts of the circuit and their reference nodes.
  const branches = parts.filter(isBranch);
  const islands = new UnionFind();
  for (const b of branches) islands.union(group(b.a), group(b.b));
  const reference = new Map<string, string>();
  for (const g of generators) {
    const island = islands.find(group(g.b));
    if (!reference.has(island)) reference.set(island, group(g.b));
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
  const norton = branches.filter((p) => isGenerator(p) && !isIdealSource(p));
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
    for (const g of norton) {
      // E in series with r equals 1/r in parallel with a current E/r pushed out of a.
      conductance(g.a, g.b, 1 / g.r!);
      current(g.a, g.b, -emfAt(g, t) / g.r!);
    }
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
      z[row] = emfAt(s, t);
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
    if (isIdealSource(p)) {
      const k = sourceIndex.get(p.id);
      set(p, emfAt(p, t), k === undefined ? 0 : x[k]);
    } else if (isGenerator(p)) {
      set(p, v, (v - emfAt(p, t)) / p.r!);
    } else if ((p.kind === 'resistor' || p.kind === 'lamp') && isBranch(p)) {
      set(p, v, v / p.value!);
    } else if (p.kind === 'led' && !p.burnt) {
      set(p, v, ledCurrent(models[ledIndex.get(p.id)!], v));
    } else {
      // Voltmeter, open switch, burnt LED or lamp: no current.
      set(p, v, 0);
    }
  }
  result.overCurrent = overLimit(parts, (p) => Math.abs(result.parts.get(p.id)!.i));

  // 5. Currents in wires and closed switches.
  const currents = linkCurrents(parts, links, (p) => result.parts.get(p.id)!.i);
  for (const l of links) set(l, 0, currents.get(l.id) ?? 0);

  // Generators with no closed path.
  for (const g of generators) {
    if (redundant.has(g.id)) continue;
    const others = new UnionFind();
    for (const p of branches) if (p !== g) others.union(group(p.a), group(p.b));
    if (!others.connected(group(g.a), group(g.b))) result.openSources.push(g.id);
  }
  const live = generators.filter((g) => !redundant.has(g.id));
  result.status = result.openSources.length === live.length ? 'open' : 'ok';
  return result;
}

/** Ids of the parts above their burn limit, the worst (highest ratio) first. */
function overLimit(parts: Part[], current: (p: Part) => number): string[] {
  return parts
    .filter((p) => !p.burnt && burnLimit(p) < Infinity && current(p) > burnLimit(p))
    .map((p) => ({ id: p.id, ratio: current(p) / burnLimit(p) }))
    .sort((x, y) => y.ratio - x.ratio)
    .map((x) => x.id);
}

/**
 * Steady state. With only DC generators this is `solve`. With AC sources the
 * circuit is solved at evenly spaced instants over one period (every part is
 * resistive or an LED, so each instant is independent of the others) and the
 * result holds RMS voltage and current and average power, as a multimeter
 * shows them. An LED burns on its peak current, a lamp on its RMS current.
 */
export function analyse(parts: Part[]): SolveResult {
  const acs = parts.filter((p) => p.kind === 'ac');
  if (acs.length === 0) return solve(parts);

  const freqs = acs.map((p) => p.freq ?? 50);
  const fmin = Math.min(...freqs);
  const fmax = Math.max(...freqs);
  const period = 1 / fmin;
  const samples = Math.min(512, Math.max(64, Math.ceil((64 * fmax) / fmin)));

  const first = solve(parts, 0);
  if (first.status === 'short' || first.status === 'error' || first.status === 'empty') return first;

  const sum = new Map<string, { v2: number; i2: number; p: number; peak: number }>();
  const nodes2 = new Map<string, number>();
  let converged = true;
  let iterations = 0;
  for (let k = 0; k < samples; k++) {
    const r = k === 0 ? first : solve(parts, (k * period) / samples);
    if (r.status === 'error') return r;
    converged &&= r.converged;
    iterations = Math.max(iterations, r.iterations);
    for (const [id, x] of r.parts) {
      const s = sum.get(id) ?? { v2: 0, i2: 0, p: 0, peak: 0 };
      s.v2 += x.v * x.v;
      s.i2 += x.i * x.i;
      s.p += x.p;
      s.peak = Math.max(s.peak, Math.abs(x.i));
      sum.set(id, s);
    }
    for (const [node, v] of r.nodes) nodes2.set(node, (nodes2.get(node) ?? 0) + v * v);
  }

  const result: SolveResult = { ...first, parts: new Map(), nodes: new Map(), converged, iterations };
  for (const [id, s] of sum) {
    result.parts.set(id, { v: Math.sqrt(s.v2 / samples), i: Math.sqrt(s.i2 / samples), p: s.p / samples });
  }
  for (const [node, v2] of nodes2) result.nodes.set(node, Math.sqrt(v2 / samples));
  result.overCurrent = overLimit(parts, (p) => (p.kind === 'led' ? sum.get(p.id)!.peak : result.parts.get(p.id)!.i));
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
 * Solves the circuit and burns any LED or lamp above its limit, one at a time
 * (the worst first), until nothing is over the limit. Returns the updated
 * parts and the ids of what burnt.
 */
export function solveWithBurnout(parts: Part[]): { parts: Part[]; result: SolveResult; burnt: string[] } {
  const burnt: string[] = [];
  let current = parts;
  for (;;) {
    const result = analyse(current);
    if (result.overCurrent.length === 0) return { parts: current, result, burnt };
    const worst = result.overCurrent[0];
    burnt.push(worst);
    current = current.map((p) => (p.id === worst ? { ...p, burnt: true } : p));
  }
}

/** 0 to 1. LEDs by current relative to 20 mA, lamps relative to their rated current. */
export function brightness(p: Part, r: PartResult | undefined): number {
  if (!r || p.burnt) return 0;
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  if (p.kind === 'led') return clamp(r.i / 0.02);
  if (p.kind === 'lamp' && (p.value ?? 0) > 0) {
    const ratedCurrent = (p.rated ?? 6) / p.value!;
    return clamp(Math.abs(r.i) / ratedCurrent);
  }
  return 0;
}
