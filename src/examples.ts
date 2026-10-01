import { type Circuit, type Element, type ElementKind, newId, normalize, type Rotation, type Wire } from './model';

type Props = Partial<Pick<Element, 'value' | 'closed' | 'vf' | 'rated'>>;

function el(kind: ElementKind, name: string, x: number, y: number, rot: Rotation, props: Props = {}): Element {
  return { id: newId(), kind, name, x, y, rot, ...props };
}

/** Wires along a path of grid points. */
function path(...pts: [number, number][]): Wire[] {
  const out: Wire[] = [];
  for (let k = 1; k < pts.length; k++) {
    const [x1, y1] = pts[k - 1];
    const [x2, y2] = pts[k];
    out.push({ id: newId(), x1, y1, x2, y2 });
  }
  return out;
}

function circuit(elements: Element[], ...wires: Wire[][]): Circuit {
  return normalize({ elements, wires: wires.flat() });
}

export interface Example {
  title: string;
  description: string;
  build(): Circuit;
}

// Batteries use rot 1, so the positive terminal (a) is at the top.
export const EXAMPLES: Example[] = [
  {
    title: 'LED com resistência',
    description: '9 V, 360 Ω e um LED vermelho: 20 mA, a corrente nominal do LED.',
    build: () =>
      circuit(
        [el('battery', 'E1', 0, 0, 1, { value: 9 }), el('resistor', 'R1', 3, -3, 0, { value: 360 }), el('led', 'D1', 6, 0, 1, { vf: 1.8 })],
        path([0, -1], [0, -3], [2, -3]),
        path([4, -3], [6, -3], [6, -1]),
        path([6, 1], [6, 3], [0, 3], [0, 1]),
      ),
  },
];
