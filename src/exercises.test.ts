import { describe, expect, it } from 'vitest';
import { EXERCISES, readAnswer, UNIT_SCALE } from './exercises';
import { parseValue } from './format';

describe('exercises', () => {
  it('has between 5 and 8 exercises', () => {
    expect(EXERCISES.length).toBeGreaterThanOrEqual(5);
    expect(EXERCISES.length).toBeLessThanOrEqual(8);
  });

  it.each(EXERCISES.map((e) => [e.title, e] as const))('%s: the hand-calculated answer is accepted', (_, ex) => {
    expect(ex.check(ex.answer * UNIT_SCALE[ex.unit]).ok).toBe(true);
  });

  it.each(EXERCISES.map((e) => [e.title, e] as const))('%s: an answer 20 %% off is rejected', (_, ex) => {
    expect(ex.check(ex.answer * UNIT_SCALE[ex.unit] * 1.2).ok).toBe(false);
    expect(ex.check(ex.answer * UNIT_SCALE[ex.unit] * 0.8).ok).toBe(false);
  });

  it('the LED exercise reports the current the simulator measured', () => {
    const led = EXERCISES.find((e) => e.id === 'led')!;
    const result = led.check(330);
    expect(result.ok).toBe(false);
    expect(result.note).toBe('Com R1 = 330 Ω o LED fica com 21,8 mA.');
  });
});

describe('readAnswer', () => {
  it('takes bare numbers in the unit of the question', () => {
    expect(readAnswer('30', 'mA', parseValue)).toBeCloseTo(0.03, 12);
    expect(readAnswer('22,5', 'mA', parseValue)).toBeCloseTo(0.0225, 12);
    expect(readAnswer('360', 'Ω', parseValue)).toBe(360);
  });

  it('accepts an explicit unit', () => {
    expect(readAnswer('0,03 A', 'mA', parseValue)).toBeCloseTo(0.03, 12);
    expect(readAnswer('30 mA', 'mA', parseValue)).toBeCloseTo(0.03, 12);
    expect(readAnswer('360 Ω', 'Ω', parseValue)).toBe(360);
    expect(readAnswer('1,33 W', 'W', parseValue)).toBeCloseTo(1.33, 12);
  });

  it('rejects text that is not a number', () => {
    expect(readAnswer('', 'mA', parseValue)).toBeNull();
    expect(readAnswer('abc', 'mA', parseValue)).toBeNull();
  });
});
