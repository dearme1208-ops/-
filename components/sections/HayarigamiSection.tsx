"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import { finishDailyTask, segmentsAccumulatedMs } from "@/lib/tasks";
import { formatHms, formatMsClock, todayStr } from "@/lib/time";
import { computeStreakDays } from "@/lib/streak";
import { computeGrowthStage } from "@/lib/growth";
import { useSetting } from "@/lib/settings";
import { getRiskTier, riskBadgeClasses, riskBadgeLabel, useVisualMode } from "@/lib/theme";
import { buildKaiiIndex, erosionPercent, judgeRoute, phaseOf, type KaiiEntry } from "@/lib/hayarigami";
import type { DailyTask, MasterTask, TodoTask } from "@/lib/types";

// 流行り神風モード(怪異調査モード)専用の「本日の作業」タブ。
// ホラーサウンドノベルの画面構成(暗闇の背景 + 下部のメッセージウィンドウ + 選択肢)を
// そのまま業務画面にしたもので、他モードと同じdailyTasks/todoTasks/records/masterTasksを扱う。
//
// 元ネタの肝である「オカルトか、科学か」の二択は、演出だけの飾りにはしていない。
// 想定時間を超えた作業に対して、
//   ・オカルト = 「これは怪異の仕業」→ その作業をトラブル対応(isTrouble)として記録する
//   ・科学     = 「見積もりが甘かった」→ 作業マスタの想定時間を実測値に書き換える
// という、このアプリに元からある2つの意味づけ(突発的な一件 / 恒常的な見積もり誤差)へ
// そのまま接続している。さらにその判定の蓄積が「ルート」として残り、
// 実績から組み上げた「怪異名鑑」がゲームの図鑑のように育っていく
type Screen = "main" | "index" | "files" | "rumors" | "record";

const NOMINAL_DAY_SECONDS = 8 * 3600;
const TYPE_INTERVAL_MS = 26;

function nowClock(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}時${pad(d.getMinutes())}分`;
}

// 経過/想定の比率を「怪異度」の語りに変える。数値そのものは別途カードに出しているので、
// ここでは比率を言葉に翻訳することだけを担う
function occultCommentary(ratio: number): string {
  if (ratio >= 4) return "もはや見積もりの話ではない。これは完全に「出て」いる。";
  if (ratio >= 2.5) return "想定の枠を大きく踏み越えた。何かに引きずり込まれている。";
  if (ratio >= 1.8) return "明らかに長い。背後に何かが立っている気配がする。";
  if (ratio >= 1.3) return "少しだけ、長い。気のせいだと思いたいが。";
  return "今のところ、想定の内側だ。";
}

const DANGER_TEXT = ["text-cream/50", "text-cream/70", "text-alert/70", "text-alert", "text-alert"];

export default function HayarigamiSection() {
  const { themedMode } = useVisualMode();
  const mode = themedMode ?? "hayarigami";
  const today = todayStr();

  const dailyTasks = useLiveQuery(() => db.dailyTasks.where("date").equals(today).toArray(), [today]);
  const todoTasks = useLiveQuery(() => db.todoTasks.toArray(), []);
  const records = useLiveQuery(() => db.records.toArray(), []);
  const masters = useLiveQuery(() => db.masterTasks.toArray(), []);
  const favoriteMasters = useMemo(() => (masters ?? []).filter((m) => m.isFavorite && !m.archived), [masters]);

  // 判定の履歴。実データの書き換え(isTrouble / 想定時間)は判定と同時に行われるが、
  // 「どちらの説を何回採ったか」自体はどこにも残らないため、この2つだけ設定に貯める
  const [occultStr, setOccultStr] = useSetting("hayarigami.occultCount", "0");
  const [scienceStr, setScienceStr] = useSetting("hayarigami.scienceCount", "0");
  const occultCount = Number(occultStr) || 0;
  const scienceCount = Number(scienceStr) || 0;
  const route = judgeRoute(occultCount, scienceCount);

  const [now, setNow] = useState(Date.now());
  const [screen, setScreen] = useState<Screen>("main");
  const [judgedIds, setJudgedIds] = useState<string[]>([]);
  const [lastJudgement, setLastJudgement] = useState<string | null>(null);
  const [openKaii, setOpenKaii] = useState<KaiiEntry | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const phase = useMemo(() => phaseOf(new Date(now)), [Math.floor(now / 600000)]); // 10分ごとに評価

  const tasks = dailyTasks ?? [];
  const running = tasks.find((t) => t.status === "running") ?? null;
  const pending = tasks.filter((t) => t.status === "pending" && !t.isProvisional);
  const paused = tasks.filter((t) => t.status === "paused");
  const done = tasks.filter((t) => t.status === "done");
  const openTodos = (todoTasks ?? []).filter((t) => !t.completed && !t.parentTaskId);
  const overdueTodos = openTodos.filter((t) => t.dueDate && t.dueDate < today);
  const myDayTodos = openTodos.filter((t) => t.myDayDate === today);

  const totalMsToday = tasks.reduce((sum, t) => sum + segmentsAccumulatedMs(t, now), 0);
  const streakDays = useMemo(() => computeStreakDays(records ?? [], today), [records, today]);
  const { stage: growthStage } = computeGrowthStage(mode, totalMsToday / 1000);

  // 侵蝕度: 本日の「想定からはみ出した時間」の割合。数値が高いほど画面も蝕まれる
  const erosion = useMemo(
    () =>
      erosionPercent(
        tasks.map((t) => ({ estimatedSeconds: t.estimatedSeconds, elapsedSeconds: segmentsAccumulatedMs(t, now) / 1000 }))
      ),
    [tasks, now]
  );

  const kaiiIndex = useMemo(() => buildKaiiIndex(masters ?? [], records ?? []), [masters, records]);
  const sealedCount = kaiiIndex.filter((k) => k.status === "鎮められた").length;

  const runningElapsedMs = running ? segmentsAccumulatedMs(running, now) : 0;
  const runningRatio = running && running.estimatedSeconds > 0 ? runningElapsedMs / 1000 / running.estimatedSeconds : 0;
  const runningTier = getRiskTier(runningRatio || 0, mode);
  const isOverrun = !!running && running.estimatedSeconds > 0 && runningRatio >= 1.3;
  const askJudgement = isOverrun && !!running && !judgedIds.includes(running.id) && !running.isTrouble;

  // 画面が「蝕まれている」条件: 深夜帯、または侵蝕度が高い、または今まさに強い超過中
  const corrupted = phase.corrupt || erosion >= 60 || runningTier.level >= 3;

  // ---- 語り(メッセージウィンドウ本文) ----
  const { narration, narrationKey } = useMemo(() => {
    const clock = nowClock();
    if (lastJudgement) return { narration: lastJudgement, narrationKey: `judged:${lastJudgement}` };

    if (screen === "index") {
      const top = kaiiIndex[0];
      return {
        narration:
          kaiiIndex.length === 0
            ? "名鑑はまだ白紙だ。作業を完了させるたび、その記録がここに綴じられていく。"
            : `記録された怪異は${kaiiIndex.length}体。うち${sealedCount}体は想定と実績が噛み合い、すでに鎮められている。……最も厄介なのは「${top.displayName}」だ。`,
        narrationKey: `index:${kaiiIndex.length}:${sealedCount}:${kaiiIndex[0]?.key ?? "-"}`,
      };
    }
    if (screen === "files") {
      return {
        narration: `本日開いたファイルは${tasks.length}件。うち解決済みが${done.length}件、未着手が${pending.length}件、中断中が${paused.length}件だ。`,
        narrationKey: `files:${tasks.length}:${done.length}:${pending.length}:${paused.length}`,
      };
    }
    if (screen === "rumors") {
      return {
        narration:
          overdueTodos.length > 0
            ? `期限を過ぎた噂が${overdueTodos.length}件、まだ野放しになっている。……放置された噂ほど、質が悪い。`
            : `期限切れの噂はない。今日拾うべき噂は${myDayTodos.length}件だ。`,
        narrationKey: `rumors:${overdueTodos.length}:${myDayTodos.length}`,
      };
    }
    if (screen === "record") {
      return {
        narration: `調査継続${streakDays}日。本日の実働は${formatHms(Math.floor(totalMsToday / 1000))}、侵蝕度${erosion}%。現在の到達段階は「${growthStage.label}」。${route.description}`,
        narrationKey: `record:${streakDays}:${erosion}:${growthStage.label}:${route.route}`,
      };
    }

    // ---- 調査画面 ----
    if (running) {
      const head = `……${clock}。「${running.category} / ${running.name}」の調査を継続している。`;
      if (running.estimatedSeconds <= 0) {
        return {
          narration: `${head}この件には想定時間が設定されていない。どこまで続くのか、誰も知らない。`,
          narrationKey: `run-noest:${running.id}`,
        };
      }
      const tail = phase.corrupt && runningTier.level >= 2 ? `……${phase.label}に、これはよくない。` : "";
      return {
        narration: `${head}想定は${formatHms(running.estimatedSeconds)}。${occultCommentary(runningRatio)}${tail}`,
        narrationKey: `run:${running.id}:${runningTier.level}:${phase.phase}`,
      };
    }
    if (paused.length > 0) {
      return {
        narration: `「${paused[0].category} / ${paused[0].name}」の調査は中断したままだ。……中断した怪異は、こちらが忘れた頃に戻ってくる。`,
        narrationKey: `paused:${paused[0].id}`,
      };
    }
    if (pending.length > 0) {
      return {
        narration: `……${clock}。${phase.flavor}手をつけていないファイルが${pending.length}件、机の上に積まれている。どれから開く?`,
        narrationKey: `pending:${pending.length}:${phase.phase}`,
      };
    }
    if (done.length > 0) {
      return {
        narration: `本日の怪異は${done.length}件すべて解決した。調査継続${streakDays}日目、侵蝕度${erosion}%。……今日は、静かだ。`,
        narrationKey: `alldone:${done.length}:${streakDays}:${erosion}`,
      };
    }
    return {
      narration: `……${clock}。${phase.flavor}まだ何も起きていない。それは幸運なのか、単に「まだ」なのか。`,
      narrationKey: `idle:${phase.phase}`,
    };
  }, [
    lastJudgement,
    screen,
    running,
    runningRatio,
    runningTier.level,
    tasks.length,
    done.length,
    pending.length,
    paused,
    overdueTodos.length,
    myDayTodos.length,
    streakDays,
    totalMsToday,
    growthStage.label,
    erosion,
    route.description,
    route.route,
    kaiiIndex,
    sealedCount,
    phase,
  ]);

  // ---- タイプライター表示(句読点と三点リーダーで「間」を取る) ----
  const [typedCount, setTypedCount] = useState(0);
  useEffect(() => {
    setTypedCount(0);
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      i += 1;
      setTypedCount(i);
      if (i >= narration.length) return;
      const ch = narration[i - 1];
      const delay = ch === "…" ? 150 : ch === "。" ? 110 : ch === "、" ? 70 : TYPE_INTERVAL_MS;
      timer = setTimeout(step, delay);
    };
    timer = setTimeout(step, TYPE_INTERVAL_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrationKey, narration]);
  const typedDone = typedCount >= narration.length;

  // ---- 作業の操作 ----
  async function pauseTask(task: DailyTask) {
    const closeAt = Date.now();
    const segments = task.segments.map((s, i) =>
      i === task.segments.length - 1 && s.end === undefined ? { ...s, end: closeAt } : s
    );
    const accumulatedMs = segments.reduce((sum, s) => sum + ((s.end ?? closeAt) - s.start), 0);
    await db.dailyTasks.update(task.id, { segments, status: "paused", accumulatedMs, stoppedAt: closeAt });
  }
  async function startTask(task: DailyTask) {
    if (running && running.id !== task.id) await pauseTask(running);
    await db.dailyTasks.update(task.id, { segments: [...task.segments, { start: Date.now() }], status: "running" });
    setLastJudgement(null);
  }
  async function completeTask(task: DailyTask) {
    await finishDailyTask(task);
    setLastJudgement(`「${task.name}」は解決した。ファイルを閉じる。……この件は名鑑に綴じられた。`);
  }
  async function startFromMaster(master: MasterTask) {
    if (running) await pauseTask(running);
    await db.dailyTasks.add({
      id: uid(),
      date: today,
      order: tasks.length,
      masterTaskId: master.id,
      category: master.category,
      name: master.name,
      estimatedSeconds: master.estimatedSeconds,
      status: "running",
      segments: [{ start: Date.now() }],
      accumulatedMs: 0,
      startedAt: Date.now(),
      isSpontaneous: true,
    });
    setLastJudgement(null);
  }

  // ---- オカルト / 科学 の二択(どちらも実データを書き換える) ----
  async function judgeOccult(task: DailyTask) {
    await db.dailyTasks.update(task.id, { isTrouble: true });
    setJudgedIds((prev) => [...prev, task.id]);
    setOccultStr(String(occultCount + 1));
    setLastJudgement(
      `これは怪異の仕業だ——そう記録した。この一件は「トラブル対応」として、通常の見積もりとは切り離して集計される。……${
        occultCount + 1 >= 3 ? "オカルト側の判定が積み上がってきた。" : "判定はあなたの記録に残る。"
      }`
    );
  }
  async function judgeScience(task: DailyTask) {
    const actualSeconds = Math.max(1, Math.round(segmentsAccumulatedMs(task, Date.now()) / 1000));
    await db.dailyTasks.update(task.id, { estimatedSeconds: actualSeconds });
    if (task.masterTaskId) {
      await db.masterTasks.update(task.masterTaskId, { estimatedSeconds: actualSeconds, updatedAt: Date.now() });
    }
    setJudgedIds((prev) => [...prev, task.id]);
    setScienceStr(String(scienceCount + 1));
    setLastJudgement(
      `怪異などいない。見積もりが甘かっただけだ——想定を実測の${formatHms(actualSeconds)}に書き換えた。${
        task.masterTaskId ? "次に同じ作業に出遭っても、もう驚かない。" : "この作業には名鑑(マスタ)が無いため、本日分のみ修正した。"
      }`
    );
  }

  const choiceClass =
    "w-full rounded-sm border border-cream/25 bg-black/40 px-3 py-2 text-left text-sm text-cream transition hover:border-alert hover:bg-alert/10 hover:text-alert";

  return (
    <div className="space-y-3">
      {/* ── 上段: 現在開いているファイル ── */}
      <div
        className={`relative overflow-hidden rounded-sm border p-4 ${
          corrupted ? "hyr-corrupt border-alert/40" : "border-cream/15"
        } ${runningTier.level >= 4 && !!running ? "hyr-shake" : ""}`}
        style={{
          minHeight: "13rem",
          backgroundImage:
            "radial-gradient(ellipse at 50% 0%, rgb(var(--accent-rgb) / 0.10) 0%, transparent 62%), linear-gradient(180deg, rgb(var(--panel-rgb)) 0%, rgb(var(--ink-rgb)) 100%)",
        }}
      >
        <div className="mb-3 flex items-center justify-between text-[10px] tracking-[0.3em] text-cream/40">
          <span>怪異調査ファイル</span>
          <span>
            {phase.label}／{today.replace(/-/g, ".")}
          </span>
        </div>

        {screen === "main" && (
          <div className="space-y-3">
            {running ? (
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] tracking-[0.25em] text-cream/40">FILE No.{done.length + 1}</span>
                  {running.estimatedSeconds > 0 && (
                    <span className={riskBadgeClasses(runningTier.level, mode)}>{riskBadgeLabel(runningTier, mode)}</span>
                  )}
                  {running.isTrouble && (
                    <span className="rounded-sm border border-alert/60 px-1.5 py-0.5 text-[10px] text-alert">怪異認定済</span>
                  )}
                </div>
                <p className="mt-2 font-display text-xl font-bold text-cream">{running.name}</p>
                <p className="text-xs text-cream/45">{running.category}</p>
                <p className="mt-3 font-display text-3xl font-bold tabular-nums text-alert">{formatMsClock(runningElapsedMs)}</p>
                <p className="text-[11px] tabular-nums text-cream/40">
                  想定 {running.estimatedSeconds > 0 ? formatHms(running.estimatedSeconds) : "不明"}
                  {running.estimatedSeconds > 0 && ` ／ 到達率 ${Math.round(runningRatio * 100)}%`}
                </p>
                {running.estimatedSeconds > 0 && (
                  <div className="mt-2 h-1 w-full overflow-hidden bg-cream/10">
                    <div className="h-1 bg-alert transition-[width]" style={{ width: `${Math.min(100, runningRatio * 100)}%` }} />
                  </div>
                )}
              </div>
            ) : (
              <div className="py-6 text-center">
                <p className="text-4xl">{growthStage.icon}</p>
                <p className="mt-2 text-sm text-cream/50">調査中のファイルはない</p>
                <p className="text-[11px] text-cream/30">現在の到達段階: {growthStage.label}</p>
              </div>
            )}
          </div>
        )}

        {screen === "index" && (
          <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
            {kaiiIndex.length === 0 && (
              <p className="text-sm text-cream/40">まだ1件も記録されていない。作業を完了させると、ここに綴じられていく。</p>
            )}
            {kaiiIndex.slice(0, 40).map((k) => (
              <button
                key={k.key}
                onClick={() => setOpenKaii(k)}
                className="flex w-full items-center justify-between gap-2 border-l-2 border-cream/25 bg-black/30 px-2 py-1.5 text-left text-xs hover:border-alert hover:bg-alert/10"
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className={`${DANGER_TEXT[k.dangerLevel]} font-bold`}>{k.displayName}</span>
                  <span className="ml-1.5 text-[10px] text-cream/35">{k.status}</span>
                </span>
                <span className="shrink-0 tabular-nums text-cream/45">×{k.encounterCount}</span>
              </button>
            ))}
          </div>
        )}

        {screen === "files" && (
          <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
            {tasks.length === 0 && <p className="text-sm text-cream/40">本日のファイルはまだ無い。</p>}
            {tasks.map((t, i) => {
              const elapsed = segmentsAccumulatedMs(t, now);
              const ratio = t.estimatedSeconds > 0 ? elapsed / 1000 / t.estimatedSeconds : 0;
              return (
                <div
                  key={t.id}
                  className={`flex items-center justify-between gap-2 border-l-2 bg-black/30 px-2 py-1.5 text-xs ${
                    t.status === "done" ? "border-cream/20 opacity-50" : ratio >= 1.3 ? "border-alert" : "border-cream/30"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate text-cream/80">
                    <span className="mr-1.5 text-[10px] text-cream/30">No.{i + 1}</span>
                    {t.name}
                    {t.isTrouble && <span className="ml-1 text-alert">［怪異］</span>}
                  </span>
                  <span className="shrink-0 tabular-nums text-cream/50">{formatMsClock(elapsed)}</span>
                  <span className="shrink-0 text-[10px] text-cream/35">
                    {t.status === "done" ? "解決" : t.status === "running" ? "調査中" : t.status === "paused" ? "中断" : "未着手"}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {screen === "rumors" && (
          <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
            {overdueTodos.length === 0 && myDayTodos.length === 0 && (
              <p className="text-sm text-cream/40">追うべき噂は、今のところ無い。</p>
            )}
            {overdueTodos.map((t: TodoTask) => (
              <div key={t.id} className="border-l-2 border-alert bg-black/30 px-2 py-1.5 text-xs">
                <span className="text-cream/80">{t.title}</span>
                <span className="ml-2 text-[10px] text-alert">期限 {t.dueDate} を過ぎている</span>
              </div>
            ))}
            {myDayTodos.map((t: TodoTask) => (
              <div key={t.id} className="border-l-2 border-cream/25 bg-black/30 px-2 py-1.5 text-xs text-cream/70">
                {t.title}
              </div>
            ))}
          </div>
        )}

        {screen === "record" && (
          <div className="max-h-56 space-y-3 overflow-y-auto pr-1">
            <div>
              <div className="flex items-center justify-between text-[10px] text-cream/40">
                <span>侵蝕度（想定からはみ出した割合）</span>
                <span className="tabular-nums">{erosion}%</span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden bg-cream/10">
                <div className="h-1.5 bg-alert transition-[width]" style={{ width: `${erosion}%` }} />
              </div>
            </div>
            <div className="border border-alert/30 bg-black/40 px-2 py-2">
              <p className="text-[10px] tracking-[0.2em] text-cream/40">現在のルート</p>
              <p className="font-display text-base font-bold text-alert">{route.label}</p>
              <p className="mt-0.5 text-[10px] text-cream/50">
                オカルト判定 {occultCount}回 ／ 科学判定 {scienceCount}回
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-center">
              {[
                { label: "調査継続", value: `${streakDays}日` },
                { label: "本日の実働", value: formatHms(Math.floor(totalMsToday / 1000)) },
                { label: "解決した怪異", value: `${done.length}件` },
                { label: "名鑑に記録", value: `${kaiiIndex.length}体` },
                { label: "鎮めた怪異", value: `${sealedCount}体` },
                { label: "負荷", value: `${Math.round((totalMsToday / 1000 / NOMINAL_DAY_SECONDS) * 100)}%` },
              ].map((s) => (
                <div key={s.label} className="border border-cream/10 bg-black/30 px-2 py-2">
                  <p className="text-[10px] tracking-wider text-cream/40">{s.label}</p>
                  <p className="font-display text-lg font-bold tabular-nums text-cream">{s.value}</p>
                </div>
              ))}
            </div>
            {tasks.length > 0 && done.length === tasks.length && (
              <div className="border border-alert/40 bg-alert/5 px-2 py-2">
                <p className="text-[10px] tracking-[0.2em] text-alert">── 本日の捜査報告 ──</p>
                <p className="mt-1 text-xs leading-relaxed text-cream/75">
                  本日の事案{tasks.length}件はすべて解決。侵蝕度{erosion}%、実働
                  {formatHms(Math.floor(totalMsToday / 1000))}。{route.label}にて記録を締める。
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── メッセージウィンドウ ── */}
      <div
        className="cursor-pointer rounded-sm border border-cream/25 bg-black/70 p-4"
        style={{ minHeight: "6.5rem" }}
        onClick={() => setTypedCount(narration.length)}
      >
        <p className="text-sm leading-relaxed tracking-wide text-cream/90">
          {narration.slice(0, typedCount)}
          {!typedDone && <span className="text-alert">▊</span>}
        </p>
        {typedDone && <p className="mt-2 text-right text-xs text-alert">▼</p>}
      </div>

      {/* ── 選択肢 ── */}
      <div className="space-y-2">
        {askJudgement && running && (
          <div className="space-y-2 rounded-sm border border-alert/50 bg-alert/5 p-3">
            <p className="text-center text-xs tracking-[0.2em] text-alert">── この現象を、どう説明する? ──</p>
            <button className={choiceClass} onClick={() => judgeOccult(running)}>
              <span className="mr-2 text-alert">オカルト</span>
              これは怪異の仕業だ（トラブル対応として記録する）
            </button>
            <button className={choiceClass} onClick={() => judgeScience(running)}>
              <span className="mr-2 text-alert">科学</span>
              見積もりが甘かっただけだ（想定時間を実測値に書き換える）
            </button>
            <p className="text-center text-[10px] text-cream/35">
              どちらを選んでも作業は続行できます。選択は集計・レポートと「ルート」に実際に反映されます。
            </p>
          </div>
        )}

        {screen === "main" && (
          <>
            {running ? (
              <>
                <button className={choiceClass} onClick={() => completeTask(running)}>
                  ▶ この怪異を解決した（作業を完了する）
                </button>
                <button className={choiceClass} onClick={() => pauseTask(running)}>
                  ▶ 調査を中断する（一時停止）
                </button>
              </>
            ) : (
              <>
                {paused.map((t) => (
                  <button key={t.id} className={choiceClass} onClick={() => startTask(t)}>
                    ▶ 「{t.name}」の調査を再開する
                  </button>
                ))}
                {pending.slice(0, 4).map((t) => (
                  <button key={t.id} className={choiceClass} onClick={() => startTask(t)}>
                    ▶ 「{t.name}」のファイルを開く
                  </button>
                ))}
                {favoriteMasters.slice(0, 3).map((m) => (
                  <button key={m.id} className={choiceClass} onClick={() => startFromMaster(m)}>
                    ▶ 新たに「{m.name}」を調べ始める
                  </button>
                ))}
                {paused.length === 0 && pending.length === 0 && favoriteMasters.length === 0 && (
                  <p className="px-1 text-xs text-cream/35">
                    開けるファイルがありません。作業マスタで★をつけておくと、ここから直接調査を始められます。
                  </p>
                )}
              </>
            )}
          </>
        )}

        <div className="grid grid-cols-5 gap-1 pt-1">
          {(
            [
              { key: "main", label: "調査" },
              { key: "index", label: `名鑑${kaiiIndex.length > 0 ? `(${kaiiIndex.length})` : ""}` },
              { key: "files", label: "事件" },
              { key: "rumors", label: `噂${overdueTodos.length > 0 ? `(${overdueTodos.length})` : ""}` },
              { key: "record", label: "記録" },
            ] as { key: Screen; label: string }[]
          ).map((s) => (
            <button
              key={s.key}
              onClick={() => {
                setScreen(s.key);
                setLastJudgement(null);
              }}
              className={`rounded-sm border px-1 py-1.5 text-[11px] transition ${
                screen === s.key
                  ? "border-alert bg-alert/15 text-alert"
                  : "border-cream/20 bg-black/30 text-cream/60 hover:border-cream/40"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── 怪異の詳細(名鑑を開いた時) ── */}
      {openKaii && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setOpenKaii(null)}
        >
          <div
            className="w-full max-w-sm rounded-sm border border-alert/40 bg-ink p-4"
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundImage:
                "radial-gradient(ellipse at 50% 0%, rgb(var(--accent-rgb) / 0.12) 0%, transparent 65%), linear-gradient(180deg, rgb(var(--panel-rgb)) 0%, rgb(var(--ink-rgb)) 100%)",
            }}
          >
            <p className="text-[10px] tracking-[0.3em] text-cream/40">怪異名鑑</p>
            <p className={`mt-1 font-display text-xl font-bold ${DANGER_TEXT[openKaii.dangerLevel]}`}>{openKaii.displayName}</p>
            <p className="text-[11px] text-cream/40">
              {openKaii.category} / {openKaii.realName}
            </p>
            <div className="mt-3 space-y-1 text-xs text-cream/70">
              <div className="flex justify-between border-b border-cream/10 pb-1">
                <span className="text-cream/40">状態</span>
                <span>{openKaii.status}</span>
              </div>
              <div className="flex justify-between border-b border-cream/10 pb-1">
                <span className="text-cream/40">遭遇回数</span>
                <span className="tabular-nums">{openKaii.encounterCount}回</span>
              </div>
              <div className="flex justify-between border-b border-cream/10 pb-1">
                <span className="text-cream/40">平均遭遇時間</span>
                <span className="tabular-nums">{formatHms(Math.round(openKaii.avgSeconds))}</span>
              </div>
              <div className="flex justify-between border-b border-cream/10 pb-1">
                <span className="text-cream/40">最長遭遇</span>
                <span className="tabular-nums">{formatHms(Math.round(openKaii.maxSeconds))}</span>
              </div>
              <div className="flex justify-between border-b border-cream/10 pb-1">
                <span className="text-cream/40">想定との比</span>
                <span className="tabular-nums">
                  {openKaii.avgRatio > 0 ? `${Math.round(openKaii.avgRatio * 100)}%` : "想定なし"}
                </span>
              </div>
              <div className="flex justify-between border-b border-cream/10 pb-1">
                <span className="text-cream/40">怪異認定</span>
                <span className="tabular-nums">{openKaii.troubleCount}回</span>
              </div>
              <div className="flex justify-between">
                <span className="text-cream/40">最終目撃</span>
                <span className="tabular-nums">{openKaii.lastSeenDate}</span>
              </div>
            </div>
            <p className="mt-3 text-[10px] leading-relaxed text-cream/35">
              呼び名は実績の傾向から自動で決まります（いつも長引く／突発が多い／一瞬で終わる 等）。想定と実績が噛み合うと「鎮められた」になります。
            </p>
            <button className="mt-3 w-full rounded-sm border border-cream/25 py-2 text-xs text-cream/70" onClick={() => setOpenKaii(null)}>
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
