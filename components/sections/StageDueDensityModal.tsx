"use client";

import { useMemo, useState } from "react";
import { isStageDone } from "@/lib/projectStage";
import { todayStr } from "@/lib/time";
import { DOW_LABELS, buildMonthGrid } from "@/lib/calendarGrid";
import type { ProjectStage } from "@/lib/types";
import Modal from "@/components/ui/Modal";

// 段階数の多い案件(パワプロのマイライフ準備のように、1件1件は小さいが数十〜百件以上ある
// ような案件)では、一覧をどれだけ眺めても「期日がどの日に偏っているか」に気づきにくい。
// ここでは件数のみを日別に数え、月カレンダーの形で密集日を一目で見せる
// (中身の一覧は既存の「カレンダー」表示・段階一覧そのものに任せ、ここは密集の把握に絞る)
export default function StageDueDensityModal({
  stages,
  today,
  onClose,
}: {
  stages: ProjectStage[];
  today: string;
  onClose: () => void;
}) {
  const densityByDate = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const s of stages) {
      if (!s.dueDate || isStageDone(s)) continue;
      const list = map.get(s.dueDate) ?? [];
      list.push(s.title);
      map.set(s.dueDate, list);
    }
    return map;
  }, [stages]);

  const initialAnchor = useMemo(() => {
    const upcoming = [...densityByDate.keys()].filter((d) => d >= today).sort();
    const base = upcoming[0] ?? today;
    return new Date(`${base}T00:00:00`);
  }, [densityByDate, today]);

  const [anchor, setAnchor] = useState(initialAnchor);
  const grid = useMemo(() => buildMonthGrid(anchor.getFullYear(), anchor.getMonth()), [anchor]);

  const maxCount = Math.max(1, ...[...densityByDate.values()].map((v) => v.length));
  const totalRemaining = [...densityByDate.values()].reduce((s, v) => s + v.length, 0);
  const busiestDate = [...densityByDate.entries()].sort((a, b) => b[1].length - a[1].length)[0];

  function prevMonth() {
    setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1));
  }
  function nextMonth() {
    setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1));
  }

  function cellClass(count: number): string {
    if (count === 0) return "border-cream/10";
    if (count === 1) return "border-cream/30 bg-cream/5";
    if (count / maxCount >= 0.66 || count >= 3) return "border-alert/70 bg-alert/20";
    return "border-alert/40 bg-alert/10";
  }

  return (
    <Modal title="段階の期日の混み具合" onClose={onClose}>
      <p className="mb-2 text-xs text-cream/50">
        未完了の段階{totalRemaining}件の期日を、日ごとの件数で見ます。色が濃い日ほど期日が集中しています。
        {busiestDate && busiestDate[1].length >= 2 && (
          <>
            {" "}
            最も集中しているのは<span className="font-bold text-alert">{busiestDate[0]}</span>
            （{busiestDate[1].length}件）です。
          </>
        )}
      </p>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="font-display text-sm font-bold">
          {anchor.getFullYear()}年{anchor.getMonth() + 1}月
        </h4>
        <div className="flex items-center gap-1">
          <button className="btn-pill-outline px-2 py-1 text-xs" onClick={prevMonth} aria-label="前月">
            ‹
          </button>
          <button className="btn-pill-outline px-2 py-1 text-xs" onClick={() => setAnchor(new Date())}>
            今月
          </button>
          <button className="btn-pill-outline px-2 py-1 text-xs" onClick={nextMonth} aria-label="翌月">
            ›
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {DOW_LABELS.map((d, i) => (
          <div key={d} className={`text-center text-[10px] ${i === 0 ? "text-alert/80" : "text-cream/50"}`}>
            {d}
          </div>
        ))}
        {grid.map((date) => {
          const dateStr = todayStr(date);
          const inMonth = date.getMonth() === anchor.getMonth();
          const isToday = dateStr === today;
          const titles = densityByDate.get(dateStr) ?? [];
          return (
            <div
              key={dateStr}
              title={titles.length > 0 ? titles.join("\n") : undefined}
              className={`flex min-h-[40px] flex-col items-center justify-center rounded border text-[10px] ${cellClass(
                titles.length
              )} ${inMonth ? "" : "opacity-25"} ${isToday ? "ring-1 ring-cream/60" : ""}`}
            >
              <span className="text-cream/60">{date.getDate()}</span>
              {titles.length > 0 && <span className="font-bold text-alert">{titles.length}件</span>}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
