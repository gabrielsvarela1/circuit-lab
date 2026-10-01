export class UnionFind {
  private parent = new Map<string, string>();

  find(x: string): string {
    let root = x;
    while (true) {
      const p = this.parent.get(root);
      if (p === undefined || p === root) break;
      root = p;
    }
    // Path compression.
    while (x !== root) {
      const next = this.parent.get(x)!;
      this.parent.set(x, root);
      x = next;
    }
    return root;
  }

  union(a: string, b: string): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    this.parent.set(ra, rb);
    return true;
  }

  connected(a: string, b: string): boolean {
    return this.find(a) === this.find(b);
  }
}

/**
 * Union-find that also tracks the voltage of every node relative to the root
 * of its set. Used to add ideal voltage sources one by one and spot loops of
 * sources: a loop is fine if its EMFs add up to zero, and a short circuit otherwise.
 */
export class PotentialUnionFind {
  private parent = new Map<string, string>();
  /** V(x) - V(parent(x)). */
  private offset = new Map<string, number>();

  private find(x: string): [root: string, potential: number] {
    const p = this.parent.get(x);
    if (p === undefined || p === x) return [x, 0];
    const [root, pp] = this.find(p);
    const potential = (this.offset.get(x) ?? 0) + pp;
    this.parent.set(x, root);
    this.offset.set(x, potential);
    return [root, potential];
  }

  /** V(a) - V(b) if both are in the same set, otherwise undefined. */
  difference(a: string, b: string): number | undefined {
    const [ra, pa] = this.find(a);
    const [rb, pb] = this.find(b);
    return ra === rb ? pa - pb : undefined;
  }

  /** Records the constraint V(a) - V(b) = e. The nodes must be in different sets. */
  union(a: string, b: string, e: number): void {
    const [ra, pa] = this.find(a);
    const [rb, pb] = this.find(b);
    this.parent.set(ra, rb);
    // V(ra) - V(rb) = (V(a) - pa) - (V(b) - pb)
    this.offset.set(ra, e - pa + pb);
  }
}
