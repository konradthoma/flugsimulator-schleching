/**
 * Touch-Steuerung für iPad und Handy:
 * - Joystick links: kippen (links/rechts) und Nase hoch/runter
 * - Schieberegler rechts: Gas
 * - Knöpfe oben rechts: Kamera, Flughilfe, Neustart
 */
export class TouchControls {
  readonly enabled: boolean;
  roll = 0;
  pitch = 0; // +1 = Nase hoch (Joystick nach unten ziehen, wie ein Steuerknüppel)

  private newThrottle: number | null = null;
  private pressed = new Set<string>();
  private throttleFill?: HTMLDivElement;

  constructor() {
    TouchControls.preventZoom();
    this.enabled =
      window.matchMedia('(pointer: coarse)').matches ||
      'ontouchstart' in window ||
      new URLSearchParams(location.search).has('touch'); // ?touch=1 zum Testen am Computer
    if (!this.enabled) return;
    document.body.classList.add('touch');

    const root = document.createElement('div');
    root.id = 'touch';
    root.innerHTML = `
      <div class="stick"><div class="knob"></div></div>
      <div class="throttle-slider"><div class="fill"></div><div class="mid"></div><span>Gas</span></div>
      <div class="buttons">
        <button data-action="camera">📷</button>
        <button data-action="assist">Hilfe</button>
        <button data-action="speed" class="speed">1×</button>
        <button data-action="pause">⏸</button>
        <button data-action="restart">↻</button>
        <button data-action="menu">✈</button>
      </div>`;
    document.body.appendChild(root);

    this.setupStick(root.querySelector('.stick')!, root.querySelector('.knob')!);
    this.setupThrottle(root.querySelector('.throttle-slider')!);
    this.throttleFill = root.querySelector('.fill')!;
    root.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.pressed.add(b.dataset.action!);
      }),
    );
    // Verhindert Zoomen und Scrollen der Seite durch Gesten
    // (im Menü darf aber gescrollt werden)
    document.addEventListener(
      'touchmove',
      (e) => {
        if (!(e.target instanceof Element && e.target.closest('#menu'))) e.preventDefault();
      },
      { passive: false },
    );
  }

  /**
   * Safari am iPhone ignoriert "user-scalable=no": Doppeltippen und Zwei-Finger-Zoom
   * würden die Seite vergrößern. Das wird hier abgefangen.
   */
  private static preventZoom() {
    let lastTouchEnd = 0;
    document.addEventListener(
      'touchend',
      (e) => {
        const now = performance.now();
        // zweites Tippen kurz nach dem ersten = Doppeltippen -> nicht zoomen
        if (now - lastTouchEnd < 350 && e.cancelable) e.preventDefault();
        lastTouchEnd = now;
      },
      { passive: false },
    );
    document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
    }
    // Zwei Finger gleichzeitig (Pinch) außerhalb der Steuerung
    document.addEventListener(
      'touchmove',
      (e) => {
        if (e.touches.length > 1 && e.cancelable && !(e.target instanceof Element && e.target.closest('#touch'))) e.preventDefault();
      },
      { passive: false },
    );
  }

  private setupStick(stick: HTMLElement, knob: HTMLElement) {
    let active: number | null = null;
    const move = (e: PointerEvent) => {
      const r = stick.getBoundingClientRect();
      const radius = r.width / 2;
      let dx = (e.clientX - (r.left + radius)) / radius;
      let dy = (e.clientY - (r.top + radius)) / radius;
      const len = Math.hypot(dx, dy);
      if (len > 1) {
        dx /= len;
        dy /= len;
      }
      knob.style.transform = `translate(${dx * radius * 0.6}px, ${dy * radius * 0.6}px)`;
      // kleine tote Zone in der Mitte, damit kleine Wackler nichts bewirken
      const dead = (v: number) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
      this.roll = dead(dx);
      this.pitch = dead(dy);
    };
    stick.addEventListener('pointerdown', (e) => {
      active = e.pointerId;
      try { stick.setPointerCapture(e.pointerId); } catch { /* egal */ }
      move(e);
    });
    stick.addEventListener('pointermove', (e) => e.pointerId === active && move(e));
    const end = (e: PointerEvent) => {
      if (e.pointerId !== active) return;
      active = null;
      this.roll = this.pitch = 0;
      knob.style.transform = '';
    };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);
  }

  private setupThrottle(slider: HTMLElement) {
    let active: number | null = null;
    const set = (e: PointerEvent) => {
      const r = slider.getBoundingClientRect();
      this.newThrottle = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
    };
    slider.addEventListener('pointerdown', (e) => {
      active = e.pointerId;
      try { slider.setPointerCapture(e.pointerId); } catch { /* egal */ }
      set(e);
    });
    slider.addEventListener('pointermove', (e) => e.pointerId === active && set(e));
    slider.addEventListener('pointerup', () => (active = null));
    slider.addEventListener('pointercancel', () => (active = null));
  }

  /** Neuer Gaswert, falls der Regler bewegt wurde (sonst null). */
  takeThrottle(): number | null {
    const t = this.newThrottle;
    this.newThrottle = null;
    return t;
  }

  /** Hubschrauber: Regler heißt "Rotor", die Mitte (schweben) ist markiert. */
  setVehicleKind(kind: 'plane' | 'heli') {
    const slider = document.querySelector('.throttle-slider');
    if (!slider) return;
    slider.classList.toggle('heli', kind === 'heli');
    slider.querySelector('span')!.textContent = kind === 'heli' ? 'Rotor' : 'Gas';
  }

  /** Beschriftung des Zeitraffer-Knopfs */
  setSpeedLabel(text: string) {
    const b = document.querySelector<HTMLButtonElement>('#touch .speed');
    if (b) b.textContent = text;
  }

  showThrottle(value: number) {
    if (this.throttleFill) this.throttleFill.style.height = `${Math.round(value * 100)}%`;
  }

  wasPressed(action: 'camera' | 'assist' | 'restart' | 'menu' | 'pause' | 'speed'): boolean {
    return this.pressed.has(action);
  }

  endFrame() {
    this.pressed.clear();
  }
}
