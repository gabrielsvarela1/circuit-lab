import './style.css';
import { type Part, type SolveResult, solve, solveWithBurnout } from './engine';
import { formatSI } from './format';
import { EXAMPLES } from './examples';
import { History } from './history';
import {
  type Circuit,
  createElement,
  empty,
  freeSpot,
  KINDS,
  LABELS,
  type Element,
  type ElementKind,
  normalize,
  remove,
  rotate,
  toParts,
  update,
} from './model';
import { fromUrl, load, save, shareUrl } from './share';
import { Board } from './ui/board';
import { Panel } from './ui/panel';
import { statusMessage } from './ui/status';
import { meterLetter, symbol } from './ui/symbols';
import { ExerciseView } from './ui/exercises';
import { tooltipHtml } from './ui/tooltip';

class App {
  history: History;
  /** Circuit shown while a drag is in progress, before it becomes an undo step. */
  draft: Circuit | null = null;
  selected: string | null = null;
  result: SolveResult | null = null;
  /** Netlist of the circuit on screen, with burnt parts marked; reused by the AC animation. */
  private parts: Part[] = [];
  /** Simulated time for AC circuits, in seconds. */
  private simTime = 0;
  showValues = true;
  board: Board;
  panel: Panel;
  exercises: ExerciseView;
  private status = document.querySelector<HTMLElement>('.status')!;
  private tooltip = document.querySelector<HTMLElement>('.tooltip')!;
  private hovered: { id: string; at: { x: number; y: number } } | null = null;
  private lastPointer = 'mouse';
  private toastTimer = 0;

  constructor() {
    const shared = fromUrl();
    if (shared) history.replaceState(null, '', location.pathname + location.search);
    this.history = new History(shared ?? load() ?? EXAMPLES[0].build());

    this.board = new Board(document.querySelector<SVGSVGElement>('.board')!, {
      preview: (c) => {
        this.draft = c === this.history.present ? null : c;
        this.render();
      },
      commit: (c) => this.commit(c),
      select: (id) => {
        this.selected = id;
        this.render();
      },
      hover: (id, at) => {
        this.hovered = id && at ? { id, at } : null;
        this.updateTooltip();
      },
      toggle: (id) => {
        const e = this.circuit.elements.find((x) => x.id === id);
        if (e) this.commit(update(this.circuit, id, { closed: !e.closed }));
      },
      announce: (text) => {
        document.querySelector<HTMLElement>('.sr-status')!.textContent = text;
      },
    });
    this.panel = new Panel(document.querySelector<HTMLElement>('.panel')!, {
      change: (id, patch) => this.commit(update(this.circuit, id, patch)),
      rotate: (id) => this.commit(rotate(this.circuit, id)),
      remove: (id) => this.removeItem(id),
    });

    this.exercises = new ExerciseView(document.querySelector<HTMLElement>('.exercise')!, {
      load: (c) => this.open(c),
      apply: (c) => this.commit(c),
      setShowValues: (show) => {
        this.showValues = show;
        this.render();
      },
      closed: () => this.render(),
    });

    this.buildPalette();
    this.buildExamples();
    this.bindCommands();
    document.addEventListener(
      'pointerdown',
      (e) => {
        this.lastPointer = e.pointerType;
        this.board.keyboardUsed = false;
      },
      true,
    );
    this.applyTheme();
    window.addEventListener('resize', () => this.updateTooltip());
    this.animate();
    this.render();
    this.board.fit(this.circuit);

    // A shared link opened in a tab that already has the app.
    window.addEventListener('hashchange', () => {
      const c = fromUrl();
      if (!c) return;
      history.replaceState(null, '', location.pathname + location.search);
      this.open(c);
    });
  }

  /** Replaces the circuit (as an undo step) and fits it in view. */
  open(c: Circuit): void {
    this.selected = null;
    this.commit(c);
    this.board.fit(c);
  }

  get circuit(): Circuit {
    return this.draft ?? this.history.present;
  }

  commit(c: Circuit): void {
    this.draft = null;
    this.history.commit(c);
    this.render();
  }

  removeItem(id: string): void {
    if (this.selected === id) this.selected = null;
    this.commit(remove(this.circuit, id));
  }

  render(): void {
    let circuit = this.circuit;
    const { result, burnt, parts } = solveWithBurnout(toParts(circuit));
    if (burnt.length) {
      // A burnt LED or lamp stays burnt: it becomes part of the circuit state.
      circuit = { ...circuit, elements: circuit.elements.map((e) => (burnt.includes(e.id) ? { ...e, burnt: true } : e)) };
      if (this.draft) this.draft = circuit;
      else this.history.replace(circuit);
      const names = (kind: string) =>
        circuit.elements.filter((e) => burnt.includes(e.id) && e.kind === kind).map((e) => e.name);
      const leds = names('led');
      const lamps = names('lamp');
      this.toast(
        [leds.length ? `O LED ${leds.join(', ')} queimou.` : '', lamps.length ? `A lâmpada ${lamps.join(', ')} fundiu.` : '']
          .filter(Boolean)
          .join(' '),
      );
    }
    this.result = result;
    this.parts = parts;
    this.updateAcNote();
    if (this.selected && !circuit.elements.some((e) => e.id === this.selected) && !circuit.wires.some((w) => w.id === this.selected)) {
      this.selected = null;
    }

    this.board.render({ circuit, result, live: this.liveResult(), selected: this.selected, showValues: this.showValues });
    this.panel.render(
      circuit,
      this.selected,
      this.selected ? result.parts.get(this.selected) : undefined,
      this.showValues,
      result.status !== 'short' && result.status !== 'error',
      result.ac,
    );

    const message = statusMessage(circuit, result);
    this.status.hidden = !message;
    this.status.className = `status ${message?.level ?? ''}`;
    this.status.textContent = message?.text ?? '';

    document.querySelector<HTMLButtonElement>('[data-cmd=undo]')!.disabled = !this.history.canUndo;
    document.querySelector<HTMLButtonElement>('[data-cmd=redo]')!.disabled = !this.history.canRedo;
    if (!this.draft) save(this.history.present);
    this.updateTooltip();
  }

  /**
   * With a mouse the tooltip follows the hovered item. On touch screens it
   * sits above the selected item, since there is no hover.
   */
  updateTooltip(): void {
    const stage = this.tooltip.parentElement!.getBoundingClientRect();
    let id: string | null = null;
    let x = 0;
    let y = 0;
    if (this.hovered && !this.draft) {
      ({ id } = this.hovered);
      x = this.hovered.at.x + 14;
      y = this.hovered.at.y + 18;
    } else if (this.selected && this.lastPointer !== 'mouse' && !this.draft) {
      id = this.selected;
      const e = this.circuit.elements.find((el) => el.id === id);
      const w = this.circuit.wires.find((wi) => wi.id === id);
      const centre = e ? { x: e.x, y: e.y } : w ? { x: (w.x1 + w.x2) / 2, y: (w.y1 + w.y2) / 2 } : null;
      if (!centre) id = null;
      else {
        const p = this.board.toClient(centre);
        x = p.x - 70;
        // Above the element, or below it when there is no room.
        y = p.y - 96 < stage.top + 70 ? p.y + 44 : p.y - 96;
      }
    }
    const html = id ? tooltipHtml(this.circuit, id, this.result, this.showValues) : null;
    this.tooltip.hidden = !html;
    if (!html) return;
    this.tooltip.innerHTML = html;
    const w = this.tooltip.offsetWidth;
    const h = this.tooltip.offsetHeight;
    const left = Math.min(Math.max(x - stage.left, 6), stage.width - w - 6);
    const top = Math.min(Math.max(y - stage.top, 6), stage.height - h - 6);
    this.tooltip.style.transform = `translate(${left}px, ${top}px)`;
  }

  /** Highest AC frequency in the circuit, or 0. */
  private acFrequency(): number {
    return Math.max(0, ...this.parts.filter((p) => p.kind === 'ac').map((p) => p.freq ?? 50));
  }

  /**
   * AC is animated in slow motion: anything faster than 1 Hz is shown at 1 Hz,
   * so the dots visibly change direction and LEDs blink.
   */
  private timeScale(): number {
    const f = this.acFrequency();
    return f > 1 ? 1 / f : 1;
  }

  /** The circuit at the current simulated instant, for AC circuits that work. */
  private liveResult(): SolveResult | null {
    if (!this.result?.ac || this.result.status !== 'ok') return null;
    return solve(this.parts, this.simTime);
  }

  private updateAcNote(): void {
    const note = document.querySelector<HTMLElement>('.note')!;
    const f = this.acFrequency();
    note.hidden = !this.result?.ac;
    if (note.hidden) return;
    const speed = f > 1 ? ', mostrada em câmara lenta a 1 Hz' : '';
    note.textContent = `Corrente alternada a ${formatSI(f, 'Hz')}${speed}. Os aparelhos mostram valores eficazes.`;
  }

  private animate(): void {
    const still = window.matchMedia('(prefers-reduced-motion: reduce)');
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!still.matches) {
        if (this.result?.ac && this.result.status === 'ok' && !this.draft) {
          this.simTime += dt * this.timeScale();
          this.board.updateLive(this.liveResult());
        }
        this.board.tick(dt);
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /** Light, dark, or the system setting when nothing was chosen. */
  private applyTheme(): void {
    let chosen: string | null = null;
    try {
      chosen = localStorage.getItem('circuit-lab-theme');
    } catch {
      // No storage: follow the system.
    }
    if (chosen === 'light' || chosen === 'dark') document.documentElement.dataset.theme = chosen;
    const button = document.querySelector<HTMLButtonElement>('[data-cmd=theme]')!;
    button.textContent = this.isDark() ? 'Tema claro' : 'Tema escuro';
  }

  private isDark(): boolean {
    const t = document.documentElement.dataset.theme;
    return t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  toast(text: string): void {
    const el = document.querySelector<HTMLElement>('.toast')!;
    el.textContent = text;
    el.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (el.hidden = true), 3000);
  }

  add(kind: ElementKind): void {
    const c = this.circuit;
    // From the keyboard, place it next to the board's cursor.
    const at = freeSpot(c, this.board.keyboardUsed ? this.board.cursor : this.board.centre());
    const e = createElement(c, kind, at.x, at.y, kind === 'battery' ? 1 : 0);
    this.selected = e.id;
    this.commit(normalize({ ...c, elements: [...c.elements, e] }));
  }

  private buildPalette(): void {
    const palette = document.querySelector<HTMLElement>('.palette')!;
    palette.innerHTML = KINDS.map(
      (kind) => `<button class="tool" data-kind="${kind}" title="${LABELS[kind]}">
        <svg viewBox="-44 -28 88 56" aria-hidden="true">${symbol(kind, { closed: false })}
          ${meterLetter(kind) ? `<text class="meter-letter" y="5">${meterLetter(kind)}</text>` : ''}</svg>
        <span>${LABELS[kind]}</span>
      </button>`,
    ).join('');

    for (const button of palette.querySelectorAll<HTMLButtonElement>('.tool')) {
      button.addEventListener('pointerdown', (down) => {
        if (down.button !== 0) return;
        down.preventDefault();
        const kind = button.dataset.kind as ElementKind;
        const origin = this.history.present;
        let placing = false;
        let element: Element | null = null;

        const move = (ev: PointerEvent) => {
          if (!placing && Math.hypot(ev.clientX - down.clientX, ev.clientY - down.clientY) > 8) placing = true;
          if (!placing) return;
          if (!this.board.contains(ev.clientX, ev.clientY)) {
            this.draft = null;
            this.render();
            return;
          }
          const p = this.board.toGrid(ev.clientX, ev.clientY);
          element = { ...(element ?? createElement(origin, kind, p.x, p.y, kind === 'battery' ? 1 : 0)), x: p.x, y: p.y };
          this.draft = { ...origin, elements: [...origin.elements, element] };
          this.render();
        };
        const up = (ev: PointerEvent) => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', up);
          if (!placing) {
            if (ev.type === 'pointerup') this.add(kind);
            return;
          }
          if (element && this.board.contains(ev.clientX, ev.clientY) && ev.type === 'pointerup') {
            this.selected = element.id;
            this.commit(normalize({ ...origin, elements: [...origin.elements, element] }));
          } else {
            this.draft = null;
            this.render();
          }
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
      });
    }
  }

  private buildExamples(): void {
    const dialog = document.querySelector<HTMLDialogElement>('dialog.examples')!;
    const list = dialog.querySelector('.example-list')!;
    list.innerHTML = EXAMPLES.map(
      (ex, k) => `<li><button data-example="${k}"><strong>${ex.title}</strong><span>${ex.description}</span></button></li>`,
    ).join('');
    list.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest<HTMLElement>('[data-example]');
      if (!button) return;
      dialog.close();
      if (this.exercises.active) this.exercises.close();
      this.open(EXAMPLES[Number(button.dataset.example)].build());
    });
    // Click on the backdrop closes the dialog.
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });
  }

  private bindCommands(): void {
    const commands: Record<string, () => void> = {
      undo: () => this.history.undo() && this.render(),
      redo: () => this.history.redo() && this.render(),
      clear: () => {
        this.selected = null;
        this.commit(empty());
      },
      share: () => this.share(),
      examples: () => document.querySelector<HTMLDialogElement>('dialog.examples')!.showModal(),
      'close-examples': () => document.querySelector<HTMLDialogElement>('dialog.examples')!.close(),
      exercises: () => (this.exercises.active ? this.exercises.close() : this.exercises.showList()),
      'zoom-in': () => this.board.zoom(1.25),
      'zoom-out': () => this.board.zoom(0.8),
      fit: () => this.board.fit(this.circuit),
      pan: () => {
        this.board.panMode = !this.board.panMode;
        const button = document.querySelector<HTMLElement>('[data-cmd=pan]')!;
        button.setAttribute('aria-pressed', String(this.board.panMode));
        this.board.svg.classList.toggle('panning', this.board.panMode);
      },
      theme: () => {
        const next = this.isDark() ? 'light' : 'dark';
        try {
          localStorage.setItem('circuit-lab-theme', next);
        } catch {
          // Not remembered, but still applied below.
        }
        document.documentElement.dataset.theme = next;
        this.applyTheme();
      },
    };
    document.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest<HTMLElement>('[data-cmd]');
      const cmd = button?.dataset.cmd;
      if (cmd && commands[cmd]) commands[cmd]();
    });

    document.addEventListener('keyup', (e) => {
      if (e.key === ' ') {
        this.board.spaceHeld = false;
        this.board.svg.classList.toggle('panning', this.board.panMode);
      }
    });
    document.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement;
      if (target.matches('input, select, textarea')) return;
      // Space held down: drag with the mouse to move the view.
      if (e.key === ' ' && !target.matches('button, a, summary')) {
        this.board.spaceHeld = true;
        this.board.svg.classList.add('panning');
        e.preventDefault();
        return;
      }
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) commands.undo();
      else if (ctrl && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) commands.redo();
      else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected) this.removeItem(this.selected);
      else if (e.key.toLowerCase() === 'r' && !ctrl && this.selected && this.circuit.elements.some((x) => x.id === this.selected)) {
        this.commit(rotate(this.circuit, this.selected));
      } else if (e.key === 'Escape') {
        this.selected = null;
        this.render();
      } else return;
      e.preventDefault();
    });
  }

  link(): string {
    return shareUrl(this.history.present);
  }

  private async share(): Promise<void> {
    const url = this.link();
    try {
      await navigator.clipboard.writeText(url);
      this.toast('Ligação copiada. Quem a abrir vê este circuito.');
    } catch {
      window.prompt('Copia esta ligação:', url);
    }
  }
}

const app = new App();
// Exposed for debugging and end-to-end tests.
(window as unknown as { app: App }).app = app;
