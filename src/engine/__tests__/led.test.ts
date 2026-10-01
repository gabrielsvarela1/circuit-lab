import { describe, expect, it } from 'vitest';
import { LED_NVT } from '../led';
import { brightness, solve, solveWithBurnout } from '../solve';
import { battery, I, lamp, led, resistor, V } from './helpers';

describe('LED', () => {
  it('9 V with 360 Ω and a 1.8 V LED gives exactly 20 mA', () => {
    // The model conducts 20 mA at Vf = 1.8 V, and 9 - 1.8 = 7.2 V = 20 mA * 360 Ω.
    const r = solve([battery('B', 'p', 'n', 9), resistor('R', 'p', 'a', 360), led('D', 'a', 'n')]);
    expect(r.converged).toBe(true);
    expect(I(r, 'D')).toBeCloseTo(0.02, 8);
    expect(V(r, 'D')).toBeCloseTo(1.8, 6);
    expect(r.overCurrent).toEqual([]);
  });

  it('5 V with 100 Ω satisfies both the resistor and the diode equation', () => {
    // Fixed point by hand: I = (5 - Vd) / 100 and Vd = 1.8 + n*Vt*ln(I / 20 mA)
    // gives I ≈ 31.76 mA, above the 30 mA limit.
    const r = solve([battery('B', 'p', 'n', 5), resistor('R', 'p', 'a', 100), led('D', 'a', 'n')]);
    const i = I(r, 'D');
    const vd = V(r, 'D');
    expect(i).toBeCloseTo((5 - vd) / 100, 9);
    expect(vd).toBeCloseTo(1.8 + LED_NVT * Math.log(i / 0.02), 6);
    expect(i).toBeCloseTo(0.03176, 4);
    expect(r.overCurrent).toEqual(['D']);
  });

  it('a reversed LED blocks the current', () => {
    const r = solve([battery('B', 'p', 'n', 9), resistor('R', 'p', 'a', 360), led('D', 'n', 'a')]);
    expect(r.converged).toBe(true);
    expect(Math.abs(I(r, 'D'))).toBeLessThan(1e-7);
    expect(V(r, 'D')).toBeCloseTo(-9, 4);
  });

  it('below the forward voltage the LED barely conducts', () => {
    const r = solve([battery('B', 'p', 'n', 1.5), resistor('R', 'p', 'a', 100), led('D', 'a', 'n')]);
    expect(I(r, 'D')).toBeLessThan(1e-4);
  });

  it('an LED straight across a battery converges and is over the limit', () => {
    const r = solve([battery('B', 'p', 'n', 9), led('D', 'p', 'n')]);
    expect(r.converged).toBe(true);
    expect(r.overCurrent).toEqual(['D']);
  });

  it('a red and a blue LED in parallel: the red one takes the current', () => {
    const r = solve([
      battery('B', 'p', 'n', 9),
      resistor('R', 'p', 'a', 330),
      led('RED', 'a', 'n', 1.8),
      led('BLUE', 'a', 'n', 3.0),
    ]);
    expect(I(r, 'BLUE')).toBeLessThan(1e-6);
    expect(I(r, 'RED')).toBeGreaterThan(0.02);
  });

  it('two LEDs in series with a resistor', () => {
    // 9 = 1.8 + 1.8 + 270 I  ->  I = 20 mA.
    const r = solve([
      battery('B', 'p', 'n', 9),
      resistor('R', 'p', 'a', 270),
      led('D1', 'a', 'b'),
      led('D2', 'b', 'n'),
    ]);
    expect(I(r, 'D1')).toBeCloseTo(0.02, 8);
    expect(I(r, 'D2')).toBeCloseTo(0.02, 8);
  });
});

describe('burnout', () => {
  it('an LED over the limit burns and opens the circuit', () => {
    const { result, burnt, parts } = solveWithBurnout([
      battery('B', 'p', 'n', 9),
      resistor('R', 'p', 'a', 100),
      led('D', 'a', 'n'),
    ]);
    expect(burnt).toEqual(['D']);
    expect(parts.find((p) => p.id === 'D')!.burnt).toBe(true);
    expect(I(result, 'R')).toBe(0);
    expect(result.status).toBe('open');
  });

  it('two LEDs in series: one burns and the other survives', () => {
    const { burnt } = solveWithBurnout([
      battery('B', 'p', 'n', 9),
      resistor('R', 'p', 'a', 47),
      led('D1', 'a', 'b'),
      led('D2', 'b', 'n'),
    ]);
    expect(burnt).toHaveLength(1);
  });

  it('LEDs within the limit are left alone', () => {
    const { burnt } = solveWithBurnout([
      battery('B', 'p', 'n', 9),
      resistor('R', 'p', 'a', 360),
      led('D', 'a', 'n'),
    ]);
    expect(burnt).toEqual([]);
  });
});

describe('brightness', () => {
  it('an LED at 20 mA is fully on and a lamp scales with its rated current', () => {
    const parts = [
      battery('B', 'p', 'n', 9),
      resistor('R', 'p', 'a', 360),
      led('D', 'a', 'n'),
      { ...lamp('L', 'p', 'n', 18), rated: 18 },
    ];
    const r = solve(parts);
    expect(brightness(parts[2], r.parts.get('D'))).toBeCloseTo(1, 6);
    // 9 V on a lamp rated for 18 V: half its rated current.
    expect(brightness(parts[3], r.parts.get('L'))).toBeCloseTo(0.5, 12);
  });
});
