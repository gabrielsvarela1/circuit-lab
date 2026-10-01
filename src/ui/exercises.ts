import { EXERCISES, readAnswer } from '../exercises';
import { formatNumber, parseValue } from '../format';
import type { Circuit } from '../model';

export interface ExerciseHost {
  /** Opens the exercise circuit and fits it in view. */
  load(c: Circuit): void;
  /** Applies a change to the circuit as an undo step. */
  apply(c: Circuit): void;
  setShowValues(show: boolean): void;
  closed(): void;
}

const STORAGE_KEY = 'circuit-lab-solved';

export class ExerciseView {
  private index: number | null = null;
  private solved = new Set<string>();

  constructor(
    private root: HTMLElement,
    private host: ExerciseHost,
  ) {
    try {
      for (const id of JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')) this.solved.add(id);
    } catch {
      // Progress is a convenience; start empty if it cannot be read.
    }
    root.addEventListener('click', (e) => this.click(e));
    root.addEventListener('submit', (e) => {
      e.preventDefault();
      this.check();
    });
  }

  get active(): boolean {
    return !this.root.hidden;
  }

  showList(): void {
    this.index = null;
    this.root.hidden = false;
    this.host.setShowValues(true);
    this.root.innerHTML = `
      <div class="ex-head"><h2>Exercícios</h2><button data-ex="close">Fechar</button></div>
      <p class="muted">Cada exercício abre um circuito. Os valores ficam escondidos até acertares.</p>
      <ol class="ex-list">${EXERCISES.map(
        (ex, k) => `<li><button data-ex-open="${k}">
          <span>${ex.title}</span>${this.solved.has(ex.id) ? '<span class="done">Resolvido</span>' : ''}
        </button></li>`,
      ).join('')}</ol>`;
  }

  open(k: number): void {
    const ex = EXERCISES[k];
    this.index = k;
    this.root.hidden = false;
    this.host.load(ex.build());
    this.host.setShowValues(false);
    this.root.innerHTML = `
      <div class="ex-head">
        <button data-ex="list">Lista</button>
        <span class="muted">${k + 1} de ${EXERCISES.length}</span>
      </div>
      <h2>${ex.title}</h2>
      <p class="question">${ex.question}</p>
      <form class="answer">
        <label for="answer">Resposta</label>
        <div class="answer-row">
          <input id="answer" name="answer" inputmode="decimal" autocomplete="off" />
          <span class="unit">${ex.unit}</span>
          <button type="submit" class="primary">Verificar</button>
        </div>
      </form>
      <p class="feedback" role="status" hidden></p>
      <p class="solution" hidden><strong>Solução.</strong> ${ex.solution}</p>
      <div class="ex-nav">
        <button data-ex="prev" ${k === 0 ? 'disabled' : ''}>Anterior</button>
        <button data-ex="solution">Ver solução</button>
        <button data-ex="next" ${k === EXERCISES.length - 1 ? 'disabled' : ''}>Seguinte</button>
      </div>`;
  }

  close(): void {
    this.root.hidden = true;
    this.root.innerHTML = '';
    this.index = null;
    this.host.setShowValues(true);
    this.host.closed();
  }

  private click(e: Event): void {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    if (button.dataset.exOpen !== undefined) return this.open(Number(button.dataset.exOpen));
    switch (button.dataset.ex) {
      case 'close':
        return this.close();
      case 'list':
        return this.showList();
      case 'prev':
        return this.open(this.index! - 1);
      case 'next':
        return this.open(this.index! + 1);
      case 'solution':
        this.reveal();
        return;
    }
  }

  private reveal(): void {
    this.root.querySelector<HTMLElement>('.solution')!.hidden = false;
    this.host.setShowValues(true);
  }

  private check(): void {
    if (this.index === null) return;
    const ex = EXERCISES[this.index];
    const input = this.root.querySelector<HTMLInputElement>('#answer')!;
    const feedback = this.root.querySelector<HTMLElement>('.feedback')!;
    const value = readAnswer(input.value, ex.unit, parseValue);
    feedback.hidden = false;
    if (value === null) {
      feedback.className = 'feedback wrong';
      feedback.textContent = `Escreve um número em ${ex.unit}, por exemplo ${formatNumber(12.5)}.`;
      return;
    }
    const result = ex.check(value);
    if (result.circuit) this.host.apply(result.circuit);
    const note = result.note ? ` ${result.note}` : '';
    if (result.ok) {
      feedback.className = 'feedback ok';
      feedback.textContent = `Certo.${note}`;
      this.solved.add(ex.id);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.solved]));
      } catch {
        // Ignore: progress just will not be remembered.
      }
      this.reveal();
    } else {
      feedback.className = 'feedback wrong';
      feedback.textContent = `Ainda não.${note} Dica: ${ex.hint}`;
    }
  }
}
