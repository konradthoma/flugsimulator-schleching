/** Merkt sich, welche Tasten gerade gedrückt sind. */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** -1, 0 oder 1 je nachdem welche der beiden Tasten gedrückt ist. */
  axis(negative: string, positive: string): number {
    return (this.isDown(positive) ? 1 : 0) - (this.isDown(negative) ? 1 : 0);
  }

  /** true nur in dem Bild, in dem die Taste neu gedrückt wurde. */
  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** Am Ende jedes Bildes aufrufen. */
  endFrame() {
    this.pressed.clear();
  }
}
