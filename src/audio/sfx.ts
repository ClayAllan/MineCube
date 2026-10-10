import type { FeedbackType } from '../game/types';

/**
 * 极简 Web Audio 音效。
 * 全部用振荡器程序化合成，不加载任何音频资源；浏览器不支持时静默降级。
 */

let context: AudioContext | null = null;
let unavailable = false;

function getContext(): AudioContext | null {
  if (unavailable) return null;
  if (context) return context;
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    unavailable = true;
    return null;
  }
  try {
    context = new Ctor();
    return context;
  } catch {
    unavailable = true;
    return null;
  }
}

interface ToneOptions {
  freq: number;
  endFreq?: number;
  duration: number;
  type?: OscillatorType;
  gain?: number;
  delay?: number;
}

function tone(ctx: AudioContext, options: ToneOptions): void {
  const { freq, endFreq, duration, type = 'sine', gain = 0.08, delay = 0 } = options;
  const start = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (endFreq !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), start + duration);
  }
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(amp);
  amp.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

/** 短促噪声，用于爆炸感 */
function noise(ctx: AudioContext, duration: number, gain = 0.12): void {
  const frames = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 900;
  const amp = ctx.createGain();
  amp.gain.value = gain;
  source.connect(filter);
  filter.connect(amp);
  amp.connect(ctx.destination);
  source.start();
}

export function playFeedbackSound(type: FeedbackType): void {
  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();

  switch (type) {
    case 'move':
      tone(ctx, { freq: 520, endFreq: 720, duration: 0.09, type: 'triangle', gain: 0.05 });
      break;
    case 'blocked':
    case 'flag-blocked':
    case 'mine-blocked':
      tone(ctx, { freq: 180, endFreq: 120, duration: 0.13, type: 'square', gain: 0.045 });
      break;
    case 'flag':
      tone(ctx, { freq: 880, duration: 0.06, type: 'square', gain: 0.04 });
      break;
    case 'unflag':
      tone(ctx, { freq: 620, duration: 0.06, type: 'square', gain: 0.035 });
      break;
    case 'mine':
      noise(ctx, 0.35);
      tone(ctx, { freq: 220, endFreq: 60, duration: 0.4, type: 'sawtooth', gain: 0.1 });
      break;
    case 'win':
      tone(ctx, { freq: 523, duration: 0.16, type: 'triangle', gain: 0.07 });
      tone(ctx, { freq: 659, duration: 0.16, type: 'triangle', gain: 0.07, delay: 0.13 });
      tone(ctx, { freq: 784, duration: 0.3, type: 'triangle', gain: 0.07, delay: 0.26 });
      break;
    case 'lose':
      noise(ctx, 0.5, 0.14);
      tone(ctx, { freq: 300, endFreq: 70, duration: 0.7, type: 'sawtooth', gain: 0.1 });
      break;
    default:
      break;
  }
}
