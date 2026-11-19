import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerTrigger } from "@/components/ui/drawer";
import { NETEASE_CATS } from "@/lib/netease/netease-cats";
import { cn } from "@/lib/utils";
import { LayoutGrid } from "lucide-react";

const SECTION_TITLE =
  "sticky top-0 z-10 py-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground/70 bg-background/95 backdrop-blur-sm";

interface PlaylistCategorySelectorProps {
  activeCategory: string;
  onSelect: (id: string) => void;
  trigger?: React.ReactNode;
}

/** 纯筛选抽屉：单击选中一个分类并关闭，选中后由父级刷新歌单列表。
 *  不再承担「常驻分类管理」（拖拽排序 / 长按增删）职责。 */
export function PlaylistCategorySelector({
  activeCategory,
  onSelect,
  trigger,
}: PlaylistCategorySelectorProps) {
  // 受控开关：单击筛选项后立即收起抽屉
  const [open, setOpen] = useState(false);

  const handleSelect = (id: string) => {
    setOpen(false);
    onSelect(id);
  };

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        {trigger || (
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full hover:bg-secondary"
          >
            <LayoutGrid className="h-4 w-4 text-muted-foreground" />
          </Button>
        )}
      </DrawerTrigger>

      <DrawerContent className="max-h-[85vh]">
        <ScrollArea className="px-6 pb-8 pt-4 overflow-y-auto">
          <div className="space-y-5">
            {/* 回到全部（清除页内筛选） */}
            <section className="space-y-2">
              <div className="grid grid-cols-4 gap-2">
                <button
                  onClick={() => handleSelect("全部")}
                  className={cn(
                    "h-9 px-2 rounded-xl text-xs font-medium transition-all border flex items-center justify-center select-none",
                    activeCategory === "全部"
                      ? "bg-primary text-primary-foreground border-primary shadow-md shadow-primary/10"
                      : "bg-secondary/30 border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/70"
                  )}
                >
                  全部
                </button>
              </div>
            </section>

            {NETEASE_CATS.map((group) => (
              <section key={group.category} className="space-y-2">
                <h4 className={SECTION_TITLE}>{group.category}</h4>
                <div className="grid grid-cols-4 gap-2">
                  {group.filters.map((f) => {
                    const isSelected = activeCategory === f.id;

                    return (
                      <button
                        key={f.id}
                        onClick={() => handleSelect(f.id)}
                        className={cn(
                          "h-9 px-2 rounded-xl text-xs font-medium transition-all border flex items-center justify-center select-none",
                          isSelected
                            ? "bg-primary text-primary-foreground border-primary shadow-md shadow-primary/10"
                            : "bg-secondary/30 border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/70"
                        )}
                      >
                        <span className="truncate">{f.name}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </ScrollArea>
      </DrawerContent>
    </Drawer>
  );
}
