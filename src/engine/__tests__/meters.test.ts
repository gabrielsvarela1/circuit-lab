import { describe, expect, it } from 'vitest';
import { solve } from '../solve';
import { ammeter, battery, I, resistor, V, voltmeter } from './helpers';

describe('meters', () => {
  it('an ammeter in series reads the loop current without changing it', () => {
    const r = solve([
      battery('B', 'p', 'n', 6),
      ammeter('A', 'p', 'q'),
      resistor('R', 'q', 'n', 200),
    ]);
    expect(I(r, 'A')).toBeCloseTo(0.03, 12);
    expect(V(r, 'A')).toBe(0);
    expect(I(r, 'R')).toBeCloseTo(0.03, 12);
  });

  it('a reversed ammeter reads a negative current', () => {
    const r = solve([
      battery('B', 'p', 'n', 6),
      ammeter('A', 'q', 'p'),
      resistor('R', 'q', 'n', 200),
    ]);
    expect(I(r, 'A')).toBeCloseTo(-0.03, 12);
  });

  it('a voltmeter in parallel reads the voltage without drawing current', () => {
    const r = solve([
      battery('B', 'p', 'n', 9),
      resistor('R1', 'p', 'm', 100),
      resistor('R2', 'm', 'n', 200),
      voltmeter('VM', 'p', 'm'),
    ]);
    expect(V(r, 'VM')).toBeCloseTo(3, 12);
    expect(I(r, 'R1')).toBeCloseTo(0.03, 12);
  });

  it('two ammeters in different branches', () => {
    const r = solve([
      battery('B', 'p', 'n', 12),
      ammeter('A1', 'p', 'x'),
      resistor('R1', 'x', 'n', 100),
      ammeter('A2', 'p', 'y'),
      resistor('R2', 'y', 'n', 300),
    ]);
    expect(I(r, 'A1')).toBeCloseTo(0.12, 12);
    expect(I(r, 'A2')).toBeCloseTo(0.04, 12);
  });
});
