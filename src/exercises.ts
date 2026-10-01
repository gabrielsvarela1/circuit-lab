import { solve } from './engine';
import { bridge, divider, el, mixed, parallel, seriesLoop, twoMeshes } from './examples';
import { type Circuit, toParts, update } from './model';

export type Unit = 'A' | 'mA' | 'V' | 'W' | 'Ω';

export const UNIT_SCALE: Record<Unit, number> = { A: 1, mA: 1e-3, V: 1, W: 1, Ω: 1 };

export interface CheckResult {
  ok: boolean;
  /** What the simulator measured with the user's answer (design exercises). */
  note?: string;
  /** The circuit with the user's answer applied (design exercises). */
  circuit?: Circuit;
}

export interface Exercise {
  id: string;
  title: string;
  question: string;
  unit: Unit;
  /** Hand-calculated answer, in `unit`. */
  answer: number;
  hint: string;
  solution: string;
  build(): Circuit;
  /** `value` is in base units (A, V, W, Ω). */
  check(value: number): CheckResult;
}

const find = (c: Circuit, name: string) => c.elements.find((e) => e.name === name)!;

/**
 * Asks for a quantity of one part. The expected value comes from the
 * simulator; the hand-calculated `answer` is checked against it in the tests.
 * Answers within 2 % are accepted, so rounding to three digits is fine.
 */
function measure(
  base: Omit<Exercise, 'check' | 'answer' | 'unit'> & { unit: Unit; answer: number },
  target: string,
  quantity: 'i' | 'v' | 'p',
): Exercise {
  return {
    ...base,
    check(value) {
      const c = base.build();
      const r = solve(toParts(c)).parts.get(find(c, target).id)!;
      const expected = Math.abs(r[quantity]);
      return { ok: Math.abs(Math.abs(value) - expected) <= 0.02 * expected };
    },
  };
}

const LED_TARGET = 0.02;

export const EXERCISES: Exercise[] = [
  measure(
    {
      id: 'ohm',
      title: 'Lei de Ohm',
      question: 'A pilha E1 tem 9 V e as resistências estão em série. Qual é a corrente no circuito?',
      unit: 'mA',
      answer: 30,
      hint: 'Em série, as resistências somam-se. Depois usa I = U / R.',
      solution: 'R = 100 + 200 = 300 Ω. I = U / R = 9 / 300 = 0,03 A = 30 mA.',
      build: () => seriesLoop(9, 100, el('resistor', 'R2', 6, 0, 1, { value: 200 })),
    },
    'R1',
    'i',
  ),
  measure(
    {
      id: 'divider',
      title: 'Divisor de tensão',
      question: 'Qual é a tensão aos terminais de R2?',
      unit: 'V',
      answer: 8,
      hint: 'A corrente é a mesma nas duas resistências. A tensão divide-se na proporção das resistências.',
      solution: 'U2 = E × R2 / (R1 + R2) = 12 × 2000 / 3000 = 8 V.',
      build: () => divider(12, 1000, 2000),
    },
    'R2',
    'v',
  ),
  measure(
    {
      id: 'parallel',
      title: 'Resistências em paralelo',
      question: 'Qual é a corrente total que a pilha E1 fornece?',
      unit: 'mA',
      answer: 80,
      hint: 'Em paralelo, cada resistência tem os 6 V da pilha. Soma as correntes dos ramos.',
      solution: 'I1 = 6 / 100 = 60 mA, I2 = 6 / 300 = 20 mA. Total: 80 mA. (Ou Req = 100 × 300 / 400 = 75 Ω, e 6 / 75 = 80 mA.)',
      build: () =>
        parallel(6, el('resistor', 'R1', 3, 1, 1, { value: 100 }), el('resistor', 'R2', 6, 1, 1, { value: 300 })),
    },
    'E1',
    'i',
  ),
  measure(
    {
      id: 'mixed',
      title: 'Circuito misto',
      question: 'R2 e R3 estão em paralelo, e o conjunto está em série com R1. Qual é a corrente em R2?',
      unit: 'mA',
      answer: 22.5,
      hint: 'Começa por substituir R2 e R3 por uma só resistência. Depois encontra a corrente total.',
      solution:
        'R2 // R3 = 200 × 200 / 400 = 100 Ω. R total = 100 + 100 = 200 Ω, I = 9 / 200 = 45 mA. Como R2 = R3, a corrente divide-se ao meio: 22,5 mA.',
      build: () => mixed(9, 100, 200, 200),
    },
    'R2',
    'i',
  ),
  measure(
    {
      id: 'power',
      title: 'Potência numa lâmpada',
      question: 'A lâmpada L1 tem 48 Ω e está em série com R1. Que potência dissipa a lâmpada?',
      unit: 'W',
      answer: 4 / 3,
      hint: 'Encontra a corrente e depois usa P = R × I².',
      solution: 'I = 12 / (24 + 48) = 1/6 A ≈ 0,167 A. P = 48 × (1/6)² ≈ 1,33 W.',
      build: () => seriesLoop(12, 24, el('lamp', 'L1', 6, 0, 1, { value: 48, rated: 12 })),
    },
    'L1',
    'p',
  ),
  {
    id: 'led',
    title: 'Resistência para um LED',
    question:
      'O LED vermelho conduz 20 mA quando tem 1,8 V aos terminais. Que resistência deve ter R1 para o LED funcionar a 20 mA com uma pilha de 9 V?',
    unit: 'Ω',
    answer: 360,
    hint: 'A resistência fica com a tensão que sobra: 9 V menos a tensão do LED.',
    solution: 'R = (9 − 1,8) / 0,02 = 7,2 / 0,02 = 360 Ω.',
    build: () => seriesLoop(9, 1000, el('led', 'D1', 6, 0, 1, { vf: 1.8 })),
    check(value) {
      if (!(value > 0)) return { ok: false };
      const base = this.build();
      const c = update(base, find(base, 'R1').id, { value });
      const i = solve(toParts(c)).parts.get(find(c, 'D1').id)!.i;
      const ma = (i * 1000).toFixed(1).replace('.', ',');
      return {
        ok: Math.abs(i - LED_TARGET) <= 0.03 * LED_TARGET,
        note: `Com R1 = ${value} Ω o LED fica com ${ma} mA.`,
        circuit: c,
      };
    },
  },
  measure(
    {
      id: 'kirchhoff',
      title: 'Leis de Kirchhoff',
      question: 'Duas pilhas (10 V e 4 V) partilham a resistência R3. Qual é a corrente em R3?',
      unit: 'mA',
      answer: 15,
      hint: 'Chama U à tensão do nó por cima de R3. A soma das correntes que saem desse nó é zero.',
      solution:
        '(U − 10) / 200 + U / 400 + (U − 4) / 400 = 0, que dá 2U − 20 + U + U − 4 = 0, ou seja U = 6 V. I3 = 6 / 400 = 15 mA.',
      build: () => twoMeshes(10, 4, 200, 400, 400),
    },
    'R3',
    'i',
  ),
  {
    id: 'wheatstone',
    title: 'Ponte de Wheatstone',
    question: 'Que valor deve ter R4 para a ponte ficar equilibrada, ou seja, para o amperímetro A1 marcar 0 A?',
    unit: 'Ω',
    answer: 300,
    hint: 'A ponte está equilibrada quando R1 / R2 = R3 / R4.',
    solution: 'R4 = R3 × R2 / R1 = 150 × 200 / 100 = 300 Ω.',
    build: () => bridge(10, 100, 200, 150, 100),
    check(value) {
      if (!(value > 0)) return { ok: false };
      const base = this.build();
      const c = update(base, find(base, 'R4').id, { value });
      const i = Math.abs(solve(toParts(c)).parts.get(find(c, 'A1').id)!.i);
      const ua = Math.round(i * 1e6);
      return {
        ok: i < 0.15e-3,
        note: `Com R4 = ${value} Ω o amperímetro marca ${ua} µA.`,
        circuit: c,
      };
    },
  },
];

/** Reads an answer: a bare number is taken in the exercise's unit; "30 mA" or "0,03 A" also work. */
export function readAnswer(text: string, unit: Unit, parse: (s: string) => number | null): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (/[a-zA-Zµ]/.test(trimmed.replace(/Ω|ohms?/gi, ''))) {
    // The user wrote a unit or a prefix; mA must stay milli, not mega.
    return parse(trimmed);
  }
  const n = parse(trimmed);
  return n === null ? null : n * UNIT_SCALE[unit];
}
