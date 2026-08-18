import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";
import { downloadVideo } from "./videos";

// 全局下载任务：模块级状态，不依赖组件树，切页/翻页/关播放窗口都不丢失
export type DownloadState = "downloading" | "done" | "error" | "cancelled";

export type DownloadTask = {
  taskId: string;
  vodId: number;
  title: string;
  state: DownloadState;
  percent: number; // 0~100
  msg: string; // 完成时保存路径 / 失败原因
};

let tasks: DownloadTask[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getTasks(): DownloadTask[] {
  return tasks;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// React Hook：订阅下载任务列表，任何组件调用即实时渲染
export function useDownloads(): DownloadTask[] {
  return useSyncExternalStore(subscribe, getTasks);
}

// 触发下载：同一视频已在下载中则忽略；进度经 download-progress 事件更新
export async function startDownload(
  apiBase: string,
  vodId: number,
  title: string,
): Promise<void> {
  if (tasks.some((t) => t.vodId === vodId && t.state === "downloading")) return;
  const taskId = `dl-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  tasks = [
    ...tasks,
    { taskId, vodId, title, state: "downloading", percent: 0, msg: "" },
  ];
  emit();

  const unlisten = await listen<{ taskId: string; percent: number }>(
    "download-progress",
    (e) => {
      if (e.payload.taskId !== taskId) return;
      tasks = tasks.map((t) =>
        t.taskId === taskId ? { ...t, percent: e.payload.percent } : t,
      );
      emit();
    },
  );

  try {
    const msg = await downloadVideo(apiBase, vodId, title, "", taskId);
    tasks = tasks.map((t) =>
      t.taskId === taskId ? { ...t, state: "done", percent: 100, msg } : t,
    );
  } catch (e) {
    // 已取消的任务保持"已取消"状态，不覆盖为失败
    tasks = tasks.map((t) =>
      t.taskId === taskId && t.state !== "cancelled"
        ? { ...t, state: "error", msg: `下载失败：${e}` }
        : t,
    );
  } finally {
    unlisten();
    emit();
  }
}

// 取消下载：终止 ffmpeg 进程，并立即把任务标记为"已取消"
export async function cancelDownload(taskId: string): Promise<void> {
  try {
    await invoke("cancel_download", { taskId });
  } catch {
    // 任务可能已结束，忽略终止失败
  }
  tasks = tasks.map((t) =>
    t.taskId === taskId ? { ...t, state: "cancelled", msg: "已取消" } : t,
  );
  emit();
}

// 清除已完成/失败的任务（进行中的保留）
export function clearFinished(): void {
  tasks = tasks.filter((t) => t.state === "downloading");
  emit();
}
