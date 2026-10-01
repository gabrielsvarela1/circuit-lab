import type { Circuit } from './model';

const LIMIT = 200;

/** Undo and redo with snapshots of the whole circuit. */
export class History {
  private past: string[] = [];
  private future: string[] = [];

  constructor(public present: Circuit) {}

  commit(next: Circuit): void {
    if (next === this.present) return;
    this.past.push(JSON.stringify(this.present));
    if (this.past.length > LIMIT) this.past.shift();
    this.future = [];
    this.present = next;
  }

  /** Changes the present state without a new undo step. */
  replace(next: Circuit): void {
    this.present = next;
  }

  undo(): boolean {
    const prev = this.past.pop();
    if (prev === undefined) return false;
    this.future.push(JSON.stringify(this.present));
    this.present = JSON.parse(prev);
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (next === undefined) return false;
    this.past.push(JSON.stringify(this.present));
    this.present = JSON.parse(next);
    return true;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }
}
