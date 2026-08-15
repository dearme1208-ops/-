"use client";

import { useState } from "react";

export interface TreeNodeBadge {
  text: string;
  tone?: "default" | "alert" | "muted";
}

export interface TreeNode {
  id: string;
  label: string;
  sublabel?: string;
  badges?: TreeNodeBadge[];
  // 表形式で揃えたい主要な値(例: タスク行のアクション、サブタスク行の期日)。
  // 設定した行だけ固定幅の右寄せ列として表示され、同じ階層内で縦に列が揃って見える
  valueLabel?: string;
  emphasis?: boolean;
  children?: TreeNode[];
  onClick?: () => void;
}

// 大/中/小の階層を、深さに応じた単色アクセントの濃淡(不透明度)だけで塗り分ける。
// 新しい色相は増やさず、既存のcream/alertトークンの濃淡のみで系統を表現する
const DEPTH_STYLES = [
  { border: "border-cream/50", bg: "bg-ink/40", text: "text-sm font-bold" },
  { border: "border-cream/30", bg: "bg-ink/25", text: "text-sm" },
  { border: "border-cream/15", bg: "bg-ink/10", text: "text-xs" },
];

function badgeClass(tone: TreeNodeBadge["tone"]): string {
  if (tone === "alert") return "bg-alert/20 text-alert font-bold";
  if (tone === "muted") return "text-cream/30";
  return "bg-cream/10 text-cream/70";
}

function TreeRow({ node, depth, verticalLabels }: { node: TreeNode; depth: number; verticalLabels?: boolean }) {
  const hasChildren = !!node.children && node.children.length > 0;
  // 「小」にあたる深い階層(実績・サブタスク等)は件数が多くなりがちなので既定で折りたたむ。
  // ここで判定するのは「自分の子」の深さなので、子が小階層(depth+1>=2)になる depth>=1 のノードを畳む
  const [collapsed, setCollapsed] = useState(depth >= 1);
  const style = DEPTH_STYLES[Math.min(depth, DEPTH_STYLES.length - 1)];
  // 血統表を意識した縦書き表示。文字数で高さが変わるため truncate はせず自然な高さで見せる
  const vertStyle = verticalLabels ? { writingMode: "vertical-rl" as const, textOrientation: "mixed" as const } : undefined;
  const labelClass = verticalLabels ? `inline-block text-cream ${style.text}` : `truncate text-cream ${style.text}`;
  const sublabelClass = verticalLabels ? "mt-1 inline-block text-cream/40" : "ml-1.5 truncate text-cream/40";

  return (
    <div className={depth > 0 ? "mt-1 ml-4" : "mt-2"}>
      <div
        className={`flex gap-2 rounded-lg border-l-4 px-2.5 py-1.5 ${verticalLabels ? "items-start" : "items-center"} ${style.border} ${style.bg} ${
          node.emphasis ? "ring-1 ring-alert/40" : ""
        }`}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="shrink-0 text-cream/50 hover:text-cream"
            aria-label={collapsed ? "展開" : "折りたたむ"}
            aria-expanded={!collapsed}
          >
            <span className={`inline-block transition-transform ${collapsed ? "-rotate-90" : ""}`}>▾</span>
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {node.onClick ? (
          <button type="button" className="min-w-0 flex-1 text-left" onClick={node.onClick}>
            <span className={labelClass} style={vertStyle}>
              {node.label}
            </span>
            {node.sublabel && (
              <span className={sublabelClass} style={vertStyle}>
                {node.sublabel}
              </span>
            )}
          </button>
        ) : (
          <div className={verticalLabels ? "flex min-w-0 flex-1 items-start" : "min-w-0 flex-1"}>
            <span className={labelClass} style={vertStyle}>
              {node.label}
            </span>
            {node.sublabel && (
              <span className={sublabelClass} style={vertStyle}>
                {node.sublabel}
              </span>
            )}
          </div>
        )}
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          {(node.badges ?? []).map((b, i) => (
            <span key={i} className={`rounded-full px-1.5 py-0.5 text-[10px] ${badgeClass(b.tone)}`}>
              {b.text}
            </span>
          ))}
          {/* バッジの有無に関わらず値列が常に行の右端に揃うよう、バッジの後ろ(最後尾)に置く */}
          {node.valueLabel !== undefined && (
            <span className="w-24 shrink-0 truncate text-right text-xs text-cream/60" title={node.valueLabel || undefined}>
              {node.valueLabel || "—"}
            </span>
          )}
        </div>
      </div>
      {hasChildren && !collapsed && (
        <div>
          {node.children!.map((child) => (
            <TreeRow key={child.id} node={child} depth={depth + 1} verticalLabels={verticalLabels} />
          ))}
        </div>
      )}
    </div>
  );
}

// 血統表(競走馬の父方/母方の系統図)の見た目にヒントを得た、大中小の階層を
// カスケード表示するツリー。二分木ではなく任意の子要素数のツリーに一般化してある
export default function TreeView({ nodes, verticalLabels }: { nodes: TreeNode[]; verticalLabels?: boolean }) {
  if (nodes.length === 0) {
    return <p className="px-1 py-4 text-sm text-cream/50">表示する項目がありません。</p>;
  }
  return (
    <div>
      {nodes.map((node) => (
        <TreeRow key={node.id} node={node} depth={0} verticalLabels={verticalLabels} />
      ))}
    </div>
  );
}
