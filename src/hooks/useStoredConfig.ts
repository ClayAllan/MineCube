import { useCallback } from 'react';
import { DEFAULT_CONFIG, STORAGE_KEY } from '../game/constants';
import { normalizeConfig } from '../game/mapGenerator';
import { randomSeedString } from '../game/seededRandom';
import type { MapConfig } from '../game/types';

/**
 * 把玩家最后一次的设置保存到 localStorage。
 * 这是可选增强功能：读写失败（隐私模式、存储被禁用等）时静默降级为默认配置。
 */
export function loadStoredConfig(): MapConfig {
  if (typeof window === 'undefined') return { ...DEFAULT_CONFIG, seed: randomSeedString() };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG, seed: randomSeedString() };
    const parsed = JSON.parse(raw) as Partial<MapConfig>;
    return normalizeConfig({ ...DEFAULT_CONFIG, ...parsed, seed: randomSeedString() });
  } catch {
    return { ...DEFAULT_CONFIG, seed: randomSeedString() };
  }
}

export function useStoreConfig(): (config: MapConfig) => void {
  return useCallback((config: MapConfig) => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {
      // 忽略存储异常，不影响游戏
    }
  }, []);
}
