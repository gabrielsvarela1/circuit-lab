import { describe, expect, it } from 'vitest';
import { SingularMatrixError, solveLinear } from '../gauss';

describe('solveLinear', () => {
  it('solves a 3x3 system that needs pivoting', () => {
    // x = 1, y = 2, z = 3
    const x = solveLinear(
      [
        [0, 2, 1],
        [1, 1, 1],
        [2, 0, -1],
      ],
      [7, 6, -1],
    );
    expect(x[0]).toBeCloseTo(1, 12);
    expect(x[1]).toBeCloseTo(2, 12);
    expect(x[2]).toBeCloseTo(3, 12);
  });

  it('rejects a singular matrix', () => {
    expect(() =>
      solveLinear(
        [
          [1, 2],
          [2, 4],
        ],
        [1, 2],
      ),
    ).toThrow(SingularMatrixError);
  });
});
