import { useRef, useState, type MouseEvent } from "react";
import { openPlayerWindow, type VideoItem } from "../data/videos";
import { startDownload } from "../data/downloads";

// 视频卡片：封面优先显示真实图片，失败回退首字占位；
// 左键点击弹出内嵌播放窗口；右键直接复制播放地址；
// 鼠标悬停时封面右上角浮现下载按钮（默认下载第一集），进度在内容区底部下载面板统一展示
export default function VideoCard({
  video,
  apiBase,
  onContextMenu,
}: {
  video: VideoItem;
  apiBase: string;
  onContextMenu?: (video: VideoItem) => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [dlAdded, setDlAdded] = useState(false);
  const dlTimerRef = useRef<number | null>(null);
  const showImg = video.vod_pic && !imgFailed;

  async function handlePlay() {
    if (playing) return; // 防止连点重复弹窗
    setPlaying(true);
    try {
      await openPlayerWindow(apiBase, video.vod_id, video.vod_name);
    } catch (e) {
      alert(`打开播放窗口失败：${e}`);
    } finally {
      setPlaying(false);
    }
  }

  // 触发全局下载（默认第一集），进度由下载面板展示
  async function handleDownload() {
    if (dlAdded) return;
    await startDownload(apiBase, video.vod_id, video.vod_name);
    setDlAdded(true);
    if (dlTimerRef.current) window.clearTimeout(dlTimerRef.current);
    dlTimerRef.current = window.setTimeout(() => setDlAdded(false), 1500);
  }

  return (
    <div
      className="video-card"
      title={video.vod_name}
      onClick={handlePlay}
      onContextMenu={(e: MouseEvent) => {
        e.preventDefault();
        onContextMenu?.(video);
      }}
    >
      <div className="video-cover-wrap">
        {showImg ? (
          <img
            className="video-cover-img"
            src={video.vod_pic}
            alt=""
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="video-cover">{video.vod_name.charAt(0)}</div>
        )}
        <button
          className="video-download-btn"
          title="下载视频（默认第一集）"
          onClick={(e) => {
            e.stopPropagation();
            handleDownload();
          }}
        >
          {dlAdded ? "已加入下载" : "下载"}
        </button>
      </div>
      <div className="video-title">{video.vod_name}</div>
      <div className="video-meta">
        <span>{video.type_name}</span>
        <span>{video.vod_time}</span>
      </div>
      {video.vod_remarks && <div className="video-remarks">{video.vod_remarks}</div>}
    </div>
  );
}
