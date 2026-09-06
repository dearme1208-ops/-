"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import { computeRemainingEstimatedSeconds, finishDailyTask } from "@/lib/tasks";
import { findOrCreateMasterTask } from "@/lib/master";
import { formatHms, todayStr } from "@/lib/time";
import { computeStreakDays } from "@/lib/streak";
import { useVisualMode } from "@/lib/theme";
import { useSetting } from "@/lib/settings";
import {
  buildAltimeter,
  buildClimbLog,
  buildDaylight,
  buildLegs,
  buildPack,
  buildRoute,
  buildWeather,
  gradeOf,
  ruggednessOf,
  secondsByProject,
  type Leg,
  type MountainRoute,
} from "@/lib/mountain";
import { skyPhaseOf } from "@/lib/mountainArt";
import { mountainWordsFor } from "@/lib/mountainWords";
import {
  Altimeter,
  ClimbLogChart,
  Panorama,
  Profile,
  Signboard,
  Topo,
  WeatherGlyph,
} from "@/components/mountain/MountainCanvas";
import MasterTaskPicker from "@/components/sections/MasterTaskPicker";
import Modal from "@/components/ui/Modal";
import type { DailyTask, MasterTask } from "@/lib/types";

// 登山モードの「本日の作業」タブ。
//
// 一日を1回の山行として見る。案件は一座の山、その段階は通過点、本日の作業は区間、
// 想定時間はコースタイム、実績時間は行動時間、トラブル対応は落石、
// 所定労働時間の残りは日没までの時間、未完了のToDoはザックの中身。
//
// 画面は「見出しの一枚絵 → 計器 → 本日の行程 → 登攀中の山 → ザック」の順に降りていく。
// 山の絵の起伏・雲の位置・雪渓の形は種から決まる擬似乱数だが、
// 数値(標高・コースタイム・天候・残り時間)はすべて実データからの純粋関数で、
// 演出のための水増しは一切していない。

type PanelKey = "route" | "peaks" | "pack" | "log";

export default function MountainSection() {
  const { wordingEnabled } = useVisualMode();
  const W = mountainWordsFor(wordingEnabled);
  const today = todayStr();
  const [now, setNow] = useState(() => Date.now());
  const [panel, setPanel] = useState<PanelKey>("route");
  const [showPicker, setShowPicker] = useState(false);
  const [pickedMaster, setPickedMaster] = useState<MasterTask | null>(null);
  const [freeCategory, setFreeCategory] = useState("");
  const [freeName, setFreeName] = useState("");
  const [openRouteId, setOpenRouteId] = useState<string | null>(null);

  // 計測中の表示を進めるため1秒ごとに時刻を更新する
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const tasks = useLiveQuery(() => db.dailyTasks.where("date").equals(today).sortBy("order"), [today]) ?? [];
  const projects = useLiveQuery(() => db.projects.toArray(), []) ?? [];
  const todos = useLiveQuery(() => db.todoTasks.toArray(), []) ?? [];
  const records = useLiveQuery(() => db.records.toArray(), []) ?? [];
  const [workStart] = useSetting("today.standardWorkStart", "08:30");
  const [workEnd] = useSetting("today.standardWorkEnd", "17:30");

  const realTasks = useMemo(() => tasks.filter((t) => !t.isProvisional), [tasks]);
  const legs = useMemo(() => buildLegs(realTasks, now), [realTasks, now]);
  const altimeter = useMemo(() => buildAltimeter(legs), [legs]);
  const weather = useMemo(() => buildWeather(realTasks, now), [realTasks, now]);
  const daylight = useMemo(() => buildDaylight(workStart, workEnd, new Date(now)), [workStart, workEnd, now]);
  const pack = useMemo(() => buildPack(todos, today), [todos, today]);
  const projectSeconds = useMemo(() => secondsByProject(records), [records]);
  const routes = useMemo(
    () =>
      projects
        .filter((p) => !p.completedAt)
        .map((p) => buildRoute(p, today, projectSeconds))
        .sort((a, b) => a.daysLeft - b.daysLeft),
    [projects, today, projectSeconds]
  );
  const summitedRoutes = useMemo(
    () => projects.filter((p) => !!p.completedAt).map((p) => buildRoute(p, today, projectSeconds)),
    [projects, today, projectSeconds]
  );
  const climbLog = useMemo(() => buildClimbLog(records, 30, today), [records, today]);
  const streak = useMemo(() => computeStreakDays(records, today), [records, today]);

  const running = realTasks.find((t) => t.status === "running") ?? null;
  const phase = skyPhaseOf(new Date(now).getHours());
  // 一枚絵のルートの進み具合は「本日の予定に対する実働の割合」そのもの。
  // 予定が無い日は完了件数の割合を使う
  const dayProgress =
    altimeter.plannedSeconds > 0
      ? Math.min(1, altimeter.ratio)
      : altimeter.totalCount > 0
        ? altimeter.doneCount / altimeter.totalCount
        : 0;

  // ---- 操作 ----
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
    await db.dailyTasks.update(task.id, {
      segments: [...task.segments, { start: Date.now() }],
      status: "running",
      startedAt: task.startedAt ?? Date.now(),
    });
  }
  async function addFromMaster(master: MasterTask, startImmediately: boolean) {
    if (startImmediately && running) await pauseTask(running);
    const estimatedSeconds = await computeRemainingEstimatedSeconds(today, master.category, master.name, master.estimatedSeconds);
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
  }
  async function addFreeform(category: string, name: string, startImmediately: boolean) {
    const cat = category.trim();
    const nm = name.trim();
    if (!cat || !nm) return;
    const master = await findOrCreateMasterTask(cat, nm, 0);
    await addFromMaster({ ...master, category: cat, name: nm }, startImmediately);
  }

  // ---- 見た目のトークン ----
  // 山の道具らしく、面は霧のかかった岩の色、縁は細い金属線。角は小さめに揃える
  const card = "rounded-xl border border-cream/12 bg-panel/70 backdrop-blur-[1px]";
  const rule = "border-cream/12";
  const chip = "rounded-full border border-cream/20 px-2 py-0.5 text-[10px] text-cream/70";
  const btn = "rounded-lg border border-cream/25 px-3 py-1.5 text-xs text-cream/90 hover:bg-cream/10 transition";
  const btnAccent =
    "rounded-lg border border-alert/60 bg-alert/20 px-3 py-1.5 text-xs font-bold text-cream hover:bg-alert/30 transition";

  return (
    <div className="relative space-y-4">
      {/* ---------- 見出し: 山のパノラマ ---------- */}
      <div className={`relative overflow-hidden ${card}`}>
        <Panorama
          phase={phase}
          seed={`day:${today}:${realTasks.length}`}
          rugged={Math.min(1, 0.3 + realTasks.length / 12)}
          progress={dayProgress}
          weather={weather.weather}
          summited={altimeter.totalCount > 0 && altimeter.doneCount === altimeter.totalCount}
          ratio={0.56}
        />
        {/* 一枚絵の上に、標高と天候の読み取りを重ねる */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-cream/60">{W.title}</div>
            <div className="font-display text-2xl font-bold tabular-nums text-cream drop-shadow">
              {altimeter.gainedMeters}
              <span className="ml-0.5 text-sm font-normal text-cream/70">{W.gainUnit}</span>
            </div>
            <div className="text-[10px] text-cream/60 tabular-nums">
              {W.altimeterSub(altimeter.doneCount, altimeter.totalCount)}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="rounded-lg bg-ink/55 px-2 py-1 backdrop-blur-sm">
              <div className="flex items-center gap-1.5">
                <WeatherGlyph weather={weather.weather} size={28} />
                <span className="text-xs font-bold text-cream">{W.weatherName(weather.weather)}</span>
              </div>
            </div>
            <span className="rounded bg-ink/55 px-1.5 py-0.5 text-[10px] text-cream/70 tabular-nums backdrop-blur-sm">
              {daylight.afterSunset ? W.afterSunset : `${W.daylight} ${W.daylightLeft(daylight.remainingMinutes)}`}
            </span>
          </div>
        </div>
        <p className="border-t border-cream/10 px-3 py-2 text-[11px] text-cream/60">
          {W.weatherNote(weather.weather, weather.troubleCount, weather.overrunCount)}
        </p>
      </div>

      {/* ---------- 計器 ---------- */}
      <div className={`flex flex-wrap items-center justify-around gap-2 p-3 ${card}`}>
        <Altimeter
          value={altimeter.gainedMeters}
          max={Math.max(1, altimeter.plannedMeters)}
          unit={W.gainUnit}
          caption={W.altimeter}
          sub={`${W.courseTime} ${altimeter.plannedMeters}${W.gainUnit}`}
          size={124}
        />
        <div className="min-w-[9rem] flex-1 space-y-2">
          <Readout label={W.actualTime} value={formatHms(altimeter.actualSeconds)} />
          <Readout label={W.courseTime} value={formatHms(altimeter.plannedSeconds)} />
          <Readout
            label={W.daylight}
            value={daylight.afterSunset ? "—" : W.daylightLeft(daylight.remainingMinutes)}
            alert={daylight.afterSunset}
          />
          {streak > 0 && <Readout label={wordingEnabled ? "連続入山" : "連続記録"} value={`${streak}日`} />}
        </div>
      </div>

      {/* ---------- パネル切替 ---------- */}
      <div className={`flex overflow-hidden ${card}`}>
        {(
          [
            ["route", W.todayRoute],
            ["peaks", W.routeList],
            ["pack", W.pack],
            ["log", W.climbLog],
          ] as [PanelKey, string][]
        ).map(([key, label], i) => (
          <button
            key={key}
            onClick={() => setPanel(key)}
            className={`flex-1 whitespace-nowrap border-l px-1.5 py-2 text-[10px] transition first:border-l-0 ${rule} ${
              panel === key ? "bg-alert/20 font-bold text-cream" : "text-cream/55 hover:bg-cream/5"
            }`}
            aria-pressed={panel === key}
          >
            {label}
            {key === "peaks" && routes.length > 0 && <span className="ml-1 tabular-nums text-cream/50">{routes.length}</span>}
            {key === "pack" && pack.items.length > 0 && (
              <span className="ml-1 tabular-nums text-cream/50">{pack.items.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ---------- 本日の行程 ---------- */}
      {panel === "route" && (
        <div className={`relative overflow-hidden ${card}`}>
          {/* 背景に等高線を薄く敷いて、地形図の上に行程表が載っている感じにする */}
          <div className="pointer-events-none absolute inset-0 opacity-70">
            <Topo seed={`topo:${today}`} height={520} />
          </div>
          <div className="relative divide-y divide-cream/8">
            {legs.length === 0 && <p className="px-4 py-8 text-center text-sm text-cream/50">{W.noLegs}</p>}
            {legs.map((leg, i) => (
              <LegRow
                key={leg.taskId}
                leg={leg}
                index={i}
                total={legs.length}
                words={W}
                onStart={() => {
                  const t = realTasks.find((x) => x.id === leg.taskId);
                  if (t) startTask(t);
                }}
                onPause={() => {
                  const t = realTasks.find((x) => x.id === leg.taskId);
                  if (t) pauseTask(t);
                }}
                onFinish={() => {
                  const t = realTasks.find((x) => x.id === leg.taskId);
                  if (t) finishDailyTask(t);
                }}
              />
            ))}
            <div className="p-3">
              <button className={btn} onClick={() => setShowPicker(true)}>
                ＋ {wordingEnabled ? "区間を追加する" : "作業を追加する"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- 登攀中の山 ---------- */}
      {panel === "peaks" && (
        <div className="space-y-3">
          {routes.length === 0 && (
            <p className={`px-4 py-8 text-center text-sm text-cream/50 ${card}`}>{W.noRoutes}</p>
          )}
          {routes.map((r) => (
            <RouteCard
              key={r.projectId}
              route={r}
              words={W}
              open={openRouteId === r.projectId}
              onToggle={() => setOpenRouteId(openRouteId === r.projectId ? null : r.projectId)}
              card={card}
              chip={chip}
            />
          ))}
          {summitedRoutes.length > 0 && (
            <div className={`p-3 ${card}`}>
              <h3 className="mb-2 text-xs font-bold text-cream/70">
                {wordingEnabled ? "登頂済みの山" : "完了した案件"}（{summitedRoutes.length}）
              </h3>
              <div className="flex flex-wrap gap-2">
                {summitedRoutes.map((r) => (
                  <span key={r.projectId} className={chip}>
                    ⛰ {r.name}・{r.summit}m
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------- ザックの中身 ---------- */}
      {panel === "pack" && (
        <div className={`overflow-hidden ${card}`}>
          <div className="flex items-baseline justify-between border-b border-cream/10 px-4 py-2.5">
            <span className="text-xs font-bold text-cream/80">{W.pack}</span>
            <span className="text-[11px] text-cream/55 tabular-nums">{W.packNote(pack.totalGrams, pack.overdueCount)}</span>
          </div>
          {pack.items.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-cream/50">
              {wordingEnabled ? "ザックは空です。軽快に歩けます。" : "未完了のToDoはありません。"}
            </p>
          )}
          <div className="divide-y divide-cream/8">
            {pack.items.slice(0, 20).map((item) => {
              // 重さのバーは、一番重い荷物を満杯として相対的に描く
              const max = Math.max(1, pack.items[0].weightGrams);
              return (
                <div key={item.todoId} className="flex items-center gap-2 px-4 py-2">
                  <span className="w-8 shrink-0 text-right text-[10px] text-cream/40 tabular-nums">
                    {(item.weightGrams / 1000).toFixed(1)}
                  </span>
                  <div className="h-2 w-16 shrink-0 overflow-hidden rounded-full bg-cream/8">
                    <div
                      className={`h-full rounded-full ${item.overdue ? "bg-alert" : "bg-cream/45"}`}
                      style={{ width: `${(item.weightGrams / max) * 100}%` }}
                    />
                  </div>
                  <span className={`min-w-0 flex-1 truncate text-xs ${item.overdue ? "text-cream" : "text-cream/75"}`}>
                    {item.important && <span className="mr-1 text-alert">★</span>}
                    {item.title}
                  </span>
                  {item.daysLeft !== null && (
                    <span className={`shrink-0 text-[10px] tabular-nums ${item.overdue ? "font-bold text-alert" : "text-cream/40"}`}>
                      {item.daysLeft < 0 ? `+${-item.daysLeft}日` : `${item.daysLeft}日`}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {pack.items.length > 20 && (
            <p className="px-4 py-2 text-center text-[10px] text-cream/35 tabular-nums">ほか{pack.items.length - 20}点</p>
          )}
        </div>
      )}

      {/* ---------- 行動記録 ---------- */}
      {panel === "log" && (
        <div className={`space-y-3 p-3 ${card}`}>
          <ClimbLogChart entries={climbLog} label={W.climbLogLabel} height={110} />
          <div className="grid grid-cols-3 gap-2">
            <Stat
              label={wordingEnabled ? "30日の累計標高" : "30日の実働換算"}
              value={`${climbLog.reduce((s, e) => s + e.meters, 0)}${W.gainUnit}`}
            />
            <Stat
              label={wordingEnabled ? "入山日数" : "記録のある日"}
              value={`${climbLog.filter((e) => e.seconds > 0).length}日`}
            />
            <Stat
              label={wordingEnabled ? "最高到達" : "最も多い日"}
              value={`${Math.max(0, ...climbLog.map((e) => e.meters))}${W.gainUnit}`}
            />
          </div>
          <p className="text-[10px] leading-relaxed text-cream/40">
            {wordingEnabled
              ? `獲得標高は実働時間の言い換えです（実働10分＝50m）。記録そのものは工程表の実績と同じものです。`
              : `棒の高さは1日の実働時間です（10分＝50mとして標高に換算しています）。`}
          </p>
        </div>
      )}

      {showPicker && (
        <Modal title={wordingEnabled ? "区間を追加する" : "作業を追加する"} onClose={() => setShowPicker(false)}>
          <div className="space-y-3">
            <MasterTaskPicker onSelect={setPickedMaster} selectedId={pickedMaster?.id ?? null} />
            <div className="sticky bottom-0 space-y-1.5 border-t border-cream/10 bg-panel pt-3">
              <button
                className={btnAccent + " w-full disabled:opacity-40"}
                disabled={!pickedMaster}
                onClick={async () => {
                  if (!pickedMaster) return;
                  await addFromMaster(pickedMaster, true);
                  setPickedMaster(null);
                }}
              >
                {wordingEnabled ? "この区間へ出発する" : "追加してすぐ開始"}
              </button>
              <button
                className={btn + " w-full disabled:opacity-40"}
                disabled={!pickedMaster}
                onClick={async () => {
                  if (!pickedMaster) return;
                  await addFromMaster(pickedMaster, false);
                  setPickedMaster(null);
                }}
              >
                {wordingEnabled ? "行程に加えるだけ" : "追加のみ"}
              </button>
              <div className="flex gap-1.5 pt-1">
                <input
                  value={freeCategory}
                  onChange={(e) => setFreeCategory(e.target.value)}
                  placeholder="業務区分"
                  className="min-w-0 flex-1 rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-xs text-cream"
                />
                <input
                  value={freeName}
                  onChange={(e) => setFreeName(e.target.value)}
                  placeholder={wordingEnabled ? "区間名" : "詳細作業名"}
                  className="min-w-0 flex-1 rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-xs text-cream"
                />
                <button
                  className={btn + " shrink-0 disabled:opacity-40"}
                  disabled={!freeCategory.trim() || !freeName.trim()}
                  onClick={async () => {
                    await addFreeform(freeCategory, freeName, false);
                    setFreeCategory("");
                    setFreeName("");
                  }}
                >
                  追加
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Readout({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="flex items-baseline justify-between border-b border-dashed border-cream/12 pb-1">
      <span className="text-[10px] uppercase tracking-wider text-cream/45">{label}</span>
      <span className={`text-sm font-bold tabular-nums ${alert ? "text-alert" : "text-cream"}`}>{value}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-cream/10 bg-ink/40 px-2 py-2 text-center">
      <div className="text-[9px] text-cream/45">{label}</div>
      <div className="font-display text-sm font-bold tabular-nums text-cream">{value}</div>
    </div>
  );
}

// 1区間(＝1作業)の行。左に高度の刻み、中央に区間名、右にコースタイムと実績
function LegRow({
  leg,
  index,
  total,
  words,
  onStart,
  onPause,
  onFinish,
}: {
  leg: Leg;
  index: number;
  total: number;
  words: ReturnType<typeof mountainWordsFor>;
  onStart: () => void;
  onPause: () => void;
  onFinish: () => void;
}) {
  const over = leg.courseTimeSeconds > 0 && leg.actualSeconds > leg.courseTimeSeconds;
  const done = leg.status === "done";
  const running = leg.status === "running";
  const pct = leg.courseTimeSeconds > 0 ? Math.min(1.5, leg.actualSeconds / leg.courseTimeSeconds) : 0;
  return (
    <div className={`px-3 py-2.5 ${running ? "card-running-mtn bg-alert/8" : over && !done ? "bg-alert/6" : ""}`}>
      <div className="flex items-start gap-2">
        {/* 高度の刻み。上に行くほど山頂に近い並びにする */}
        <div className="flex w-6 shrink-0 flex-col items-center pt-0.5">
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-full border text-[9px] font-bold tabular-nums ${
              done ? "border-alert bg-alert text-ink" : running ? "border-alert text-alert" : "border-cream/30 text-cream/50"
            }`}
          >
            {done ? "✓" : index + 1}
          </span>
          {index < total - 1 && <span className="mt-0.5 h-full w-px flex-1 bg-cream/12" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-[10px] text-cream/45">{leg.category}</span>
            <span className={`text-sm ${done ? "text-cream/45 line-through" : "text-cream"}`}>{leg.name}</span>
            {leg.isTrouble && <span className="rounded bg-alert/25 px-1 text-[9px] text-cream">{words.troubleLeg}</span>}
          </div>
          {/* コースタイムに対する行動時間のバー。100%の位置に基準線を引く */}
          <div className="relative mt-1 h-1.5 overflow-hidden rounded-full bg-cream/8">
            <div
              className={`h-full rounded-full ${over ? "bg-alert" : "bg-cream/55"}`}
              style={{ width: `${Math.min(100, (pct / 1.5) * 100)}%` }}
            />
            <span className="absolute inset-y-0 w-px bg-cream/40" style={{ left: `${(1 / 1.5) * 100}%` }} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] tabular-nums text-cream/50">
            <span>
              {words.actualTime} <span className={over ? "font-bold text-alert" : "text-cream/80"}>{formatHms(leg.actualSeconds)}</span>
            </span>
            {leg.courseTimeSeconds > 0 && (
              <span>
                {words.courseTime} {formatHms(leg.courseTimeSeconds)}
              </span>
            )}
            <span>
              {words.gain} {leg.gainMeters}
              {words.gainUnit}
            </span>
            <span className={over ? "text-alert" : ""}>{over ? words.legOver : words.legUnder}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          {!done && !running && (
            <button className="rounded border border-cream/25 px-2 py-1 text-[10px] text-cream/90 hover:bg-cream/10" onClick={onStart}>
              {words.legStatus("running") === "行動中" ? "出発" : "開始"}
            </button>
          )}
          {running && (
            <>
              <button className="rounded border border-alert/60 bg-alert/20 px-2 py-1 text-[10px] font-bold text-cream" onClick={onFinish}>
                {words.legStatus("done") === "通過" ? "通過" : "完了"}
              </button>
              <button className="rounded border border-cream/25 px-2 py-1 text-[10px] text-cream/70" onClick={onPause}>
                {words.legStatus("paused") === "休憩中" ? "休憩" : "停止"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// 一座ぶんのカード。山名板 → 断面図 → 通過点の一覧
function RouteCard({
  route,
  words,
  open,
  onToggle,
  card,
  chip,
}: {
  route: MountainRoute;
  words: ReturnType<typeof mountainWordsFor>;
  open: boolean;
  onToggle: () => void;
  card: string;
  chip: string;
}) {
  const done = route.waypoints.filter((w) => w.passed).length;
  return (
    <div className={`overflow-hidden ${card} ${route.overdue ? "card-overrun-mtn" : ""}`}>
      <button className="block w-full text-left" onClick={onToggle} aria-expanded={open}>
        <Signboard
          name={route.name}
          altitude={route.summit}
          grade={gradeOf(route)}
          summited={route.summited}
          seed={`sign:${route.projectId}`}
          height={78}
        />
      </button>
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
        <span className={chip}>{words.waypointsDone(done, route.waypoints.length)}</span>
        <span className={`${chip} ${route.overdue ? "border-alert/60 text-alert" : ""}`}>{words.daysLeft(route.daysLeft)}</span>
        {route.collapsedCount > 0 && (
          <span className="rounded-full border border-alert/60 px-2 py-0.5 text-[10px] font-bold text-alert">
            {words.collapsed(route.collapsedCount)}
          </span>
        )}
        {route.climbedSeconds > 0 && <span className={chip}>{formatHms(route.climbedSeconds)}</span>}
        <button className="ml-auto text-[10px] text-cream/50 hover:text-cream" onClick={onToggle}>
          {open ? "▲ 閉じる" : "▼ 断面図"}
        </button>
      </div>
      {open && (
        <div className="border-t border-cream/10">
          <Profile
            summit={route.summit}
            current={route.current}
            waypoints={route.waypoints}
            seed={`prof:${route.projectId}`}
            labels={{ start: words.start, summit: words.summit, now: words.now }}
          />
          <div className="divide-y divide-cream/8 border-t border-cream/10">
            {route.waypoints.map((wp) => (
              <div key={wp.id} className="flex items-center gap-2 px-3 py-1.5">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    wp.passed ? "bg-alert" : wp.collapsed ? "bg-alert/40 ring-1 ring-alert" : "bg-cream/25"
                  }`}
                />
                <span className={`min-w-0 flex-1 truncate text-xs ${wp.passed ? "text-cream/45 line-through" : "text-cream/80"}`}>
                  {wp.title}
                </span>
                <span className="shrink-0 text-[10px] text-cream/40 tabular-nums">{Math.round(wp.altitude)}m</span>
                {wp.collapsed && <span className="shrink-0 text-[10px] font-bold text-alert">崩落</span>}
              </div>
            ))}
            {route.waypoints.length === 0 && (
              <p className="px-3 py-3 text-[11px] text-cream/45">
                通過点が設定されていません（案件タブで段階を追加すると、ここに現れます）。
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
