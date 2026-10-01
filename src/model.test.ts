import { describe, expect, it } from 'vitest';
import { solve } from './engine';
import { EXAMPLES } from './examples';
import { addWire, createElement, empty, move, normalize, rotate, terminals, toParts } from './model';
import { decode, encode } from './share';

describe('model', () => {
  it('draws an L-shaped wire between points that are not aligned', () => {
    const c = addWire(empty(), { x: 0, y: 0 }, { x: 3, y: 2 });
    expect(c.wires.map((w) => [w.x1, w.y1, w.x2, w.y2])).toEqual([
      [0, 0, 3, 0],
      [3, 0, 3, 2],
    ]);
  });

  it('splits a wire where another wire ends on it, but not where wires cross', () => {
    let c = addWire(empty(), { x: 0, y: 0 }, { x: 4, y: 0 });
    c = addWire(c, { x: 2, y: 0 }, { x: 2, y: 3 });
    expect(c.wires).toHaveLength(3);
    const crossing = addWire(addWire(empty(), { x: 0, y: 0 }, { x: 4, y: 0 }), { x: 2, y: -2 }, { x: 2, y: 2 });
    expect(crossing.wires).toHaveLength(2);
  });

  it('drops duplicated and empty wires', () => {
    const c = normalize({
      elements: [],
      wires: [
        { id: 'a', x1: 0, y1: 0, x2: 2, y2: 0 },
        { id: 'b', x1: 2, y1: 0, x2: 0, y2: 0 },
        { id: 'c', x1: 1, y1: 1, x2: 1, y2: 1 },
      ],
    });
    expect(c.wires.map((w) => w.id)).toEqual(['a']);
  });

  it('moving an element drags the wires attached to it', () => {
    let c = empty();
    const r = createElement(c, 'resistor', 2, 0);
    c = addWire({ ...c, elements: [r] }, { x: -2, y: 0 }, { x: 1, y: 0 });
    c = move(c, r.id, 2, 1);
    expect(c.wires[0]).toMatchObject({ x1: -2, y1: 0, x2: 1, y2: 1 });
  });

  it('rotating turns the terminals around the centre', () => {
    const r = createElement(empty(), 'resistor', 0, 0);
    const c = rotate({ elements: [r], wires: [] }, r.id);
    expect(terminals(c.elements[0])).toEqual([
      { x: 0, y: -1 },
      { x: 0, y: 1 },
    ]);
  });

  it('names new elements with the lowest free number', () => {
    const c = empty();
    const r1 = createElement(c, 'resistor', 0, 0);
    const r2 = createElement({ ...c, elements: [r1] }, 'resistor', 0, 2);
    expect([r1.name, r2.name]).toEqual(['R1', 'R2']);
  });
});

describe('share', () => {
  it('round-trips a circuit through the URL encoding', () => {
    const c = EXAMPLES[0].build();
    const back = decode(encode(c))!;
    expect(back.elements.map(({ id: _, ...e }) => e)).toEqual(c.elements.map(({ id: _, ...e }) => e));
    expect(back.wires.map(({ id: _, ...w }) => w)).toEqual(c.wires.map(({ id: _, ...w }) => w));
  });

  it('rejects text that is not a circuit', () => {
    expect(decode('not-base64!')).toBeNull();
  });
});

describe('examples', () => {
  it.each(EXAMPLES.map((e) => [e.title, e] as const))('%s solves without errors', (_, example) => {
    const r = solve(toParts(example.build()));
    expect(r.status).toBe('ok');
    expect(r.converged).toBe(true);
  });
});
