import { useEffect } from 'react';
import { useApp } from '../state/store';

/** Panels marked `data-inset` are kept clear when fitting; `key` changes when panels come or go. */
export function usePanelInsets(key: string): void {
  const setInsets = useApp((s) => s.setInsets);
  const attached = useApp((s) => (s.renderer === 'webgpu' || s.renderer === 'webgl2') && s.engineError === undefined);
  useEffect(() => {
    const host = document.querySelector<HTMLElement>('.app');
    if (!attached || !host) return;
    const panels = [...host.querySelectorAll<HTMLElement>('[data-inset]')];
    const measure = () => {
      const h = host.getBoundingClientRect();
      const insets = { top: 0, right: 0, bottom: 0, left: 0 };
      for (const panel of panels) {
        const r = panel.getBoundingClientRect();
        switch (panel.dataset.inset) {
          case 'top':
            insets.top = Math.max(insets.top, r.bottom - h.top);
            break;
          case 'bottom':
            insets.bottom = Math.max(insets.bottom, h.bottom - r.top);
            break;
          case 'left':
            insets.left = Math.max(insets.left, r.right - h.left);
            break;
          case 'right':
            insets.right = Math.max(insets.right, h.right - r.left);
            break;
        }
      }
      setInsets(insets);
    };
    const observer = new ResizeObserver(measure);
    for (const element of [host, ...panels]) observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [setInsets, attached, key]);
}
