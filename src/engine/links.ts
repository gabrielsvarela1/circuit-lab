import { solveLinear, SingularMatrixError, zeros } from './gauss';
import type { Part } from './types';

/**
 * Current in each wire and closed switch.
 *
 * The solver merges the terminals of ideal conductors into one node, so their
 * currents are not unknowns of the main system. Here, within each merged node,
 * the wires form a small network fed by the currents of the other parts.
 * In a tree of wires Kirchhoff's current law fixes every current. When wires
 * form a loop the split is not defined for ideal conductors, so each wire is
 * given a resistance proportional to its length, as real wires have.
 */
export function linkCurrents(
  parts: Part[],
  links: Part[],
  currentOf: (p: Part) => number,
): Map<string, number> {
  const out = new Map<string, number>();
  if (links.length === 0) return out;

  // Group the wire endpoints into connected sets.
  const adjacency = new Map<string, Part[]>();
  for (const l of links) {
    if (l.a === l.b) {
      out.set(l.id, 0);
      continue;
    }
    for (const n of [l.a, l.b]) {
      if (!adjacency.has(n)) adjacency.set(n, []);
      adjacency.get(n)!.push(l);
    }
  }

  // Current that each node pushes into the wires: minus what leaves into other parts.
  const injection = new Map<string, number>();
  const linkSet = new Set(links);
  for (const p of parts) {
    if (linkSet.has(p)) continue;
    const i = currentOf(p);
    if (i === 0 || p.a === p.b) continue;
    injection.set(p.a, (injection.get(p.a) ?? 0) - i);
    injection.set(p.b, (injection.get(p.b) ?? 0) + i);
  }

  const seen = new Set<string>();
  for (const start of adjacency.keys()) {
    if (seen.has(start)) continue;
    const nodes: string[] = [];
    const wires = new Set<Part>();
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const node = stack.pop()!;
      nodes.push(node);
      for (const l of adjacency.get(node)!) {
        wires.add(l);
        const next = l.a === node ? l.b : l.a;
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }

    // Laplacian system with nodes[0] as reference.
    const index = new Map(nodes.slice(1).map((n, k) => [n, k]));
    const size = index.size;
    const A = zeros(size, size);
    const b = nodes.slice(1).map((n) => injection.get(n) ?? 0);
    for (const l of wires) {
      const g = 1 / (l.length && l.length > 0 ? l.length : 1);
      const ia = index.get(l.a) ?? -1;
      const ib = index.get(l.b) ?? -1;
      if (ia >= 0) A[ia][ia] += g;
      if (ib >= 0) A[ib][ib] += g;
      if (ia >= 0 && ib >= 0) {
        A[ia][ib] -= g;
        A[ib][ia] -= g;
      }
    }
    let phi: number[];
    try {
      phi = size > 0 ? solveLinear(A, b) : [];
    } catch (e) {
      if (!(e instanceof SingularMatrixError)) throw e;
      phi = new Array<number>(size).fill(0);
    }
    const at = (n: string) => {
      const k = index.get(n);
      return k === undefined ? 0 : phi[k];
    };
    for (const l of wires) {
      const g = 1 / (l.length && l.length > 0 ? l.length : 1);
      out.set(l.id, g * (at(l.a) - at(l.b)));
    }
  }
  return out;
}
