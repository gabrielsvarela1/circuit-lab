import type { Element, ElementKind } from '../model';
import { ledColor } from '../model';

/** Pixels per grid cell in world coordinates. */
export const U = 40;

/**
 * Symbol drawn horizontally between the terminals at x = -U and x = +U.
 * `glow` is 0 to 1 (LED and lamp brightness).
 */
export function symbol(kind: ElementKind, opts: { glow?: number; closed?: boolean; vf?: number; burnt?: boolean } = {}): string {
  const lead = (inner: number) =>
    `<line class="lead" x1="${-U}" y1="0" x2="${-inner}" y2="0"/><line class="lead" x1="${inner}" y1="0" x2="${U}" y2="0"/>`;
  const glow = opts.glow ?? 0;
  switch (kind) {
    case 'battery':
      return `${lead(6)}
        <line class="plate" x1="-6" y1="-16" x2="-6" y2="16"/>
        <line class="plate thick" x1="6" y1="-8" x2="6" y2="8"/>
        <path class="sign" d="M-24 -14 H-14 M-19 -19 V-9"/>`;
    case 'resistor':
      return `${lead(20)}<rect class="body" x="-20" y="-8" width="40" height="16" rx="1"/>`;
    case 'lamp':
      return `${lead(14)}
        <circle class="glow" r="26" fill="#ffd54a" opacity="${(glow * 0.75).toFixed(3)}"/>
        <circle class="body" r="14" style="fill:${glow > 0.02 ? `rgba(255,213,74,${(0.3 + glow * 0.7).toFixed(3)})` : ''}"/>
        <path class="line" d="M-9.9 -9.9 L9.9 9.9 M-9.9 9.9 L9.9 -9.9"/>`;
    case 'led': {
      const color = opts.burnt ? '#6b6b6b' : ledColor(opts.vf);
      const fill = opts.burnt ? 0.35 : 0.18 + glow * 0.82;
      return `${lead(10)}
        <circle class="glow" r="24" fill="${color}" opacity="${opts.burnt ? 0 : (glow * 0.55).toFixed(3)}"/>
        <path class="body" d="M-10 -12 L-10 12 L10 0 Z" style="fill:${color};fill-opacity:${fill.toFixed(3)}"/>
        <line class="line" x1="10" y1="-12" x2="10" y2="12"/>
        <path class="line thin" d="M0 -14 L7 -22 M3 -22 H7 V-18 M8 -10 L15 -18 M11 -18 H15 V-14"/>
        ${opts.burnt ? '<path class="burnt" d="M-14 -16 L14 16 M-14 16 L14 -16"/>' : ''}`;
    }
    case 'switch': {
      const lever = opts.closed ? 'M-14 0 L14 0' : 'M-14 0 L11 -15';
      return `${lead(14)}
        <circle class="pin" cx="-14" r="3"/><circle class="pin" cx="14" r="3"/>
        <path class="line" d="${lever}"/>`;
    }
    case 'ammeter':
    case 'voltmeter':
      return `${lead(14)}<circle class="body meter" r="14"/><path class="sign" d="M-30 -12 H-22 M-26 -16 V-8"/>`;
  }
}

/** Letter drawn upright in the middle of meters. */
export function meterLetter(kind: ElementKind): string {
  return kind === 'ammeter' ? 'A' : kind === 'voltmeter' ? 'V' : '';
}

export function transform(e: Element): string {
  return `translate(${e.x * U} ${e.y * U}) rotate(${e.rot * 90})`;
}

/** Position for a label beside the element, on side +1 or -1. */
export function labelPos(e: Element, side: 1 | -1): { x: number; y: number; anchor: string } {
  const horizontal = e.rot % 2 === 0;
  if (horizontal) return { x: e.x * U, y: e.y * U + side * (side < 0 ? 24 : 32), anchor: 'middle' };
  return { x: e.x * U + side * 22, y: e.y * U + 4, anchor: side < 0 ? 'end' : 'start' };
}
