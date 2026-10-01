import { describe, expect, it } from 'vitest';
import { analyse, solve, solveWithBurnout } from '../solve';
import type { Part } from '../types';
import { battery, I, lamp, led, P, resistor, V, wire } from './helpers';

const ac = (id: string, a: string, b: string, rms: number, freq: number, r?: number): Part => ({
  id,
  kind: 'ac',
  a,
  b,
  value: rms,
  freq,
  r,
});

describe('internal resistance', () => {
  it('9 V with r = 1 Ω on 8 Ω: 1 A, and 8 V at the terminals', () => {
    const r = solve([{ ...battery('B', 'p', 'n', 9), r: 1 }, resistor('R', 'p', 'n', 8)]);
    expect(r.status).toBe('ok');
    expect(I(r, 'R')).toBeCloseTo(1, 12);
    expect(V(r, 'B')).toBeCloseTo(8, 12);
    // Power delivered at the terminals: 8 V * 1 A.
    expect(P(r, 'B')).toBeCloseTo(-8, 12);
  });

  it('a wire across a real battery gives the short-circuit current E / r', () => {
    const r = solve([{ ...battery('B', 'p', 'n', 9), r: 0.5 }, wire('W', 'p', 'n')]);
    expect(r.status).toBe('ok');
    expect(Math.abs(I(r, 'B'))).toBeCloseTo(18, 12);
    expect(Math.abs(I(r, 'W'))).toBeCloseTo(18, 12);
  });

  it('two different real batteries in parallel share the load', () => {
    // Node voltage U: (U - 9)/1 + (U - 6)/1 + U/10 = 0  ->  U = 15 / 2.1.
    const r = solve([
      { ...battery('B1', 'p', 'n', 9), r: 1 },
      { ...battery('B2', 'p', 'n', 6), r: 1 },
      resistor('R', 'p', 'n', 10),
    ]);
    expect(V(r, 'R')).toBeCloseTo(15 / 2.1, 12);
  });

  it('a real battery with nothing attached is an open circuit', () => {
    const r = solve([{ ...battery('B', 'p', 'n', 9), r: 1 }, resistor('R', 'p', 'x', 10)]);
    expect(r.status).toBe('open');
    expect(V(r, 'B')).toBeCloseTo(9, 12);
  });
});

describe('alternating current', () => {
  const circuit = [ac('G', 'p', 'n', 6, 50), resistor('R', 'p', 'n', 100)];

  it('6 V RMS on 100 Ω: 60 mA RMS and 0.36 W on average', () => {
    const r = analyse(circuit);
    expect(r.ac).toBe(true);
    expect(V(r, 'R')).toBeCloseTo(6, 9);
    expect(I(r, 'R')).toBeCloseTo(0.06, 9);
    expect(P(r, 'R')).toBeCloseTo(0.36, 9);
  });

  it('the instantaneous current follows the sine', () => {
    // A quarter of a period in: the peak, 6 * √2 / 100.
    expect(I(solve(circuit, 1 / 200), 'R')).toBeCloseTo((6 * Math.SQRT2) / 100, 9);
    // Three quarters in: the negative peak.
    expect(I(solve(circuit, 3 / 200), 'R')).toBeCloseTo((-6 * Math.SQRT2) / 100, 9);
  });

  it('a wire across an AC source is a short circuit even when the sine is zero', () => {
    const r = solve([ac('G', 'p', 'n', 6, 50), wire('W', 'p', 'n')], 0);
    expect(r.status).toBe('short');
    expect(analyse([ac('G', 'p', 'n', 6, 50), wire('W', 'p', 'n')]).status).toBe('short');
  });

  it('two identical AC sources in parallel are fine', () => {
    const r = analyse([ac('G1', 'p', 'n', 6, 50), ac('G2', 'p', 'n', 6, 50), resistor('R', 'p', 'n', 100)]);
    expect(r.status).toBe('ok');
    expect(I(r, 'R')).toBeCloseTo(0.06, 9);
  });

  it('an LED only conducts in the positive half-cycle', () => {
    const parts = [ac('G', 'p', 'n', 10, 50), resistor('R', 'p', 'a', 1000), led('D', 'a', 'n')];
    expect(I(solve(parts, 1 / 200), 'D')).toBeGreaterThan(0.01);
    expect(Math.abs(I(solve(parts, 3 / 200), 'D'))).toBeLessThan(1e-6);
    // Half-wave rectified: the RMS current is well under the 10 mA a resistor alone would draw.
    const rms = I(analyse(parts), 'D');
    expect(rms).toBeGreaterThan(0.003);
    expect(rms).toBeLessThan(0.007);
  });

  it('an LED burns on its peak current, not its RMS current', () => {
    // Peak 6 * √2 ≈ 8,49 V, so about 33 mA through 200 Ω at the peak.
    const { burnt, result } = solveWithBurnout([ac('G', 'p', 'n', 6, 50), resistor('R', 'p', 'a', 200), led('D', 'a', 'n')]);
    expect(burnt).toEqual(['D']);
    expect(result.status).toBe('open');
  });
});

describe('lamps burn', () => {
  const rated6 = (id: string, a: string, b: string): Part => ({ ...lamp(id, a, b, 30), rated: 6 });

  it('a 6 V lamp on 12 V blows (twice its rated current)', () => {
    const { burnt, result } = solveWithBurnout([battery('B', 'p', 'n', 12), rated6('L', 'p', 'n')]);
    expect(burnt).toEqual(['L']);
    expect(I(result, 'L')).toBe(0);
    expect(result.status).toBe('open');
  });

  it('a 6 V lamp on 8 V survives', () => {
    const { burnt } = solveWithBurnout([battery('B', 'p', 'n', 8), rated6('L', 'p', 'n')]);
    expect(burnt).toEqual([]);
  });

  it('of two lamps in parallel on 12 V, both blow; the worst first', () => {
    const { burnt } = solveWithBurnout([
      battery('B', 'p', 'n', 12),
      rated6('L1', 'p', 'n'),
      { ...lamp('L2', 'p', 'n', 30), rated: 4 },
    ]);
    expect(burnt).toEqual(['L2', 'L1']);
  });
});
