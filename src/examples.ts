import { type Circuit, type Element, type ElementKind, newId, normalize, type Rotation, type Wire } from './model';

type Props = Partial<Pick<Element, 'value' | 'closed' | 'vf' | 'rated'>>;

export function el(kind: ElementKind, name: string, x: number, y: number, rot: Rotation, props: Props = {}): Element {
  return { id: newId(), kind, name, x, y, rot, ...props };
}

/** Wires along a path of grid points. */
export function path(...pts: [number, number][]): Wire[] {
  const out: Wire[] = [];
  for (let k = 1; k < pts.length; k++) {
    const [x1, y1] = pts[k - 1];
    const [x2, y2] = pts[k];
    out.push({ id: newId(), x1, y1, x2, y2 });
  }
  return out;
}

export function circuit(elements: Element[], ...wires: Wire[][]): Circuit {
  return normalize({ elements, wires: wires.flat() });
}

// Layouts shared by the examples and the exercises. Batteries use rot 1, so
// the positive terminal is at the top; vertical parts have terminal a at the top.

/** Battery, a resistor along the top and a second part down the right side. */
export function seriesLoop(e: number, r1: number, second: Element, extra: Element[] = [], extraWires: Wire[][] = []): Circuit {
  return circuit(
    [el('battery', 'E1', 0, 0, 1, { value: e }), el('resistor', 'R1', 3, -3, 0, { value: r1 }), second, ...extra],
    path([0, -1], [0, -3], [2, -3]),
    path([4, -3], [6, -3], [6, -1]),
    path([6, 1], [6, 3], [0, 3], [0, 1]),
    ...extraWires,
  );
}

/** Battery feeding R1 over R2 (vertical), output in the middle. */
export function divider(e: number, r1: number, r2: number, meter = false): Circuit {
  const elements = [
    el('battery', 'E1', 0, 1, 1, { value: e }),
    el('resistor', 'R1', 3, 0, 1, { value: r1 }),
    el('resistor', 'R2', 3, 3, 1, { value: r2 }),
  ];
  const wires = [path([0, 0], [0, -2], [3, -2], [3, -1]), path([3, 1], [3, 2]), path([3, 4], [3, 5], [0, 5], [0, 2])];
  if (meter) {
    elements.push(el('voltmeter', 'V1', 6, 3, 1));
    wires.push(path([3, 2], [6, 2]), path([3, 4], [6, 4]));
  }
  return circuit(elements, ...wires);
}

/** Battery with two vertical parts in parallel. */
export function parallel(e: number, a: Element, b: Element): Circuit {
  return circuit(
    [el('battery', 'E1', 0, 1, 1, { value: e }), a, b],
    path([0, 0], [0, -1], [6, -1], [6, 0]),
    path([3, -1], [3, 0]),
    path([0, 2], [0, 3], [6, 3], [6, 2]),
    path([3, 2], [3, 3]),
  );
}

/** R1 in series with R2 || R3. */
export function mixed(e: number, r1: number, r2: number, r3: number): Circuit {
  return circuit(
    [
      el('battery', 'E1', 0, 1, 1, { value: e }),
      el('resistor', 'R1', 2, -1, 0, { value: r1 }),
      el('resistor', 'R2', 4, 1, 1, { value: r2 }),
      el('resistor', 'R3', 7, 1, 1, { value: r3 }),
    ],
    path([0, 0], [0, -1], [1, -1]),
    path([3, -1], [7, -1], [7, 0]),
    path([4, -1], [4, 0]),
    path([0, 2], [0, 3], [7, 3], [7, 2]),
    path([4, 2], [4, 3]),
  );
}

/** Wheatstone bridge with an ammeter between the two midpoints. */
export function bridge(e: number, r1: number, r2: number, r3: number, r4: number): Circuit {
  return circuit(
    [
      el('battery', 'E1', 0, 1, 1, { value: e }),
      el('resistor', 'R1', 3, 0, 1, { value: r1 }),
      el('resistor', 'R2', 3, 3, 1, { value: r2 }),
      el('resistor', 'R3', 7, 0, 1, { value: r3 }),
      el('resistor', 'R4', 7, 3, 1, { value: r4 }),
      el('ammeter', 'A1', 5, 2, 0),
    ],
    path([0, 0], [0, -2], [7, -2], [7, -1]),
    path([3, -2], [3, -1]),
    path([3, 1], [3, 2], [4, 2]),
    path([7, 1], [7, 2], [6, 2]),
    path([0, 2], [0, 5], [7, 5], [7, 4]),
    path([3, 4], [3, 5]),
  );
}

/** Two batteries sharing R3: E1 with R1 on the left, E2 with R2 on the right. */
export function twoMeshes(e1: number, e2: number, r1: number, r2: number, r3: number): Circuit {
  return circuit(
    [
      el('battery', 'E1', 0, 1, 1, { value: e1 }),
      el('resistor', 'R1', 2, -2, 0, { value: r1 }),
      el('resistor', 'R3', 4, 1, 1, { value: r3 }),
      el('resistor', 'R2', 6, -2, 0, { value: r2 }),
      el('battery', 'E2', 8, 1, 1, { value: e2 }),
    ],
    path([0, 0], [0, -2], [1, -2]),
    path([3, -2], [5, -2]),
    path([4, -2], [4, 0]),
    path([7, -2], [8, -2], [8, 0]),
    path([0, 2], [0, 4], [8, 4], [8, 2]),
    path([4, 2], [4, 4]),
  );
}

export interface Example {
  title: string;
  description: string;
  build(): Circuit;
}

export const EXAMPLES: Example[] = [
  {
    title: 'LED com resistência',
    description: '9 V, 360 Ω e um LED vermelho: 20 mA, a corrente nominal do LED.',
    build: () => seriesLoop(9, 360, el('led', 'D1', 6, 0, 1, { vf: 1.8 })),
  },
  {
    title: 'Série com amperímetro e voltímetro',
    description: 'O amperímetro liga-se em série e o voltímetro em paralelo com R2.',
    build: () =>
      circuit(
        [
          el('battery', 'E1', 0, 0, 1, { value: 9 }),
          el('resistor', 'R1', 2, -3, 0, { value: 100 }),
          el('ammeter', 'A1', 5, -3, 0),
          el('resistor', 'R2', 7, 0, 1, { value: 200 }),
          el('voltmeter', 'V1', 10, 0, 1),
        ],
        path([0, -1], [0, -3], [1, -3]),
        path([3, -3], [4, -3]),
        path([6, -3], [7, -3], [7, -1]),
        path([7, 1], [7, 3], [0, 3], [0, 1]),
        path([7, -1], [10, -1]),
        path([7, 1], [10, 1]),
      ),
  },
  {
    title: 'Lâmpadas em paralelo',
    description: 'Cada lâmpada tem o seu interruptor. Liga e desliga para ver a corrente total mudar.',
    build: () =>
      circuit(
        [
          el('battery', 'E1', 0, 0, 1, { value: 9 }),
          el('switch', 'S1', 2, -3, 0, { closed: true }),
          el('switch', 'S2', 4, -2, 1, { closed: true }),
          el('lamp', 'L1', 4, 1, 1, { value: 30, rated: 9 }),
          el('switch', 'S3', 7, -2, 1, { closed: false }),
          el('lamp', 'L2', 7, 1, 1, { value: 30, rated: 9 }),
        ],
        path([0, -1], [0, -3], [1, -3]),
        path([3, -3], [7, -3]),
        path([4, -1], [4, 0]),
        path([7, -1], [7, 0]),
        path([7, 2], [7, 4], [0, 4], [0, 1]),
        path([4, 2], [4, 4]),
      ),
  },
  {
    title: 'Divisor de tensão',
    description: '12 V divididos por 1 kΩ e 2 kΩ: o voltímetro mostra 8 V à saída.',
    build: () => divider(12, 1000, 2000, true),
  },
  {
    title: 'Ponte de Wheatstone',
    description: 'R1/R2 = R3/R4, por isso a ponte está equilibrada e o amperímetro marca 0 A. Muda R4 para a desequilibrar.',
    build: () => bridge(10, 100, 200, 150, 300),
  },
  {
    title: 'Duas malhas',
    description: 'Duas pilhas partilham R3. Com 10 V e 4 V, a pilha E2 acaba por ser carregada.',
    build: () => twoMeshes(10, 4, 200, 400, 400),
  },
  {
    title: 'Três LEDs',
    description: 'Vermelho, amarelo e verde, cada um com a sua resistência e interruptor.',
    build: () => {
      const elements = [el('battery', 'E1', 0, 1, 1, { value: 9 })];
      const colours = [1.8, 2.0, 2.2];
      colours.forEach((vf, k) => {
        const x = 3 + 3 * k;
        elements.push(
          el('switch', `S${k + 1}`, x, -1, 1, { closed: k !== 1 }),
          el('resistor', `R${k + 1}`, x, 1, 1, { value: 360 }),
          el('led', `D${k + 1}`, x, 3, 1, { vf }),
        );
      });
      return circuit(elements, path([0, 0], [0, -2], [9, -2]), path([0, 2], [0, 4], [9, 4]));
    },
  },
];
