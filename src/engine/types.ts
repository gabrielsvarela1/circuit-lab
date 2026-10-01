export type PartKind =
  | 'battery'
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
 * - battery: `a` is the positive terminal, so V(a) - V(b) = value.
 * - led: `a` is the anode, `b` the cathode.
 * - ammeter / voltmeter: `a` is the red (+) probe.
 */
export interface Part {
  id: string;
  kind: PartKind;
  a: string;
  b: string;
  /** battery: EMF in volts. resistor, lamp: resistance in ohms. */
  value?: number;
  /** switch: true when closed. */
  closed?: boolean;
  /** led: forward voltage at the nominal current (20 mA). */
  vf?: number;
  /** led: a burnt LED behaves as an open circuit. */
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
  /** No battery in the circuit. */
  | 'empty'
  | 'ok'
  /** Every battery is missing a closed path back to itself. */
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
  /** Batteries with no closed path. */
  openSources: string[];
  /** LEDs above their maximum current. */
  overCurrent: string[];
  /** False when Newton's method did not converge. */
  converged: boolean;
  iterations: number;
}
