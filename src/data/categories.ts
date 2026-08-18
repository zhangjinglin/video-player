import { invoke } from "@tauri-apps/api/core";
import type { SiteConfig } from "./sites";

// 分类节点：id 分类ID / pid 父分类ID / name 分类名称 / children 子分类
export type Category = {
  id: number;
  pid: number;
  name: string;
  children: Category[];
};

// 接口返回的扁平分类条目（部分站点缺失 type_pid 或缺失父级条目）
type FlatCategory = { type_id: number; type_pid?: number; type_name: string };

// 通过 Rust 侧 command 获取指定站点的全部分类（绕开浏览器 CORS）
async function fetchFlatCategories(apiBase: string): Promise<FlatCategory[]> {
  return (await invoke("fetch_categories", { apiBase })) as FlatCategory[];
}

// 把扁平的分类数据组装成树（自适应，无需为每个站点单独配置）：
// 1. 接口有 type_pid 且父级存在 → 组装成树形；
// 2. 缺少 type_pid、或父级条目缺失 → 该分类平铺为顶级（不做占位、不特殊处理）。
// 3. 可选 typePidMap 用于补全个别站点缺失的 type_pid（如鸭鸭资源的真实层级）。
export function buildCategoryTree(
  flat: FlatCategory[],
  typePidMap?: Record<number, number>,
): Category[] {
  const nodes = new Map<number, Category>();
  for (const c of flat) {
    const pid = c.type_pid ?? typePidMap?.[c.type_id] ?? 0;
    nodes.set(c.type_id, { id: c.type_id, pid, name: c.type_name, children: [] });
  }

  const tree: Category[] = [];
  for (const node of nodes.values()) {
    // 仅当父级确实存在（且有父子关系）时才挂为子节点，否则视为顶级平铺
    const parent = nodes.get(node.pid);
    if (parent && parent.id !== node.id) parent.children.push(node);
    else tree.push(node);
  }
  return tree;
}

// 供组件调用的统一入口：拉取并组装指定站点的分类树
export async function loadCategoryTree(site: SiteConfig): Promise<Category[]> {
  const flat = await fetchFlatCategories(site.apiBase);
  return buildCategoryTree(flat, site.typePidMap);
}
