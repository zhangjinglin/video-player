import { useState } from "react";
import {
  cancelDownload,
  clearFinished,
  useDownloads,
} from "../data/downloads";

// 内容区底部的下载面板：可折叠，展示所有下载任务的实时进度
// 任务状态由全局模块管理，切页/翻页不丢失
export default function DownloadPanel() {
  const [expanded, setExpanded] = useState(true);
  const tasks = useDownloads();
  if (tasks.length === 0) return null;

  const downloadingCount = tasks.filter((t) => t.state === "downloading").length;
  const hasFinished = tasks.some((t) => t.state !== "downloading");

  return (
    <div className="download-panel">
      <div
        className="download-panel-header"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="download-panel-title">
          下载{downloadingCount > 0 ? `（${downloadingCount} 个进行中）` : ""}
        </span>
        <div className="download-panel-actions">
          {hasFinished && (
            <button
              className="download-panel-clear-btn"
              title="清除已完成/失败/取消的任务，只保留下载中"
              onClick={(e) => {
                e.stopPropagation();
                clearFinished();
              }}
            >
              清除
            </button>
          )}
          <span className="download-panel-toggle">
            {expanded ? "收起 ▲" : "展开 ▼"}
          </span>
        </div>
      </div>
      {expanded && (
        <div className="download-panel-body">
          {tasks.map((t) => (
            <div key={t.taskId} className="download-task">
              <div className="download-task-top">
                <span className="download-task-name" title={t.title}>
                  {t.title}
                </span>
                <span className={`download-task-state ${t.state}`}>
                  {t.state === "downloading"
                    ? `${Math.round(t.percent)}%`
                    : t.state === "done"
                      ? "完成"
                      : t.state === "cancelled"
                        ? "已取消"
                        : "失败"}
                </span>
              </div>
              {t.state === "downloading" && (
                <div className="download-task-progress">
                  <div className="download-task-track">
                    <div
                      className="download-task-fill"
                      style={{ width: `${t.percent}%` }}
                    />
                  </div>
                  <button
                    className="download-cancel-btn"
                    title="终止当前下载"
                    onClick={() => cancelDownload(t.taskId)}
                  >
                    取消
                  </button>
                </div>
              )}
              {t.msg && (
                <div
                  className={`download-task-msg ${t.state === "error" ? "error" : ""}`}
                >
                  {t.msg}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
