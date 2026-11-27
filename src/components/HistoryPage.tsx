"use client";

import { History, Trash2 } from "lucide-react";
import { MusicPlaylistView } from "./MusicPlaylistView";
import { MusicTrack } from "@/types/music";
import { Button } from "./ui/button";
import { confirmDialog } from "./ui/confirm-dialog";
import { PageLayout } from "./PageLayout";

interface HistoryPageProps {
  history: MusicTrack[];
  currentTrackId?: string;
  isPlaying: boolean;
  onPlay: (track: MusicTrack | null, index?: number) => void;
  onRemove: (track: MusicTrack) => void;
  onBatchRemove: (tracks: MusicTrack[]) => void;
  onClear: () => void;
  onBack?: () => void;
}

export function HistoryPage({
  history,
  currentTrackId,
  isPlaying,
  onPlay,
  onRemove,
  onBatchRemove,
  onClear,
  onBack,
}: HistoryPageProps) {
  return (
    <PageLayout title="播放历史" onBack={onBack}>
      <MusicPlaylistView
        title="播放历史"
        showInlineCover
        tracks={history}
        icon={<History className="h-8 w-8 text-primary/80" />}
        onPlay={onPlay}
        onRemove={onRemove}
        onBatchRemove={onBatchRemove}
        currentTrackId={currentTrackId}
        isPlaying={isPlaying}
        // 和播放列表 QueuePage 的清空按钮完全同款：ghost + Trash2，点击直接清空
        action={
          history.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                if (
                  await confirmDialog({
                    title: "确定清空播放历史吗？",
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
          ) : undefined
        }
      />
    </PageLayout>
  );
}
