import { palettes, type Rgba, type Theme } from '../style/palette';

const css = ([r, g, b]: Rgba, alpha: number) =>
  `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`;

/** The box a shift-drag draws, as an element over the canvas. */
export class RubberBand {
  private readonly element = document.createElement('div');

  constructor(private readonly canvas: HTMLCanvasElement) {
    Object.assign(this.element.style, { position: 'absolute', pointerEvents: 'none', display: 'none' });
    this.element.dataset.testid = 'rubber-band';
    this.setTheme('light');
  }

  attach(host: HTMLElement): void {
    host.appendChild(this.element);
  }

  setTheme(theme: Theme): void {
    const color = palettes[theme].selection;
    this.element.style.border = `1px solid ${css(color, 1)}`;
    this.element.style.background = css(color, 0.08);
  }

  /** Corners in canvas pixels. */
  show(x0: number, y0: number, x1: number, y1: number): void {
    const scale = this.canvas.getBoundingClientRect().width / Math.max(1, this.canvas.width);
    Object.assign(this.element.style, {
      display: 'block',
      left: `${Math.min(x0, x1) * scale}px`,
      top: `${Math.min(y0, y1) * scale}px`,
      width: `${Math.abs(x1 - x0) * scale}px`,
      height: `${Math.abs(y1 - y0) * scale}px`,
    });
  }

  hide(): void {
    this.element.style.display = 'none';
  }

  remove(): void {
    this.element.remove();
  }
}
