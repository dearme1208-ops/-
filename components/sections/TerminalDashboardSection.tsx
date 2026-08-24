"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import { findOrCreateMasterTask } from "@/lib/master";
import { finishDailyTask, segmentsAccumulatedMs } from "@/lib/tasks";
import { formatClock, formatHms, formatMsClock, todayStr } from "@/lib/time";
import { computeStreakDays } from "@/lib/streak";
import { computeGrowthStage, TERMINAL_STAGES } from "@/lib/growth";
import { useVisualMode, getRiskTier, riskBadgeClasses, riskBadgeLabel, RISK_TIERS_TERMINAL } from "@/lib/theme";
import { fetchCurrentWeatherCode, weatherCodeToCategory, type WeatherCategory } from "@/lib/weather";
import type { DailyTask, MasterTask } from "@/lib/types";

// computeGrowthStageの分岐(0h/1h/2h/4h/6h/8h以上)と対応させた表示用ラベル
const GROWTH_HOUR_LABELS = ["0h", "1h", "2h", "4h", "6h", "8h+"];

// ターミナルモード専用の「本日」タブ。Claude/禅がタブや情報を削ぎ落とす方向だったのに対し、
// こちらはユーザーの要望どおり正反対の方向 ── マルチモニターのトレーディングフロア並みの
// 情報密度を1画面に詰め込む。データソースは他モードと完全に同じdailyTasks/todoTasks/
// projects/records/masterTasksで、見せ方だけをダッシュボード仕立てに変える
const NOMINAL_DAY_SECONDS = 8 * 3600;
const WEATHER_FALLBACK_LOCATION = { lat: 35.6812, lon: 139.7671 };
const WEATHER_LABEL: Record<WeatherCategory, string> = {
  clear: "CLEAR",
  cloudy: "CLOUDY",
  rain: "RAIN",
  thunderstorm: "STORM",
  snow: "SNOW",
};

function CategoryBar({
  category,
  ms,
  maxMs,
  onTap,
}: {
  category: string;
  ms: number;
  maxMs: number;
  onTap: () => void;
}) {
  const pct = maxMs > 0 ? Math.max(2, Math.round((ms / maxMs) * 100)) : 0;
  return (
    <button
      type="button"
      onClick={onTap}
      className="flex w-full items-center gap-2 text-left text-xs hover:opacity-80"
    >
      <span className="w-20 shrink-0 truncate text-cream/60">{category || "未分類"}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-sm bg-cream/10">
        <div className="h-full bg-[rgb(var(--term-up-rgb))]" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-14 shrink-0 tabular-nums text-right text-cream/50">{formatHms(ms / 1000)}</span>
    </button>
  );
}

export default function TerminalDashboardSection() {
  const { themedMode } = useVisualMode();
  const mode = themedMode ?? "terminal";
  const today = todayStr();
  const dailyTasks = useLiveQuery(() => db.dailyTasks.where("date").equals(today).toArray(), [today]);
  const todoTasks = useLiveQuery(() => db.todoTasks.toArray(), []);
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const records = useLiveQuery(() => db.records.toArray(), []);
  const favoriteMasters = useLiveQuery(
    () => db.masterTasks.filter((m) => m.isFavorite && !m.archived).toArray(),
    []
  );
  const [now, setNow] = useState(Date.now());
  const [weather, setWeather] = useState<WeatherCategory | null>(null);
  const [newTaskCategory, setNewTaskCategory] = useState("");
  const [newTaskName, setNewTaskName] = useState("");
  // カテゴリ内訳・時間帯バー・ティッカーはタップで詳細を1箇所にまとめて出す(ホバーの
  // ネイティブtitleはタッチ端末で機能しないため、Ganttタブ等と同じタップ詳細パネル方式にする)
  const [selectedDetail, setSelectedDetail] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function resolveLocation(): Promise<{ lat: number; lon: number }> {
      if (typeof navigator !== "undefined" && navigator.geolocation) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000, maximumAge: 1800000 })
          );
          return { lat: pos.coords.latitude, lon: pos.coords.longitude };
        } catch {
          // 権限拒否・タイムアウト時はフォールバック地点を使う
        }
      }
      return WEATHER_FALLBACK_LOCATION;
    }
    async function refresh() {
      try {
        const { lat, lon } = await resolveLocation();
        const { weathercode } = await fetchCurrentWeatherCode(lat, lon);
        if (!cancelled) setWeather(weatherCodeToCategory(weathercode));
      } catch {
        // 取得失敗時はタイル自体を表示しない
      }
    }
    refresh();
    const id = setInterval(refresh, 1800000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const runningDaily = (dailyTasks ?? []).find((d) => d.status === "running") ?? null;
  const totalMsToday = (dailyTasks ?? []).reduce((sum, d) => sum + segmentsAccumulatedMs(d, now), 0);
  const doneToday = (dailyTasks ?? []).filter((d) => d.status === "done");
  const activeTodos = (todoTasks ?? []).filter((t) => !t.completed);
  const activeProjects = (projects ?? []).filter((p) => !p.completedAt);
  const streakDays = useMemo(() => computeStreakDays(records ?? [], today), [records, today]);
  const { stage: growthStage } = computeGrowthStage(mode, totalMsToday / 1000);
  const loadRatio = totalMsToday / 1000 / NOMINAL_DAY_SECONDS;
  const loadTier = getRiskTier(loadRatio, mode);

  const categoryTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of dailyTasks ?? []) {
      map.set(d.category, (map.get(d.category) ?? 0) + segmentsAccumulatedMs(d, now));
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyTasks, now]);
  const maxCategoryMs = categoryTotals.length > 0 ? categoryTotals[0][1] : 0;

  // 24時間分の稼働密度(0-23時)。今日のセグメントを時間帯ごとに切り分けて積み上げる
  const hourlyBuckets = useMemo(() => {
    const buckets = new Array(24).fill(0) as number[];
    const dayStart = new Date(today + "T00:00:00").getTime();
    for (const d of dailyTasks ?? []) {
      for (const seg of d.segments) {
        const segEnd = seg.end ?? now;
        for (let h = 0; h < 24; h++) {
          const hStart = dayStart + h * 3600000;
          const hEnd = hStart + 3600000;
          const overlap = Math.min(segEnd, hEnd) - Math.max(seg.start, hStart);
          if (overlap > 0) buckets[h] += overlap;
        }
      }
    }
    return buckets;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyTasks, now, today]);
  const maxBucketMs = Math.max(1, ...hourlyBuckets);

  async function pauseDaily(daily: DailyTask) {
    const closeAt = Date.now();
    const segments = daily.segments.map((s, i) =>
      i === daily.segments.length - 1 && s.end === undefined ? { ...s, end: closeAt } : s
    );
    const accumulatedMs = segments.reduce((sum, s) => sum + ((s.end ?? closeAt) - s.start), 0);
    await db.dailyTasks.update(daily.id, { segments, status: "paused", accumulatedMs, stoppedAt: closeAt });
  }

  async function startMaster(master: MasterTask) {
    if (runningDaily && runningDaily.masterTaskId !== master.id) await pauseDaily(runningDaily);
    const existing = (dailyTasks ?? []).find(
      (d) => d.masterTaskId === master.id && (d.status === "running" || d.status === "paused")
    );
    if (existing) {
      if (existing.status === "paused") {
        const segments = [...existing.segments, { start: Date.now() }];
        await db.dailyTasks.update(existing.id, { segments, status: "running" });
      }
      return;
    }
    const task: DailyTask = {
      id: uid(),
      date: today,
      order: (dailyTasks ?? []).length,
      masterTaskId: master.id,
      category: master.category,
      name: master.name,
      estimatedSeconds: master.estimatedSeconds,
      hasPlan: master.estimatedSeconds > 0,
      status: "running",
      segments: [{ start: Date.now() }],
      accumulatedMs: 0,
      startedAt: Date.now(),
      isSpontaneous: true,
    };
    await db.dailyTasks.add(task);
  }

  // クイックスタート(お気に入り)に無い作業も、大項目・詳細作業名を直接打ち込んで
  // その場で計測を開始できるようにする(お気に入りからしか選べない、という制約を無くす)
  async function startNewTask() {
    const category = newTaskCategory.trim();
    const name = newTaskName.trim();
    if (!category || !name) return;
    if (runningDaily) await pauseDaily(runningDaily);
    const master = await findOrCreateMasterTask(category, name, 0);
    const task: DailyTask = {
      id: uid(),
      date: today,
      order: (dailyTasks ?? []).length,
      masterTaskId: master.id,
      category,
      name,
      estimatedSeconds: master.estimatedSeconds,
      hasPlan: master.estimatedSeconds > 0,
      status: "running",
      segments: [{ start: Date.now() }],
      accumulatedMs: 0,
      startedAt: Date.now(),
      isSpontaneous: true,
    };
    await db.dailyTasks.add(task);
    setNewTaskCategory("");
    setNewTaskName("");
  }

  function categoryDetail(category: string): string {
    const items = (dailyTasks ?? []).filter((d) => d.category === category);
    const total = items.reduce((sum, d) => sum + segmentsAccumulatedMs(d, now), 0);
    const lines = items.map(
      (d) => `${d.status === "running" ? "● LIVE " : ""}${d.name} ${formatMsClock(segmentsAccumulatedMs(d, now))}`
    );
    return [`[${category || "未分類"}] 合計 ${formatMsClock(total)}`, ...lines].join("\n");
  }

  function hourDetail(hour: number): string {
    const dayStart = new Date(today + "T00:00:00").getTime();
    const hStart = dayStart + hour * 3600000;
    const hEnd = hStart + 3600000;
    const lines: string[] = [];
    for (const d of dailyTasks ?? []) {
      for (const seg of d.segments) {
        const segEnd = seg.end ?? now;
        const clipStart = Math.max(seg.start, hStart);
        const clipEnd = Math.min(segEnd, hEnd);
        if (clipEnd > clipStart) {
          lines.push(
            `[${d.category}] ${d.name} ${formatClock(clipStart)}〜${seg.end === undefined && clipEnd === segEnd ? "計測中" : formatClock(clipEnd)}`
          );
        }
      }
    }
    const header = `${String(hour).padStart(2, "0")}:00-${String((hour + 1) % 24).padStart(2, "0")}:00`;
    return lines.length > 0 ? [header, ...lines].join("\n") : `${header}\n記録なし`;
  }

  function tickerDetail(d: DailyTask): string {
    const seconds = d.accumulatedMs / 1000;
    const over = d.estimatedSeconds > 0 && seconds > d.estimatedSeconds;
    const estimateLine = d.estimatedSeconds > 0 ? `予測 ${formatHms(d.estimatedSeconds)}${over ? "(超過)" : ""}` : "予測なし";
    const startLabel = d.startedAt ? formatClock(d.startedAt) : "-";
    const endLabel = d.endedAt ? formatClock(d.endedAt) : "-";
    return [`[${d.category}] ${d.name}`, `${startLabel} 〜 ${endLabel}`, `実績 ${formatHms(seconds)} / ${estimateLine}`].join("\n");
  }

  function clockDetail(): string {
    const weekday = ["日", "月", "火", "水", "木", "金", "土"][nowDate.getDay()];
    return [
      `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, "0")}-${String(nowDate.getDate()).padStart(2, "0")} (${weekday})`,
      `TODAY TOTAL ${formatMsClock(totalMsToday)}`,
    ].join("\n");
  }

  function loadDetail(): string {
    // 昇順(NOMINAL→SYSTEM OVERLOAD)に並べ替え、現在の階級を明示する
    const tiers = [...RISK_TIERS_TERMINAL].reverse();
    const lines = tiers.map(
      (t) => `${t.level === loadTier.level ? "▶ " : "  "}[${t.name}] ratio >= ${t.threshold.toFixed(1)}`
    );
    return [
      `LOAD RATIO ×${loadRatio.toFixed(2)} (${formatMsClock(totalMsToday)} / 8h基準)`,
      ...lines,
    ].join("\n");
  }

  function growthDetail(): string {
    const hours = totalMsToday / 1000 / 3600;
    const lines = TERMINAL_STAGES.map(
      (s, i) => `${s.label === growthStage.label ? "▶ " : "  "}${s.icon} ${s.label} (${GROWTH_HOUR_LABELS[i]}〜)`
    );
    return [`本日の稼働時間 ${formatMsClock(totalMsToday)} (${hours.toFixed(1)}h)`, ...lines].join("\n");
  }

  function streakDetail(): string {
    const dates = [...new Set((records ?? []).filter((r) => r.seconds > 0).map((r) => r.date))].sort().reverse().slice(0, 10);
    const lines = dates.length > 0 ? dates.map((d) => `  ${d}`) : ["  記録なし"];
    return [`STREAK ${streakDays} DAYS`, "直近の記録日:", ...lines].join("\n");
  }

  function completedDetail(): string {
    if (doneToday.length === 0) return "COMPLETED 0件\n本日完了した作業はまだありません。";
    const lines = doneToday.map((d) => `・[${d.category}] ${d.name} ${formatMsClock(d.accumulatedMs)}`);
    return [`COMPLETED ${doneToday.length}件`, ...lines].join("\n");
  }

  function queueDetail(): string {
    if (activeTodos.length === 0) return "QUEUE (TODO) 0件\n未完了のToDoはありません。";
    const lines = activeTodos
      .slice(0, 20)
      .map((t) => `・${t.title}${t.dueDate ? ` (期日 ${t.dueDate})` : ""}`);
    return [`QUEUE (TODO) ${activeTodos.length}件`, ...lines].join("\n");
  }

  function positionsDetail(): string {
    if (activeProjects.length === 0) return "POSITIONS 0件\n進行中の案件はありません。";
    const lines = activeProjects.slice(0, 20).map((p) => `・${p.title} (期日 ${p.dueDate})`);
    return [`POSITIONS ${activeProjects.length}件`, ...lines].join("\n");
  }

  function todayTotalDetail(): string {
    const map = new Map<string, number>();
    for (const d of dailyTasks ?? []) {
      map.set(d.category, (map.get(d.category) ?? 0) + segmentsAccumulatedMs(d, now));
    }
    const all = [...map.entries()].sort((a, b) => b[1] - a[1]);
    if (all.length === 0) return "TODAY TOTAL\n本日の記録はまだありません。";
    const lines = all.map(([c, ms]) => `・${c || "未分類"} ${formatMsClock(ms)}`);
    return [`TODAY TOTAL ${formatMsClock(totalMsToday)}`, ...lines].join("\n");
  }

  function weatherDetail(): string {
    if (!weather) return "WEATHER 取得中/取得できませんでした";
    return [`WEATHER ${WEATHER_LABEL[weather]}`, "現在地(または既定地点)の直近取得結果です。30分ごとに自動更新します。"].join("\n");
  }

  function runningDetail(daily: DailyTask): string {
    const elapsedSeconds = segmentsAccumulatedMs(daily, now) / 1000;
    const startLabel = daily.startedAt ? formatClock(daily.startedAt) : "-";
    const lines = [`[${daily.category}] ${daily.name}`, `開始 ${startLabel}`, `実績 ${formatHms(elapsedSeconds)}`];
    if (daily.estimatedSeconds > 0) {
      const remaining = daily.estimatedSeconds - elapsedSeconds;
      lines.push(
        `予測 ${formatHms(daily.estimatedSeconds)}`,
        remaining >= 0 ? `残り ${formatHms(remaining)}` : `超過 ${formatHms(-remaining)}`
      );
    } else {
      lines.push("予測なし");
    }
    const pauseCount = daily.segments.filter((s) => s.end !== undefined).length;
    if (pauseCount > 0) lines.push(`一時停止回数 ${pauseCount}回`);
    return lines.join("\n");
  }

  const nowDate = new Date(now);
  const clockStr = [nowDate.getHours(), nowDate.getMinutes(), nowDate.getSeconds()]
    .map((v) => String(v).padStart(2, "0"))
    .join(":");

  return (
    <div className="space-y-3 font-sans">
      {/* --- ヘッダー行: 時刻・システム負荷・育成ステージ・継続日数を横並びで一望する。
           いずれもタップすると下部のDETAILパネルに内訳が出る --- */}
      <div className="panel grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
        <button type="button" className="text-left hover:opacity-80" onClick={() => setSelectedDetail(clockDetail())}>
          <div className="text-[10px] uppercase tracking-widest text-cream/40">CLOCK</div>
          <div className="tabular-nums text-2xl font-bold text-[rgb(var(--term-up-rgb))]">{clockStr}</div>
        </button>
        <button type="button" className="text-left hover:opacity-80" onClick={() => setSelectedDetail(loadDetail())}>
          <div className="text-[10px] uppercase tracking-widest text-cream/40">SYSTEM LOAD</div>
          <span className={riskBadgeClasses(loadTier.level, mode)}>{riskBadgeLabel(loadTier, mode)}</span>
        </button>
        <button type="button" className="text-left hover:opacity-80" onClick={() => setSelectedDetail(growthDetail())}>
          <div className="text-[10px] uppercase tracking-widest text-cream/40">GROWTH STAGE</div>
          <div className="text-sm font-bold text-cream">
            {growthStage.icon} {growthStage.label}
          </div>
        </button>
        <button type="button" className="text-left hover:opacity-80" onClick={() => setSelectedDetail(streakDetail())}>
          <div className="text-[10px] uppercase tracking-widest text-cream/40">STREAK</div>
          <div className="tabular-nums text-sm font-bold text-cream">{streakDays} DAYS</div>
        </button>
      </div>

      {/* --- 現在実行中の作業。LIVEランプは他テーマのような柔らかい呼吸ではなく硬い点滅にする --- */}
      {runningDaily ? (
        <div className="panel space-y-1 p-4 ring-1 ring-alert/50">
          <div className="flex items-center gap-2 text-xs text-alert">
            <span className="term-blink inline-flex h-2 w-2 rounded-full bg-alert" aria-hidden="true" />
            ● LIVE
          </div>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 text-left hover:opacity-80"
            onClick={() => setSelectedDetail(runningDetail(runningDaily))}
          >
            <p className="text-base font-bold text-cream">
              [{runningDaily.category}] {runningDaily.name}
            </p>
            <span className="tabular-nums text-xl font-bold text-alert">
              {formatMsClock(segmentsAccumulatedMs(runningDaily, now))}
            </span>
          </button>
          <div className="flex gap-2 pt-1">
            <button className="btn-pill-outline text-xs" onClick={() => pauseDaily(runningDaily)}>
              一時停止
            </button>
            <button className="btn-pill text-xs" onClick={() => finishDailyTask(runningDaily)}>
              完了にする
            </button>
          </div>
        </div>
      ) : (
        <div className="panel p-4 text-xs text-cream/40">計測中の作業はありません。下のクイックスタートから開始できます。</div>
      )}

      {/* --- 密なステータスタイル群。いずれもタップで下部のDETAILパネルに内訳が出る --- */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <button type="button" className="panel p-3 text-left hover:opacity-80" onClick={() => setSelectedDetail(todayTotalDetail())}>
          <div className="text-[10px] uppercase tracking-widest text-cream/40">TODAY TOTAL</div>
          <div className="tabular-nums text-lg font-bold text-cream">{formatMsClock(totalMsToday)}</div>
        </button>
        <button type="button" className="panel p-3 text-left hover:opacity-80" onClick={() => setSelectedDetail(completedDetail())}>
          <div className="text-[10px] uppercase tracking-widest text-cream/40">COMPLETED</div>
          <div className="tabular-nums text-lg font-bold text-cream">{doneToday.length}</div>
        </button>
        <button type="button" className="panel p-3 text-left hover:opacity-80" onClick={() => setSelectedDetail(queueDetail())}>
          <div className="text-[10px] uppercase tracking-widest text-cream/40">QUEUE (TODO)</div>
          <div className="tabular-nums text-lg font-bold text-cream">{activeTodos.length}</div>
        </button>
        <button type="button" className="panel p-3 text-left hover:opacity-80" onClick={() => setSelectedDetail(positionsDetail())}>
          <div className="text-[10px] uppercase tracking-widest text-cream/40">POSITIONS</div>
          <div className="tabular-nums text-lg font-bold text-cream">{activeProjects.length}</div>
        </button>
        <button type="button" className="panel p-3 text-left hover:opacity-80" onClick={() => setSelectedDetail(loadDetail())}>
          <div className="text-[10px] uppercase tracking-widest text-cream/40">LOAD RATIO</div>
          <div className="tabular-nums text-lg font-bold text-cream">×{loadRatio.toFixed(2)}</div>
        </button>
        <button type="button" className="panel p-3 text-left hover:opacity-80" onClick={() => setSelectedDetail(weatherDetail())}>
          <div className="text-[10px] uppercase tracking-widest text-cream/40">WEATHER</div>
          <div className="text-lg font-bold text-cream">{weather ? WEATHER_LABEL[weather] : "—"}</div>
        </button>
      </div>

      {/* --- カテゴリ別内訳・時間帯アクティビティ密度 --- */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="panel space-y-1.5 p-4">
          <div className="mb-1 text-[10px] uppercase tracking-widest text-cream/40">BREAKDOWN BY CATEGORY</div>
          {categoryTotals.length === 0 ? (
            <p className="text-xs text-cream/30">本日の記録はまだありません。</p>
          ) : (
            categoryTotals.map(([category, ms]) => (
              <CategoryBar
                key={category}
                category={category}
                ms={ms}
                maxMs={maxCategoryMs}
                onTap={() => setSelectedDetail(categoryDetail(category))}
              />
            ))
          )}
        </div>
        <div className="panel space-y-1.5 p-4">
          <div className="mb-1 text-[10px] uppercase tracking-widest text-cream/40">HOURLY ACTIVITY (00-23)</div>
          <div className="flex h-16 items-end gap-[2px]">
            {hourlyBuckets.map((ms, h) => (
              <button
                key={h}
                type="button"
                title={`${h}時台: ${formatHms(ms / 1000)}`}
                onClick={() => setSelectedDetail(hourDetail(h))}
                className="flex-1 rounded-t-sm bg-[rgb(var(--term-up-rgb))] hover:opacity-70"
                style={{ height: `${Math.max(3, Math.round((ms / maxBucketMs) * 100))}%`, opacity: ms > 0 ? 1 : 0.15 }}
              />
            ))}
          </div>
          <div className="flex justify-between text-[9px] tabular-nums text-cream/30">
            <span>00</span>
            <span>06</span>
            <span>12</span>
            <span>18</span>
            <span>23</span>
          </div>
        </div>
      </div>

      {/* --- カテゴリ内訳・時間帯バー・下部ティッカーをタップした際の詳細パネル(共通1箇所) --- */}
      {selectedDetail && (
        <div className="panel space-y-1 p-3 ring-1 ring-[rgb(var(--term-up-rgb))]/40">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-widest text-cream/40">DETAIL</span>
            <button type="button" className="text-xs text-cream/40 hover:text-cream" onClick={() => setSelectedDetail(null)}>
              close ✕
            </button>
          </div>
          <pre className="whitespace-pre-wrap font-sans text-xs text-cream/80">{selectedDetail}</pre>
        </div>
      )}

      {/* --- 新規エントリー: お気に入りに無い作業も大項目・詳細作業名を直接打ち込んで即計測開始できる --- */}
      <div className="panel space-y-2 p-4">
        <div className="text-[10px] uppercase tracking-widest text-cream/40">NEW ENTRY</div>
        <div className="flex flex-wrap gap-1.5">
          <input
            value={newTaskCategory}
            onChange={(e) => setNewTaskCategory(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && startNewTask()}
            placeholder="CATEGORY"
            className="min-w-[6rem] flex-1 rounded-sm border border-cream/15 bg-ink/40 px-2 py-1.5 text-xs text-cream placeholder:text-cream/30"
          />
          <input
            value={newTaskName}
            onChange={(e) => setNewTaskName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && startNewTask()}
            placeholder="TASK NAME"
            className="min-w-[8rem] flex-[2] rounded-sm border border-cream/15 bg-ink/40 px-2 py-1.5 text-xs text-cream placeholder:text-cream/30"
          />
          <button
            type="button"
            onClick={startNewTask}
            disabled={!newTaskCategory.trim() || !newTaskName.trim()}
            className="btn-pill text-xs disabled:opacity-40"
          >
            ▶ START
          </button>
        </div>
      </div>

      {/* --- クイックスタート: お気に入り登録済みのマスタ作業を1タップで開始する --- */}
      {favoriteMasters && favoriteMasters.length > 0 && (
        <div className="panel space-y-2 p-4">
          <div className="text-[10px] uppercase tracking-widest text-cream/40">QUICK START</div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
            {favoriteMasters.map((m) => {
              const daily = (dailyTasks ?? []).find((d) => d.masterTaskId === m.id);
              const isRunning = daily?.status === "running";
              return (
                <button
                  key={m.id}
                  onClick={() => startMaster(m)}
                  disabled={isRunning}
                  className={`rounded-sm border px-2 py-1.5 text-left text-xs transition-colors ${
                    isRunning
                      ? "border-alert bg-alert/10 text-alert"
                      : "border-cream/15 bg-ink/40 text-cream/70 hover:border-[rgb(var(--term-up-rgb))] hover:text-cream"
                  }`}
                >
                  <div className="truncate font-bold">{m.name}</div>
                  <div className="truncate text-[10px] opacity-60">[{m.category}]{isRunning ? " ● LIVE" : ""}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* --- 直近完了タスクのティッカーテープ。想定超過は警戒色、想定内は稼働色で色分けする --- */}
      {doneToday.length > 0 && (
        <div className="term-ticker panel overflow-hidden p-2">
          <div className="term-ticker-track">
            {[...doneToday, ...doneToday].map((d, i) => {
              const over = d.estimatedSeconds > 0 && d.accumulatedMs / 1000 > d.estimatedSeconds;
              return (
                <button
                  key={`${d.id}-${i}`}
                  type="button"
                  onClick={() => setSelectedDetail(tickerDetail(d))}
                  className={`mx-4 shrink-0 text-xs tabular-nums hover:underline ${over ? "text-alert" : "text-[rgb(var(--term-up-rgb))]"}`}
                >
                  {over ? "▼" : "▲"} [{d.category}] {d.name} {formatMsClock(d.accumulatedMs)}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
