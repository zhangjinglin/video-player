import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getEpisodes, getPlayerPayload, type Episode } from "../data/videos";

// 播放窗口：顶部为集数下拉列表（单集则不显示），下方为内嵌视频播放器
export default function Player() {
  const [title, setTitle] = useState("");
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [playError, setPlayError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  // 双击视频切换全屏：Tauri 窗口级全屏，再次双击或按 Esc 退出
  const toggleFullscreen = async () => {
    const win = getCurrentWindow();
    const isFs = await win.isFullscreen();
    await win.setFullscreen(!isFs);
  };

  // 全局键盘快捷键：左右方向键快进/快退 10 秒，空格播放/暂停，Q 关闭窗口，Esc 退出全屏（焦点在输入控件时不拦截）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ["SELECT", "INPUT", "TEXTAREA", "BUTTON"].includes(t.tagName)) return;
      const video = videoRef.current;
      if (!video) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        video.currentTime = Math.max(0, video.currentTime - 10);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        video.currentTime = Math.min(
          Number.isFinite(video.duration) ? video.duration : Infinity,
          video.currentTime + 10
        );
      } else if (e.key === " ") {
        e.preventDefault();
        if (video.paused) video.play();
        else video.pause();
      } else if (e.key === "q" || e.key === "Q") {
        e.preventDefault();
        getCurrentWindow().close();
      } else if (e.key === "Escape") {
        e.preventDefault();
        getCurrentWindow().setFullscreen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        // 1. 取本窗口的播放数据（站点 + 视频 ID + 标题）
        const payload = await getPlayerPayload();
        document.title = payload.title || "播放";
        // 2. 请求详情接口，解析出集数列表
        const result = await getEpisodes(payload.apiBase, payload.vodId);
        setTitle(result.title || payload.title);
        setEpisodes(result.episodes);
        setSelected(0);
      } catch (e) {
        setError(`加载失败：${e}`);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 根据播放地址类型初始化播放器：m3u8 走 hls.js（WebView2/WKWebView 跨平台统一），mp4 直链走原生
  const current = episodes[selected];
  const currentUrl = current?.url ?? "";

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !currentUrl) return;
    setPlayError("");

    const isM3u8 = currentUrl.includes(".m3u8") || currentUrl.includes("m3u8");

    if (isM3u8 && Hls.isSupported()) {
      // hls.js 通过 MSE 播放，兼容 Windows WebView2（不支持原生 HLS）
      const hls = new Hls({ enableWorker: false });
      hlsRef.current = hls;
      hls.loadSource(currentUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) {
          setPlayError("播放失败：无法加载视频流（可能是源站限制或地址失效）");
        }
      });
      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    } else if (isM3u8 && video.canPlayType("application/vnd.apple.mpegurl")) {
      // 环境不支持 hls.js 但原生支持 HLS（旧版 WebKit）时的兜底
      video.src = currentUrl;
    } else {
      // mp4 等直链
      video.src = currentUrl;
    }
  }, [currentUrl]);

  if (loading) {
    return <div className="player-center">正在加载视频信息…</div>;
  }
  if (error) {
    return <div className="player-center player-error">{error}</div>;
  }
  if (!current) {
    return <div className="player-center player-error">该视频暂无播放地址</div>;
  }

  return (
    <div className="player-root">
      <div className="player-topbar">
        <div className="player-title" title={title}>
          {title}
        </div>
        {episodes.length > 1 && (
          <select
            className="player-select"
            value={selected}
            onChange={(e) => setSelected(Number(e.target.value))}
          >
            {episodes.map((ep, i) => (
              <option key={i} value={i}>
                {ep.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="player-stage">
        <video
          key={selected}
          ref={videoRef}
          className="player-video"
          controls
          autoPlay
          onDoubleClick={toggleFullscreen}
          onError={() => setPlayError("播放失败：无法加载该视频地址")}
        />
        {playError && <div className="player-error-overlay">{playError}</div>}
      </div>
    </div>
  );
}
