import type { SolveResult } from '../engine';
import { formatSI } from '../format';
import { type Circuit, LABELS } from '../model';

/** Short V, I and P summary for an element or wire. */
export function tooltipHtml(c: Circuit, id: string, r: SolveResult | null, showValues: boolean): string | null {
  const element = c.elements.find((e) => e.id === id);
  const wire = c.wires.find((w) => w.id === id);
  if (!element && !wire) return null;
  const title = element ? `<strong>${element.name}</strong> ${LABELS[element.kind]}` : '<strong>Fio</strong>';
  const part = r?.parts.get(id);
  if (!part || !r || r.status === 'short' || r.status === 'error') return title;
  if (!showValues) return `${title}<br><span class="muted">Valores escondidos</span>`;

  const v = formatSI(Math.abs(part.v), 'V');
  const i = formatSI(Math.abs(part.i), 'A');
  const p = formatSI(Math.abs(part.p), 'W');
  const kind = element?.kind;
  let rows: string;
  if (!element) rows = `I = ${i}`;
  else if (kind === 'ammeter') rows = `I = ${formatSI(part.i, 'A')}`;
  else if (kind === 'voltmeter') rows = `V = ${formatSI(part.v, 'V')}`;
  else if (kind === 'switch') rows = element.closed ? `I = ${i}` : `V = ${v}`;
  else rows = `V = ${v} · I = ${i} · P = ${p}`;
  const burnt = element?.burnt ? '<br><span class="warning">Queimado</span>' : '';
  return `${title}<br>${rows}${burnt}`;
}
