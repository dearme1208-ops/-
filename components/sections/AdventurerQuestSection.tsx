"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import { findOrCreateMasterTask } from "@/lib/master";
import { finishDailyTask, segmentsAccumulatedMs } from "@/lib/tasks";
import { formatHms, formatMsClock, todayStr } from "@/lib/time";
import { computeStreakDays } from "@/lib/streak";
import { computeGrowthStage, ADVENTURER_STAGES } from "@/lib/growth";
import { fireConfetti } from "@/lib/confetti";
import { useVisualMode } from "@/lib/theme";
import type { DailyTask, MasterTask } from "@/lib/types";

// computeGrowthStageの分岐(0h/1h/2h/4h/6h/8h以上)と対応させた、各ランクの開始時間(h)
const RANK_HOUR_THRESHOLDS = [0, 1, 2, 4, 6, 8];
// ボス級として扱う最低の討伐目安(30分以上)。これ未満はどれだけ長くてもボス扱いにしない
const BOSS_MIN_ESTIMATED_SECONDS = 30 * 60;

// 冒険者モード専用の「本日」タブ。Claude/禅の引き算、ターミナルの足し算とはまた違う軸で、
// 同じdailyTasks/masterTasks/records/todoTasksのデータを「ダンジョン攻略」の
// バトル画面として見せる。予測時間=モンスターの体力、経過時間=与えたダメージ、
// 完了=討伐、というメタファーで、タブ構成ではなく操作の手触り自体を作り替える
export default function AdventurerQuestSection() {
  const { themedMode } = useVisualMode();
  const mode = themedMode ?? "adventurer";
  const today = todayStr();
  const dailyTasks = useLiveQuery(() => db.dailyTasks.where("date").equals(today).toArray(), [today]);
  const todoTasks = useLiveQuery(() => db.todoTasks.toArray(), []);
  const records = useLiveQuery(() => db.records.toArray(), []);
  const favoriteMasters = useLiveQuery(
    () => db.masterTasks.filter((m) => m.isFavorite && !m.archived).toArray(),
    []
  );
  const [now, setNow] = useState(Date.now());
  const [newCategory, setNewCategory] = useState("");
  const [newName, setNewName] = useState("");
  const [selectedDetail, setSelectedDetail] = useState<string | null>(null);
  const [showRankList, setShowRankList] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const runningTask = (dailyTasks ?? []).find((t) => t.status === "running") ?? null;
  const pendingTasksSorted = useMemo(
    () => (dailyTasks ?? []).filter((t) => !t.isProvisional && t.status === "pending").sort((a, b) => a.order - b.order),
    [dailyTasks]
  );
  const pausedTasksSorted = useMemo(
    () => (dailyTasks ?? []).filter((t) => !t.isProvisional && t.status === "paused").sort((a, b) => a.order - b.order),
    [dailyTasks]
  );
  const doneToday = useMemo(
    () => (dailyTasks ?? []).filter((t) => t.status === "done").sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0)),
    [dailyTasks]
  );
  const totalMs = (dailyTasks ?? []).reduce((sum, t) => sum + segmentsAccumulatedMs(t, now), 0);
  const totalSeconds = totalMs / 1000;
  const activeTodos = (todoTasks ?? []).filter((t) => !t.completed);
  const streakDays = useMemo(() => computeStreakDays(records ?? [], today), [records, today]);

  // 本日最大の討伐目安を持つクエストを「ボス」として特別扱いする(30分未満のクエストしか
  // 無い日はボス無し)。討伐済みのクエストは対象から外す(倒したボスに今さら怯える必要はない)
  const bossTaskId = useMemo(() => {
    const candidates = (dailyTasks ?? []).filter(
      (t) => !t.isProvisional && t.status !== "done" && t.estimatedSeconds >= BOSS_MIN_ESTIMATED_SECONDS
    );
    if (candidates.length === 0) return null;
    return candidates.reduce((a, b) => (b.estimatedSeconds > a.estimatedSeconds ? b : a)).id;
  }, [dailyTasks]);

  const { stage: rank, index: rankIndex } = computeGrowthStage(mode, totalSeconds);
  const rankStartHour = RANK_HOUR_THRESHOLDS[rankIndex];
  const rankNextHour = rankIndex < RANK_HOUR_THRESHOLDS.length - 1 ? RANK_HOUR_THRESHOLDS[rankIndex + 1] : null;
  const hoursToday = totalSeconds / 3600;
  const expPct =
    rankNextHour === null
      ? 100
      : Math.min(100, Math.max(totalSeconds > 0 ? 4 : 0, ((hoursToday - rankStartHour) / (rankNextHour - rankStartHour)) * 100));

  // ゴールドは「討伐報酬(1体30G)+探索報酬(1分あたり1G)」という単純な換算。
  // 新しいstateを持たず、既存の実績データだけから毎回計算し直す(他の育成表示と同じ思想)
  const gold = doneToday.length * 30 + Math.floor(totalSeconds / 60);

  async function pauseDaily(daily: DailyTask) {
    const closeAt = Date.now();
    const segments = daily.segments.map((s, i) =>
      i === daily.segments.length - 1 && s.end === undefined ? { ...s, end: closeAt } : s
    );
    const accumulatedMs = segments.reduce((sum, s) => sum + ((s.end ?? closeAt) - s.start), 0);
    await db.dailyTasks.update(daily.id, { segments, status: "paused", accumulatedMs });
  }

  async function startExisting(task: DailyTask) {
    if (runningTask && runningTask.id !== task.id) await pauseDaily(runningTask);
    const segments = [...task.segments, { start: Date.now() }];
    await db.dailyTasks.update(task.id, {
      segments,
      status: "running",
      startedAt: task.startedAt ?? Date.now(),
    });
  }

  async function startMaster(master: MasterTask) {
    if (runningTask && runningTask.masterTaskId !== master.id) await pauseDaily(runningTask);
    const existing = (dailyTasks ?? []).find(
      (d) => d.masterTaskId === master.id && (d.status === "running" || d.status === "paused")
    );
    if (existing) {
      await startExisting(existing);
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

  async function encounterNewMonster() {
    const category = newCategory.trim();
    const name = newName.trim();
    if (!category || !name) return;
    if (runningTask) await pauseDaily(runningTask);
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
    setNewCategory("");
    setNewName("");
  }

  async function defeatMonster(task: DailyTask) {
    await finishDailyTask(task);
    fireConfetti();
  }

  function rankDetail(): string {
    const lines = ADVENTURER_STAGES.map(
      (s, i) => `${i === rankIndex ? "▶ " : "　"}${s.icon} ${s.label}（${RANK_HOUR_THRESHOLDS[i]}h〜）`
    );
    return [`本日の冒険時間 ${formatMsClock(totalMs)}（${hoursToday.toFixed(1)}h）`, ...lines].join("\n");
  }

  function questTradeDetail(): string {
    if (activeTodos.length === 0) return "受注中のクエストはありません。「ToDo」タブから新しいクエストを受けましょう。";
    const lines = activeTodos.slice(0, 20).map((t) => `・${t.title}${t.dueDate ? `（期日 ${t.dueDate}）` : ""}`);
    return [`受注中のクエスト ${activeTodos.length}件`, ...lines].join("\n");
  }

  const runningElapsedSec = runningTask ? segmentsAccumulatedMs(runningTask, now) / 1000 : 0;
  const runningHasEstimate = !!runningTask && runningTask.estimatedSeconds > 0;
  const runningHpPct = runningHasEstimate
    ? Math.max(0, Math.min(100, 100 - (runningElapsedSec / runningTask!.estimatedSeconds) * 100))
    : null;
  const runningIsOverrun = runningHasEstimate && runningElapsedSec > runningTask!.estimatedSeconds;
  const runningIsBoss = !!runningTask && runningTask.id === bossTaskId;

  return (
    <div className="space-y-4">
      {/* --- パーティステータス: ランク・けいけんち・ゴールド・れんぞく討伐日数を一望する --- */}
      <div className="panel space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" className="group flex items-center gap-3 text-left" onClick={() => setShowRankList((v) => !v)}>
            <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-alert bg-alert/10">
              <div className="adv-levelup-burst" aria-hidden="true" />
              <span className="relative text-2xl">{rank.icon}</span>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-cream/50">冒険者ランク</div>
              <div className="font-display text-lg font-bold text-cream">
                Lv.{rankIndex + 1} {rank.label}
              </div>
            </div>
          </button>
          <div className="flex flex-wrap items-center gap-4 text-right">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-cream/50">ゴールド</div>
              <div className="adv-gold-text tabular-nums text-lg font-bold">✦ {gold.toLocaleString()}G</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-cream/50">れんぞく討伐日数</div>
              <div className="tabular-nums text-lg font-bold text-cream">{streakDays}日</div>
            </div>
            <button
              type="button"
              className="text-right hover:opacity-80"
              onClick={() => setSelectedDetail(questTradeDetail())}
            >
              <div className="text-[10px] uppercase tracking-widest text-cream/50">受注中のクエスト</div>
              <div className="tabular-nums text-lg font-bold text-cream">{activeTodos.length}件</div>
            </button>
          </div>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] text-cream/60">
            <span>けいけんち</span>
            <span className="tabular-nums">
              {rankNextHour === null ? "MAX" : `${hoursToday.toFixed(1)}h / ${rankNextHour}h`}
            </span>
          </div>
          <div className="adv-stat-bar">
            <div className="adv-stat-bar-fill adv-exp-fill" style={{ width: `${expPct}%` }} />
          </div>
        </div>
        {showRankList && (
          <pre className="whitespace-pre-wrap rounded-lg border border-cream/15 bg-ink/30 p-3 font-sans text-xs text-cream/80">
            {rankDetail()}
          </pre>
        )}
      </div>

      {/* --- バトル画面: 計測中のクエストがあれば戦闘中、無ければエンカウント選択 --- */}
      {runningTask ? (
        <div className={`panel space-y-3 p-4 ${runningIsBoss ? "adv-boss-frame" : ""}`}>
          {runningIsBoss && <span className="adv-boss-tag">🐉 BOSS</span>}
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-widest text-cream/50">
                {runningIsOverrun ? "げきとう中・想定を超過" : "エンカウント中"}
              </div>
              <div className="truncate font-display text-xl font-bold text-cream">{runningTask.name}</div>
              <div className="truncate text-xs text-cream/50">[{runningTask.category}]</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="tabular-nums text-2xl font-bold text-alert">{formatMsClock(runningElapsedSec * 1000)}</div>
              <div className="text-[10px] text-cream/40">経過時間</div>
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] text-cream/60">
              <span>{runningHasEstimate ? "てきの体力" : "手ごたえ（討伐目安なし）"}</span>
              <span className="tabular-nums">
                {runningHasEstimate
                  ? runningIsOverrun
                    ? `力尽きた後 +${formatHms(runningElapsedSec - runningTask.estimatedSeconds)}`
                    : `残り ${formatHms(runningTask.estimatedSeconds - runningElapsedSec)}`
                  : formatHms(runningElapsedSec)}
              </span>
            </div>
            <div className="adv-stat-bar">
              <div
                className={`adv-stat-bar-fill ${runningHasEstimate ? "adv-hp-fill" : "adv-mp-fill"} ${runningIsOverrun ? "is-danger" : ""}`}
                style={{
                  width: `${runningHasEstimate ? runningHpPct : Math.min(100, (runningElapsedSec / 7200) * 100)}%`,
                }}
              />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button className="btn-pill-outline text-xs" onClick={() => pauseDaily(runningTask)}>
              一時休戦
            </button>
            <button className="btn-pill text-xs" onClick={() => defeatMonster(runningTask)}>
              とどめを刺す！
            </button>
          </div>
        </div>
      ) : (
        <div className="panel space-y-3 p-4">
          <div className="text-[10px] uppercase tracking-widest text-cream/50">つぎのクエストを選ぼう</div>
          {favoriteMasters && favoriteMasters.length > 0 && (
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
              {favoriteMasters.map((m) => (
                <button
                  key={m.id}
                  onClick={() => startMaster(m)}
                  className="adv-quest-card p-2.5 text-left text-xs transition-transform hover:-translate-y-0.5"
                >
                  <div className="truncate font-bold text-cream">{m.name}</div>
                  <div className="truncate text-[10px] text-cream/50">[{m.category}]</div>
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            <input
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && encounterNewMonster()}
              placeholder="大項目（例: 経理）"
              className="min-w-[7rem] flex-1 rounded-md border border-cream/20 bg-ink/30 px-2.5 py-1.5 text-xs text-cream placeholder:text-cream/30"
            />
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && encounterNewMonster()}
              placeholder="モンスター名（作業名）"
              className="min-w-[9rem] flex-[2] rounded-md border border-cream/20 bg-ink/30 px-2.5 py-1.5 text-xs text-cream placeholder:text-cream/30"
            />
            <button
              type="button"
              onClick={encounterNewMonster}
              disabled={!newCategory.trim() || !newName.trim()}
              className="btn-pill text-xs disabled:opacity-40"
            >
              遭遇する！
            </button>
          </div>
        </div>
      )}

      {/* --- 本日のクエスト帳: まだ挑んでいない/中断中のクエスト一覧 --- */}
      <div className="panel space-y-2 p-4">
        <div className="text-[10px] uppercase tracking-widest text-cream/50">本日のクエスト帳</div>
        {pendingTasksSorted.length === 0 && pausedTasksSorted.length === 0 ? (
          <p className="text-xs text-cream/40">受けているクエストはすべて挑戦済みです。上のエンカウントから新しい冒険を始めましょう。</p>
        ) : (
          <div className="space-y-2">
            {[...pausedTasksSorted, ...pendingTasksSorted].map((t) => {
              const isBoss = t.id === bossTaskId;
              return (
                <div
                  key={t.id}
                  className={`adv-quest-card flex items-center justify-between gap-3 p-3 ${isBoss ? "adv-boss-frame" : ""}`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      {isBoss && <span className="shrink-0 text-[10px] font-bold text-alert">🐉 BOSS</span>}
                      {t.status === "paused" && <span className="shrink-0 text-[10px] text-cream/40">（休戦中）</span>}
                    </div>
                    <div className="truncate text-sm font-bold text-cream">{t.name}</div>
                    <div className="truncate text-xs text-cream/50">
                      [{t.category}]{t.estimatedSeconds > 0 ? ` 討伐目安 ${formatHms(t.estimatedSeconds)}` : " 討伐目安 不明"}
                    </div>
                  </div>
                  <button className="btn-pill-outline shrink-0 text-xs" onClick={() => startExisting(t)}>
                    挑む
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* --- 討伐ログ: 本日倒したモンスター(完了した作業)の一覧 --- */}
      {doneToday.length > 0 && (
        <div className="panel space-y-2 p-4">
          <div className="text-[10px] uppercase tracking-widest text-cream/50">討伐ログ（本日 {doneToday.length}体）</div>
          <div className="space-y-1.5">
            {doneToday.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate text-cream/80">
                  ⚔ [{t.category}] {t.name}
                </span>
                <span className="tabular-nums shrink-0 text-cream/50">{formatHms(t.accumulatedMs / 1000)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

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
