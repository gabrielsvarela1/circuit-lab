import { describe, expect, it } from 'vitest';
import { solve } from '../solve';
import { ammeter, battery, I, lamp, P, resistor, V, voltmeter, wire } from './helpers';

describe('textbook circuits', () => {
  it('series: 9 V across 100 Ω + 200 Ω', () => {
    // I = 9 / (100 + 200) = 30 mA; V1 = 3 V; V2 = 6 V.
    const r = solve([
      battery('B', 'p', 'n', 9),
      resistor('R1', 'p', 'm', 100),
      resistor('R2', 'm', 'n', 200),
    ]);
    expect(r.status).toBe('ok');
    expect(I(r, 'R1')).toBeCloseTo(0.03, 12);
    expect(I(r, 'R2')).toBeCloseTo(0.03, 12);
    expect(V(r, 'R1')).toBeCloseTo(3, 12);
    expect(V(r, 'R2')).toBeCloseTo(6, 12);
    expect(P(r, 'R1')).toBeCloseTo(0.09, 12);
    expect(P(r, 'R2')).toBeCloseTo(0.18, 12);
    // The battery delivers 9 V * 30 mA = 0.27 W. Its current flows from - to + inside.
    expect(I(r, 'B')).toBeCloseTo(-0.03, 12);
    expect(P(r, 'B')).toBeCloseTo(-0.27, 12);
  });

  it('parallel: 12 V across 100 Ω || 300 Ω', () => {
    // I1 = 120 mA, I2 = 40 mA, total 160 mA, Req = 75 Ω.
    const r = solve([
      battery('B', 'p', 'n', 12),
      resistor('R1', 'p', 'n', 100),
      resistor('R2', 'p', 'n', 300),
    ]);
    expect(I(r, 'R1')).toBeCloseTo(0.12, 12);
    expect(I(r, 'R2')).toBeCloseTo(0.04, 12);
    expect(-I(r, 'B')).toBeCloseTo(0.16, 12);
    expect(12 / -I(r, 'B')).toBeCloseTo(75, 9);
  });

  it('voltage divider: 12 V, 1 kΩ over 2 kΩ', () => {
    // Vout = 12 * 2000 / 3000 = 8 V.
    const r = solve([
      battery('B', 'p', 'n', 12),
      resistor('R1', 'p', 'out', 1000),
      resistor('R2', 'out', 'n', 2000),
      voltmeter('VM', 'out', 'n'),
    ]);
    expect(V(r, 'R2')).toBeCloseTo(8, 12);
    expect(V(r, 'VM')).toBeCloseTo(8, 12);
    expect(I(r, 'VM')).toBe(0);
  });

  it('loaded voltage divider: 2 kΩ load on the output', () => {
    // R2 || RL = 1 kΩ, so Vout = 12 * 1000 / 2000 = 6 V.
    const r = solve([
      battery('B', 'p', 'n', 12),
      resistor('R1', 'p', 'out', 1000),
      resistor('R2', 'out', 'n', 2000),
      resistor('RL', 'out', 'n', 2000),
    ]);
    expect(V(r, 'RL')).toBeCloseTo(6, 12);
    expect(I(r, 'RL')).toBeCloseTo(0.003, 12);
  });

  it('balanced Wheatstone bridge: no current in the ammeter', () => {
    // R1 / R2 = R3 / R4 = 1/2, so both midpoints sit at 10 * 2/3 V.
    const r = solve([
      battery('B', 't', 'g', 10),
      resistor('R1', 't', 'L', 100),
      resistor('R2', 'L', 'g', 200),
      resistor('R3', 't', 'M', 150),
      resistor('R4', 'M', 'g', 300),
      ammeter('A', 'L', 'M'),
    ]);
    expect(I(r, 'A')).toBeCloseTo(0, 12);
    expect(V(r, 'R2')).toBeCloseTo(20 / 3, 12);
    expect(V(r, 'R4')).toBeCloseTo(20 / 3, 12);
  });

  it('unbalanced Wheatstone bridge with a 100 Ω bridge resistor', () => {
    // Nodal analysis by hand (all in Ω and V):
    //   L: (L - 10)/100 + L/100 + (L - M)/100 = 0  ->  3L - M = 10
    //   M: (M - 10)/200 + M/100 + (M - L)/100 = 0  ->  5M - 2L = 10
    //   L = 60/13 V, M = 50/13 V, I5 = (L - M)/100 = 1/130 A.
    const r = solve([
      battery('B', 't', 'g', 10),
      resistor('R1', 't', 'L', 100),
      resistor('R2', 'L', 'g', 100),
      resistor('R3', 't', 'M', 200),
      resistor('R4', 'M', 'g', 100),
      resistor('R5', 'L', 'M', 100),
    ]);
    expect(V(r, 'R2')).toBeCloseTo(60 / 13, 12);
    expect(V(r, 'R4')).toBeCloseTo(50 / 13, 12);
    expect(I(r, 'R5')).toBeCloseTo(1 / 130, 12);
  });

  it('two meshes with two batteries (Kirchhoff)', () => {
    // E1 = 10 V with R1 = 200 Ω, E2 = 4 V with R2 = 400 Ω, R3 = 400 Ω shared.
    // Mesh currents (clockwise, J1 left, J2 right):
    //   10 = 200 J1 + 400 (J1 - J2)  ->  600 J1 - 400 J2 = 10
    //   -4 = 400 J2 + 400 (J2 - J1)  ->  -400 J1 + 800 J2 = -4
    //   J1 = 20 mA, J2 = 5 mA, so I(R3) = J1 - J2 = 15 mA and E2 is charged with 5 mA.
    const r = solve([
      battery('E1', 'a', 'g', 10),
      resistor('R1', 'a', 'x', 200),
      resistor('R3', 'x', 'g', 400),
      resistor('R2', 'x', 'b', 400),
      battery('E2', 'b', 'g', 4),
    ]);
    expect(I(r, 'R1')).toBeCloseTo(0.02, 12);
    expect(I(r, 'R3')).toBeCloseTo(0.015, 12);
    expect(I(r, 'R2')).toBeCloseTo(0.005, 12);
    expect(I(r, 'E2')).toBeCloseTo(0.005, 12);
    expect(P(r, 'E2')).toBeCloseTo(0.02, 12);
    expect(r.nodes.get('x')).toBeCloseTo(6, 12);
  });

  it('a lamp behaves as a resistor', () => {
    const r = solve([battery('B', 'p', 'n', 6), lamp('L', 'p', 'n', 12)]);
    expect(I(r, 'L')).toBeCloseTo(0.5, 12);
    expect(P(r, 'L')).toBeCloseTo(3, 12);
  });

  it('batteries in series add up', () => {
    const r = solve([
      battery('B1', 'p', 'm', 1.5),
      battery('B2', 'm', 'n', 1.5),
      resistor('R', 'p', 'n', 30),
    ]);
    expect(I(r, 'R')).toBeCloseTo(0.1, 12);
  });

  it('equal batteries in parallel are accepted', () => {
    const r = solve([
      battery('B1', 'p', 'n', 9),
      battery('B2', 'p', 'n', 9),
      resistor('R', 'p', 'n', 90),
    ]);
    expect(r.status).toBe('ok');
    expect(I(r, 'R')).toBeCloseTo(0.1, 12);
    expect(I(r, 'B1') + I(r, 'B2')).toBeCloseTo(-0.1, 12);
  });

  it('wires join nodes and carry the loop current', () => {
    const r = solve([
      battery('B', 'p', 'n', 9),
      wire('W1', 'p', 'q'),
      resistor('R', 'q', 'r', 90),
      wire('W2', 'r', 's'),
      wire('W3', 's', 'n'),
    ]);
    expect(I(r, 'R')).toBeCloseTo(0.1, 12);
    expect(I(r, 'W1')).toBeCloseTo(0.1, 12);
    expect(I(r, 'W2')).toBeCloseTo(0.1, 12);
    expect(I(r, 'W3')).toBeCloseTo(0.1, 12);
  });

  it('current splits at a wire junction by Kirchhoff\'s current law', () => {
    // p -W1- j, then j -W2- k1 -R1- n and j -W3- k2 -R2- n.
    const r = solve([
      battery('B', 'p', 'n', 6),
      wire('W1', 'p', 'j'),
      wire('W2', 'j', 'k1'),
      wire('W3', 'j', 'k2'),
      resistor('R1', 'k1', 'n', 100),
      resistor('R2', 'k2', 'n', 300),
    ]);
    expect(I(r, 'W1')).toBeCloseTo(0.08, 12);
    expect(I(r, 'W2')).toBeCloseTo(0.06, 12);
    expect(I(r, 'W3')).toBeCloseTo(0.02, 12);
  });

  it('two parallel wires of the same length share the current', () => {
    const r = solve([
      battery('B', 'p', 'n', 9),
      wire('W1', 'p', 'q', 2),
      wire('W2', 'p', 'q', 2),
      resistor('R', 'q', 'n', 90),
    ]);
    expect(I(r, 'W1')).toBeCloseTo(0.05, 12);
    expect(I(r, 'W2')).toBeCloseTo(0.05, 12);
  });
});
