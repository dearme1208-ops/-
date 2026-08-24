"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import { findOrCreateMasterTask } from "@/lib/master";
import { finishDailyTask, segmentsAccumulatedMs } from "@/lib/tasks";
import { formatHms, formatMsClock, todayStr } from "@/lib/time";
import { computeStreakDays } from "@/lib/streak";
import { computeGrowthStage, ADVENTURER_STAGES } from "@/lib/growth";
import { fireConfetti } from "@/lib/confetti";
import { useVisualMode } from "@/lib/theme";
import DailyChallengePanel from "@/components/DailyChallengePanel";
import type { DailyTask, MasterTask } from "@/lib/types";

// computeGrowthStageの分岐(0h/1h/2h/4h/6h/8h以上)と対応させた、各ランクの開始時間(h)
const RANK_HOUR_THRESHOLDS = [0, 1, 2, 4, 6, 8];
// ボス級として扱う最低の討伐目安(30分以上)。これ未満はどれだけ長くてもボス扱いにしない
const BOSS_MIN_ESTIMATED_SECONDS = 30 * 60;

type NodeVariant = "guild" | "current" | "next" | "later" | "goal";

// 冒険者モード専用の「本日」タブ。他の演出テーマ(Claude=タブ統合、禅=引き算、
// ターミナル=足し算のダッシュボード)と同じく、色や文言だけでなく操作の手触りそのものを
// 作り替える。今回はさらに踏み込み、「一覧をスクロールして選ぶ」という他の全タブと
// 共通のUI文法そのものを捨て、ダンジョンの道すじを辿って進む地図(map)と、
// 1件と向き合うバトル画面(battle)を行き来する2画面構成に総入れ替えする
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

  // 画面遷移: map(道すじを見渡す) ⇄ battle(1件のクエストと向き合う)。
  // 一覧を丸ごと出す代わりに、選んだ1件だけをフルスクリーン相当のバトル画面に切り替える
  const [view, setView] = useState<"map" | "battle">("map");
  const [battleTaskId, setBattleTaskId] = useState<string | null>(null);
  const [showGuild, setShowGuild] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // 開いた時点で既に計測中のクエストがあれば、一度だけ自動でバトル画面から始める
  // (「本日の作業」を開く=戦いの続きから、という体験にする)。以後は再判定しない
  const autoEnteredRef = useRef(false);
  useEffect(() => {
    if (autoEnteredRef.current || !dailyTasks) return;
    autoEnteredRef.current = true;
    const running = dailyTasks.find((t) => t.status === "running");
    if (running) {
      setBattleTaskId(running.id);
      setView("battle");
    }
  }, [dailyTasks]);

  const runningTask = (dailyTasks ?? []).find((t) => t.status === "running") ?? null;
  // 道すじに並べるのは、まだ討伐していないクエスト(未着手+休戦中)。順番(order)どおりに
  // 蛇行させることで、「次に進むべき道」が視覚的にも一目でわかるようにする
  const roadTasks = useMemo(
    () =>
      (dailyTasks ?? [])
        .filter((t) => !t.isProvisional && (t.status === "pending" || t.status === "paused"))
        .sort((a, b) => a.order - b.order),
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
  // 無い日はボス無し)。討伐済みのクエストは対象から外す
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
    await db.dailyTasks.update(daily.id, { segments, status: "paused", accumulatedMs, stoppedAt: closeAt });
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

  // 道すじのノードをタップした時の共通処理: 計測中でなければ開始/再開し、
  // そのままバトル画面に切り替える。既に計測中のノードなら開始処理をスキップして画面遷移のみ行う
  async function enterBattle(task: DailyTask) {
    if (task.status !== "running") await startExisting(task);
    setBattleTaskId(task.id);
    setView("battle");
  }

  async function startMaster(master: MasterTask) {
    if (runningTask && runningTask.masterTaskId !== master.id) await pauseDaily(runningTask);
    const existing = (dailyTasks ?? []).find(
      (d) => d.masterTaskId === master.id && (d.status === "running" || d.status === "paused")
    );
    if (existing) {
      await enterBattle(existing);
      setShowGuild(false);
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
    setBattleTaskId(task.id);
    setView("battle");
    setShowGuild(false);
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
    setBattleTaskId(task.id);
    setView("battle");
    setShowGuild(false);
  }

  async function defeatMonster(task: DailyTask) {
    await finishDailyTask(task);
    fireConfetti();
    setView("map");
    setBattleTaskId(null);
  }

  async function retreatToMap(task: DailyTask, alsoPause: boolean) {
    if (alsoPause) await pauseDaily(task);
    setView("map");
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

  const battleTask = (dailyTasks ?? []).find((t) => t.id === battleTaskId) ?? null;

  return (
    <div className="space-y-4">
      {/* --- HUD: ランク・けいけんち・ゴールド・れんぞく討伐日数を、常に見える細い帯で --- */}
      <div className="panel sticky top-2 z-10 flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
        <button type="button" className="flex items-center gap-2 text-left hover:opacity-80" onClick={() => setShowRankList((v) => !v)}>
          <span className="text-xl">{rank.icon}</span>
          <span className="font-display text-sm font-bold text-cream">
            Lv.{rankIndex + 1} {rank.label}
          </span>
          <div className="hidden w-20 sm:block">
            <div className="adv-stat-bar" style={{ height: 8 }}>
              <div className="adv-stat-bar-fill adv-exp-fill" style={{ width: `${expPct}%` }} />
            </div>
          </div>
        </button>
        <div className="flex items-center gap-3 text-xs">
          <span className="adv-gold-text tabular-nums font-bold">✦{gold.toLocaleString()}G</span>
          <span className="tabular-nums text-cream/70">🔥{streakDays}日</span>
          <button type="button" className="tabular-nums text-cream/70 hover:text-cream" onClick={() => setSelectedDetail(questTradeDetail())}>
            📜{activeTodos.length}件
          </button>
        </div>
      </div>
      {showRankList && (
        <pre className="whitespace-pre-wrap rounded-lg border border-cream/15 bg-ink/30 p-3 font-sans text-xs text-cream/80">
          {rankDetail()}
        </pre>
      )}

      {view === "battle" && battleTask ? (
        <BattleScreen
          task={battleTask}
          now={now}
          isBoss={battleTask.id === bossTaskId}
          onBack={() => retreatToMap(battleTask, false)}
          onPause={() => retreatToMap(battleTask, true)}
          onDefeat={() => defeatMonster(battleTask)}
        />
      ) : (
        <>
          <DailyChallengePanel />

          {/* --- ダンジョンの道すじ: ギルド受付→(戦闘中)→未着手クエスト→帰還、と
               左右に蛇行しながら金の点線でつながる1本道 --- */}
          <div className="relative">
            <div className="adv-path-spine" aria-hidden="true" />
            <div className="relative flex flex-col items-center gap-5 py-3">
              <div className="flex w-full justify-center">
                <PathNode icon="🏰" label="ギルド受付" variant="guild" onClick={() => setShowGuild((v) => !v)} />
              </div>

              {showGuild && (
                <div className="panel w-full space-y-3 p-4">
                  <div className="text-[10px] uppercase tracking-widest text-cream/50">クエストを受注する</div>
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

              {runningTask && (
                <div className="flex w-full justify-center">
                  <PathNode
                    icon={runningTask.id === bossTaskId ? "🐉" : "⚔️"}
                    label={runningTask.name}
                    sub="エンカウント中"
                    variant="current"
                    boss={runningTask.id === bossTaskId}
                    onClick={() => enterBattle(runningTask)}
                  />
                </div>
              )}

              {roadTasks.map((t, i) => (
                <div key={t.id} className={`flex w-full ${i % 2 === 0 ? "justify-start pl-[8%] sm:pl-[18%]" : "justify-end pr-[8%] sm:pr-[18%]"}`}>
                  <PathNode
                    icon={t.id === bossTaskId ? "🐉" : t.status === "paused" ? "⏸️" : "🗡️"}
                    label={t.name}
                    sub={t.status === "paused" ? "休戦中" : t.estimatedSeconds > 0 ? `討伐目安 ${formatHms(t.estimatedSeconds)}` : undefined}
                    variant={i === 0 && !runningTask ? "next" : "later"}
                    boss={t.id === bossTaskId}
                    onClick={() => enterBattle(t)}
                  />
                </div>
              ))}

              <div className="flex w-full justify-center">
                <PathNode
                  icon="🏁"
                  label={roadTasks.length === 0 && !runningTask ? "本日の冒険、完了！" : "帰還"}
                  variant="goal"
                />
              </div>
            </div>
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
        </>
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

// ダンジョンの道すじ上の1ノード(ギルド/戦闘中/未着手クエスト/帰還)を表す丸バッジ。
// variantで見た目(色・大きさ)を出し分け、boss=trueならさらに大きく赤縁にする
function PathNode({
  icon,
  label,
  sub,
  variant,
  boss,
  onClick,
}: {
  icon: string;
  label: string;
  sub?: string;
  variant: NodeVariant;
  boss?: boolean;
  onClick?: () => void;
}) {
  const variantClass =
    variant === "current"
      ? "adv-path-node-current"
      : variant === "later"
        ? "adv-path-node-later"
        : variant === "guild"
          ? "adv-path-node-guild"
          : variant === "goal"
            ? "adv-path-node-goal"
            : "";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`adv-path-node ${variantClass} ${boss ? "adv-path-node-boss" : ""}`}
    >
      <span className="adv-path-node-badge">{icon}</span>
      <span className="adv-path-node-label">{label}</span>
      {sub && <span className="adv-path-node-sub">{sub}</span>}
    </button>
  );
}

// 選んだ1件のクエストと向き合うバトル画面。map一覧の1行ではなく、この1件だけに
// 画面を切り替えることで、「今どれと戦っているか」が常に一目でわかるようにする
function BattleScreen({
  task,
  now,
  isBoss,
  onBack,
  onPause,
  onDefeat,
}: {
  task: DailyTask;
  now: number;
  isBoss: boolean;
  onBack: () => void;
  onPause: () => void;
  onDefeat: () => void;
}) {
  const elapsedSec = segmentsAccumulatedMs(task, now) / 1000;
  const hasEstimate = task.estimatedSeconds > 0;
  const hpPct = hasEstimate ? Math.max(0, Math.min(100, 100 - (elapsedSec / task.estimatedSeconds) * 100)) : null;
  const isOverrun = hasEstimate && elapsedSec > task.estimatedSeconds;

  return (
    <div className={`panel adv-battle-screen space-y-4 p-5 ${isBoss ? "adv-boss-frame" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="text-xs text-cream/50 hover:text-cream" onClick={onBack}>
          ← 地図にもどる
        </button>
        {isBoss && <span className="adv-boss-tag" style={{ position: "static" }}>🐉 BOSS</span>}
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-cream/50">
            {isOverrun ? "げきとう中・想定を超過" : "エンカウント中"}
          </div>
          <div className="truncate font-display text-2xl font-bold text-cream">{task.name}</div>
          <div className="truncate text-xs text-cream/50">[{task.category}]</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="tabular-nums text-3xl font-bold text-alert">{formatMsClock(elapsedSec * 1000)}</div>
          <div className="text-[10px] text-cream/40">経過時間</div>
        </div>
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[11px] text-cream/60">
          <span>{hasEstimate ? "てきの体力" : "手ごたえ（討伐目安なし）"}</span>
          <span className="tabular-nums">
            {hasEstimate
              ? isOverrun
                ? `力尽きた後 +${formatHms(elapsedSec - task.estimatedSeconds)}`
                : `残り ${formatHms(task.estimatedSeconds - elapsedSec)}`
              : formatHms(elapsedSec)}
          </span>
        </div>
        <div className="adv-stat-bar" style={{ height: 20 }}>
          <div
            className={`adv-stat-bar-fill ${hasEstimate ? "adv-hp-fill" : "adv-mp-fill"} ${isOverrun ? "is-danger" : ""}`}
            style={{ width: `${hasEstimate ? hpPct : Math.min(100, (elapsedSec / 7200) * 100)}%` }}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        <button className="btn-pill-outline text-xs" onClick={onPause}>
          一時休戦して地図へ
        </button>
        <button className="btn-pill text-xs" onClick={onDefeat}>
          とどめを刺す！
        </button>
      </div>
    </div>
  );
}
