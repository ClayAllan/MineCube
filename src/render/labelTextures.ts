import * as THREE from 'three';

/**
 * 程序化生成的标签贴图。
 * 不依赖任何外部字体或图片资源：数字、字母、旗帜、地雷图标全部用 Canvas 2D 画出来，
 * 再缓存为 CanvasTexture，最多只有二十几种，开销极小。
 */

const SIZE = 128;
const textureCache = new Map<string, THREE.CanvasTexture>();
const materialCache = new Map<string, THREE.SpriteMaterial>();

function createCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  return { canvas, ctx };
}

/** 数字按大小分档，同时改变颜色、字重与下划线数量（不依赖颜色单一维度） */
function numberStyle(value: number): { fill: string; weight: string; underlines: number } {
  if (value === 0) return { fill: '#cbd5f5', weight: '600', underlines: 0 };
  if (value <= 3) return { fill: '#7dd3fc', weight: '700', underlines: 0 };
  if (value <= 7) return { fill: '#fde047', weight: '800', underlines: 1 };
  return { fill: '#fb923c', weight: '900', underlines: 2 };
}

function drawText(ctx: CanvasRenderingContext2D, text: string, fill: string, weight: string): void {
  const fontSize = text.length <= 1 ? 82 : text.length === 2 ? 58 : 40;
  ctx.font = `${weight} ${fontSize}px "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 深色描边保证在任何底色上都能读清
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(3, 7, 18, 0.92)';
  ctx.strokeText(text, SIZE / 2, SIZE / 2 - 4);
  ctx.fillStyle = fill;
  ctx.fillText(text, SIZE / 2, SIZE / 2 - 4);
}

function drawUnderlines(ctx: CanvasRenderingContext2D, count: number, color: string): void {
  for (let i = 0; i < count; i += 1) {
    const y = SIZE - 26 + i * 9;
    ctx.strokeStyle = 'rgba(3, 7, 18, 0.9)';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(SIZE / 2 - 26, y);
    ctx.lineTo(SIZE / 2 + 26, y);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(SIZE / 2 - 24, y);
    ctx.lineTo(SIZE / 2 + 24, y);
    ctx.stroke();
  }
}

/** 地雷图标：带尖刺的圆球 */
function drawMine(ctx: CanvasRenderingContext2D): void {
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  ctx.strokeStyle = 'rgba(3, 7, 18, 0.95)';
  ctx.lineWidth = 14;
  for (let i = 0; i < 8; i += 1) {
    const angle = (Math.PI / 4) * i;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * 50, cy + Math.sin(angle) * 50);
    ctx.stroke();
  }
  ctx.strokeStyle = '#fed7aa';
  ctx.lineWidth = 7;
  for (let i = 0; i < 8; i += 1) {
    const angle = (Math.PI / 4) * i;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * 48, cy + Math.sin(angle) * 48);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, 27, 0, Math.PI * 2);
  ctx.fillStyle = '#1f2937';
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#fdba74';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx - 9, cy - 9, 6, 0, Math.PI * 2);
  ctx.fillStyle = '#fef3c7';
  ctx.fill();
}

/** 旗帜图标：旗杆 + 三角旗面 */
function drawFlag(ctx: CanvasRenderingContext2D): void {
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(3, 7, 18, 0.95)';
  ctx.lineWidth = 16;
  ctx.beginPath();
  ctx.moveTo(46, 24);
  ctx.lineTo(46, 104);
  ctx.stroke();
  ctx.strokeStyle = '#e9d5ff';
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(46, 24);
  ctx.lineTo(46, 104);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(50, 26);
  ctx.lineTo(102, 46);
  ctx.lineTo(50, 66);
  ctx.closePath();
  ctx.fillStyle = '#c084fc';
  ctx.strokeStyle = 'rgba(3, 7, 18, 0.95)';
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.fill();

  ctx.strokeStyle = 'rgba(3, 7, 18, 0.95)';
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.moveTo(28, 106);
  ctx.lineTo(66, 106);
  ctx.stroke();
  ctx.strokeStyle = '#e9d5ff';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(28, 106);
  ctx.lineTo(66, 106);
  ctx.stroke();
}

/** 右下角的六邻域雷数角标：只统计 6 个正交邻格，约束比 26 邻域强得多 */
function drawOrthBadge(ctx: CanvasRenderingContext2D, text: string): void {
  const cx = SIZE - 27;
  const cy = SIZE - 27;
  ctx.beginPath();
  ctx.arc(cx, cy, 23, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(12, 74, 110, 0.95)';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = text === '0' ? '#7dd3fc' : '#38bdf8';
  ctx.stroke();

  ctx.font = '900 30px "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e0f2fe';
  ctx.fillText(text, cx, cy + 1);
}

/** 左上角的身份角标（S = 起点，E = 终点），与中间的数字共存 */
function drawBadge(ctx: CanvasRenderingContext2D, text: string): void {
  const cx = 26;
  const cy = 26;
  ctx.beginPath();
  ctx.arc(cx, cy, 21, 0, Math.PI * 2);
  ctx.fillStyle = text === 'S' ? 'rgba(6, 78, 59, 0.95)' : 'rgba(120, 53, 15, 0.95)';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = text === 'S' ? '#6ee7b7' : '#fcd34d';
  ctx.stroke();

  ctx.font = '900 26px "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = text === 'S' ? '#d1fae5' : '#fef3c7';
  ctx.fillText(text, cx, cy + 1);
}

function renderLabel(label: string): HTMLCanvasElement | null {
  const created = createCanvas();
  if (!created) return null;
  const { canvas, ctx } = created;
  ctx.clearRect(0, 0, SIZE, SIZE);

  // 组合标签："3" / "3@S"（起点角标） / "3~1"（26 邻域 + 六邻域） / "3~1@S"
  const atIndex = label.indexOf('@');
  const badge = atIndex > 0 ? label.slice(atIndex + 1) : '';
  const numberPart = atIndex > 0 ? label.slice(0, atIndex) : label;
  const tildeIndex = numberPart.indexOf('~');

  if (badge || tildeIndex > 0) {
    const main = tildeIndex > 0 ? numberPart.slice(0, tildeIndex) : numberPart;
    const orth = tildeIndex > 0 ? numberPart.slice(tildeIndex + 1) : '';
    const style = numberStyle(Number(main));
    drawText(ctx, main, style.fill, style.weight);
    drawUnderlines(ctx, style.underlines, style.fill);
    if (badge) drawBadge(ctx, badge);
    if (orth) drawOrthBadge(ctx, orth);
    return canvas;
  }

  // 分析模式的结论标记
  if (label === 'verdict:safe') {
    drawText(ctx, '✓', '#4ade80', '900');
    return canvas;
  }
  if (label === 'verdict:mine') {
    drawText(ctx, '✗', '#f87171', '900');
    return canvas;
  }
  if (label.startsWith('prob:')) {
    const value = Number(label.slice(5));
    const fill = value >= 70 ? '#fca5a5' : value >= 40 ? '#fcd34d' : '#a5f3fc';
    drawText(ctx, `${value}%`, fill, '800');
    return canvas;
  }

  // 揭示阶段的旗帜判定：旗面 + 右下角对勾 / 叉
  if (label === 'flag-ok' || label === 'flag-bad') {
    drawFlag(ctx);
    const ok = label === 'flag-ok';
    const cx = SIZE - 28;
    const cy = SIZE - 28;
    ctx.beginPath();
    ctx.arc(cx, cy, 24, 0, Math.PI * 2);
    ctx.fillStyle = ok ? 'rgba(20, 83, 45, 0.96)' : 'rgba(127, 29, 29, 0.96)';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = ok ? '#4ade80' : '#f87171';
    ctx.stroke();
    ctx.font = '900 30px "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = ok ? '#bbf7d0' : '#fecaca';
    ctx.fillText(ok ? '✓' : '✗', cx, cy + 1);
    return canvas;
  }

  if (label === 'unsure') {
    drawText(ctx, '?', '#ddd6fe', '900');
    return canvas;
  }

  if (label.startsWith('hint:')) {
    const text = label.slice(5);
    const cx = SIZE / 2;
    const cy = SIZE / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 46, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.fill();
    ctx.lineWidth = 7;
    ctx.strokeStyle = '#22d3ee';
    ctx.stroke();

    ctx.font = '900 48px "Segoe UI", "PingFang SC", "Microsoft YaHei", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ecfeff';
    ctx.fillText(text, cx, cy - 2);
    return canvas;
  }

  if (label === 'mine') {
    drawMine(ctx);
  } else if (label === 'flag') {
    drawFlag(ctx);
  } else if (label === 'S') {
    drawText(ctx, 'S', '#d1fae5', '900');
  } else if (label === 'E') {
    drawText(ctx, 'E', '#fef3c7', '900');
  } else if (/^\d+$/.test(label)) {
    const value = Number(label);
    const style = numberStyle(value);
    drawText(ctx, label, style.fill, style.weight);
    drawUnderlines(ctx, style.underlines, style.fill);
  } else {
    drawText(ctx, label, '#e2e8f0', '700');
  }
  return canvas;
}

export function getLabelTexture(label: string): THREE.CanvasTexture | null {
  const cached = textureCache.get(label);
  if (cached) return cached;
  const canvas = renderLabel(label);
  if (!canvas) return null;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  textureCache.set(label, texture);
  return texture;
}

/** 标签使用 Sprite，始终面向相机；关闭深度写入避免遮挡半透明方块 */
export function getLabelMaterial(label: string): THREE.SpriteMaterial | null {
  const cached = materialCache.get(label);
  if (cached) return cached;
  const texture = getLabelTexture(label);
  if (!texture) return null;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
  });
  materialCache.set(label, material);
  return material;
}
