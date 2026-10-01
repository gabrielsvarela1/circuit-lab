import { solve } from './engine';

const app = document.querySelector<HTMLDivElement>('#app')!;
const r = solve([
  { id: 'B', kind: 'battery', a: 'p', b: 'n', value: 9 },
  { id: 'R', kind: 'resistor', a: 'p', b: 'n', value: 90 },
]);
app.textContent = `I = ${r.parts.get('R')!.i} A`;
