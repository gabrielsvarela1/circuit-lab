import type { PartResult } from '../engine';
import { formatNumber, formatSI, parseValue } from '../format';
import { type Circuit, type Element, LABELS, LED_COLORS } from '../model';

export interface PanelHost {
  change(id: string, patch: Partial<Element>): void;
  rotate(id: string): void;
  remove(id: string): void;
}

interface Field {
  prop: 'value' | 'rated';
  label: string;
  unit: string;
  min: number;
  max: number;
}

const FIELDS: Partial<Record<Element['kind'], Field[]>> = {
  battery: [{ prop: 'value', label: 'Tensão', unit: 'V', min: 0.1, max: 1000 }],
  resistor: [{ prop: 'value', label: 'Resistência', unit: 'Ω', min: 0.1, max: 1e8 }],
  lamp: [
    { prop: 'value', label: 'Resistência', unit: 'Ω', min: 0.1, max: 1e6 },
    { prop: 'rated', label: 'Tensão nominal', unit: 'V', min: 0.1, max: 1000 },
  ],
};

const HELP = `
  <h2>Como usar</h2>
  <ul class="help">
    <li>Arrasta um componente da lista para a grelha, ou toca nele para o adicionar.</li>
    <li>Para ligar, arrasta a partir de um ponto vazio ou de um terminal até outro ponto: fica um fio.</li>
    <li>Toca num componente para o editar, rodar ou apagar. Toca num interruptor para o abrir ou fechar.</li>
    <li>Roda do rato ou dois dedos para aproximar e mover a vista.</li>
    <li>Atalhos: <kbd>R</kbd> roda, <kbd>Delete</kbd> apaga, <kbd>Ctrl</kbd>+<kbd>Z</kbd> anula, <kbd>Ctrl</kbd>+<kbd>Y</kbd> refaz.</li>
  </ul>`;

/**
 * Properties of the selected element. The form is rebuilt only when the
 * selection or its properties change, so typing is not interrupted; the
 * readings are refreshed on every render.
 */
export class Panel {
  private signature = '';

  constructor(
    private root: HTMLElement,
    private host: PanelHost,
  ) {}

  render(circuit: Circuit, selected: string | null, reading: PartResult | undefined, showValues: boolean, valid = true): void {
    const element = circuit.elements.find((e) => e.id === selected);
    const wire = circuit.wires.find((w) => w.id === selected);
    const signature = JSON.stringify(element ?? wire ?? null) + showValues;
    if (signature !== this.signature) {
      this.signature = signature;
      this.root.innerHTML = element ? this.form(element) : wire ? this.wireForm() : HELP;
      if (element) this.bind(element);
      if (wire) this.root.querySelector('[data-action=remove]')?.addEventListener('click', () => this.host.remove(wire.id));
    }
    const out = this.root.querySelector('.readings');
    if (out) out.innerHTML = valid ? readings(element, reading, showValues) : '';
  }

  private form(e: Element): string {
    const fields = (FIELDS[e.kind] ?? [])
      .map(
        (f) => `<label class="field">
          <span>${f.label} (${f.unit})</span>
          <input data-prop="${f.prop}" inputmode="decimal" autocomplete="off" value="${formatNumber(e[f.prop] ?? 0)}"
            data-min="${f.min}" data-max="${f.max}" data-unit="${f.unit}" />
          <small class="error" hidden></small>
        </label>`,
      )
      .join('');
    const led =
      e.kind === 'led'
        ? `<label class="field"><span>Cor</span><select data-prop="vf">${LED_COLORS.map(
            (c) => `<option value="${c.vf}" ${c.vf === e.vf ? 'selected' : ''}>${c.name} (${formatNumber(c.vf)} V)</option>`,
          ).join('')}</select></label>
          ${e.burnt ? '<p class="warning">Este LED queimou.</p><button data-action="repair">Substituir LED</button>' : ''}`
        : '';
    const sw =
      e.kind === 'switch'
        ? `<button data-action="toggle">${e.closed ? 'Abrir' : 'Fechar'} interruptor</button>`
        : '';
    return `
      <h2>${e.name} <span class="kind">${LABELS[e.kind]}</span></h2>
      ${fields}${led}${sw}
      <dl class="readings"></dl>
      <div class="actions">
        <button data-action="rotate" title="Rodar (R)">Rodar</button>
        <button data-action="remove" class="danger" title="Apagar (Delete)">Apagar</button>
      </div>`;
  }

  private wireForm(): string {
    return `<h2>Fio</h2><dl class="readings"></dl>
      <div class="actions"><button data-action="remove" class="danger">Apagar</button></div>`;
  }

  private bind(e: Element): void {
    for (const input of this.root.querySelectorAll<HTMLInputElement>('input[data-prop]')) {
      const commit = () => {
        const error = input.parentElement!.querySelector<HTMLElement>('.error')!;
        const x = parseValue(input.value);
        const min = Number(input.dataset.min);
        const max = Number(input.dataset.max);
        if (x === null || x < min || x > max) {
          error.textContent = `Escreve um valor entre ${formatSI(min, input.dataset.unit!)} e ${formatSI(max, input.dataset.unit!)}.`;
          error.hidden = false;
          input.setAttribute('aria-invalid', 'true');
          return;
        }
        error.hidden = true;
        input.removeAttribute('aria-invalid');
        this.host.change(e.id, { [input.dataset.prop!]: x });
      };
      input.addEventListener('change', commit);
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') input.blur();
      });
    }
    this.root.querySelector<HTMLSelectElement>('select[data-prop=vf]')?.addEventListener('change', (ev) => {
      this.host.change(e.id, { vf: Number((ev.target as HTMLSelectElement).value) });
    });
    const on = (action: string, fn: () => void) =>
      this.root.querySelector(`[data-action=${action}]`)?.addEventListener('click', fn);
    on('rotate', () => this.host.rotate(e.id));
    on('remove', () => this.host.remove(e.id));
    on('toggle', () => this.host.change(e.id, { closed: !e.closed }));
    on('repair', () => this.host.change(e.id, { burnt: false }));
  }
}

function readings(e: Element | undefined, r: PartResult | undefined, showValues: boolean): string {
  if (!r) return '';
  if (!showValues) return '<p class="muted">Os valores ficam escondidos até responderes.</p>';
  const rows: [string, string][] = [];
  if (!e || e.kind !== 'ammeter') rows.push(['Tensão', formatSI(Math.abs(r.v), 'V')]);
  if (!e || e.kind !== 'voltmeter') rows.push(['Corrente', formatSI(Math.abs(r.i), 'A')]);
  if (e && e.kind !== 'ammeter' && e.kind !== 'voltmeter' && e.kind !== 'switch') {
    rows.push([e.kind === 'battery' ? 'Potência fornecida' : 'Potência', formatSI(Math.abs(r.p), 'W')]);
  }
  return rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}
