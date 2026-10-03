"use client";

import { useEffect, useMemo, useRef } from "react";
import TabNav, { type TabDef } from "@/components/TabNav";
import { activeGroupKey, buildVisibleTabGroups } from "@/lib/tabGroups";

// タブを「分類(上段)」と「その分類の中のタブ(下段)」の2段に分けて出すタブ列。
// 上段・下段とも既存のTabNav(tab-nav / tab-chip)をそのまま使うので、演出テーマの
// タブの見た目(森モードの木札など)はどちらの段にも同じように当たる。
// 受け取るtabsは、モードの絞り込み・「茂みへ隠す」を適用済みのもの
export default function GroupedTabNav({
  tabs,
  active,
  onChange,
}: {
  tabs: TabDef[];
  active: string;
  onChange: (key: string) => void;
}) {
  const groups = useMemo(() => buildVisibleTabGroups(tabs), [tabs]);
  const currentGroupKey = activeGroupKey(groups, active);
  const currentGroup = groups.find((g) => g.key === currentGroupKey) ?? null;

  // 分類ごとに最後に開いていたタブ。分類を切り替えて戻ってきたとき、毎回その分類の
  // 先頭タブに戻されると、例えば「振り返り」で残業分析を見ていた人が何度も選び直すことになる
  const lastTabByGroup = useRef(new Map<string, string>());
  useEffect(() => {
    if (currentGroupKey) lastTabByGroup.current.set(currentGroupKey, active);
  }, [currentGroupKey, active]);

  function openGroup(groupKey: string) {
    const group = groups.find((g) => g.key === groupKey);
    if (!group) return;
    const remembered = lastTabByGroup.current.get(groupKey);
    const target = group.tabs.find((t) => t.key === remembered) ?? group.tabs[0];
    onChange(target.key);
  }

  const groupTabs: TabDef[] = groups.map((g) => ({
    key: g.key,
    icon: g.icon,
    label: g.label,
    shortLabel: g.shortLabel,
    badge: g.badge,
  }));

  return (
    <div data-grouped-tabs="true">
      <TabNav
        tabs={groupTabs}
        active={currentGroupKey ?? ""}
        onChange={openGroup}
        className="tab-nav-groups !mb-2"
        ariaLabel="タブの分類"
      />
      {/* 中のタブが1つだけの分類(今日など)は、下段を出しても選ぶものがないので出さない */}
      {currentGroup && currentGroup.tabs.length > 1 && (
        <TabNav
          tabs={currentGroup.tabs}
          active={active}
          onChange={onChange}
          className="tab-nav-sub"
          ariaLabel={`${currentGroup.label}のタブ`}
        />
      )}
    </div>
  );
}
