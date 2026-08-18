import type { Category } from "../data/categories";

type Props = {
  tree: Category[];
  selectedId: number | null;
  onSelect: (cat: Category) => void;
  // 受控展开：展开的一级分类 id 列表 + 切换展开回调
  expandedTopIds: number[];
  onToggleTop: (id: number) => void;
};

// 单个分类节点：点击行 = 选中；有子分类时点击箭头 = 展开/收起
function Node({
  cat,
  depth,
  selectedId,
  onSelect,
  open,
  onToggle,
}: {
  cat: Category;
  depth: number;
  selectedId: number | null;
  onSelect: (c: Category) => void;
  open: boolean;
  onToggle: (id: number) => void;
}) {
  const hasChildren = cat.children.length > 0;
  const selected = cat.id === selectedId;

  return (
    <div>
      <div
        className={"cat-row" + (selected ? " selected" : "")}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => onSelect(cat)}
      >
        {hasChildren ? (
          <span
            className="cat-arrow"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(cat.id);
            }}
          >
            {open ? "▾" : "▸"}
          </span>
        ) : (
          <span className="cat-arrow cat-leaf" />
        )}
        <span className="cat-name">{cat.name}</span>
      </div>
      {hasChildren && open && (
        <div>
          {cat.children.map((c) => (
            <Node
              key={c.id}
              cat={c}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              open={false}
              onToggle={() => {}}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function CategoryTree({
  tree,
  selectedId,
  onSelect,
  expandedTopIds,
  onToggleTop,
}: Props) {
  return (
    <div className="cat-tree">
      {tree.map((cat) => (
        <Node
          key={cat.id}
          cat={cat}
          depth={0}
          selectedId={selectedId}
          onSelect={onSelect}
          open={expandedTopIds.includes(cat.id)}
          onToggle={onToggleTop}
        />
      ))}
    </div>
  );
}
