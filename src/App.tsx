import { useEffect, useRef, useState } from "react";
import { SITES, type SiteConfig } from "./data/sites";
import { loadCategoryTree, type Category } from "./data/categories";
import { copyText, getPlayUrl, loadVideos, type VideoItem } from "./data/videos";
import CategoryTree from "./components/CategoryTree";
import VideoCard from "./components/VideoCard";
import DownloadPanel from "./components/DownloadPanel";
import "./App.css";

// 加载提示的最小展示时长（毫秒）：数据秒回时也要保证加载反馈可见
const MIN_LOADING_MS = 800;

function App() {
  const [site, setSite] = useState<SiteConfig>(SITES[0]);
  const [tree, setTree] = useState<Category[]>([]);
  const [catsLoading, setCatsLoading] = useState(true);
  const [catsError, setCatsError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Category | null>(null);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [videosLoading, setVideosLoading] = useState(false);
  const [videosError, setVideosError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pagecount, setPagecount] = useState(1);
  const [pageInput, setPageInput] = useState("");
  const [expandedTopIds, setExpandedTopIds] = useState<number[]>([]);

  // 请求序号：快速切换分类/翻页时，只有最后一次请求的结果会被采纳
  const reqSeq = useRef(0);

  // toast 用于复制成功的短暂提示
  const [toast, setToast] = useState<string | null>(null);

  // 站点变化或首次挂载时，自动加载该站分类树并重置右侧
  useEffect(() => {
    let cancelled = false;
    setCatsLoading(true);
    setCatsError(null);
    setSelected(null);
    setVideos([]);
    setPage(1);
    setPagecount(1);
    setExpandedTopIds([]);
    const startedAt = Date.now();
    loadCategoryTree(site)
      .then((cats) => {
        if (!cancelled) setTree(cats);
      })
      .catch((e) => {
        if (!cancelled) setCatsError(String(e));
      })
      .finally(() => {
        if (cancelled) return;
        const wait = Math.max(0, MIN_LOADING_MS - (Date.now() - startedAt));
        setTimeout(() => {
          if (!cancelled) setCatsLoading(false);
        }, wait);
      });
    return () => {
      cancelled = true;
    };
  }, [site]);

  // 按 分类ID + 页码 拉取列表；若该分类自身无内容且含子分类，自动展开并降级到第一个子分类
  async function loadInto(tid: number, pg: number, cat: Category | null = null) {
    const seq = ++reqSeq.current;
    const startedAt = Date.now();
    setVideosLoading(true);
    setVideosError(null);
    setVideos([]); // 立即清空旧列表，让加载状态可见
    console.log(`[loadVideos] 开始请求 tid=${tid} pg=${pg}`);
    try {
      let res = await loadVideos(site.apiBase, tid, pg);
      if (res.list.length === 0 && cat && cat.children.length > 0) {
        // 顶级分类无内容：自动展开并加载第一个子分类
        const first = cat.children[0];
        console.log(`[loadVideos] tid=${tid} 无内容，降级到子分类 tid=${first.id}（${first.name}）`);
        setExpandedTopIds((ids) => (ids.includes(cat.id) ? ids : [...ids, cat.id]));
        setSelected(first);
        res = await loadVideos(site.apiBase, first.id, 1);
      }
      console.log(
        `[loadVideos] tid=${tid} 返回 ${res.list.length} 条，page=${res.page} pagecount=${res.pagecount}`,
      );
      if (seq === reqSeq.current) {
        setVideos(res.list);
        // 部分站点返回的 page/pagecount 是字符串，统一转数字，避免翻页时字符串拼接
        setPage(Number(res.page));
        setPagecount(Number(res.pagecount));
      }
    } catch (e) {
      console.error(`[loadVideos] tid=${tid} pg=${pg} 请求失败`, e);
      if (seq === reqSeq.current) setVideosError(String(e));
    } finally {
      const wait = Math.max(0, MIN_LOADING_MS - (Date.now() - startedAt));
      await new Promise((resolve) => setTimeout(resolve, wait));
      if (seq === reqSeq.current) setVideosLoading(false);
    }
  }

  // 点击分类：切到第一页（支持顶级分类自动降级）
  function handleSelect(cat: Category) {
    setSelected(cat);
    loadInto(cat.id, 1, cat);
  }

  // 翻页
  function goPage(pg: number) {
    if (!selected) return;
    loadInto(selected.id, pg);
  }

  // 跳转到指定页：输入数字后按回车或点跳转，校验为 1~总页数 内的整数才生效
  function handleJump() {
    const target = Number(pageInput.trim());
    if (!Number.isInteger(target) || target < 1 || target > pagecount) return;
    setPageInput("");
    goPage(target);
  }

  // 切换一级分类展开
  function toggleTop(id: number) {
    setExpandedTopIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );
  }

  // 卡片右键：直接复制播放地址到剪贴板（不再弹菜单）
  async function handleContextMenu(video: VideoItem) {
    try {
      const addr = await getPlayUrl(site.apiBase, video.vod_id);
      await copyText(addr);
      console.log(`[copy] 已复制播放地址: ${addr}`);
      setToast("已复制播放地址");
      setTimeout(() => setToast(null), 2000);
    } catch (e) {
      alert(`获取播放地址失败：${e}`);
    }
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-title">资源站</div>
        <select
          className="site-select"
          value={site.id}
          onChange={(e) => {
            const next = SITES.find((s) => s.id === e.target.value);
            if (next) setSite(next); // 切换站点 → 自动重新加载分类树
          }}
        >
          {SITES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <div className="sidebar-title">分类</div>
        {catsLoading ? (
          <div className="loading-panel small">
            <span className="spinner" />
            <p>正在获取分类数据…</p>
          </div>
        ) : catsError ? (
          <div className="sidebar-hint error">加载失败：{catsError}</div>
        ) : (
          <CategoryTree
            tree={tree}
            selectedId={selected?.id ?? null}
            onSelect={handleSelect}
            expandedTopIds={expandedTopIds}
            onToggleTop={toggleTop}
          />
        )}
      </aside>
      <main className="content">
        <div className="content-scroll">
          {!selected ? (
            <div className="loading-panel">
              <p>请在左侧选择一个分类</p>
            </div>
          ) : videosLoading ? (
            <div className="loading-panel">
              <span className="spinner large" />
              <p>正在加载「{selected.name}」的视频…</p>
            </div>
          ) : videosError ? (
            <div className="loading-panel error">
              <p>加载失败：{videosError}</p>
            </div>
          ) : (
            <div className="video-section">
              <div className="video-section-title">
                {selected.name}（{videos.length} 条）
              </div>
              <div className="video-grid">
                {videos.map((v) => (
                  <VideoCard
                    key={v.vod_id}
                    video={v}
                    apiBase={site.apiBase}
                    onContextMenu={handleContextMenu}
                  />
                ))}
              </div>
              <div className="pager">
                <button disabled={page <= 1} onClick={() => goPage(page - 1)}>
                  上一页
                </button>
                <span>
                  第 {page} / {pagecount} 页
                </span>
                <div className="pager-jump">
                  <input
                    className="pager-input"
                    type="number"
                    min={1}
                    max={pagecount}
                    placeholder="页码"
                    value={pageInput}
                    onChange={(e) => setPageInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleJump();
                    }}
                  />
                  <button onClick={handleJump}>跳转</button>
                </div>
                <button disabled={page >= pagecount} onClick={() => goPage(page + 1)}>
                  下一页
                </button>
              </div>
            </div>
          )}
        </div>
        <DownloadPanel />
      </main>
      {/* 复制成功提示 */}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export default App;
