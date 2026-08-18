import { invoke } from "@tauri-apps/api/core";

// 视频条目（列表接口字段 + Rust 侧合并的封面地址）
export type VideoItem = {
  vod_id: number;
  vod_name: string;
  type_id: number;
  type_name: string;
  vod_time: string;
  vod_remarks: string;
  vod_play_from: string;
  vod_pic?: string;
};

// 拉取结果：列表 + 当前页 + 总页数
export type VideoListResult = {
  list: VideoItem[];
  page: number;
  pagecount: number;
};

// 按站点、分类与页码拉取视频列表（每页条数由站点接口决定，如 20 或 50）
export async function loadVideos(
  apiBase: string,
  tid: number,
  pg: number,
): Promise<VideoListResult> {
  return (await invoke("fetch_videos", { apiBase, tid, pg })) as VideoListResult;
}

// 拉起系统 IINA 播放指定视频，成功时返回播放地址
// 架构师决策：不自研播放器，直接交给 macOS 的 IINA
export async function playVideo(apiBase: string, vodId: number): Promise<string> {
  return (await invoke("play_video", { apiBase, vodId })) as string;
}

// 获取播放地址（不播放），供右键菜单复制后用其他工具下载
export async function getPlayUrl(apiBase: string, vodId: number): Promise<string> {
  return (await invoke("get_play_url", { apiBase, vodId })) as string;
}

// 复制文本到系统剪贴板
export async function copyText(text: string): Promise<void> {
  await invoke("copy_text", { text });
}

// ===== 内嵌播放窗口 =====

// 单个集数：名称 + 播放地址
export type Episode = {
  name: string;
  url: string;
};

// 集数解析结果
export type EpisodesResult = {
  title: string;
  episodes: Episode[];
};

// 打开内嵌播放窗口（由 Rust 创建新窗口并携带播放数据）
export async function openPlayerWindow(
  apiBase: string,
  vodId: number,
  title: string,
): Promise<string> {
  return (await invoke("open_player_window", { apiBase, vodId, title })) as string;
}

// 播放窗口自取本窗口的播放数据
export async function getPlayerPayload(): Promise<{
  apiBase: string;
  vodId: number;
  title: string;
}> {
  return (await invoke("get_player_payload")) as {
    apiBase: string;
    vodId: number;
    title: string;
  };
}

// 获取视频的集数列表（单集返回 1 条）
export async function getEpisodes(
  apiBase: string,
  vodId: number,
): Promise<EpisodesResult> {
  return (await invoke("get_episodes", { apiBase, vodId })) as EpisodesResult;
}

// 用系统 ffmpeg 下载视频到 ~/Downloads，成功时返回保存路径提示
// taskId 由调用方生成，用于过滤本窗口的 download-progress 进度事件
export async function downloadVideo(
  apiBase: string,
  vodId: number,
  title: string,
  episodeName: string,
  taskId: string,
): Promise<string> {
  return (await invoke("download_video", {
    apiBase,
    vodId,
    title,
    episodeName,
    taskId,
  })) as string;
}
