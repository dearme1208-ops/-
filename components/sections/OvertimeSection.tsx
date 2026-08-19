"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useSetting } from "@/lib/settings";
import { breakdownByCategory, breakdownByProject, computeMonthlyOvertime, formatHoursJp, type BreakdownRow } from "@/lib/overtime";
import { formatDateJp } from "@/lib/time";
import RankingBarChart from "@/components/charts/RankingBarChart";
import DiffLineChart from "@/components/charts/DiffLineChart";
import DonutChart, { type DonutDatum } from "@/components/charts/DonutChart";
import Modal from "@/components/ui/Modal";

type BreakdownMode = "category" | "project";
type BreakdownStyle = "bar" | "donut";

export default function OvertimeSection() {
  const [standardHoursStr, setStandardHoursStr] = useSetting("overtime.standardDailyHours", "8");
  const standardDailySeconds = Math.max(0, Number(standardHoursStr) || 0) * 3600;

  const records = useLiveQuery(() => db.records.toArray(), []);
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const settings = useLiveQuery(() => db.settings.toArray(), []);

  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [breakdownMode, setBreakdownMode] = useState<BreakdownMode>("category");
  const [breakdownStyle, setBreakdownStyle] = useState<BreakdownStyle>("bar");
  // 外れ値として概算残業から除外された日の内訳を表示するモーダル
  const [outlierDetailMonth, setOutlierDetailMonth] = useState<string | null>(null);

  const projectTitleById = useMemo(() => new Map((projects ?? []).map((p) => [p.id, p.title])), [projects]);

  const manualOverrides = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of settings ?? []) {
      if (s.key.startsWith("overtime.manual.")) {
        const month = s.key.slice("overtime.manual.".length);
        const v = Number(s.value);
        if (!Number.isNaN(v)) map.set(month, v);
      }
    }
    return map;
  }, [settings]);

  // 年表タブで「労働日数×所定労働時間」を基準とした残業時間を算出するために使う
  const workDaysByMonth = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of settings ?? []) {
      if (s.key.startsWith("overtime.workdays.")) {
        const month = s.key.slice("overtime.workdays.".length);
        const v = Number(s.value);
        if (!Number.isNaN(v)) map.set(month, v);
      }
    }
    return map;
  }, [settings]);

  const monthlyMap = useMemo(
    () => computeMonthlyOvertime(records ?? [], standardDailySeconds),
    [records, standardDailySeconds]
  );

  const months = useMemo(() => {
    const set = new Set<string>([...monthlyMap.keys(), ...manualOverrides.keys()]);
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [monthlyMap, manualOverrides]);

  const currentMonth = selectedMonth ?? months[0] ?? null;

  const currentMonthRecords = useMemo(() => {
    if (!currentMonth) return [];
    return (records ?? []).filter((r) => r.date.startsWith(currentMonth));
  }, [records, currentMonth]);

  // 外れ値詳細モーダル用: 除外した個々の実績を日付ごとにまとめておく
  const excludedRecordsByDate = useMemo(() => {
    const map = new Map<string, { date: string; category: string; name: string; seconds: number }[]>();
    for (const r of monthlyMap.get(outlierDetailMonth ?? "")?.excludedRecords ?? []) {
      if (!map.has(r.date)) map.set(r.date, []);
      map.get(r.date)!.push(r);
    }
    return map;
  }, [monthlyMap, outlierDetailMonth]);

  const breakdownRows = useMemo(() => {
    return breakdownMode === "category"
      ? breakdownByCategory(currentMonthRecords)
      : breakdownByProject(currentMonthRecords, projectTitleById);
  }, [currentMonthRecords, breakdownMode, projectTitleById]);

  // ドーナツグラフの区分をタップした際、その区分の元になった実績(日付ごと)を見せる詳細パネル
  const [breakdownDetail, setBreakdownDetail] = useState<string | null>(null);
  function findBreakdownRow(d: DonutDatum): BreakdownRow | undefined {
    return (
      breakdownRows.find((r) => r.label === d.label && r.seconds === d.value) ??
      breakdownRows.find((r) => r.label === d.label)
    );
  }
  function recordsForBreakdownRow(row: BreakdownRow) {
    if (breakdownMode === "category") {
      if (row.key.startsWith("__trouble__::")) {
        const category = row.key.slice("__trouble__::".length);
        return currentMonthRecords.filter((r) => r.category === category && r.isTrouble);
      }
      return currentMonthRecords.filter((r) => r.category === row.sublabel && r.name === row.label && !r.isTrouble);
    }
    if (row.key === "__none__") return currentMonthRecords.filter((r) => !r.projectId);
    return currentMonthRecords.filter((r) => r.projectId === row.key);
  }
  function breakdownDetailText(d: DonutDatum, meta: { isOther: boolean; otherItems: DonutDatum[] }): string {
    if (meta.isOther) {
      const items = [...meta.otherItems].sort((a, b) => b.value - a.value);
      const lines = ["その他（上位に入らなかった内訳）", `合計 ${formatHoursJp(d.value)}`, ""];
      for (const item of items.slice(0, 15)) lines.push(`・${item.label}: ${formatHoursJp(item.value)}`);
      if (items.length > 15) lines.push(`ほか${items.length - 15}件`);
      return lines.join("\n");
    }
    const row = findBreakdownRow(d);
    if (!row) return `${d.label}\n合計 ${formatHoursJp(d.value)}`;
    const records = recordsForBreakdownRow(row).sort((a, b) => b.date.localeCompare(a.date));
    const title = breakdownMode === "category" && row.sublabel ? `${row.sublabel} / ${row.label}` : row.label;
    const lines = [title, `合計 ${formatHoursJp(d.value)}`, ""];
    for (const r of records.slice(0, 15)) {
      lines.push(`・${r.date}: ${formatHoursJp(r.seconds)}`);
    }
    if (records.length > 15) lines.push(`ほか${records.length - 15}件`);
    return lines.join("\n");
  }

  // 手入力残業が登録されている月について、手入力と概算の差（手入力－概算）を古い月から新しい月へ並べる
  const diffPoints = useMemo(() => {
    return [...manualOverrides.entries()]
      .filter(([month]) => monthlyMap.has(month))
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, manualHours]) => {
        const { year, m } = monthLabel(month);
        const autoSeconds = monthlyMap.get(month)!.autoOvertimeSeconds;
        const diffHours = manualHours - autoSeconds / 3600;
        return { key: month, label: `${year.slice(2)}/${m}`, value: diffHours };
      });
  }, [manualOverrides, monthlyMap]);

  async function saveManualOverride(month: string, hoursStr: string) {
    const key = `overtime.manual.${month}`;
    if (hoursStr.trim() === "") {
      await db.settings.delete(key);
      return;
    }
    const v = Number(hoursStr);
    if (Number.isNaN(v)) return;
    await db.settings.put({ key, value: String(v) });
  }

  async function saveWorkDays(month: string, daysStr: string) {
    const key = `overtime.workdays.${month}`;
    if (daysStr.trim() === "") {
      await db.settings.delete(key);
      return;
    }
    const v = Number(daysStr);
    if (Number.isNaN(v)) return;
    await db.settings.put({ key, value: String(v) });
  }

  function monthLabel(month: string): { year: string; m: string } {
    const [y, m] = month.split("-");
    return { year: y, m: String(Number(m)) };
  }

  return (
    <div className="space-y-4">
      <h2 className="font-display text-lg font-bold">残業分析</h2>

      <div className="panel flex flex-wrap items-center gap-2 p-4">
        <label className="text-xs text-cream/60">1日の所定労働時間</label>
        <input
          type="number"
          min={0}
          step={0.5}
          value={standardHoursStr}
          onChange={(e) => setStandardHoursStr(e.target.value)}
          className="w-16 rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-center text-sm text-cream"
        />
        <span className="text-xs text-cream/60">時間</span>
        <p className="ml-2 text-xs text-cream/40">
          概算残業は、実績（作業記録）から日ごとにこの時間を超えた分を積み上げて計算します。同じ作業の他の日・平均と比べて突出して長い実績（タイマーの消し忘れなど）は、その実績分だけを外れ値として計算から除外します。実際の残業時間が分かる場合は「手入力残業」に入力すると、そちらが優先して表示されます。
        </p>
      </div>

      <div className="panel overflow-x-auto p-0">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-cream/10 text-xs text-cream/50">
              <th className="px-3 py-2 text-left">対象年</th>
              <th className="px-3 py-2 text-left">対象月</th>
              <th className="px-3 py-2 text-right">実績合計</th>
              <th className="px-3 py-2 text-right">概算残業（自動）</th>
              <th className="px-3 py-2 text-right">手入力残業</th>
              <th className="px-3 py-2 text-right">労働日数</th>
            </tr>
          </thead>
          <tbody>
            {months.map((month) => {
              const row = monthlyMap.get(month);
              const { year, m } = monthLabel(month);
              const manual = manualOverrides.get(month);
              const isSelected = month === currentMonth;
              return (
                <tr
                  key={month}
                  onClick={() => {
                    setSelectedMonth(month);
                    setBreakdownDetail(null);
                  }}
                  className={`cursor-pointer border-b border-cream/5 ${
                    isSelected ? "bg-cream/10" : "hover:bg-cream/5"
                  }`}
                >
                  <td className="px-3 py-2">{year} 年</td>
                  <td className="px-3 py-2">{m} 月</td>
                  <td className="px-3 py-2 text-right tabular-nums text-cream/70">
                    {row ? formatHoursJp(row.totalTrackedSeconds) : "-"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-cream/70">
                    {row ? formatHoursJp(row.autoOvertimeSeconds) : "-"}
                    {row && row.excludedRecords.length > 0 && (
                      <button
                        type="button"
                        className="ml-1 text-[10px] text-cream/40 underline decoration-dotted hover:text-cream"
                        title="同じ作業の他の日や平均と比べて突出して長い実績(タイマーの消し忘れなど)を外れ値として概算から除外しています。クリックすると内訳を表示します"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOutlierDetailMonth(month);
                        }}
                      >
                        （外れ値{row.excludedRecords.length}件除外）
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      defaultValue={manual ?? ""}
                      placeholder="未入力"
                      onBlur={(e) => saveManualOverride(month, e.target.value)}
                      className="w-20 rounded-lg border border-cream/20 bg-ink px-2 py-1 text-right text-sm text-cream"
                    />
                  </td>
                  <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      defaultValue={workDaysByMonth.get(month) ?? ""}
                      placeholder="未入力"
                      onBlur={(e) => saveWorkDays(month, e.target.value)}
                      className="w-16 rounded-lg border border-cream/20 bg-ink px-2 py-1 text-right text-sm text-cream"
                    />
                  </td>
                </tr>
              );
            })}
            {months.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-sm text-cream/50">
                  実績データがありません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {currentMonth && (
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-base font-bold">
              {monthLabel(currentMonth).year}年{monthLabel(currentMonth).m}月の内訳
            </h3>
            <div className="flex gap-2">
              <button
                className={breakdownMode === "category" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
                onClick={() => {
                  setBreakdownMode("category");
                  setBreakdownDetail(null);
                }}
              >
                業務区分別
              </button>
              <button
                className={breakdownMode === "project" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
                onClick={() => {
                  setBreakdownMode("project");
                  setBreakdownDetail(null);
                }}
              >
                案件別
              </button>
              <span className="mx-1 text-cream/20">|</span>
              <button
                className={breakdownStyle === "bar" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
                onClick={() => setBreakdownStyle("bar")}
              >
                棒グラフ
              </button>
              <button
                className={breakdownStyle === "donut" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
                onClick={() => setBreakdownStyle("donut")}
              >
                円グラフ
              </button>
            </div>
          </div>
          <div className="panel p-4">
            {breakdownStyle === "bar" ? (
              <RankingBarChart
                data={breakdownRows.map((r) => ({ label: r.label, sublabel: r.sublabel, value: r.seconds }))}
                formatValue={formatHoursJp}
              />
            ) : (
              <>
                <DonutChart
                  data={breakdownRows.map((r) => ({ label: r.label, value: r.seconds }))}
                  formatValue={formatHoursJp}
                  onSliceClick={(d, meta) => setBreakdownDetail(breakdownDetailText(d, meta))}
                />
                {breakdownDetail && (
                  <div className="mt-3 flex items-start justify-between gap-3 rounded-lg border border-cream/20 bg-ink p-3">
                    <p className="min-w-0 whitespace-pre-line break-words text-sm text-cream">{breakdownDetail}</p>
                    <button
                      className="shrink-0 text-lg leading-none text-cream/50 hover:text-cream"
                      onClick={() => setBreakdownDetail(null)}
                      aria-label="詳細を閉じる"
                    >
                      ×
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <div>
        <h3 className="mb-2 font-display text-base font-bold">手入力残業と概算の差の推移</h3>
        <p className="mb-2 text-xs text-cream/40">
          「手入力残業 − 概算残業（自動）」を月ごとに表示します。プラスなら実際の残業が概算より多く、マイナスなら概算が実際を上回っています。
        </p>
        <div className="panel p-4">
          <DiffLineChart points={diffPoints} formatValue={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)} 時間`} />
        </div>
      </div>

      {outlierDetailMonth && (
        <Modal
          title={`${monthLabel(outlierDetailMonth).year}年${monthLabel(outlierDetailMonth).m}月の外れ値（除外した実績）`}
          onClose={() => setOutlierDetailMonth(null)}
        >
          <p className="mb-3 text-xs text-cream/50">
            以下の実績は、同じ作業の他の日・平均と比べて突出して長かったため、概算残業の計算からのみ除外しています（実績合計・実績自体はそのまま残っています。日をまるごと除外するのではなく、この実績分だけを差し引いて計算します）。タイマーの消し忘れなどが原因であれば、実績編集タブから該当する記録を修正・削除してください。
          </p>
          <div className="space-y-3">
            {[...excludedRecordsByDate.entries()].map(([date, items]) => (
              <div key={date} className="rounded-lg bg-ink/50 p-3">
                <div className="mb-1.5 text-sm font-bold text-cream">{formatDateJp(date)}</div>
                <div className="space-y-1">
                  {items.map((r, i) => (
                    <div key={i} className="flex items-center justify-between text-xs text-cream/60">
                      <span className="truncate">
                        {r.category} / {r.name}
                      </span>
                      <span className="shrink-0 tabular-nums text-alert">{formatHoursJp(r.seconds)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
