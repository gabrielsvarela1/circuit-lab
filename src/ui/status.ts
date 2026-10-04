import type { SolveResult } from '../engine';
import { formatSI } from '../format';
import type { Circuit } from '../model';

export interface StatusMessage {
  level: 'info' | 'warning' | 'danger';
  text: string;
}

/** Above this current a generator gets a warning: in practice it is close to a short circuit. */
export const HIGH_CURRENT = 2;

export function statusMessage(c: Circuit, r: SolveResult): StatusMessage | null {
  const name = (id: string) => c.elements.find((e) => e.id === id)?.name ?? id;
  const names = (ids: string[]) => ids.map(name).join(', ');
  const isGenerator = (id: string) => c.elements.some((e) => e.id === id && (e.kind === 'battery' || e.kind === 'ac'));

  switch (r.status) {
    case 'empty':
      return c.elements.length === 0
        ? { level: 'info', text: 'Grelha vazia. Começa por adicionar uma pilha.' }
        : { level: 'info', text: 'Falta uma pilha ou uma fonte para alimentar o circuito.' };
    case 'short': {
      const sources = r.shortLoop.filter(isGenerator);
      const meters = r.shortLoop.filter((id) => c.elements.some((e) => e.id === id && e.kind === 'ammeter'));
      const extra = meters.length ? ` O amperímetro ${names(meters)} tem resistência zero: liga-o em série, não em paralelo.` : '';
      return {
        level: 'danger',
        text:
          `Curto-circuito: os terminais de ${names(sources)} estão ligados sem nenhuma resistência pelo meio. ` +
          `Com uma fonte ideal a corrente seria infinita (dá-lhe resistência interna para ver o valor real).${extra}`,
      };
    }
    case 'error':
      return { level: 'danger', text: 'Não foi possível resolver este circuito.' };
  }

  const leds = c.elements.filter((e) => e.kind === 'led' && e.burnt);
  const lamps = c.elements.filter((e) => e.kind === 'lamp' && e.burnt);
  if (leds.length || lamps.length) {
    const parts = [];
    if (leds.length) parts.push(`O LED ${leds.map((e) => e.name).join(', ')} queimou: passou dos 30 mA.`);
    if (lamps.length) {
      parts.push(`A lâmpada ${lamps.map((e) => e.name).join(', ')} fundiu: passou de 1,5 vezes a corrente nominal.`);
    }
    return { level: 'warning', text: `${parts.join(' ')} Põe uma resistência maior em série e substitui no painel.` };
  }
  if (r.status === 'open') {
    return {
      level: 'warning',
      text: 'Circuito aberto: não há um caminho fechado entre os terminais da fonte, por isso não passa corrente.',
    };
  }
  if (!r.converged) return { level: 'warning', text: 'O cálculo não convergiu. Os valores podem estar errados.' };

  const high = c.elements.find((e) => isGenerator(e.id) && Math.abs(r.parts.get(e.id)?.i ?? 0) > HIGH_CURRENT);
  if (high) {
    return {
      level: 'danger',
      text:
        `Corrente muito elevada em ${high.name} (${formatSI(Math.abs(r.parts.get(high.id)!.i), 'A')}): ` +
        'na prática é quase um curto-circuito. Uma pilha real aquecia e gastava-se depressa.',
    };
  }
  return null;
}
