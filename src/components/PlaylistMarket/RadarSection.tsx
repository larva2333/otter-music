import { useNavigate } from "react-router-dom";
import type { MarketPlaylist } from "@/lib/netease/netease-types";
import { PlaylistGrid } from "./PlaylistGrid";

/**
 * 官方算法歌单（每日更新）。id 为网易固定歌单 id，
 * 点击跳 /netease-playlist/:id 复用现有歌单详情页；封面为官方静态图。
 * 全部为网易官方雷达卡：6 张通用雷达（私人/新歌/时光/乐迷/神秘/宝藏）
 * + 4 张官方私人订制雷达（华语/欧美/日系/韩系），封面自带网易云 logo 与雷达字样。
 * 注：神秘雷达官方封面是无字宇航员图，全系列只有它不带字样，不是取图错误。
 */
const RADAR_PLAYLISTS: MarketPlaylist[] = [
  {
    id: "3136952023",
    name: "私人雷达",
    coverUrl:
      "http://p1.music.126.net/J5Gf2W1XSuwOS0gegA9ryA==/109951168645398914.jpg",
    playCount: 0,
  },
  {
    id: "5300458264",
    name: "新歌雷达",
    coverUrl:
      "http://p1.music.126.net/jTjsB9kTHZs7Vb8ro32Ysg==/109951168645402404.jpg",
    playCount: 0,
  },
  {
    id: "5320167908",
    name: "时光雷达",
    coverUrl:
      "http://p1.music.126.net/JgsoYaJgE6lJhTJ6yEghog==/109951168645396491.jpg",
    playCount: 0,
  },
  {
    id: "5327906368",
    name: "乐迷雷达",
    coverUrl:
      "http://p1.music.126.net/u0TWjN9w-lOyZ2kDd_cjHQ==/109951168645409673.jpg",
    playCount: 0,
  },
  {
    id: "5341776086",
    name: "神秘雷达",
    coverUrl:
      "http://p1.music.126.net/wOxj1fghDYSX0wBwMS8rjA==/109951168606981129.jpg",
    playCount: 0,
  },
  {
    id: "5362359247",
    name: "宝藏雷达",
    coverUrl:
      "http://p1.music.126.net/5sQ0Dmz4_nJMYtD0UXBs6w==/109951168645408205.jpg",
    playCount: 0,
  },
  {
    id: "2829883282",
    name: "华语私人雷达",
    coverUrl:
      "http://p1.music.126.net/NaSOolKiCwxsljTiMWImTg==/109951169058725193.jpg",
    playCount: 0,
  },
  {
    id: "2829816518",
    name: "欧美私人雷达",
    coverUrl:
      "http://p1.music.126.net/kBUPrLfB9-OZXHrf8aVbSw==/109951168609048221.jpg",
    playCount: 0,
  },
  {
    id: "2829896389",
    name: "日系私人雷达",
    coverUrl:
      "http://p1.music.126.net/cquMcH0i4V81DIW4R2mc4A==/109951168609042494.jpg",
    playCount: 0,
  },
  {
    id: "2829920189",
    name: "韩系私人雷达",
    coverUrl:
      "http://p1.music.126.net/t0dHmqaQfA8EfB1DJu5QEw==/109951168609045867.jpg",
    playCount: 0,
  },
];

/** 发现页「雷达」分类：官方雷达歌单卡片 */
export function RadarSection() {
  const navigate = useNavigate();
  return (
    <div className="px-4 pb-bottom-stack">
      <div className="flex items-center -mx-4 px-5 h-[52px] pt-1 border-b mb-4">
        <h2 className="text-base font-bold text-foreground tracking-wide truncate">
          官方雷达
        </h2>
      </div>
      <PlaylistGrid
        list={RADAR_PLAYLISTS}
        onClick={(id) => navigate(`/netease-playlist/${id}`)}
      />
    </div>
  );
}
