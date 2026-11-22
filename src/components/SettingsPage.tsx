"use client";

import { PageLayout } from "./PageLayout";
import { useNavigate } from "react-router-dom";
import { ThemeToggle } from "./ThemeToggle";
import { QualitySelect } from "./settings/QualitySelect";
import { AggregatedSourceSelect } from "./settings/AggregatedSourceSelect";
import { SyncConfig } from "./settings/SyncConfig";
import { NeteaseLogin } from "./settings/NeteaseLogin";
import { QqMusicLogin } from "./settings/QqMusicLogin";
import { BilibiliLogin } from "./settings/BilibiliLogin";
import { ApiUrlConfig } from "./settings/ApiUrlConfig";
import { useMusicStore } from "@/store/music-store";
import { useShallow } from "zustand/react/shallow";
import { Slider } from "./ui/slider";
import {
  Palette,
  Volume2,
  Wand2,
  Trash2,
  Tag,
  Database,
  Shield,
  Bell,
  Music4,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Switch } from "./ui/switch";
import { useAppStore } from "@/store/app-store";
import { DownloadSetting } from "./settings/DownloadSetting";
import { SettingItem } from "./settings/SettingItem";
import { UpdateCheck } from "./settings/UpdateCheck";
import { IssueLogs } from "./settings/IssueLogs";
import { StreamCacheSetting } from "./settings/StreamCacheSetting";
import { AutoMatchSuffixSetting } from "./settings/AutoMatchSuffixSetting";
import { AutoMatchSetting } from "./settings/AutoMatchSetting";
import { FullScreenPlayerSetting } from "./settings/FullScreenPlayerSetting";
import { DataBackup } from "./settings/DataBackup";
import { WebDavBackup } from "./settings/WebDavBackup";
import { LyricStyleSetting } from "./settings/LyricStyleSetting";
import { CarLyricSetting } from "./settings/CarLyricSetting";
import { DesktopLyricSetting } from "./settings/DesktopLyricSetting";
import { FontSizeSetting } from "./settings/FontSizeSetting";
import { useState, useRef } from "react";
import { IS_NATIVE } from "@/lib/api/config";
import { useSwipeCategories } from "@/hooks/use-swipe-categories";
import { useRootTabSwipe } from "@/hooks/use-root-tab-swipe";
import { useTabReclick } from "@/hooks/use-tab-reclick";

interface SettingsPageProps {
  onBack?: () => void;
}

function SettingsSection({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div data-settings-group={title} className="mb-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1 text-sm font-bold text-muted-foreground mb-1.5 px-1 py-0.5"
      >
        <span>{title}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 transition-transform duration-200",
            open ? "rotate-0" : "-rotate-90"
          )}
        />
      </button>
      {open && (
        <div className="rounded-xl bg-card/50 border border-border/50 divide-y divide-border/50 overflow-hidden">
          {children}
        </div>
      )}
    </div>
  );
}

export function SettingsPage({ onBack }: SettingsPageProps) {
  const navigate = useNavigate();
  const [dataBackupOpen, setDataBackupOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 设置是链尾：右滑回歌单最后一个 type，左滑无下一页。
  // 左滑方向不跟手——否则整页内容会被拖出去再弹回来。
  useSwipeCategories(scrollRef, {
    ids: ["settings"],
    activeId: "settings",
    onChange: () => {},
    onEdge: useRootTabSwipe("settings"),
    canFollow: (dir) => dir === "prev",
  });

  // 再次点击底部「设置」tab：依次滚到下一个分组，最后一组之后再点回到顶部
  useTabReclick("settings", () => {
    const container = scrollRef.current;
    if (!container) return;
    const groups = Array.from(
      container.querySelectorAll<HTMLElement>("[data-settings-group]")
    );
    if (groups.length === 0) return;
    // 分组相对容器的顶部偏移；最后几组滚不到顶（容器见底），
    // 用 maxScroll 夹一下，否则「关于系统」这组永远判不得到达
    const maxScroll = container.scrollHeight - container.clientHeight;
    const tops = groups.map((g) =>
      Math.min(g.offsetTop - container.offsetTop - 8, maxScroll)
    );
    // 当前所处分组：最后一个已滚过的；下一个就是目标
    let current = 0;
    for (let i = 0; i < tops.length; i++) {
      if (tops[i] <= container.scrollTop + 20) current = i;
    }
    const next = current + 1;
    container.scrollTo({
      top: next >= tops.length ? 0 : tops[next],
      behavior: "smooth",
    });
  });
  const {
    enableUpdateNotify,
    setEnableUpdateNotify,
    allowSimultaneousPlayback,
    setAllowSimultaneousPlayback,
  } = useAppStore();
  const {
    volume,
    setVolume,
    enableAutoMatch,
    enableProxyFallback,
    setEnableProxyFallback,
    bilibiliKeepOriginalMeta,
    setBilibiliKeepOriginalMeta,
    showSourceBadge,
    setShowSourceBadge,
    highlightCurrentTrack,
    setHighlightCurrentTrack,
    showBarBackground,
    setShowBarBackground,
    lightThemeLightBackground,
    setLightThemeLightBackground,
  } = useMusicStore(
    useShallow((state) => ({
      volume: state.volume,
      setVolume: state.setVolume,
      enableAutoMatch: state.enableAutoMatch,
      enableProxyFallback: state.enableProxyFallback,
      setEnableProxyFallback: state.setEnableProxyFallback,
      bilibiliKeepOriginalMeta: state.bilibiliKeepOriginalMeta,
      setBilibiliKeepOriginalMeta: state.setBilibiliKeepOriginalMeta,
      showSourceBadge: state.showSourceBadge,
      setShowSourceBadge: state.setShowSourceBadge,
      highlightCurrentTrack: state.highlightCurrentTrack,
      setHighlightCurrentTrack: state.setHighlightCurrentTrack,
      showBarBackground: state.showBarBackground,
      setShowBarBackground: state.setShowBarBackground,
      lightThemeLightBackground: state.lightThemeLightBackground,
      setLightThemeLightBackground: state.setLightThemeLightBackground,
    }))
  );

  return (
    <PageLayout title="系统设置" onBack={onBack} showBack={false}>
      <div
        ref={scrollRef}
        data-page-scroll=""
        className="flex-1 p-4 pb-bottom-stack overflow-y-auto"
      >
        <SettingsSection title="常用设置">
          <AggregatedSourceSelect />
          <SettingItem
            icon={Volume2}
            title="音量调节"
            action={
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground w-10 text-right">
                  {Math.round(volume * 100)}%
                </span>
                <Slider
                  value={[volume * 100]}
                  onValueChange={([value]) => setVolume(value / 100)}
                  min={0}
                  max={100}
                  step={1}
                  className="w-32"
                />
              </div>
            }
          />
          <QualitySelect />
          {IS_NATIVE && (
            <SettingItem
              icon={Music4}
              title="与其他应用同时播放"
              action={
                <Switch
                  checked={allowSimultaneousPlayback}
                  onCheckedChange={setAllowSimultaneousPlayback}
                />
              }
            />
          )}
          <DownloadSetting />
        </SettingsSection>

        <SettingsSection title="界面设置">
          <SettingItem
            icon={Palette}
            title="主题切换"
            action={<ThemeToggle />}
          />
          <FontSizeSetting />
          <SettingItem
            icon={Tag}
            title="显示音源标签"
            subtitle="在歌曲列表中始终显示音源平台标签"
            action={
              <Switch
                checked={showSourceBadge}
                onCheckedChange={setShowSourceBadge}
              />
            }
          />
          <SettingItem
            icon={Music4}
            title="高亮正在播放的歌曲"
            subtitle="列表中给正在播放的歌曲整行加背景色高亮"
            action={
              <Switch
                checked={highlightCurrentTrack}
                onCheckedChange={setHighlightCurrentTrack}
              />
            }
          />
          <SettingItem
            icon={Music4}
            title="播放条显示背景"
            subtitle="播放条使用封面取色渐变背景，关闭则显示卡片底色"
            action={
              <Switch
                checked={showBarBackground}
                onCheckedChange={setShowBarBackground}
              />
            }
          />
          <SettingItem
            icon={Palette}
            title="浅色主题显示浅色背景"
            subtitle="浅色主题下播放条与播放页使用浅色封面背景，关闭则使用深色"
            action={
              <Switch
                checked={lightThemeLightBackground}
                onCheckedChange={setLightThemeLightBackground}
              />
            }
          />
          <FullScreenPlayerSetting />
          <LyricStyleSetting />
          <CarLyricSetting />
          <DesktopLyricSetting />
        </SettingsSection>

        <SettingsSection title="账号数据">
          <NeteaseLogin />
          <QqMusicLogin />
          <BilibiliLogin />
          <SyncConfig />
          <SettingItem
            icon={Database}
            title="数据备份"
            subtitle="导出或导入全部收藏、歌单与设置"
            onClick={() => setDataBackupOpen(true)}
            showChevron
          />
          <SettingItem
            icon={Trash2}
            title="回收站"
            subtitle="恢复误删的歌曲和歌单"
            onClick={() => navigate("/settings/trash")}
            showChevron
          />
        </SettingsSection>

        <SettingsSection title="B站设置">
          <SettingItem
            icon={Wand2}
            title="换源保留原信息"
            subtitle="自动换源到B站时保留原标题和歌手"
            action={
              <Switch
                checked={bilibiliKeepOriginalMeta}
                onCheckedChange={setBilibiliKeepOriginalMeta}
                disabled={!enableAutoMatch}
              />
            }
          />
          <AutoMatchSuffixSetting />
        </SettingsSection>

        <SettingsSection title="高级设置">
          <ApiUrlConfig />
          <SettingItem
            icon={Shield}
            title="代理回退"
            subtitle="自动切换代理线路（但容易卡顿）"
            action={
              <Switch
                checked={enableProxyFallback}
                onCheckedChange={setEnableProxyFallback}
              />
            }
          />
          <AutoMatchSetting />
          <StreamCacheSetting />
          <WebDavBackup />
        </SettingsSection>

        <SettingsSection title="关于系统">
          <SettingItem
            icon={Bell}
            title="更新提醒"
            subtitle="启动时自动检查新版本"
            action={
              <Switch
                checked={enableUpdateNotify}
                onCheckedChange={setEnableUpdateNotify}
              />
            }
          />
          <UpdateCheck />
          <IssueLogs />
        </SettingsSection>
      </div>
      <DataBackup open={dataBackupOpen} onOpenChange={setDataBackupOpen} />
    </PageLayout>
  );
}
