import { describe, expect, it } from 'vitest';
import { solve } from '../solve';
import { ammeter, battery, I, resistor, sw, V, voltmeter, wire } from './helpers';

describe('short circuit', () => {
  it('a wire across a battery', () => {
    const r = solve([battery('B', 'p', 'n', 9), wire('W', 'p', 'n'), resistor('R', 'p', 'n', 100)]);
    expect(r.status).toBe('short');
    expect(r.shortLoop.sort()).toEqual(['B', 'W']);
  });

  it('a path of several wires across a battery', () => {
    const r = solve([
      battery('B', 'p', 'n', 9),
      wire('W1', 'p', 'x'),
      wire('W2', 'x', 'y'),
      wire('W3', 'y', 'n'),
      resistor('R', 'x', 'n', 100),
    ]);
    expect(r.status).toBe('short');
    expect(r.shortLoop.sort()).toEqual(['B', 'W1', 'W2', 'W3']);
  });

  it('a closed switch across a battery', () => {
    const r = solve([battery('B', 'p', 'n', 9), sw('S', 'p', 'n', true)]);
    expect(r.status).toBe('short');
  });

  it('an open switch across a battery is fine', () => {
    const r = solve([battery('B', 'p', 'n', 9), sw('S', 'p', 'n', false), resistor('R', 'p', 'n', 9)]);
    expect(r.status).toBe('ok');
    expect(I(r, 'R')).toBeCloseTo(1, 12);
  });

  it('an ammeter across a battery (ammeters have zero resistance)', () => {
    const r = solve([battery('B', 'p', 'n', 9), ammeter('A', 'p', 'n')]);
    expect(r.status).toBe('short');
    expect(r.shortLoop.sort()).toEqual(['A', 'B']);
  });

  it('two different batteries in parallel', () => {
    const r = solve([
      battery('B1', 'p', 'n', 9),
      wire('W1', 'p', 'q'),
      battery('B2', 'q', 'm', 4.5),
      wire('W2', 'm', 'n'),
    ]);
    expect(r.status).toBe('short');
    expect(r.shortLoop.sort()).toEqual(['B1', 'B2', 'W1', 'W2']);
  });

  it('a voltmeter across a battery is not a short', () => {
    const r = solve([battery('B', 'p', 'n', 9), voltmeter('VM', 'p', 'n')]);
    expect(r.status).toBe('open');
    expect(V(r, 'VM')).toBeCloseTo(9, 12);
  });
});

describe('open circuit', () => {
  it('an open switch breaks the loop', () => {
    const r = solve([
      battery('B', 'p', 'n', 9),
      sw('S', 'p', 'q', false),
      resistor('R', 'q', 'n', 100),
    ]);
    expect(r.status).toBe('open');
    expect(r.openSources).toEqual(['B']);
    expect(I(r, 'R')).toBe(0);
    expect(V(r, 'R')).toBe(0);
    // The whole EMF appears across the open switch.
    expect(V(r, 'S')).toBeCloseTo(9, 12);
  });

  it('closing the switch restores the current', () => {
    const r = solve([
      battery('B', 'p', 'n', 9),
      sw('S', 'p', 'q', true),
      resistor('R', 'q', 'n', 100),
    ]);
    expect(r.status).toBe('ok');
    expect(I(r, 'R')).toBeCloseTo(0.09, 12);
    expect(I(r, 'S')).toBeCloseTo(0.09, 12);
  });

  it('a resistor hanging from one terminal', () => {
    const r = solve([battery('B', 'p', 'n', 9), resistor('R', 'p', 'x', 100)]);
    expect(r.status).toBe('open');
    expect(I(r, 'R')).toBe(0);
    expect(r.nodes.get('x')).toBeCloseTo(9, 12);
  });

  it('a voltmeter in series shows the EMF and blocks the current', () => {
    const r = solve([
      battery('B', 'p', 'n', 9),
      resistor('R', 'p', 'x', 100),
      voltmeter('VM', 'x', 'n'),
    ]);
    expect(r.status).toBe('open');
    expect(V(r, 'VM')).toBeCloseTo(9, 12);
  });

  it('one open battery does not hide a working one', () => {
    const r = solve([
      battery('B1', 'p', 'n', 9),
      resistor('R1', 'p', 'n', 90),
      battery('B2', 'x', 'y', 9),
      resistor('R2', 'x', 'z', 90),
    ]);
    expect(r.status).toBe('ok');
    expect(r.openSources).toEqual(['B2']);
  });
});

describe('edge cases', () => {
  it('no battery', () => {
    const r = solve([resistor('R', 'a', 'b', 100)]);
    expect(r.status).toBe('empty');
    expect(I(r, 'R')).toBe(0);
  });

  it('a part not connected to anything', () => {
    const r = solve([
      battery('B', 'p', 'n', 9),
      resistor('R', 'p', 'n', 90),
      resistor('X', 'u', 'v', 50),
    ]);
    expect(r.status).toBe('ok');
    expect(I(r, 'X')).toBe(0);
    expect(V(r, 'X')).toBe(0);
  });

  it('a voltmeter between two unconnected circuits reads nothing', () => {
    const r = solve([
      battery('B', 'p', 'n', 9),
      resistor('R', 'p', 'n', 90),
      voltmeter('VM', 'p', 'x'),
    ]);
    expect(V(r, 'VM')).toBeNaN();
  });

  it('a 0 Ω resistor acts as a wire', () => {
    const r = solve([battery('B', 'p', 'n', 9), resistor('R', 'p', 'n', 0)]);
    expect(r.status).toBe('short');
  });

  it('an ammeter shorted by a wire reads zero', () => {
    const r = solve([
      battery('B', 'p', 'n', 9),
      ammeter('A', 'p', 'q'),
      wire('W', 'p', 'q'),
      resistor('R', 'q', 'n', 90),
    ]);
    expect(r.status).toBe('ok');
    expect(I(r, 'A')).toBe(0);
    expect(I(r, 'W')).toBeCloseTo(0.1, 12);
  });
});
