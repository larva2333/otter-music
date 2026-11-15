import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "otter_search_history";
const MAX_ITEMS = 12;

function readHistory(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is string => typeof item === "string" && !!item.trim()
      )
      .slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

/** 搜索历史：最近搜索关键词，本地持久化，最多保留 MAX_ITEMS 条 */
export function useSearchHistory() {
  const [history, setHistory] = useState<string[]>(readHistory);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch {
      /* localStorage 不可用时只保留内存态 */
    }
  }, [history]);

  const addHistory = useCallback((keyword: string) => {
    const term = keyword.trim();
    if (!term) return;
    setHistory((prev) => [term, ...prev.filter((item) => item !== term)].slice(0, MAX_ITEMS));
  }, []);

  const removeHistory = useCallback((keyword: string) => {
    setHistory((prev) => prev.filter((item) => item !== keyword));
  }, []);

  const clearHistory = useCallback(() => setHistory([]), []);

  return { history, addHistory, removeHistory, clearHistory };
}
