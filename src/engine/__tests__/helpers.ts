import type { Part, SolveResult } from '../types';

export const battery = (id: string, a: string, b: string, value: number): Part => ({ id, kind: 'battery', a, b, value });
export const resistor = (id: string, a: string, b: string, value: number): Part => ({ id, kind: 'resistor', a, b, value });
export const lamp = (id: string, a: string, b: string, value: number): Part => ({ id, kind: 'lamp', a, b, value });
export const led = (id: string, a: string, b: string, vf = 1.8): Part => ({ id, kind: 'led', a, b, vf });
export const wire = (id: string, a: string, b: string, length = 1): Part => ({ id, kind: 'wire', a, b, length });
export const sw = (id: string, a: string, b: string, closed: boolean): Part => ({ id, kind: 'switch', a, b, closed });
export const ammeter = (id: string, a: string, b: string): Part => ({ id, kind: 'ammeter', a, b });
export const voltmeter = (id: string, a: string, b: string): Part => ({ id, kind: 'voltmeter', a, b });

export const I = (r: SolveResult, id: string) => r.parts.get(id)!.i;
export const V = (r: SolveResult, id: string) => r.parts.get(id)!.v;
export const P = (r: SolveResult, id: string) => r.parts.get(id)!.p;
