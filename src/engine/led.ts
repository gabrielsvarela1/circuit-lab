/**
 * LED model: Shockley diode equation I = Is * (exp(V / (n * Vt)) - 1).
 * Is is chosen so that the LED conducts its nominal current at its forward voltage.
 */

export const LED_NOMINAL_CURRENT = 0.02;
export const LED_MAX_CURRENT = 0.03;
export const LED_DEFAULT_VF = 1.8;

/** Emission coefficient times thermal voltage at 300 K. */
export const LED_NVT = 2 * 0.025852;

/** Small conductance in parallel with every LED so reverse-biased nodes stay solvable. */
export const GMIN = 1e-9;

/**
 * Above this current the exponential continues as a straight line, so an LED
 * straight across a battery gives a large but finite current instead of overflowing.
 */
const LINEAR_ABOVE = 1;

export interface LedModel {
  is: number;
  nvt: number;
  vcrit: number;
  /** Voltage at which the current reaches LINEAR_ABOVE. */
  vmax: number;
}

export function ledModel(vf = LED_DEFAULT_VF): LedModel {
  const nvt = LED_NVT;
  const is = LED_NOMINAL_CURRENT / Math.expm1(vf / nvt);
  return {
    is,
    nvt,
    vcrit: nvt * Math.log(nvt / (Math.SQRT2 * is)),
    vmax: nvt * Math.log1p(LINEAR_ABOVE / is),
  };
}

export function ledCurrent(m: LedModel, v: number): number {
  if (v > m.vmax) return ledCurrent(m, m.vmax) + (ledConductance(m, m.vmax) - GMIN) * (v - m.vmax);
  return m.is * Math.expm1(v / m.nvt) + GMIN * v;
}

/** dI/dV */
export function ledConductance(m: LedModel, v: number): number {
  return (m.is / m.nvt) * Math.exp(Math.min(v, m.vmax) / m.nvt) + GMIN;
}

/**
 * Limits the change of the diode voltage between Newton iterations
 * (the "pnjlim" rule from SPICE). Without it, a large step lands deep in the
 * exponential and the next iteration overflows or oscillates.
 */
export function limitStep(m: LedModel, vNew: number, vOld: number): number {
  if (vNew > m.vcrit && Math.abs(vNew - vOld) > 2 * m.nvt) {
    if (vOld > 0) {
      const arg = 1 + (vNew - vOld) / m.nvt;
      return arg > 0 ? vOld + m.nvt * Math.log(arg) : m.vcrit;
    }
    return m.nvt * Math.log(vNew / m.nvt);
  }
  return vNew;
}
