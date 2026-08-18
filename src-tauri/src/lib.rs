use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;
use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

// 把 JSON 值转成字符串：兼容数字（如 vod_id: 206）与字符串两种情况
fn val_str(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

// 统一 HTTP GET + JSON 解析：浏览器 UA、15 秒超时、失败自动重试 3 次
// 部分采集站 CDN 会拒绝非浏览器 UA 或偶发 502，重试可显著提高成功率
fn http_get_json(url: &str) -> Result<Value, String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("初始化 HTTP 客户端失败: {e}"))?;

    let mut last_err = String::new();
    for attempt in 1..=3 {
        match client.get(url).send().and_then(|r| r.json::<Value>()) {
            Ok(v) => return Ok(v),
            Err(e) => {
                last_err = format!("{e}");
                if attempt < 3 {
                    std::thread::sleep(Duration::from_millis(300 * attempt));
                }
            }
        }
    }
    Err(format!("请求失败（已重试 3 次）: {last_err}"))
}

// 拉取分类列表：请求 {api_base}?ac=list，返回其中的 class 字段（全部分类，含父子关系）
#[tauri::command]
fn fetch_categories(api_base: String) -> Result<Value, String> {
    let url = format!("{}?ac=list", api_base);
    let resp = http_get_json(&url)?;
    resp.get("class")
        .cloned()
        .ok_or_else(|| "返回数据中缺少 class 字段".to_string())
}

// 拉取指定分类下的视频列表：请求 {api_base}?ac=list&t=分类ID&pg=页码（MacCMS 分类参数 t、分页参数 pg）
// 列表接口不含封面，因此再按 vod_id 批量请求 ac=detail 获取 vod_pic，合并后返回
// 返回结构：{ list, page, pagecount }
#[tauri::command]
fn fetch_videos(api_base: String, tid: u32, pg: u32) -> Result<Value, String> {
    let url = format!("{}?ac=list&t={}&pg={}", api_base, tid, pg);
    eprintln!("[fetch_videos] 收到 tid={} pg={}，请求 URL: {}", tid, pg, url);
    let resp = http_get_json(&url)?;
    let mut list = resp
        .get("list")
        .cloned()
        .ok_or_else(|| "返回数据中缺少 list 字段".to_string())?;

    // 收集 vod_id（兼容数字/字符串），批量请求详情接口拿封面
    let ids: Vec<String> = list
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.get("vod_id").and_then(val_str))
                .collect()
        })
        .unwrap_or_default();
    if !ids.is_empty() {
        let detail_url = format!("{}?ac=detail&ids={}", api_base, ids.join(","));
        if let Ok(detail_json) = http_get_json(&detail_url) {
            // vod_id -> vod_pic 映射
            let mut pic_map: std::collections::HashMap<String, String> =
                std::collections::HashMap::new();
            if let Some(details) = detail_json.get("list").and_then(|v| v.as_array()) {
                for d in details {
                    if let (Some(id), Some(pic)) = (
                        d.get("vod_id").and_then(val_str),
                        d.get("vod_pic").and_then(val_str),
                    ) {
                        pic_map.insert(id, pic);
                    }
                }
            }
            // 把 vod_pic 合并进列表条目
            if let Some(arr) = list.as_array_mut() {
                for item in arr.iter_mut() {
                    if let Some(id) = item.get("vod_id").and_then(val_str) {
                        if let Some(pic) = pic_map.get(&id) {
                            item.as_object_mut()
                                .map(|o| o.insert("vod_pic".into(), Value::String(pic.clone())));
                        }
                    }
                }
            }
        }
    }

    // 组装返回结构：list + page + pagecount
    let mut obj = serde_json::Map::new();
    obj.insert("list".into(), list);
    if let Some(p) = resp.get("page") {
        obj.insert("page".into(), p.clone());
    }
    if let Some(pc) = resp.get("pagecount") {
        obj.insert("pagecount".into(), pc.clone());
    }
    Ok(Value::Object(obj))
}

// 解析 MacCMS vod_play_url（形如 "正片$http://a.mp4" 或多集 "第1集$http://a$$$第2集$http://b"），返回第一个播放地址
fn parse_play_url(raw: &str) -> Option<String> {
    let first_episode = raw.split("$$$").next()?;
    let addr = first_episode.split('$').last()?.trim();
    if addr.starts_with("http") {
        Some(addr.to_string())
    } else {
        None
    }
}

// 请求当前站详情接口，解析出播放地址（播放与复制共用）
fn fetch_play_url(api_base: &str, vod_id: u32) -> Result<String, String> {
    let url = format!("{}?ac=detail&ids={}", api_base, vod_id);
    eprintln!("[fetch_play_url] vod_id={}，请求 URL: {}", vod_id, url);
    let resp = http_get_json(&url)?;
    let item = resp
        .get("list")
        .and_then(|l| l.as_array())
        .and_then(|a| a.first())
        .ok_or_else(|| "详情接口未返回视频数据".to_string())?;
    let raw = item
        .get("vod_play_url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "该视频没有播放地址".to_string())?;
    parse_play_url(raw).ok_or_else(|| format!("无法解析播放地址（原始内容: {}）", raw))
}

// 播放视频：拿播放地址后拉起系统 IINA 播放
#[tauri::command]
fn play_video(api_base: String, vod_id: u32) -> Result<String, String> {
    let play_url = fetch_play_url(&api_base, vod_id)?;
    // 检查 IINA 是否已安装
    if !Path::new("/Applications/IINA.app").exists() {
        return Err("未检测到 IINA 播放器（/Applications/IINA.app），请先安装".to_string());
    }
    Command::new("open")
        .args(["-a", "IINA", &play_url])
        .spawn()
        .map_err(|e| format!("启动 IINA 失败: {e}"))?;
    eprintln!("[play_video] 已在 IINA 中打开: {}", play_url);
    Ok(play_url)
}

// 获取播放地址（不播放），供右键菜单复制后用于其他工具下载
#[tauri::command]
fn get_play_url(api_base: String, vod_id: u32) -> Result<String, String> {
    fetch_play_url(&api_base, vod_id)
}

// 清洗文件名中的非法字符（macOS 文件名不能包含 / : 等）
fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() {
        "video".to_string()
    } else {
        trimmed.to_string()
    }
}

// 下载视频（async）：ffmpeg 拉流保存到 ~/Downloads
// 放 spawn_blocking 后台线程执行，避免阻塞主线程导致界面锁死；进度经 download-progress 事件推送前端
#[tauri::command]
async fn download_video(
    app: tauri::AppHandle,
    api_base: String,
    vod_id: u32,
    title: String,
    episode_name: String,
    task_id: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        download_video_blocking(&app, &api_base, vod_id, &title, &episode_name, &task_id)
    })
    .await
    .map_err(|e| format!("下载线程异常: {e}"))?
}

// 下载的实际逻辑（阻塞线程内执行）
fn download_video_blocking(
    app: &tauri::AppHandle,
    api_base: &str,
    vod_id: u32,
    title: &str,
    episode_name: &str,
    task_id: &str,
) -> Result<String, String> {
    use tauri::Emitter;

    let play_url = fetch_play_url(api_base, vod_id)?;

    // 保存目录：~/Downloads，不存在则创建
    let home = std::env::var("HOME").map_err(|_| "无法获取用户主目录".to_string())?;
    let download_dir = Path::new(&home).join("Downloads");
    std::fs::create_dir_all(&download_dir)
        .map_err(|e| format!("创建下载目录失败: {e}"))?;

    // 文件名：标题（多集时附加集名），重名自动加序号
    let mut base = sanitize_filename(title);
    let ep = sanitize_filename(episode_name);
    if !ep.is_empty() && ep != "正片" && ep != base {
        base = format!("{base} - {ep}");
    }
    let mut output_path = download_dir.join(format!("{base}.mp4"));
    let mut n = 1;
    while output_path.exists() {
        output_path = download_dir.join(format!("{base} ({n}).mp4"));
        n += 1;
    }

    // 预取总时长（ffprobe），失败则无百分比、降级为仅显示“下载中”
    // 因跳过了片头广告，百分比分母用正片时长（总时长 - 跳过秒数）
    let duration = probe_duration(&play_url);
    let effective_duration = duration.map(|d| (d - SKIP_AD_SECONDS).max(1.0));
    eprintln!(
        "[download_video] ffmpeg 下载: {} -> {}（总时长 {:?} 秒，跳过片头 {} 秒）",
        play_url,
        output_path.display(),
        duration,
        SKIP_AD_SECONDS
    );

    // -ss 放在 -i 之前：快速定位到片头广告之后，不下载广告分片（省流量）
    // -progress pipe:1 让 ffmpeg 把 key=value 进度写到 stdout（逐行 \n，含 out_time_us）
    // stderr 单独收集用于失败诊断
    let skip_str = SKIP_AD_SECONDS.to_string();
    let mut child = Command::new("ffmpeg")
        .args([
            "-progress",
            "pipe:1",
            "-y",
            "-ss",
            skip_str.as_str(),
            "-i",
            play_url.as_str(),
            "-c",
            "copy",
        ])
        .arg(&output_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动 ffmpeg 失败（请确认系统已安装 ffmpeg）: {e}"))?;

    let stderr = child.stderr.take().unwrap();
    let stderr_thread = std::thread::spawn(move || {
        let mut buf = String::new();
        let _ = std::io::Read::read_to_string(&mut std::io::BufReader::new(stderr), &mut buf);
        buf
    });

    // 把子进程登记进活动任务表（stdout/stderr 已取出，子进程本体存入），供取消下载时 kill
    let stdout = child.stdout.take().unwrap();
    app.state::<ActiveDownloads>()
        .0
        .lock()
        .unwrap()
        .insert(task_id.to_string(), child);

    // 逐行读 stdout 进度，换算百分比并推送
    for line in std::io::BufReader::new(stdout)
        .lines()
        .map_while(Result::ok)
    {
        if let Some(t) = parse_progress_time(&line) {
            if let Some(d) = effective_duration {
                let pct = ((t / d) * 100.0).clamp(0.0, 99.0);
                let _ = app.emit(
                    "download-progress",
                    serde_json::json!({ "taskId": task_id, "percent": pct }),
                );
            }
        } else if line.trim() == "progress=end" {
            break;
        }
    }

    // 从活动表取出子进程并等待结束（取消时 kill 后这里同样能拿到退出码）
    let mut child = app
        .state::<ActiveDownloads>()
        .0
        .lock()
        .unwrap()
        .remove(task_id)
        .ok_or_else(|| "下载任务状态异常".to_string())?;
    let status = child.wait().map_err(|e| format!("ffmpeg 等待失败: {e}"))?;
    let stderr_text = stderr_thread.join().unwrap_or_default();

    if status.success() {
        eprintln!("[download_video] 下载完成: {}", output_path.display());
        let _ = app.emit(
            "download-progress",
            serde_json::json!({ "taskId": task_id, "percent": 100.0 }),
        );
        Ok(format!("已保存到 {}", output_path.display()))
    } else {
        let tail: String = stderr_text
            .chars()
            .rev()
            .take(400)
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        Err(format!("ffmpeg 下载失败: {tail}"))
    }
}

// 解析 ffmpeg -progress 输出中的时间字段（优先 out_time_us 微秒，其次 out_time=HH:MM:SS.xxx）
fn parse_progress_time(line: &str) -> Option<f64> {
    if let Some(v) = line.strip_prefix("out_time_us=") {
        return v.trim().parse::<f64>().ok().map(|us| us / 1_000_000.0);
    }
    if let Some(v) = line.strip_prefix("out_time=") {
        let parts: Vec<&str> = v.trim().split(':').collect();
        if parts.len() == 3 {
            let h: f64 = parts[0].parse().ok()?;
            let m: f64 = parts[1].parse().ok()?;
            let s: f64 = parts[2].parse().ok()?;
            return Some(h * 3600.0 + m * 60.0 + s);
        }
    }
    None
}

// 用 ffprobe 获取视频总时长（秒），失败返回 None（部分 m3u8 无法预取时长）
fn probe_duration(url: &str) -> Option<f64> {
    let out = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            url,
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8_lossy(&out.stdout)
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|d| *d > 0.0)
}

// 写入 macOS 剪贴板（使用系统自带 pbcopy）
fn copy_to_clipboard(text: &str) -> Result<(), String> {
    let mut child = Command::new("pbcopy")
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|e| format!("pbcopy 启动失败: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(text.as_bytes())
            .map_err(|e| format!("写入剪贴板失败: {e}"))?;
    }
    let status = child.wait().map_err(|e| format!("pbcopy 等待失败: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("pbcopy 执行失败".to_string())
    }
}

// 复制文本到剪贴板（前端调用）
#[tauri::command]
fn copy_text(text: String) -> Result<(), String> {
    copy_to_clipboard(&text)
}

// 下载时跳过片头广告的秒数（ffmpeg -ss 快速定位，不下载广告段）
const SKIP_AD_SECONDS: f64 = 12.0;

// ===== 下载取消 =====

// 活动下载任务表：task_id -> ffmpeg 子进程，供取消下载时终止
#[derive(Default)]
struct ActiveDownloads(Mutex<HashMap<String, std::process::Child>>);

// 取消下载：终止对应的 ffmpeg 子进程（下载线程会因此读到 EOF 并退出）
#[tauri::command]
fn cancel_download(app: tauri::AppHandle, task_id: String) -> Result<(), String> {
    let state = app.state::<ActiveDownloads>();
    let mut map = state.0.lock().unwrap();
    if let Some(child) = map.get_mut(&task_id) {
        child
            .kill()
            .map_err(|e| format!("终止下载失败: {e}"))?;
        eprintln!("[cancel_download] 已终止任务 {task_id}");
        Ok(())
    } else {
        Err("未找到该下载任务".to_string())
    }
}

// ===== 播放窗口相关 =====

// 传给播放窗口的初始数据（按窗口 label 存储，新窗口加载后自取）
// rename_all 让序列化输出 camelCase（apiBase/vodId），与前端类型保持一致
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerPayload {
    api_base: String,
    vod_id: u32,
    title: String,
}

#[derive(Default)]
struct PlayerPayloadState(Mutex<HashMap<String, PlayerPayload>>);

// 窗口 label 序号（保证同一视频重复点击也能创建独立窗口）
static WINDOW_SEQ: AtomicU32 = AtomicU32::new(0);

// 创建播放窗口：存入 payload（label -> 数据），加载 player.html
#[tauri::command]
fn open_player_window(
    app: tauri::AppHandle,
    api_base: String,
    vod_id: u32,
    title: String,
) -> Result<String, String> {
    let label = format!(
        "player-{}-{}",
        vod_id,
        WINDOW_SEQ.fetch_add(1, Ordering::Relaxed)
    );
    app.state::<PlayerPayloadState>()
        .0
        .lock()
        .unwrap()
        .insert(label.clone(), PlayerPayload { api_base, vod_id, title: title.clone() });
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("player.html".into()))
        .title(&title)
        .inner_size(1100.0, 750.0)
        .devtools(true)
        .build()
        .map_err(|e| format!("创建播放窗口失败: {e}"))?;
    eprintln!("[open_player_window] 已创建播放窗口 {label}，vod_id={vod_id}");
    Ok(label)
}

// 播放窗口加载后自取本窗口的初始数据
// 用 get 而非 remove：React StrictMode 开发模式下 effect 会执行两次，删除会导致第二次取不到
#[tauri::command]
fn get_player_payload(
    app: tauri::AppHandle,
    window: WebviewWindow,
) -> Result<PlayerPayload, String> {
    app.state::<PlayerPayloadState>()
        .0
        .lock()
        .unwrap()
        .get(window.label())
        .cloned()
        .ok_or_else(|| "未找到该窗口的播放数据".to_string())
}

// 获取视频的集数列表：请求详情接口，解析 vod_play_url（$$$ 分隔多集、每集 名称$地址）
// 返回结构：{ title, episodes: [{ name, url }, ...] }
#[tauri::command]
fn get_episodes(api_base: String, vod_id: u32) -> Result<Value, String> {
    let url = format!("{}?ac=detail&ids={}", api_base, vod_id);
    eprintln!("[get_episodes] vod_id={}，请求 URL: {}", vod_id, url);
    let resp = http_get_json(&url)?;
    let item = resp
        .get("list")
        .and_then(|l| l.as_array())
        .and_then(|a| a.first())
        .ok_or_else(|| "详情接口未返回视频数据".to_string())?;
    let raw = item
        .get("vod_play_url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "该视频没有播放地址".to_string())?;
    // 统一多集分隔符：标准站用 $$$，部分站（如鸭鸭）用 #
    let episodes: Vec<Value> = raw
        .replace("$$$", "#")
        .split('#')
        .filter_map(|seg| {
            let mut parts: Vec<&str> = seg.split('$').collect();
            let addr = parts.pop()?.trim();
            if !addr.starts_with("http") {
                return None;
            }
            let joined = parts.join("$");
            let name = joined.trim();
            Some(serde_json::json!({
                "name": if name.is_empty() { "正片" } else { name },
                "url": addr,
            }))
        })
        .collect();
    if episodes.is_empty() {
        return Err(format!("无法解析播放地址（原始内容: {}）", raw));
    }
    Ok(serde_json::json!({
        "title": item.get("vod_name").and_then(|v| v.as_str()).unwrap_or(""),
        "episodes": episodes,
    }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(PlayerPayloadState::default())
        .manage(ActiveDownloads::default())
        .invoke_handler(tauri::generate_handler![
            fetch_categories,
            fetch_videos,
            play_video,
            get_play_url,
            copy_text,
            download_video,
            cancel_download,
            open_player_window,
            get_player_payload,
            get_episodes
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
