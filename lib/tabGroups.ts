import type { TabKey } from "./theme";

// タブが20個を超えて1列に並ぶと目当てのタブを探しにくいため、役割ごとの分類(上段)と、
// 選んだ分類の中のタブ(下段)の2段に分けて出す(まずは森モードだけで試験的に使う)。
//
// 画面の中身・タブのキーは一切変えず、並べ方だけを変える。ほかの画面から
// 「ToDoタブへ移る」のようにタブのキーで移動しても、移った先の分類は
// タブから自動的に決まる(groupOfTab)ので、移動の経路側は何も知らなくてよい

export interface TabGroupDef {
  key: string;
  icon: string;
  label: string;
  tabs: TabKey[];
}

export const TAB_GROUPS: TabGroupDef[] = [
  { key: "today", icon: "🌱", label: "今日", tabs: ["today"] },
  { key: "plan", icon: "📋", label: "計画", tabs: ["todo", "projects", "mandala", "memo", "board", "template"] },
  {
    key: "review",
    icon: "📊",
    label: "振り返り",
    tabs: ["report", "aggregation", "attention", "overtime", "gantt", "charts", "heatmap", "yearlyChart", "observatory"],
  },
  { key: "records", icon: "🗂", label: "記録・マスタ", tabs: ["records", "master", "homeMaster"] },
  { key: "settings", icon: "⚙", label: "設定", tabs: ["appearance", "settings"] },
];

/** そのタブが属する分類。どの分類にも無いタブ(将来追加されたタブ等)はnull */
export function groupOfTab(tabKey: string): TabGroupDef | null {
  return TAB_GROUPS.find((g) => (g.tabs as string[]).includes(tabKey)) ?? null;
}

export interface VisibleTab {
  key: string;
  label: string;
  badge?: number;
}

export interface VisibleTabGroup {
  key: string;
  icon: string;
  label: string;
  tabs: VisibleTab[];
  /** 中のタブのバッジ(件数)の合計。分類を開かなくても気づけるよう上段に出す */
  badge: number;
}

// 実際に表示するタブ(モードの絞り込み・「茂みへ隠す」を適用済み)を分類ごとに振り分ける。
// ・分類内の並びは、分類の定義順(TAB_GROUPS)に従う
// ・中のタブが全部隠れた分類は、上段からも消す
// ・どの分類にも属さないタブは、取りこぼさないよう末尾の「その他」にまとめる
export function buildVisibleTabGroups(visibleTabs: VisibleTab[]): VisibleTabGroup[] {
  const byKey = new Map(visibleTabs.map((t) => [t.key, t]));
  const groups: VisibleTabGroup[] = [];
  for (const g of TAB_GROUPS) {
    const tabs = g.tabs.map((k) => byKey.get(k)).filter((t): t is VisibleTab => t !== undefined);
    if (tabs.length === 0) continue;
    groups.push({ key: g.key, icon: g.icon, label: g.label, tabs, badge: sumBadges(tabs) });
  }
  const others = visibleTabs.filter((t) => groupOfTab(t.key) === null);
  if (others.length > 0) {
    groups.push({ key: "others", icon: "…", label: "その他", tabs: others, badge: sumBadges(others) });
  }
  return groups;
}

function sumBadges(tabs: VisibleTab[]): number {
  return tabs.reduce((sum, t) => sum + (t.badge ?? 0), 0);
}

/** 今開いているタブが属する(表示中の)分類のキー */
export function activeGroupKey(groups: VisibleTabGroup[], activeTab: string): string | null {
  return groups.find((g) => g.tabs.some((t) => t.key === activeTab))?.key ?? null;
}
