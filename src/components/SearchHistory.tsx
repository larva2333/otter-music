import { History, X } from "lucide-react";

interface SearchHistoryProps {
  items: string[];
  onSelect: (keyword: string) => void;
  onRemove: (keyword: string) => void;
}

/** 搜索历史页的列表。空列表留在页面上，由返回键离开。 */
export function SearchHistory({
  items,
  onSelect,
  onRemove,
}: SearchHistoryProps) {
  if (!items.length) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
        暂无搜索历史
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {items.map((keyword) => (
        <div
          key={keyword}
          className="flex items-center border-b border-border/40"
        >
          <button
            type="button"
            onClick={() => onSelect(keyword)}
            className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left text-sm"
          >
            <div className="h-4 w-4 shrink-0 flex-[0_0_16px] min-h-4 min-w-4">
              <History className="h-full w-full text-muted-foreground/60" />
            </div>
            <span className="truncate">{keyword}</span>
          </button>
          <button
            type="button"
            aria-label={`删除 ${keyword}`}
            onClick={() => onRemove(keyword)}
            className="mr-3 shrink-0 rounded p-1 text-muted-foreground/50"
          >
            <div className="h-3.5 w-3.5 shrink-0 flex-[0_0_14px] min-h-3.5 min-w-3.5">
              <X className="h-full w-full" />
            </div>
          </button>
        </div>
      ))}
    </div>
  );
}
