"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import { finishDailyTask, segmentsAccumulatedMs } from "@/lib/tasks";
import { formatHms, formatMsClock, todayStr } from "@/lib/time";
import { computeStreakDays } from "@/lib/streak";
import { computeGrowthStage } from "@/lib/growth";
import { useVisualMode, getRiskTier, riskBadgeClasses, riskBadgeLabel } from "@/lib/theme";
import type { DailyTask, MasterTask, WorkRecord } from "@/lib/types";

// パワプロ風モード(育成選手モード)専用の「本日の作業」タブ。育成ゲームの選手育成画面
// (練習メニュー選択〜能力値カード〜体力/やる気ゲージ)を模しながら、中身は他モードと
// 完全に同じdailyTasks/todoTasks/records/masterTasksを使う。ゲーム的な数値(球速・
// コントロール等)も、実績データから算出した「本日の調子」の言い換えに過ぎない
const NOMINAL_DAY_SECONDS = 8 * 3600;
const GRADES = ["G", "F", "E", "D", "C", "B", "A", "S"];

function gradeFor(ratio: number): string {
  const idx = Math.min(GRADES.length - 1, Math.max(0, Math.floor(ratio * GRADES.length)));
  return GRADES[idx];
}

type Screen = "practice" | "recover" | "outing" | "levelup" | "items" | "data" | null;

const MENU_ITEMS: { key: Screen; icon: string; label: string }[] = [
  { key: "practice", icon: "⚾", label: "練習" },
  { key: "recover", icon: "💤", label: "回復" },
  { key: "outing", icon: "🚶", label: "おでかけ" },
  { key: "levelup", icon: "⬆️", label: "能力アップ" },
  { key: "items", icon: "🎒", label: "アイテム" },
  { key: "data", icon: "📋", label: "データ" },
];

export default function PowerproTrainingSection() {
  const { themedMode } = useVisualMode();
  const mode = themedMode ?? "powerpro";
  const today = todayStr();
  const dailyTasks = useLiveQuery(() => db.dailyTasks.where("date").equals(today).toArray(), [today]);
  const todoTasks = useLiveQuery(() => db.todoTasks.toArray(), []);
  const records = useLiveQuery(() => db.records.toArray(), []);
  const favoriteMasters = useLiveQuery(() => db.masterTasks.filter((m) => m.isFavorite && !m.archived).toArray(), []);
  const [now, setNow] = useState(Date.now());
  const [screen, setScreen] = useState<Screen>("practice");

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const runningDaily = (dailyTasks ?? []).find((d) => d.status === "running") ?? null;
  const pausedDaily = (dailyTasks ?? []).filter((d) => d.status === "paused");
  const pendingDaily = (dailyTasks ?? []).filter((d) => d.status === "pending");
  const doneToday = (dailyTasks ?? []).filter((d) => d.status === "done");
  const overdueTodos = (todoTasks ?? []).filter((t) => !t.completed && t.dueDate && t.dueDate < today);
  const myDayTodos = (todoTasks ?? []).filter((t) => !t.completed && t.myDayDate === today);
  const totalMsToday = (dailyTasks ?? []).reduce((sum, d) => sum + segmentsAccumulatedMs(d, now), 0);
  const streakDays = useMemo(() => computeStreakDays(records ?? [], today), [records, today]);
  const { stage: growthStage, index: growthIndex } = computeGrowthStage(mode, totalMsToday / 1000);
  const loadRatio = totalMsToday / 1000 / NOMINAL_DAY_SECONDS;
  const loadTier = getRiskTier(loadRatio, mode);

  // 「能力値カード」: 実績データから算出した、育成ゲーム風の疑似ステータス。
  // どれも実データに基づく決定的な計算で、演出のための乱数は使わない
  const stats = useMemo(() => {
    const allRecords: WorkRecord[] = records ?? [];
    const doneWithEstimate = doneToday.filter((d) => d.estimatedSeconds > 0);
    const avgEfficiency =
      doneWithEstimate.length > 0
        ? doneWithEstimate.reduce((s, d) => s + d.estimatedSeconds / Math.max(1, segmentsAccumulatedMs(d, now) / 1000), 0) /
          doneWithEstimate.length
        : 1;
    const speed = Math.round(Math.min(165, Math.max(90, 100 + (avgEfficiency - 1) * 60)));
    const controlGrade = gradeFor(Math.min(1, avgEfficiency / 1.3));
    const staminaGrade = gradeFor(Math.min(1, totalMsToday / 1000 / NOMINAL_DAY_SECONDS));
    const totalLifetimeHours = allRecords.reduce((s, r) => s + r.seconds, 0) / 3600;
    const strength = Math.round(Math.min(999, 200 + totalLifetimeHours * 3));
    const last30 = allRecords.filter((r) => {
      const d = new Date(r.date + "T00:00:00");
      return Date.now() - d.getTime() < 30 * 86400000;
    });
    const categoryVariety = new Set(last30.map((r) => r.category)).size;
    const agility = Math.round(Math.min(999, 200 + categoryVariety * 45));
    const masterVariety = new Set(last30.map((r) => r.masterTaskId ?? `${r.category}::${r.name}`)).size;
    const skill = Math.round(Math.min(999, 200 + masterVariety * 20));
    const troubleCount = last30.filter((r) => r.isTrouble).length;
    const trickery = Math.round(Math.min(999, 150 + troubleCount * 35));
    const mental = Math.round(Math.min(999, 200 + streakDays * 25));
    return { speed, controlGrade, staminaGrade, strength, agility, skill, trickery, mental };
  }, [records, doneToday, totalMsToday, now, streakDays]);

  async function pauseDaily(daily: DailyTask) {
    const closeAt = Date.now();
    const segments = daily.segments.map((s, i) =>
      i === daily.segments.length - 1 && s.end === undefined ? { ...s, end: closeAt } : s
    );
    const accumulatedMs = segments.reduce((sum, s) => sum + ((s.end ?? closeAt) - s.start), 0);
    await db.dailyTasks.update(daily.id, { segments, status: "paused", accumulatedMs, stoppedAt: closeAt });
  }
  async function startExisting(daily: DailyTask) {
    if (runningDaily && runningDaily.id !== daily.id) await pauseDaily(runningDaily);
    const segments = [...daily.segments, { start: Date.now() }];
    await db.dailyTasks.update(daily.id, { segments, status: "running" });
  }
  async function startMaster(master: MasterTask) {
    if (runningDaily) await pauseDaily(runningDaily);
    const task: DailyTask = {
      id: uid(),
      date: today,
      order: (dailyTasks ?? []).length,
      masterTaskId: master.id,
      category: master.category,
      name: master.name,
      estimatedSeconds: master.estimatedSeconds,
      status: "running",
      segments: [{ start: Date.now() }],
      accumulatedMs: 0,
      startedAt: Date.now(),
      isSpontaneous: true,
    };
    await db.dailyTasks.add(task);
  }

  const hpPct = Math.max(0, Math.min(100, Math.round(100 - loadRatio * 100)));
  const moodEmoji = doneToday.length === 0 ? "😐" : doneToday.length < 3 ? "🙂" : "😀";
  const turnCount = doneToday.length;
  const turnTarget = Math.max(1, doneToday.length + pendingDaily.length);

  return (
    <div className="space-y-3">
      <div className="panel flex flex-wrap items-center justify-between gap-2 p-3">
        <div className="flex items-center gap-2">
          <span className="rounded bg-alert px-2 py-1 text-xs font-black text-white">育成選手</span>
          <span className="font-display text-lg font-bold text-cream">練習メニュー</span>
        </div>
        <span className={riskBadgeClasses(loadTier.level, mode)}>{riskBadgeLabel(loadTier, mode)}</span>
      </div>

      {/* アイコンメニュー */}
      <div className="panel grid grid-cols-3 gap-2 p-3 sm:grid-cols-6">
        {MENU_ITEMS.map((m) => (
          <button
            key={m.key}
            onClick={() => setScreen(screen === m.key ? null : m.key)}
            className={`flex flex-col items-center gap-1 rounded-xl border-2 py-2 text-xs font-bold ${
              screen === m.key ? "border-alert bg-alert/10 text-alert" : "border-cream/15 text-cream/70"
            }`}
          >
            <span className="text-xl">{m.icon}</span>
            {m.label}
          </button>
        ))}
      </div>

      {/* キャラクター + 能力値カード */}
      <div className="flex flex-wrap gap-3">
        <div className="panel flex flex-1 flex-col items-center justify-center gap-2 p-4" style={{ minWidth: 140 }}>
          <span className="text-6xl">{moodEmoji}</span>
          <span className="text-xs text-cream/50">やる気</span>
        </div>
        <div className="panel flex-[2] space-y-2 p-4" style={{ minWidth: 240 }}>
          <div className="flex items-center gap-2">
            <span className="rounded bg-alert px-2 py-1 text-xs font-black text-white">{growthStage.icon}</span>
            <span className="font-display text-base font-bold text-cream">
              {growthStage.label}（Lv.{growthIndex + 1}）
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <div className="flex justify-between border-b border-cream/10 py-1">
              <span className="text-cream/50">球速</span>
              <span className="font-bold tabular-nums text-cream">{stats.speed} km/h</span>
            </div>
            <div className="flex justify-between border-b border-cream/10 py-1">
              <span className="text-cream/50">コントロール</span>
              <span className="font-bold text-cream">{stats.controlGrade}</span>
            </div>
            <div className="flex justify-between border-b border-cream/10 py-1">
              <span className="text-cream/50">スタミナ</span>
              <span className="font-bold text-cream">{stats.staminaGrade}</span>
            </div>
            <div className="flex justify-between border-b border-cream/10 py-1">
              <span className="text-cream/50">筋力</span>
              <span className="font-bold tabular-nums text-cream">{stats.strength}</span>
            </div>
            <div className="flex justify-between border-b border-cream/10 py-1">
              <span className="text-cream/50">敏捷</span>
              <span className="font-bold tabular-nums text-cream">{stats.agility}</span>
            </div>
            <div className="flex justify-between border-b border-cream/10 py-1">
              <span className="text-cream/50">技術</span>
              <span className="font-bold tabular-nums text-cream">{stats.skill}</span>
            </div>
            <div className="flex justify-between border-b border-cream/10 py-1">
              <span className="text-cream/50">変化球</span>
              <span className="font-bold tabular-nums text-cream">{stats.trickery}</span>
            </div>
            <div className="flex justify-between border-b border-cream/10 py-1">
              <span className="text-cream/50">精神</span>
              <span className="font-bold tabular-nums text-cream">{stats.mental}</span>
            </div>
          </div>
        </div>
      </div>

      {/* メニュー選択画面 */}
      {screen === "practice" && (
        <div className="panel space-y-2 p-4">
          <h3 className="font-display text-sm font-bold text-cream/80">⚾ 練習(作業を開始)</h3>
          {pendingDaily.length === 0 ? (
            <p className="text-sm text-cream/50">予定している練習メニューはありません。「アイテム」からも開始できます。</p>
          ) : (
            pendingDaily.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 rounded-lg bg-ink/50 px-3 py-2">
                <span className="text-sm text-cream">
                  <span className="text-cream/50">{d.category}</span> {d.name}
                </span>
                <button className="btn-pill text-xs" onClick={() => startExisting(d)}>
                  開始
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {screen === "recover" && (
        <div className="panel space-y-2 p-4">
          <h3 className="font-display text-sm font-bold text-cream/80">💤 回復(実行中・一時停止中)</h3>
          {!runningDaily && pausedDaily.length === 0 ? (
            <p className="text-sm text-cream/50">現在練習中の項目はありません。</p>
          ) : (
            <>
              {runningDaily && (
                <div className="flex items-center justify-between gap-2 rounded-lg bg-alert/10 px-3 py-2">
                  <span className="text-sm text-cream">
                    🔴 {runningDaily.category} / {runningDaily.name}（{formatMsClock(segmentsAccumulatedMs(runningDaily, now))}）
                  </span>
                  <div className="flex gap-1.5">
                    <button className="btn-pill-outline text-xs" onClick={() => pauseDaily(runningDaily)}>
                      一時停止
                    </button>
                    <button className="btn-pill text-xs" onClick={() => finishDailyTask(runningDaily)}>
                      練習完了
                    </button>
                  </div>
                </div>
              )}
              {pausedDaily.map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-2 rounded-lg bg-ink/50 px-3 py-2">
                  <span className="text-sm text-cream">
                    {d.category} / {d.name}（{formatMsClock(segmentsAccumulatedMs(d, now))}）
                  </span>
                  <button className="btn-pill text-xs" onClick={() => startExisting(d)}>
                    再開
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {screen === "outing" && (
        <div className="panel space-y-2 p-4">
          <h3 className="font-display text-sm font-bold text-cream/80">🚶 おでかけ(マイデイのToDo)</h3>
          {myDayTodos.length === 0 ? (
            <p className="text-sm text-cream/50">マイデイに追加されたToDoはありません。</p>
          ) : (
            myDayTodos.map((t) => (
              <div key={t.id} className="rounded-lg bg-ink/50 px-3 py-2 text-sm text-cream">
                {t.title}
                {t.dueDate && <span className="ml-2 text-xs text-cream/40">期日 {t.dueDate}</span>}
              </div>
            ))
          )}
        </div>
      )}

      {screen === "levelup" && (
        <div className="panel space-y-2 p-4">
          <h3 className="font-display text-sm font-bold text-cream/80">⬆️ 能力アップ(育成度)</h3>
          <p className="text-sm text-cream/70">
            本日の育成度: <span className="font-bold text-cream">{growthStage.icon} {growthStage.label}</span>
            （Lv.{growthIndex + 1} / 6）
          </p>
          <p className="text-xs text-cream/50">作業時間が増えるほどレベルが上がります(0h/1h/2h/4h/6h/8h+の6段階)。</p>
          <p className="text-sm text-cream/70">
            継続日数: <span className="font-bold text-cream">🔥 {streakDays}日</span>
          </p>
        </div>
      )}

      {screen === "items" && (
        <div className="panel space-y-2 p-4">
          <h3 className="font-display text-sm font-bold text-cream/80">🎒 アイテム(お気に入りから練習開始)</h3>
          {(favoriteMasters ?? []).length === 0 ? (
            <p className="text-sm text-cream/50">お気に入り登録された作業はありません。</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(favoriteMasters ?? []).map((m) => (
                <button key={m.id} className="btn-pill-outline text-xs" onClick={() => startMaster(m)}>
                  ★ {m.category} / {m.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {screen === "data" && (
        <div className="panel space-y-2 p-4">
          <h3 className="font-display text-sm font-bold text-cream/80">📋 データ(本日の記録)</h3>
          <p className="text-sm text-cream/70">
            本日の練習時間: <span className="font-bold tabular-nums text-cream">{formatHms(totalMsToday / 1000)}</span>
          </p>
          <p className="text-sm text-cream/70">
            完了 <span className="font-bold text-cream">{doneToday.length}</span>件 / 予定{" "}
            <span className="font-bold text-cream">{pendingDaily.length}</span>件
          </p>
          {overdueTodos.length > 0 && (
            <p className="text-sm text-alert">⚠ 期限切れのToDoが{overdueTodos.length}件あります</p>
          )}
        </div>
      )}

      {/* 下部リソースバー */}
      <div className="panel space-y-2 p-3">
        <div className="flex items-center gap-3">
          <span className="w-16 shrink-0 text-xs font-bold text-cream/60">体力</span>
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-ink">
            <div
              className={`h-full rounded-full ${hpPct > 40 ? "bg-alert" : "bg-alert/50"}`}
              style={{ width: `${hpPct}%` }}
            />
          </div>
          <span className="w-14 shrink-0 text-right text-xs font-bold tabular-nums text-cream">{hpPct}/100</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-cream/60">
          <span>
            ターン数 <span className="font-bold tabular-nums text-cream">{turnCount}</span>/
            <span className="tabular-nums">{turnTarget}</span>
          </span>
          <span className="flex items-center gap-2">
            <span title="実行中">▶️×{runningDaily ? 1 : 0}</span>
            <span title="予定">📋×{pendingDaily.length}</span>
            <span title="完了">✅×{doneToday.length}</span>
            <span title="ToDo期限切れ">⚠️×{overdueTodos.length}</span>
          </span>
          <span>
            Lv.<span className="font-bold tabular-nums text-cream">{growthIndex + 1}</span>　🔥
            <span className="font-bold tabular-nums text-cream">{streakDays}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
