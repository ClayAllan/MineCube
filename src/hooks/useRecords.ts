import { useCallback, useState } from 'react';
import type { RecordBook } from '../game/records';

const RECORDS_KEY = 'minecube:records';

/**
 * 本地最佳记录的读写。
 * 这是可选增强功能：读写失败（隐私模式、存储被禁用等）时静默降级为空记录簿。
 */
export function loadRecords(): RecordBook {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(RECORDS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as RecordBook;
  } catch {
    return {};
  }
}

function saveRecords(book: RecordBook): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RECORDS_KEY, JSON.stringify(book));
  } catch {
    // 忽略存储异常，不影响游戏
  }
}

export function useRecords(): {
  records: RecordBook;
  updateRecords: (next: RecordBook) => void;
} {
  const [records, setRecords] = useState<RecordBook>(() => loadRecords());

  const updateRecords = useCallback((next: RecordBook) => {
    setRecords(next);
    saveRecords(next);
  }, []);

  return { records, updateRecords };
}
