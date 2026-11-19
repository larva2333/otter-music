import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LayoutGrid, RotateCcw } from "lucide-react";
import {
  getArtist,
  getArtistList,
  getTopArtists,
  type TopArtist,
} from "@/lib/netease/netease-api";
import { CachedImage } from "@/components/CachedImage";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Drawer, DrawerContent, DrawerTrigger } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { t2s } from "@/lib/utils/t2s";

/** 周杰伦（网易云歌手 id），固定在列表第一位 */
const JAY_CHOU_ID = 6452;
/** 「Z」的 ASCII 码（接口只认数字），周杰伦拼音首字母 */
const INITIAL_Z = "90";

/**
 * 周杰伦是否落在当前筛选条件内：
 * 地区「全部/华语」、类型「全部/男歌手」、首字母「热门/Z」。
 * 满足条件时（即便接口没返回他）也补到首位，不满足则不应出现。
 */
function jayMatchesFilter(area: string, type: string, initial: string) {
  return (
    (area === "-1" || area === "7") &&
    (type === "-1" || type === "1") &&
    (initial === "-1" || initial === INITIAL_Z)
  );
}

const AREA_OPTIONS = [
  { id: "-1", name: "全部" },
  { id: "7", name: "华语" },
  { id: "96", name: "欧美" },
  { id: "8", name: "日本" },
  { id: "16", name: "韩国" },
  { id: "0", name: "其他" },
] as const;

const TYPE_OPTIONS = [
  { id: "-1", name: "全部" },
  { id: "1", name: "男歌手" },
  { id: "2", name: "女歌手" },
  { id: "3", name: "组合/乐队" },
] as const;

/** 首字母：接口只认 ASCII（65~90 = A~Z），0 表示「#」 */
const INITIAL_OPTIONS = [
  { id: "-1", name: "热门" },
  { id: "0", name: "#" },
  ...Array.from({ length: 26 }, (_, i) => ({
    id: String(65 + i),
    name: String.fromCharCode(65 + i),
  })),
] as const;

/**
 * 把周杰伦挪到第一位；列表中没有他时（榜单未收录）单独补一条，
 * 头像通过歌手详情接口补齐（该结果缓存 7 天，不会反复请求）。
 */
async function pinJayChou(list: TopArtist[]): Promise<TopArtist[]> {
  const isJay = (a: TopArtist) => String(a.id) === String(JAY_CHOU_ID);
  const jay = list.find(isJay);
  const rest = list.filter((a) => !isJay(a));
  if (jay) return [jay, ...rest];

  let name = "周杰伦";
  let picUrl = "";
  try {
    const detail = await getArtist(String(JAY_CHOU_ID));
    name = detail?.artist?.name || name;
    picUrl = detail?.artist?.picUrl || "";
  } catch {
    // 取详情失败时退回占位（图上显示姓氏）
  }
  return [{ id: JAY_CHOU_ID, name, picUrl }, ...rest];
}

function FilterGroup({
  title,
  options,
  value,
  onSelect,
  grid = false,
}: {
  title: string;
  options: readonly { id: string; name: string }[];
  value: string;
  onSelect: (id: string) => void;
  /** 字母这类选项多、字数短的用等宽网格，避免一行挤爆 */
  grid?: boolean;
}) {
  return (
    <div className="space-y-2.5">
      <p className="text-xs font-bold text-muted-foreground">{title}</p>
      <div
        className={cn(grid ? "grid grid-cols-7 gap-2" : "flex flex-wrap gap-2")}
      >
        {options.map((opt) => {
          const active = opt.id === value;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onSelect(opt.id)}
              className={cn(
                "h-8 rounded-full text-sm transition-colors shrink-0",
                grid ? "px-0" : "px-3.5",
                active
                  ? "bg-primary text-primary-foreground font-medium"
                  : "bg-secondary/60 text-foreground hover:bg-secondary"
              )}
            >
              {opt.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 发现页「歌手」分类：歌手榜 + 地区/类型筛选（单选）。
 * 圆形头像三列网格，点击进入歌手详情页 /netease-artist/:id。
 */
export function ArtistSection() {
  const navigate = useNavigate();
  const [area, setArea] = useState("-1");
  const [type, setType] = useState("-1");
  const [initial, setInitial] = useState("-1");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [artists, setArtists] = useState<TopArtist[]>([]);
  const [loading, setLoading] = useState(true);
  const reqIdRef = useRef(0);

  const load = useCallback(
    async (nextArea: string, nextType: string, nextInitial: string) => {
      const reqId = ++reqIdRef.current;
      setLoading(true);
      try {
        let list = await getArtistList({
          area: nextArea,
          type: nextType,
          initial: nextInitial,
        });
        // 默认档位下接口异常时回落到歌手榜（保证首屏有内容）
        const isDefault =
          nextArea === "-1" && nextType === "-1" && nextInitial === "-1";
        if (list.length === 0 && isDefault) {
          list = await getTopArtists();
        }
        if (reqId === reqIdRef.current) {
          // 满足「华语/男歌手/Z」这类条件时周杰伦固定第一位（筛选档位同样生效）
          const result = jayMatchesFilter(nextArea, nextType, nextInitial)
            ? await pinJayChou(list)
            : list;
          if (reqId === reqIdRef.current) setArtists(result);
        }
      } catch {
        if (reqId === reqIdRef.current) setArtists([]);
      } finally {
        if (reqId === reqIdRef.current) setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void load(area, type, initial);
  }, [area, type, initial, load]);

  const handleSelect = (setter: (v: string) => void) => (id: string) => {
    setter(id);
    setDrawerOpen(false);
  };

  /** 一键重置：地区/类型/首字母全部回到默认档位，并关闭抽屉刷新列表 */
  const handleReset = () => {
    setDrawerOpen(false);
    if (area === "-1" && type === "-1" && initial === "-1") return;
    setArea("-1");
    setType("-1");
    setInitial("-1");
  };

  const isDefaultFilter = area === "-1" && type === "-1" && initial === "-1";

  // 页内标题：默认「热门歌手」，选中筛选后跟随变为筛选标签（多条件用 · 连接）
  const titleLabel = useMemo(() => {
    const parts = [
      area !== "-1" ? AREA_OPTIONS.find((o) => o.id === area)?.name : null,
      type !== "-1" ? TYPE_OPTIONS.find((o) => o.id === type)?.name : null,
      initial !== "-1"
        ? INITIAL_OPTIONS.find((o) => o.id === initial)?.name
        : null,
    ].filter(Boolean) as string[];
    return parts.length > 0 ? parts.join(" · ") : "热门歌手";
  }, [area, type, initial]);

  return (
    <div className="p-4 pb-bottom-stack">
      {/* 标题行：标题与筛选按钮都可点击打开筛选抽屉（单选，选完自动收起并刷新） */}
      <div className="flex items-center gap-2 mb-4 px-1 h-8">
        <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
          <DrawerTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 cursor-pointer select-none text-left"
              aria-label="筛选歌手"
            >
              <span className="text-base font-bold text-foreground tracking-wide truncate">
                {titleLabel}
              </span>
              <span className="h-8 w-8 rounded-full shrink-0 flex items-center justify-center bg-secondary/50 hover:bg-secondary transition-colors">
                <LayoutGrid className="h-4 w-4 text-muted-foreground" />
              </span>
            </button>
          </DrawerTrigger>
          <DrawerContent className="max-h-[70vh]">
            <ScrollArea className="px-6 pb-8 pt-3 overflow-y-auto">
              <div className="space-y-5">
                {/* 一键重置：三组条件全回到「全部/热门」 */}
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleReset}
                    className={cn(
                      "h-8 px-3 rounded-full text-sm flex items-center gap-1.5 transition-colors",
                      isDefaultFilter
                        ? "text-muted-foreground/40 bg-secondary/30"
                        : "text-foreground bg-secondary/70 hover:bg-secondary"
                    )}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    重置
                  </button>
                </div>
                <FilterGroup
                  title="地区"
                  options={AREA_OPTIONS}
                  value={area}
                  onSelect={handleSelect(setArea)}
                />
                <FilterGroup
                  title="类型"
                  options={TYPE_OPTIONS}
                  value={type}
                  onSelect={handleSelect(setType)}
                />
                <FilterGroup
                  title="首字母"
                  options={INITIAL_OPTIONS}
                  value={initial}
                  onSelect={handleSelect(setInitial)}
                  grid
                />
              </div>
            </ScrollArea>
          </DrawerContent>
        </Drawer>
      </div>

      {loading && artists.length === 0 ? (
        <div className="grid grid-cols-3 gap-x-3 gap-y-5">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <div className="w-full aspect-square rounded-full bg-secondary animate-pulse" />
              <div className="h-3 w-2/3 rounded bg-secondary animate-pulse" />
            </div>
          ))}
        </div>
      ) : artists.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-16">
          暂无歌手数据
        </p>
      ) : (
        <div
          className={cn(
            "grid grid-cols-3 gap-x-3 gap-y-5",
            loading && "opacity-60"
          )}
        >
          {artists.map((artist, index) => (
            <button
              key={artist.id}
              type="button"
              onClick={() => navigate(`/netease-artist/${artist.id}`)}
              className="flex flex-col items-center gap-2 min-w-0 group"
            >
              <div className="relative w-full aspect-square rounded-full overflow-hidden bg-secondary">
                {artist.picUrl ? (
                  <CachedImage
                    src={artist.picUrl}
                    alt=""
                    size={300}
                    shimmerDelay={(index % 6) * 60}
                    className="transition-transform duration-300 group-active:scale-95"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground text-lg">
                    {t2s(artist.name).slice(0, 1)}
                  </div>
                )}
              </div>
              <span className="text-xs text-foreground line-clamp-1 w-full text-center">
                {t2s(artist.name)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
