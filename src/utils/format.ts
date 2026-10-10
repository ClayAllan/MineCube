/** 毫秒 -> mm:ss（超过一小时显示 hh:mm:ss） */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export function formatPercent(ratio: number, digits = 1): string {
  if (!Number.isFinite(ratio)) return '0%';
  return `${(Math.max(0, Math.min(1, ratio)) * 100).toFixed(digits)}%`;
}

export function formatPosition(p: { x: number; y: number; z: number } | null): string {
  return p ? `(${p.x}, ${p.y}, ${p.z})` : '—';
}
