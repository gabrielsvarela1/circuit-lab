export type PartKind =
  | 'battery'
  | 'ac'
  | 'resistor'
  | 'lamp'
  | 'led'
  | 'switch'
  | 'wire'
  | 'ammeter'
  | 'voltmeter';

/**
 * A two-terminal element connected between nodes `a` and `b`.
 *
 * Polarity conventions:
 * - battery: `a` is the positive terminal; with no load V(a) - V(b) = value.
 * - ac: with no load V(a) - V(b) = value * √2 * sin(2π * freq * t).
 * - led: `a` is the anode, `b` the cathode.
 * - ammeter / voltmeter: `a` is the red (+) probe.
 */
export interface Part {
  id: string;
  kind: PartKind;
  a: string;
  b: string;
  /** battery: EMF in volts. ac: RMS voltage. resistor, lamp: resistance in ohms. */
  value?: number;
  /** battery, ac: internal resistance in ohms (0 or missing for an ideal source). */
  r?: number;
  /** ac: frequency in hertz. */
  freq?: number;
  /** switch: true when closed. */
  closed?: boolean;
  /** led: forward voltage at the nominal current (20 mA). */
  vf?: number;
  /** led, lamp: a burnt part behaves as an open circuit. */
  burnt?: boolean;
  /** lamp: voltage at which it reaches full brightness. */
  rated?: number;
  /** wire: length, used to split current between parallel wires. */
  length?: number;
}

export interface PartResult {
  /** V(a) - V(b). NaN when a and b are in separate, unconnected parts of the circuit. */
  v: number;
  /** Current flowing through the part from `a` to `b`. */
  i: number;
  /** Power absorbed (v * i). Negative when the part delivers power. */
  p: number;
}

export type Status =
  /** No battery or AC source in the circuit. */
  | 'empty'
  | 'ok'
  /** Every generator is missing a closed path back to itself. */
  | 'open'
  /** A loop of ideal sources and wires with a net EMF: the current would be infinite. */
  | 'short'
  /** The system could not be solved. */
  | 'error';

export interface SolveResult {
  status: Status;
  parts: Map<string, PartResult>;
  /** Voltage of each node, relative to the reference node of its connected part. */
  nodes: Map<string, number>;
  /** Parts that form the short-circuit loop. */
  shortLoop: string[];
  /** Generators with no closed path. */
  openSources: string[];
  /** LEDs and lamps above their limit, the worst first. */
  overCurrent: string[];
  /** False when Newton's method did not converge. */
  converged: boolean;
  iterations: number;
  /**
   * True when the circuit has AC sources. Results from `analyse` are then RMS
   * voltage and current (always positive) and average power.
   */
  ac: boolean;
}
