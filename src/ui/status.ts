import type { SolveResult } from '../engine';
import type { Circuit } from '../model';

export interface StatusMessage {
  level: 'info' | 'warning' | 'danger';
  text: string;
}

export function statusMessage(c: Circuit, r: SolveResult): StatusMessage | null {
  const name = (id: string) => c.elements.find((e) => e.id === id)?.name ?? id;
  const names = (ids: string[]) => ids.map(name).join(', ');

  switch (r.status) {
    case 'empty':
      return c.elements.length === 0
        ? { level: 'info', text: 'Grelha vazia. Começa por adicionar uma pilha.' }
        : { level: 'info', text: 'Falta uma pilha para alimentar o circuito.' };
    case 'short': {
      const sources = r.shortLoop.filter((id) => c.elements.some((e) => e.id === id && e.kind === 'battery'));
      const meters = r.shortLoop.filter((id) => c.elements.some((e) => e.id === id && e.kind === 'ammeter'));
      const extra = meters.length ? ` O amperímetro ${names(meters)} tem resistência zero: liga-o em série, não em paralelo.` : '';
      return {
        level: 'danger',
        text: `Curto-circuito: os terminais de ${names(sources)} estão ligados sem nenhuma resistência pelo meio. A corrente seria infinita.${extra}`,
      };
    }
    case 'error':
      return { level: 'danger', text: 'Não foi possível resolver este circuito.' };
    case 'open':
      return { level: 'warning', text: 'Circuito aberto: não há um caminho fechado entre os terminais da pilha, por isso não passa corrente.' };
  }
  if (!r.converged) return { level: 'warning', text: 'O cálculo não convergiu. Os valores podem estar errados.' };
  const burnt = c.elements.filter((e) => e.kind === 'led' && e.burnt);
  if (burnt.length) {
    return {
      level: 'warning',
      text: `O LED ${burnt.map((e) => e.name).join(', ')} queimou: passou dos 30 mA. Põe uma resistência maior em série e substitui-o.`,
    };
  }
  return null;
}
