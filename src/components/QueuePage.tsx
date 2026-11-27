"use client";

import { Trash2, ListVideo } from "lucide-react";
import { MusicPlaylistView } from "./MusicPlaylistView";
import { MusicTrack } from "@/types/music";
import { Button } from "./ui/button";
import { confirmDialog } from "./ui/confirm-dialog";
import { PageLayout } from "./PageLayout";

interface QueuePageProps {
  queue: MusicTrack[];
  currentTrackId?: string;
  isPlaying: boolean;
  onPlay: (track: MusicTrack | null, index?: number) => void;
  onRemove: (track: MusicTrack) => void;
  onClear: () => void;
  onBack?: () => void;
  /** embedded：嵌在「歌单」页的 type 里，不带 PageLayout 头部 */
  embedded?: boolean;
}

export function QueuePage({
  queue,
  currentTrackId,
  isPlaying,
  onPlay,
  onRemove,
  onClear,
  onBack,
  embedded,
}: QueuePageProps) {
  const clearButton =
    queue.length > 0 ? (
      <Button
        variant="secondary"
        size="icon"
        className="h-8 w-8 rounded-full"
        aria-label="清空播放列表"
        onClick={async () => {
          if (
            await confirmDialog({
              title: "确定清空播放列表吗？",
              destructive: true,
              confirmText: "清空",
            })
          ) {
            onClear();
          }
        }}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    ) : undefined;

  const body = (
    <MusicPlaylistView
      title="播放列表"
      // 标题文字样式与「我的歌单」标题栏一致（text-base font-semibold）
      titleClassName="text-base font-semibold text-foreground"
      compactHeader={embedded}
      dense
      incrementalBatch={10}
      tracks={queue}
      icon={<ListVideo className="h-8 w-8 text-primary/80" />}
      onPlay={onPlay}
      onRemove={onRemove}
      currentTrackId={currentTrackId}
      isPlaying={isPlaying}
      action={embedded ? clearButton : undefined}
    />
  );

  if (embedded) return body;

  return (
    <PageLayout title="播放列表" onBack={onBack} action={clearButton}>
      {body}
    </PageLayout>
  );
}
