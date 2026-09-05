"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import { computeRemainingEstimatedSeconds, finishDailyTask, segmentsAccumulatedMs } from "@/lib/tasks";
import { formatHms, formatMsClock, todayStr } from "@/lib/time";
import { computeStreakDays } from "@/lib/streak";
import { computeGrowthStage } from "@/lib/growth";
import { useSetting } from "@/lib/settings";
import { getRiskTier, riskBadgeClasses, riskBadgeLabel, useVisualMode } from "@/lib/theme";
import { buildKaiiIndex, erosionPercent, judgeRoute, phaseOf, type KaiiEntry } from "@/lib/hayarigami";
import { kaiiStatusLabel, wordsFor } from "@/lib/hayarigamiWords";
import MasterTaskPicker from "@/components/sections/MasterTaskPicker";
import SceneCanvas from "@/components/hayarigami/SceneCanvas";
import KaiiSilhouette from "@/components/hayarigami/KaiiSilhouette";
import CaseDiagram from "@/components/hayarigami/CaseDiagram";
import EmblemCanvas from "@/components/hayarigami/EmblemCanvas";
import { pickScene, SCENE_LABEL } from "@/lib/hayarigamiArt";
import {
  buildKeywords,
  buildLogicPuzzle,
  judgeRank,
  keywordStorageKey,
  keywordWordsFor,
  parseCollected,
  splitNarration,
  type KeywordDef,
} from "@/lib/hayarigamiLogic";
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
type Screen = "main" | "index" | "files" | "rumors" | "record" | "logic";

const NOMINAL_DAY_SECONDS = 8 * 3600;
const TYPE_INTERVAL_MS = 26;

function nowClock(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}時${pad(d.getMinutes())}分`;
}

const DANGER_TEXT = ["text-cream/50", "text-cream/70", "text-alert/70", "text-alert", "text-alert"];

export default function HayarigamiSection() {
  const { themedMode, wordingEnabled, wordingThemedMode } = useVisualMode();
  const mode = themedMode ?? "hayarigami";
  // 設定の「テーマに合わせた文言を使う」がオフなら、色・絵はこのモードのまま
  // 言葉づかいだけ工程表本来のものへ差し替える
  const W = wordsFor(wordingEnabled);
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
  const route = judgeRoute(occultCount, scienceCount, wordingEnabled);

  const [now, setNow] = useState(Date.now());
  const [screen, setScreen] = useState<Screen>("main");
  const [judgedIds, setJudgedIds] = useState<string[]>([]);
  const [lastJudgement, setLastJudgement] = useState<string | null>(null);
  const [openKaii, setOpenKaii] = useState<KaiiEntry | null>(null);
  // 名鑑(作業マスタ)から自由に選んで調査を始める/ファイルだけ用意するためのピッカー
  const [showPicker, setShowPicker] = useState(false);
  const [pickedMaster, setPickedMaster] = useState<MasterTask | null>(null);
  // 二択の紋章は、指したものだけ線が光る
  const [hoverJudge, setHoverJudge] = useState<"occult" | "science" | null>(null);
  // 推理ロジックの回答(空欄id -> キーワードid)と、当日の評価
  const [logicAnswers, setLogicAnswers] = useState<Record<string, string>>({});
  const [openSlot, setOpenSlot] = useState<string | null>(null);
  // セルフ・クエスチョン(自問自答)の進行
  const [sqStep, setSqStep] = useState<0 | 1 | null>(null);
  const [sqTask, setSqTask] = useState<DailyTask | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const phase = useMemo(() => phaseOf(new Date(now), wordingEnabled), [Math.floor(now / 600000), wordingEnabled]); // 10分ごとに評価

  const tasks = dailyTasks ?? [];
  const running = tasks.find((t) => t.status === "running") ?? null;
  const pending = tasks.filter((t) => t.status === "pending" && !t.isProvisional);
  const paused = tasks.filter((t) => t.status === "paused");
  const done = tasks.filter((t) => t.status === "done");
  const openTodos = (todoTasks ?? []).filter((t) => !t.completed && !t.parentTaskId);
  const overdueTodos = openTodos.filter((t) => t.dueDate && t.dueDate < today);
  const myDayTodos = openTodos.filter((t) => t.myDayDate === today);

  // 本文にも手帳(キーワード)にも同じ数を出すため、ここで一度だけ数える
  const overrunCount = tasks.filter(
    (t) => t.estimatedSeconds > 0 && segmentsAccumulatedMs(t, now) / 1000 > t.estimatedSeconds
  ).length;
  const troubleCount = tasks.filter((t) => t.isTrouble).length;

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

  // 一枚絵(背景)の種と濃さ。調査中の作業があればその作業名、無ければ日付と時間帯で決まるため、
  // 同じ案件を開けば毎回同じ景色が出る。濃さは侵蝕度と今の危険度の高い方を採る
  const sceneSeed = running ? `${running.category}/${running.name}` : `${today}:${phase.phase}`;
  const sceneIntensity = Math.max(erosion / 100, runningTier.level / 4);

  // ---- キーワードと推理ロジック ----
  // 本文に現れる語のうち、その日の事実に基づくものをキーワードとして拾えるようにする。
  // 語そのものは本文と同じ辞書(keywordWordsFor)から作るので、本文と手帳が食い違うことはない
  const dayFacts = useMemo(
    () => ({
      tasks,
      openTodos,
      overdueTodos,
      kaiiIndex,
      erosion,
      streakDays,
      phaseLabel: phase.label,
      elapsedSecondsOf: (t: DailyTask) => segmentsAccumulatedMs(t, now) / 1000,
      kw: keywordWordsFor(wordingEnabled),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, openTodos, overdueTodos, kaiiIndex, erosion, streakDays, phase.label, wordingEnabled, Math.floor(now / 60000)]
  );
  const keywords = useMemo(() => buildKeywords(dayFacts), [dayFacts]);
  const [collectedRaw, setCollectedRaw] = useSetting(keywordStorageKey(today), "[]");
  const collected = useMemo(() => parseCollected(collectedRaw, keywords), [collectedRaw, keywords]);
  const [rankRaw, setRankRaw] = useSetting(`hayarigami.rank.${today}`, "");
  const puzzle = useMemo(
    () => buildLogicPuzzle(dayFacts, collected),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [collected, tasks.length, overdueTodos.length, erosion]
  );

  function collectKeyword(k: KeywordDef) {
    if (collected.some((c) => c.id === k.id)) return;
    setCollectedRaw(JSON.stringify([...collected.map((c) => c.id), k.id]));
  }

  function confirmLogic() {
    let correct = 0;
    for (const slot of puzzle.slots) {
      if (logicAnswers[slot.id] === slot.answerId) correct += 1;
    }
    const { rank } = judgeRank(correct, puzzle.slots.length);
    setRankRaw(JSON.stringify({ rank, correct, total: puzzle.slots.length }));
  }

  const logicResult = useMemo(() => {
    if (!rankRaw) return null;
    try {
      const v = JSON.parse(rankRaw) as { rank: string; correct: number; total: number };
      return typeof v?.rank === "string" ? v : null;
    } catch {
      return null;
    }
  }, [rankRaw]);

  // ---- セルフ・クエスチョン ----
  const sqCandidates = [...paused, ...pending].slice(0, 5);
  async function sqPick(task: DailyTask) {
    setSqTask(task);
    await startTask(task);
    setSqStep(1);
  }
  async function sqEstimate(multiplier: number) {
    if (sqTask) {
      const base = sqTask.estimatedSeconds > 0 ? sqTask.estimatedSeconds : 1800;
      const next = Math.round(base * multiplier);
      await db.dailyTasks.update(sqTask.id, { estimatedSeconds: next });
      setLastJudgement(W.sqDone(sqTask.name, formatHms(next)));
    }
    setSqStep(null);
    setSqTask(null);
  }

  // ---- 語り(メッセージウィンドウ本文) ----
  const { narration, narrationKey } = useMemo(() => {
    const clock = nowClock();
    if (lastJudgement) return { narration: lastJudgement, narrationKey: `judged:${lastJudgement}` };

    if (screen === "index") {
      const top = kaiiIndex[0];
      return {
        narration: W.narration.index(
          kaiiIndex.length,
          sealedCount,
          top ? (wordingEnabled ? top.displayName : top.realName) : ""
        ),
        narrationKey: `index:${kaiiIndex.length}:${sealedCount}:${kaiiIndex[0]?.key ?? "-"}`,
      };
    }
    if (screen === "files") {
      return {
        narration: W.narration.files(
          tasks.length,
          done.length,
          pending.length,
          paused.length,
          overrunCount,
          troubleCount > 0
        ),
        narrationKey: `files:${tasks.length}:${done.length}:${pending.length}:${paused.length}:${overrunCount}:${troubleCount}`,
      };
    }
    if (screen === "rumors") {
      return {
        narration: W.narration.rumors(overdueTodos.length, myDayTodos.length),
        narrationKey: `rumors:${overdueTodos.length}:${myDayTodos.length}`,
      };
    }
    if (screen === "record") {
      return {
        narration: W.narration.record(
          streakDays,
          formatHms(Math.floor(totalMsToday / 1000)),
          erosion,
          growthStage.label,
          route.description,
          phase.label
        ),
        narrationKey: `record:${streakDays}:${erosion}:${growthStage.label}:${route.route}:${phase.phase}`,
      };
    }

    // ---- 調査画面 ----
    if (running) {
      if (running.estimatedSeconds <= 0) {
        return {
          narration: W.narration.runningNoEstimate(clock, running.category, running.name),
          narrationKey: `run-noest:${running.id}`,
        };
      }
      const tail = wordingEnabled && phase.corrupt && runningTier.level >= 2 ? `……${phase.label}に、これはよくない。` : "";
      return {
        narration: W.narration.running(
          clock,
          running.category,
          running.name,
          formatHms(running.estimatedSeconds),
          W.commentary(runningRatio),
          tail
        ),
        narrationKey: `run:${running.id}:${runningTier.level}:${phase.phase}`,
      };
    }
    if (paused.length > 0) {
      return {
        narration: W.narration.paused(paused[0].category, paused[0].name),
        narrationKey: `paused:${paused[0].id}`,
      };
    }
    if (pending.length > 0) {
      return {
        narration: W.narration.pending(clock, phase.flavor, pending.length),
        narrationKey: `pending:${pending.length}:${phase.phase}`,
      };
    }
    if (done.length > 0) {
      return {
        narration: W.narration.allDone(done.length, streakDays, erosion),
        narrationKey: `alldone:${done.length}:${streakDays}:${erosion}`,
      };
    }
    return {
      narration: W.narration.idle(clock, phase.flavor),
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
    overrunCount,
    troubleCount,
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
    W,
    wordingEnabled,
  ]);

  // ---- タイプライター表示(句読点と三点リーダーで「間」を取る) ----
  // 送り位置と次のタイマーはrefで持つ。stateだけで持つと、窓をタップして最後まで送っても
  // 走り続けているタイマーが次の一文字で巻き戻してしまい、原作の「クリックで全文表示」が効かない
  const [typedCount, setTypedCount] = useState(0);
  const typeIndexRef = useRef(0);
  const typeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setTypedCount(0);
    typeIndexRef.current = 0;
    const step = () => {
      typeIndexRef.current += 1;
      const i = typeIndexRef.current;
      setTypedCount(i);
      if (i >= narration.length) return;
      const ch = narration[i - 1];
      const delay = ch === "…" ? 150 : ch === "。" ? 110 : ch === "、" ? 70 : TYPE_INTERVAL_MS;
      typeTimerRef.current = setTimeout(step, delay);
    };
    typeTimerRef.current = setTimeout(step, TYPE_INTERVAL_MS);
    return () => {
      if (typeTimerRef.current) clearTimeout(typeTimerRef.current);
    };
    // narration自体は実働時間や時刻を含むため毎秒変わりうる。これを依存に入れると
    // 記録画面のように秒が載る本文で送りが延々とやり直しになり、最後まで表示できない。
    // 送り直すのは「別の話に切り替わった」ときだけでよいので、narrationKeyだけを見る
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrationKey]);
  const typedDone = typedCount >= narration.length;
  // メッセージ窓のタップ = 全文送り
  function skipTyping() {
    if (typeTimerRef.current) clearTimeout(typeTimerRef.current);
    typeIndexRef.current = narration.length;
    setTypedCount(narration.length);
  }

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
    setLastJudgement(W.narration.completed(task.name));
  }
  // 名鑑(作業マスタ)から本日のファイルを起こす。startImmediately=falseなら未着手のまま積むだけ。
  // 想定時間は他タブと同じ計算(同じ作業を既にこなした分を差し引いた残り)に揃える
  async function addFromMaster(master: MasterTask, startImmediately: boolean) {
    if (startImmediately && running) await pauseTask(running);
    const estimatedSeconds = await computeRemainingEstimatedSeconds(
      today,
      master.category,
      master.name,
      master.estimatedSeconds
    );
    await db.dailyTasks.add({
      id: uid(),
      date: today,
      order: tasks.length,
      masterTaskId: master.id,
      category: master.category,
      name: master.name,
      estimatedSeconds,
      status: startImmediately ? "running" : "pending",
      segments: startImmediately ? [{ start: Date.now() }] : [],
      accumulatedMs: 0,
      startedAt: startImmediately ? Date.now() : undefined,
      isSpontaneous: true,
    });
    setLastJudgement(startImmediately ? null : W.narration.queued(master.name));
  }

  // ---- オカルト / 科学 の二択(どちらも実データを書き換える) ----
  async function judgeOccult(task: DailyTask) {
    await db.dailyTasks.update(task.id, { isTrouble: true });
    setJudgedIds((prev) => [...prev, task.id]);
    setOccultStr(String(occultCount + 1));
    setLastJudgement(W.narration.judgedOccult(occultCount + 1));
  }
  async function judgeScience(task: DailyTask) {
    const actualSeconds = Math.max(1, Math.round(segmentsAccumulatedMs(task, Date.now()) / 1000));
    await db.dailyTasks.update(task.id, { estimatedSeconds: actualSeconds });
    if (task.masterTaskId) {
      await db.masterTasks.update(task.masterTaskId, { estimatedSeconds: actualSeconds, updatedAt: Date.now() });
    }
    setJudgedIds((prev) => [...prev, task.id]);
    setScienceStr(String(scienceCount + 1));
    setLastJudgement(W.narration.judgedScience(formatHms(actualSeconds), !!task.masterTaskId));
  }

  const choiceClass =
    "w-full rounded-sm border border-cream/25 bg-black/40 px-3 py-2 text-left text-sm text-cream transition hover:border-alert hover:bg-alert/10 hover:text-alert";

  // 舞台に敷く一枚絵の情景。名札(現場)にも使う
  const sceneKind = pickScene(sceneSeed);
  const placeLabel = wordingEnabled ? `${SCENE_LABEL[sceneKind]}　・　${phase.label}` : W.fileHeader;

  const choicePlate =
    "w-full border border-cream/30 bg-black/55 px-3 py-2 text-left text-sm text-cream transition hover:border-alert hover:bg-alert/15 hover:text-alert";

  // 現在の画面に応じた選択肢。舞台の中でメッセージ窓の上に重ねる
  const choices: React.ReactNode[] = [];
  if (screen === "main") {
    if (running) {
      choices.push(
        <button key="complete" className={choicePlate} onClick={() => completeTask(running)}>
          {W.completeChoice}
        </button>,
        <button key="pause" className={choicePlate} onClick={() => pauseTask(running)}>
          {W.pauseChoice}
        </button>
      );
    } else {
      for (const t of paused) {
        choices.push(
          <button key={`resume-${t.id}`} className={choicePlate} onClick={() => startTask(t)}>
            {W.resumeChoice(t.name)}
          </button>
        );
      }
      for (const t of pending.slice(0, 4)) {
        choices.push(
          <button key={`open-${t.id}`} className={choicePlate} onClick={() => startTask(t)}>
            {W.openChoice(t.name)}
          </button>
        );
      }
      for (const m of favoriteMasters.slice(0, 3)) {
        choices.push(
          <button key={`fav-${m.id}`} className={choicePlate} onClick={() => addFromMaster(m, true)}>
            {W.newChoice(m.name)}
          </button>
        );
      }
      if (paused.length === 0 && pending.length === 0 && favoriteMasters.length === 0) {
        choices.push(
          <p key="hint" className="px-1 text-xs text-cream/45">
            {W.noStartHint}
          </p>
        );
      }
    }
    choices.push(
      <button key="picker" className={choicePlate} onClick={() => setShowPicker(true)}>
        {W.pickerChoice}
      </button>,
      <button key="sq" className={choicePlate} onClick={() => setSqStep(0)}>
        {W.selfQuestionChoice}
      </button>
    );
  }

  const screenTabs = [
    { key: "main", label: W.screens.main },
    { key: "index", label: W.screens.index, badge: kaiiIndex.length },
    { key: "files", label: W.screens.files },
    { key: "rumors", label: W.screens.rumors, badge: overdueTodos.length },
    { key: "record", label: W.screens.record },
    { key: "logic", label: W.screens.logic },
  ] as { key: Screen; label: string; badge?: number }[];

  return (
    <div className="flex gap-1">
      {/* ══ 舞台 ══
          一枚絵を全面に敷き、その上に情報・選択肢・メッセージ窓を重ねる。
          サウンドノベルの画面そのものを1つの枠として組み立てている */}
      <div
        className={`relative flex min-w-0 flex-1 flex-col overflow-hidden border ${
          corrupted ? "hyr-corrupt border-alert/40" : "border-cream/20"
        } ${runningTier.level >= 4 && !!running ? "hyr-shake" : ""}`}
        style={{ height: "clamp(25rem, 70vh, 42rem)" }}
      >
        <SceneCanvas
          seed={sceneSeed}
          intensity={sceneIntensity}
          night={phase.corrupt}
          className="pointer-events-none absolute inset-0"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/55 via-black/5 to-black/85" />
        {/* 画面切り替えのたびに走る一瞬のノイズ */}
        <div key={screen} className="hyr-flash pointer-events-none absolute inset-0 bg-cream/10" />

        {/* ── 上部: 事件情報 ── */}
        <div className="relative z-10 flex items-start justify-between gap-2 p-3">
          <div className="min-w-0">
            <p className="text-[10px] tracking-[0.3em] text-cream/50">{W.fileHeader}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-cream/40">
              <span>
                {W.fileNoPrefix}
                {done.length + 1}
              </span>
              <span>/</span>
              <span>{today.replace(/-/g, ".")}</span>
              {running && running.estimatedSeconds > 0 && (
                <span className={riskBadgeClasses(runningTier.level, mode)}>{riskBadgeLabel(runningTier, wordingThemedMode)}</span>
              )}
              {running?.isTrouble && (
                <span className="border border-alert/60 px-1 py-0.5 text-[9px] text-alert">{W.troubleBadge}</span>
              )}
            </p>
          </div>
          {/* 右肩に縦書きで作業名。和製ホラーの装丁に寄せる */}
          {running && (
            <p
              className="shrink-0 overflow-hidden text-sm font-bold tracking-widest text-cream/85"
              style={{ writingMode: "vertical-rl", height: "9rem", textShadow: "0 1px 4px rgba(0,0,0,0.95)" }}
            >
              {running.name}
            </p>
          )}
        </div>

        {/* ── 中央: 計測 または 資料画面 ── */}
        <div className="relative z-10 min-h-0 flex-1 overflow-y-auto px-3">
          {screen === "main" && (
            <div className="flex h-full flex-col items-center justify-center text-center">
              {running ? (
                <>
                  <p
                    className="font-display text-5xl font-bold tabular-nums text-alert"
                    style={{ textShadow: "0 2px 12px rgba(0,0,0,0.95)" }}
                  >
                    {formatMsClock(runningElapsedMs)}
                  </p>
                  <p className="mt-1 text-[11px] tabular-nums text-cream/60">
                    想定 {running.estimatedSeconds > 0 ? formatHms(running.estimatedSeconds) : W.noEstimate}
                    {running.estimatedSeconds > 0 && ` ／ ${Math.round(runningRatio * 100)}%`}
                  </p>
                  {running.estimatedSeconds > 0 && (
                    <div className="mt-2 h-[3px] w-40 overflow-hidden bg-cream/15">
                      <div className="h-[3px] bg-alert" style={{ width: `${Math.min(100, runningRatio * 100)}%` }} />
                    </div>
                  )}
                </>
              ) : (
                <>
                  <p className="text-5xl opacity-80">{growthStage.icon}</p>
                  <p className="mt-2 text-sm text-cream/60">{W.noRunning}</p>
                  <p className="text-[11px] text-cream/35">
                    {W.stagePrefix}: {growthStage.label}
                  </p>
                </>
              )}
            </div>
          )}

          {screen === "index" && (
            <div className="space-y-1.5 py-1">
              {kaiiIndex.length === 0 && <p className="text-sm text-cream/50">{W.indexEmpty}</p>}
              {kaiiIndex.slice(0, 40).map((k) => (
                <button
                  key={k.key}
                  onClick={() => setOpenKaii(k)}
                  className="flex w-full items-center gap-2.5 border-l-2 border-cream/25 bg-black/55 px-2 py-1.5 text-left text-xs hover:border-alert hover:bg-alert/10"
                >
                  <KaiiSilhouette
                    seed={k.displayName}
                    size={42}
                    dangerLevel={k.dangerLevel}
                    className="shrink-0 border border-cream/15"
                  />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate font-bold ${DANGER_TEXT[k.dangerLevel]}`}>
                      {wordingEnabled ? k.displayName : k.realName}
                    </span>
                    <span className="block text-[10px] text-cream/40">
                      {kaiiStatusLabel(k.status, wordingEnabled)}　{k.category}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums text-cream/45">×{k.encounterCount}</span>
                </button>
              ))}
            </div>
          )}

          {screen === "files" && (
            <div className="space-y-2 py-1">
              {tasks.length === 0 && <p className="text-sm text-cream/50">{W.filesEmpty}</p>}
              {tasks.length > 0 && (
                <CaseDiagram
                  className="overflow-hidden border border-cream/15 bg-black/40"
                  height={186}
                  centerLabel={`本日 ${done.length}/${tasks.length}`}
                  seed={`${today}:${tasks.length}`}
                  nodes={tasks.slice(0, 8).map((t) => {
                    const el = segmentsAccumulatedMs(t, now) / 1000;
                    const ratio = t.estimatedSeconds > 0 ? el / t.estimatedSeconds : 0;
                    return { label: t.name, level: getRiskTier(ratio, mode).level, done: t.status === "done" };
                  })}
                />
              )}
              {tasks.map((t, i) => {
                const elapsed = segmentsAccumulatedMs(t, now);
                const ratio = t.estimatedSeconds > 0 ? elapsed / 1000 / t.estimatedSeconds : 0;
                return (
                  <div
                    key={t.id}
                    className={`flex items-center justify-between gap-2 border-l-2 bg-black/55 px-2 py-1.5 text-xs ${
                      t.status === "done" ? "border-cream/20 opacity-50" : ratio >= 1.3 ? "border-alert" : "border-cream/30"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate text-cream/85">
                      <span className="mr-1.5 text-[10px] text-cream/30">
                        {W.fileNoPrefix}
                        {i + 1}
                      </span>
                      {t.name}
                      {t.isTrouble && <span className="ml-1 text-alert">［{W.troubleBadge}］</span>}
                    </span>
                    <span className="shrink-0 tabular-nums text-cream/55">{formatMsClock(elapsed)}</span>
                    <span className="shrink-0 text-[10px] text-cream/40">
                      {t.status === "done"
                        ? W.statusDone
                        : t.status === "running"
                          ? W.statusRunning
                          : t.status === "paused"
                            ? W.statusPaused
                            : W.statusPending}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {screen === "rumors" && (
            <div className="space-y-1.5 py-1">
              {overdueTodos.length === 0 && myDayTodos.length === 0 && (
                <p className="text-sm text-cream/50">{W.rumorsEmpty}</p>
              )}
              {overdueTodos.map((t: TodoTask) => (
                <div key={t.id} className="border-l-2 border-alert bg-black/55 px-2 py-1.5 text-xs">
                  <span className="text-cream/85">{t.title}</span>
                  <span className="ml-2 text-[10px] text-alert">期限 {t.dueDate}</span>
                </div>
              ))}
              {myDayTodos.map((t: TodoTask) => (
                <div key={t.id} className="border-l-2 border-cream/25 bg-black/55 px-2 py-1.5 text-xs text-cream/75">
                  {t.title}
                </div>
              ))}
            </div>
          )}

          {screen === "record" && (
            <div className="space-y-3 py-1">
              <div className="border border-cream/15 bg-black/55 px-2 py-2">
                <div className="flex items-center justify-between text-[10px] text-cream/45">
                  <span>{W.erosionLabel}</span>
                  <span className="tabular-nums">{erosion}%</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden bg-cream/10">
                  <div className="h-1.5 bg-alert transition-[width]" style={{ width: `${erosion}%` }} />
                </div>
              </div>
              <div className="border border-alert/40 bg-black/60 px-2 py-2">
                <p className="text-[10px] tracking-[0.2em] text-cream/45">{W.routeTitle}</p>
                <p className="font-display text-base font-bold text-alert">{route.label}</p>
                <p className="mt-0.5 text-[10px] text-cream/50">
                  {W.occultCountLabel} {occultCount}回 ／ {W.scienceCountLabel} {scienceCount}回
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-center">
                {[
                  { label: W.statStreak, value: `${streakDays}日` },
                  { label: W.statToday, value: formatHms(Math.floor(totalMsToday / 1000)) },
                  { label: W.statSolved, value: `${done.length}件` },
                  { label: W.statIndexed, value: `${kaiiIndex.length}件` },
                  { label: W.statSealed, value: `${sealedCount}件` },
                  { label: W.statLoad, value: `${Math.round((totalMsToday / 1000 / NOMINAL_DAY_SECONDS) * 100)}%` },
                ].map((s) => (
                  <div key={s.label} className="border border-cream/10 bg-black/55 px-2 py-2">
                    <p className="text-[10px] tracking-wider text-cream/45">{s.label}</p>
                    <p className="font-display text-lg font-bold tabular-nums text-cream">{s.value}</p>
                  </div>
                ))}
              </div>
              {tasks.length > 0 && done.length === tasks.length && (
                <div className="border border-alert/40 bg-alert/10 px-2 py-2">
                  <p className="text-[10px] tracking-[0.2em] text-alert">{W.reportTitle}</p>
                  <p className="mt-1 text-xs leading-relaxed text-cream/80">
                    {W.reportBody(tasks.length, erosion, formatHms(Math.floor(totalMsToday / 1000)), route.label)}
                  </p>
                </div>
              )}
            </div>
          )}

          {screen === "logic" && (
            <div className="space-y-2 py-1">
              <p className="text-[10px] tracking-[0.3em] text-alert">{W.logicTitle}</p>
              <p className="text-[11px] leading-relaxed text-cream/60">{W.logicLead}</p>
              {puzzle.slots.length === 0 ? (
                <p className="border border-cream/15 bg-black/55 p-3 text-xs text-cream/60">{W.logicNoKeywords}</p>
              ) : logicResult ? (
                <div className="space-y-2">
                  <div className="border border-alert/50 bg-black/60 p-3 text-center">
                    <p className="font-display text-4xl font-bold text-alert">{logicResult.rank}</p>
                    <p className="mt-1 text-[11px] text-cream/60">
                      {W.logicResult(logicResult.rank, logicResult.correct, logicResult.total)}
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-cream/75">{W.rankComment(logicResult.rank)}</p>
                  </div>
                  {puzzle.slots.map((slot) => {
                    const chosen = keywords.find((k) => k.id === logicAnswers[slot.id]);
                    const truth = keywords.find((k) => k.id === slot.answerId);
                    const ok = logicAnswers[slot.id] === slot.answerId;
                    return (
                      <div key={slot.id} className="border-l-2 border-cream/20 bg-black/50 px-2 py-1.5 text-[11px]">
                        <span className="text-cream/55">{slot.question}</span>{" "}
                        <span className={ok ? "font-bold text-alert" : "text-cream/40 line-through"}>
                          {chosen?.label ?? "—"}
                        </span>
                        {!ok && <span className="ml-1 font-bold text-alert">→ {truth?.label ?? "—"}</span>}
                      </div>
                    );
                  })}
                  <button
                    className="w-full border border-cream/25 py-2 text-xs text-cream/70"
                    onClick={() => {
                      setRankRaw("");
                      setLogicAnswers({});
                    }}
                  >
                    {W.logicRetry}
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {puzzle.slots.map((slot) => {
                    const chosen = keywords.find((k) => k.id === logicAnswers[slot.id]);
                    return (
                      <div key={slot.id} className="border border-cream/15 bg-black/55 p-2">
                        <p className="text-[11px] text-cream/70">
                          {slot.question}
                          <button
                            className="ml-1 border border-alert/50 bg-alert/10 px-2 py-0.5 text-[11px] text-alert"
                            onClick={() => setOpenSlot(openSlot === slot.id ? null : slot.id)}
                          >
                            {chosen ? chosen.label : W.logicBlank}
                          </button>
                        </p>
                        {openSlot === slot.id && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {puzzle.candidates.map((k) => {
                              // 1つのキーワードは1箇所にしか置けない(原作の相関図と同じ)
                              const usedElsewhere = Object.entries(logicAnswers).some(
                                ([sid, kid]) => sid !== slot.id && kid === k.id
                              );
                              return (
                                <button
                                  key={k.id}
                                  disabled={usedElsewhere}
                                  className="border border-cream/25 bg-black/60 px-2 py-1 text-[11px] text-cream/80 hover:border-alert hover:text-alert disabled:border-cream/10 disabled:text-cream/25 disabled:line-through disabled:hover:text-cream/25"
                                  onClick={() => {
                                    setLogicAnswers((prev) => ({ ...prev, [slot.id]: k.id }));
                                    setOpenSlot(null);
                                  }}
                                >
                                  {k.label}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <button
                    className="w-full border border-alert/50 bg-alert/10 py-2 text-xs text-alert disabled:opacity-40"
                    disabled={puzzle.slots.some((sl) => !logicAnswers[sl.id])}
                    onClick={confirmLogic}
                  >
                    {W.logicConfirm}
                  </button>
                  <p className="text-[10px] text-cream/35">{W.keywordHint}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── 選択肢(メッセージ窓の上に重ねる) ── */}
        {choices.length > 0 && (
          <div className="relative z-10 max-h-[36%] shrink-0 space-y-1.5 overflow-y-auto px-2 pb-1">{choices}</div>
        )}

        {/* ── メッセージ窓 ── */}
        <div className="relative z-10 mx-2 mb-2 shrink-0">
          {/* 名札(現場) */}
          <div className="inline-block border border-cream/30 border-b-0 bg-black/80 px-2 py-0.5 text-[10px] tracking-widest text-cream/70">
            {placeLabel}
          </div>
          <div
            className="cursor-pointer border border-cream/30 bg-black/80 p-3"
            style={{ minHeight: "5.5rem" }}
            onClick={skipTyping}
          >
            <p className="text-sm leading-relaxed tracking-wide text-cream/90">
              {splitNarration(narration.slice(0, typedCount), keywords).map((part, i) =>
                part.keyword ? (
                  <button
                    key={i}
                    className={`hyr-keyword ${
                      collected.some((c) => c.id === part.keyword!.id) ? "hyr-keyword-taken" : ""
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      collectKeyword(part.keyword!);
                    }}
                  >
                    {part.text}
                  </button>
                ) : (
                  <span key={i}>{part.text}</span>
                )
              )}
              {!typedDone && <span className="text-alert">▊</span>}
            </p>
            {typedDone && (
              <div className="mt-1 flex items-end justify-between gap-2">
                <span className="text-[10px] text-cream/35">{W.keywordCount(collected.length, keywords.length)}</span>
                <span className="text-xs text-alert">▼</span>
              </div>
            )}
          </div>
        </div>

        {/* ── セルフ・クエスチョン(自問自答) ── */}
        {sqStep !== null && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/88 p-4">
            <p className="text-center text-xs tracking-[0.3em] text-alert">{W.sqTitle}</p>
            {sqStep === 0 && (
              <>
                <p className="text-center text-sm text-cream/85">{W.sqStep1}</p>
                <div className="w-full max-w-sm space-y-1.5">
                  {sqCandidates.length === 0 && <p className="text-center text-xs text-cream/50">{W.sqNone}</p>}
                  {sqCandidates.map((t) => (
                    <button key={t.id} className={choicePlate} onClick={() => sqPick(t)}>
                      ▶ {t.name}
                    </button>
                  ))}
                </div>
              </>
            )}
            {sqStep === 1 && sqTask && (
              <>
                <p className="text-center text-sm text-cream/85">{W.sqStep2(sqTask.name)}</p>
                <div className="w-full max-w-sm space-y-1.5">
                  <button className={choicePlate} onClick={() => sqEstimate(1)}>
                    ▶ {W.sqAsIs}
                  </button>
                  <button className={choicePlate} onClick={() => sqEstimate(1.5)}>
                    ▶ {W.sqHalf}
                  </button>
                  <button className={choicePlate} onClick={() => sqEstimate(2)}>
                    ▶ {W.sqDouble}
                  </button>
                </div>
              </>
            )}
            <button
              className="border border-cream/25 px-4 py-1.5 text-xs text-cream/60"
              onClick={() => {
                setSqStep(null);
                setSqTask(null);
              }}
            >
              {W.sqClose}
            </button>
          </div>
        )}

        {/* ── オカルト / 科学 の二択(舞台を覆う見せ場) ── */}
        {askJudgement && running && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/85 p-4">
            <p className="text-center text-xs tracking-[0.3em] text-alert">{W.judgeTitle}</p>
            <div className="flex w-full max-w-md items-stretch justify-center gap-3">
              {(
                [
                  { key: "occult" as const, tag: W.occultTag, text: W.occultChoice, run: () => judgeOccult(running) },
                  { key: "science" as const, tag: W.scienceTag, text: W.scienceChoice, run: () => judgeScience(running) },
                ]
              ).map((c) => (
                <button
                  key={c.key}
                  onClick={c.run}
                  onMouseEnter={() => setHoverJudge(c.key)}
                  onMouseLeave={() => setHoverJudge(null)}
                  className={`flex flex-1 flex-col items-center gap-2 border bg-black/60 p-3 transition ${
                    hoverJudge === c.key ? "border-alert bg-alert/10" : "border-cream/30"
                  }`}
                >
                  <EmblemCanvas kind={c.key} size={92} active={hoverJudge === c.key} className="border border-cream/10" />
                  <span className="font-display text-base font-bold text-alert">{c.tag}</span>
                  <span className="text-center text-[11px] leading-snug text-cream/70">{c.text}</span>
                </button>
              ))}
            </div>
            <p className="max-w-md text-center text-[10px] leading-relaxed text-cream/40">{W.judgeNote}</p>
          </div>
        )}
      </div>

      {/* ══ 綴じ込みの見出し(右端の縦書きタブ) ══
          事件ファイルの背に貼られたインデックスのつもりで、縦書きの札を縦に並べる */}
      <div className="flex w-8 shrink-0 flex-col gap-1" style={{ height: "clamp(25rem, 70vh, 42rem)" }}>
        {screenTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setScreen(t.key);
              setLastJudgement(null);
            }}
            className={`relative flex flex-1 items-center justify-center border transition ${
              screen === t.key
                ? "border-alert bg-alert/15 text-alert"
                : "border-cream/20 bg-black/50 text-cream/55 hover:border-cream/45"
            }`}
            style={{ writingMode: "vertical-rl" }}
          >
            <span className="text-[11px] tracking-[0.25em]">{t.label}</span>
            {!!t.badge && t.badge > 0 && (
              <span className="absolute left-0.5 top-0.5 text-[8px] text-alert" style={{ writingMode: "horizontal-tb" }}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── 作業マスタから選ぶ ── */}
      {showPicker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => {
            setShowPicker(false);
            setPickedMaster(null);
          }}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-sm flex-col border border-alert/40 bg-ink p-4"
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundImage:
                "radial-gradient(ellipse at 50% 0%, rgb(var(--accent-rgb) / 0.12) 0%, transparent 65%), linear-gradient(180deg, rgb(var(--panel-rgb)) 0%, rgb(var(--ink-rgb)) 100%)",
            }}
          >
            <p className="shrink-0 text-[10px] tracking-[0.3em] text-cream/40">{W.pickerTitle}</p>
            <p className="mb-2 shrink-0 text-xs text-cream/50">{W.pickerDesc}</p>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <MasterTaskPicker selectedId={pickedMaster?.id} onSelect={setPickedMaster} />
            </div>
            <div className="mt-3 shrink-0 space-y-2">
              <button
                className={choicePlate + " disabled:opacity-40"}
                disabled={!pickedMaster}
                onClick={async () => {
                  if (!pickedMaster) return;
                  await addFromMaster(pickedMaster, true);
                  setPickedMaster(null);
                  setShowPicker(false);
                }}
              >
                {W.pickerStart}
              </button>
              <button
                className={choicePlate + " disabled:opacity-40"}
                disabled={!pickedMaster}
                onClick={async () => {
                  if (!pickedMaster) return;
                  await addFromMaster(pickedMaster, false);
                  setPickedMaster(null);
                  setShowPicker(false);
                }}
              >
                {W.pickerQueue}
              </button>
              <button
                className="w-full border border-cream/25 py-2 text-xs text-cream/70"
                onClick={() => {
                  setShowPicker(false);
                  setPickedMaster(null);
                }}
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 怪異の詳細(名鑑を開いた時) ── */}
      {openKaii && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setOpenKaii(null)}
        >
          <div
            className="w-full max-w-sm border border-alert/40 bg-ink p-4"
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundImage:
                "radial-gradient(ellipse at 50% 0%, rgb(var(--accent-rgb) / 0.12) 0%, transparent 65%), linear-gradient(180deg, rgb(var(--panel-rgb)) 0%, rgb(var(--ink-rgb)) 100%)",
            }}
          >
            <p className="text-[10px] tracking-[0.3em] text-cream/40">{W.detailHeader}</p>
            <div className="mt-1 flex items-start gap-3">
              <KaiiSilhouette
                seed={openKaii.displayName}
                size={104}
                dangerLevel={openKaii.dangerLevel}
                className="shrink-0 border border-cream/20"
              />
              <div className="min-w-0">
                <p className={`font-display text-lg font-bold leading-snug ${DANGER_TEXT[openKaii.dangerLevel]}`}>
                  {wordingEnabled ? openKaii.displayName : openKaii.realName}
                </p>
                <p className="text-[11px] text-cream/40">
                  {openKaii.category} / {openKaii.realName}
                </p>
              </div>
            </div>
            <div className="mt-3 space-y-1 text-xs text-cream/70">
              {[
                [W.detailStatus, kaiiStatusLabel(openKaii.status, wordingEnabled)],
                [W.detailCount, `${openKaii.encounterCount}回`],
                [W.detailAvg, formatHms(Math.round(openKaii.avgSeconds))],
                [W.detailMax, formatHms(Math.round(openKaii.maxSeconds))],
                [W.detailRatio, openKaii.avgRatio > 0 ? `${Math.round(openKaii.avgRatio * 100)}%` : W.noEstimate],
                [W.detailTrouble, `${openKaii.troubleCount}回`],
                [W.detailLastSeen, openKaii.lastSeenDate],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between border-b border-cream/10 pb-1">
                  <span className="text-cream/40">{label}</span>
                  <span className="tabular-nums">{value}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[10px] leading-relaxed text-cream/35">{W.detailNote}</p>
            <button
              className="mt-3 w-full border border-cream/25 py-2 text-xs text-cream/70"
              onClick={() => setOpenKaii(null)}
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
