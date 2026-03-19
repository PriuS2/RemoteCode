export function uiPx(px: number): string {
  return `calc(${px}px * var(--web-scale, 1))`;
}
