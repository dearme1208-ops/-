"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { computeStreakDays } from "@/lib/streak";
import { computeGrowthStage, ADVENTURER_STAGES } from "@/lib/growth";
import { formatHms, todayStr } from "@/lib/time";
import { computeCalendarHeatmap, heatLevel, type CalendarDay } from "@/lib/calendarHeatmap";
import RankingBarChart, { type RankingBarDatum } from "@/components/charts/RankingBarChart";

// 危険度マップの5段階の濃淡(GanttMonthView/HeatmapSectionと揃える)
const LEVEL_OPACITY = [0.04, 0.22, 0.42, 0.64, 0.9];
const RANK_HOUR_THRESHOLDS = [0, 1, 2, 4, 6, 8];
const WEEKS_BACK = 12;

// 冒険者モード専用の「冒険者ステータス」タブ。集計・ランキング/グラフ/ヒートマップ/年表/
// 残業分析という5つの分析系タブは、いずれも同じ実績データを別の角度から見るという
// 点で役割が重なっており、RPGのキャラクターステータス画面のように1画面へ集約する方が
// この世界観には自然だと判断し、既存の4タブ(グラフ/ヒートマップ/年表/残業分析)は
// 冒険者モードでは非表示にし、この画面に統合した(集計・ランキングタブの中身を丸ごと置き換える)
export default function AdventurerStatusSection() {
  const today = todayStr();
  const records = useLiveQuery(() => db.records.toArray(), []);
  const [selectedDetail, setSelectedDetail] = useState<string | null>(null);

  const todaySeconds = useMemo(
    () => (records ?? []).filter((r) => r.date === today && !r.excludedFromStats).reduce((s, r) => s + r.seconds, 0),
    [records, today]
  );
  const streakDays = useMemo(() => computeStreakDays(records ?? [], today), [records, today]);
  const { stage: rank, index: rankIndex } = computeGrowthStage("adventurer", todaySeconds);
  const totalLifetimeSeconds = useMemo(
    () => (records ?? []).filter((r) => !r.excludedFromStats).reduce((s, r) => s + r.seconds, 0),
    [records]
  );
  const questCount = useMemo(() => (records ?? []).filter((r) => !r.excludedFromStats && r.seconds > 0).length, [records]);

  // 討伐者番付: 今月のカテゴリ別合計時間の上位8件
  const thisMonthPrefix = today.slice(0, 7);
  const categoryRanking: RankingBarDatum[] = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of records ?? []) {
      if (r.excludedFromStats || !r.date.startsWith(thisMonthPrefix)) continue;
      map.set(r.category, (map.get(r.category) ?? 0) + r.seconds);
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([label, value]) => ({ label, value }));
  }, [records, thisMonthPrefix]);

  // 冒険の年代記: 今年の月別合計時間(12ヶ月分)
  const monthlyChronicle: RankingBarDatum[] = useMemo(() => {
    const year = new Date(today + "T00:00:00").getFullYear();
    const totals = Array(12).fill(0) as number[];
    for (const r of records ?? []) {
      if (r.excludedFromStats) continue;
      const [y, m] = r.date.split("-").map(Number);
      if (y === year) totals[m - 1] += r.seconds;
    }
    return totals.map((value, i) => ({ label: `${i + 1}月`, value }));
  }, [records, today]);

  // 危険度マップ: 直近12週間のGitHub風カレンダーヒートマップ(実績の多い日ほど濃い赤)
  const heat = useMemo(() => computeCalendarHeatmap(records ?? [], WEEKS_BACK, today), [records, today]);
  const columns = useMemo(() => {
    const cols: (CalendarDay | undefined)[][] = Array.from({ length: heat.weekCount }, () => []);
    for (const d of heat.days) {
      if (!cols[d.weekIndex]) cols[d.weekIndex] = [];
      cols[d.weekIndex][d.dow] = d;
    }
    return cols;
  }, [heat]);

  // 夜更かし警報: 22時以降〜4時未満に開始または終了した実績がある日
  const lateNightDays = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of records ?? []) {
      if (r.excludedFromStats) continue;
      const startHour = new Date(r.startedAt).getHours();
      const endHour = new Date(r.endedAt).getHours();
      const isLate = (h: number) => h >= 22 || h < 4;
      if (isLate(startHour) || isLate(endHour)) {
        map.set(r.date, (map.get(r.date) ?? 0) + r.seconds);
      }
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 10);
  }, [records]);

  function rankDetail(): string {
    const lines = ADVENTURER_STAGES.map(
      (s, i) => `${i === rankIndex ? "▶ " : "　"}${s.icon} ${s.label}（${RANK_HOUR_THRESHOLDS[i]}h〜）`
    );
    return [`本日の冒険時間 ${formatHms(todaySeconds)}`, ...lines].join("\n");
  }

  function dayDetail(d: CalendarDay): string {
    return `${d.date}\n討伐時間 ${d.seconds > 0 ? formatHms(d.seconds) : "記録なし"}`;
  }

  return (
    <div className="space-y-4">
      {/* --- 冒険者としての通算戦績。今のランク・れんぞく討伐日数・生涯討伐時間・討伐数 --- */}
      <div className="panel space-y-2 p-4">
        <button type="button" className="flex items-center gap-2 text-left hover:opacity-80" onClick={() => setSelectedDetail(rankDetail())}>
          <span className="text-xl">{rank.icon}</span>
          <span className="font-display text-sm font-bold text-cream">
            Lv.{rankIndex + 1} {rank.label}（本日）
          </span>
        </button>
        <div className="grid grid-cols-3 gap-3 text-center sm:grid-cols-3">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-cream/50">れんぞく討伐日数</div>
            <div className="tabular-nums text-lg font-bold text-cream">{streakDays}日</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-cream/50">生涯討伐時間</div>
            <div className="tabular-nums text-lg font-bold text-cream">{formatHms(totalLifetimeSeconds)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-cream/50">通算討伐数</div>
            <div className="tabular-nums text-lg font-bold text-cream">{questCount}体</div>
          </div>
        </div>
      </div>

      {/* --- 討伐者番付: 今月のカテゴリ別合計時間 --- */}
      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-base font-bold">討伐者番付（今月・カテゴリ別）</h3>
        {categoryRanking.length === 0 ? (
          <p className="text-xs text-cream/40">今月の討伐記録はまだありません。</p>
        ) : (
          <RankingBarChart data={categoryRanking} formatValue={(v) => formatHms(v)} />
        )}
      </div>

      {/* --- 危険度マップ: 直近12週間のカレンダーヒートマップ --- */}
      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-base font-bold">危険度マップ（直近{WEEKS_BACK}週間）</h3>
        <div className="flex gap-1 overflow-x-auto pb-1">
          {columns.map((col, ci) => (
            <div key={ci} className="flex flex-col gap-1">
              {col.map((d, di) =>
                d ? (
                  <button
                    key={di}
                    type="button"
                    onClick={() => setSelectedDetail(dayDetail(d))}
                    className="h-3.5 w-3.5 rounded-sm border border-cream/10"
                    style={
                      d.seconds > 0
                        ? { backgroundColor: `rgb(var(--adv-danger-rgb) / ${LEVEL_OPACITY[heatLevel(d.seconds, heat.maxSeconds)]})` }
                        : { backgroundColor: "rgb(var(--adv-danger-rgb) / 0.04)" }
                    }
                    title={d.date}
                  />
                ) : (
                  <div key={di} className="h-3.5 w-3.5" />
                )
              )}
            </div>
          ))}
        </div>
        <p className="text-xs text-cream/40">マスをタップすると、その日の討伐時間を表示します。色が濃いほど激戦だった日です。</p>
      </div>

      {/* --- 冒険の年代記: 今年の月別合計時間 --- */}
      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-base font-bold">冒険の年代記（{new Date(today + "T00:00:00").getFullYear()}年）</h3>
        <RankingBarChart data={monthlyChronicle} formatValue={(v) => formatHms(v)} />
      </div>

      {/* --- 夜更かし警報: 22時以降/4時未満に討伐していた日 --- */}
      <div className="panel space-y-2 p-4">
        <h3 className="font-display text-base font-bold">夜更かし警報</h3>
        {lateNightDays.length === 0 ? (
          <p className="text-xs text-cream/40">最近、夜更けの討伐はないようです。よい休息を。</p>
        ) : (
          <div className="space-y-1.5">
            {lateNightDays.map(([date, seconds]) => (
              <div key={date} className="flex items-center justify-between text-xs">
                <span className="text-cream/80">🌙 {date}</span>
                <span className="tabular-nums text-cream/50">{formatHms(seconds)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedDetail && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-cream/20 bg-ink/30 p-3">
          <p className="min-w-0 whitespace-pre-line break-words text-sm text-cream">{selectedDetail}</p>
          <button
            className="shrink-0 text-lg leading-none text-cream/50 hover:text-cream"
            onClick={() => setSelectedDetail(null)}
            aria-label="詳細を閉じる"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
