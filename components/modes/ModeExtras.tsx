"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import { findOrCreateMasterTask } from "@/lib/master";
import {
  activityTrail,
  CAUSES,
  causeLinks,
  diaryAlbum,
  findOverruns,
  injuryRisk,
  monthHomework,
  mountainPlan,
  overdueTodos,
  seasonRecord,
  yearCard,
} from "@/lib/modeExtras";
import { hmToMs } from "@/lib/timebox";
import { useDraftSetting, useSetting } from "@/lib/settings";
import { formatMsClock, shiftDateStr, todayStr } from "@/lib/time";
import { showUndoToast } from "@/lib/toast";
import type { TodoTask } from "@/lib/types";

// 本日の作業を独自の画面に差し替える各モードに、その画面の下へ足す機能(計算は lib/modeExtras.ts)。
// 見た目は各モードの .panel / .btn-pill の装飾にそのまま乗る

function hm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** ToDoを今日の作業(未着手)に入れる。ToDoとの紐付けを残し、マイデイにも載せる */
async function addTodoToToday(t: TodoTask, today: string): Promise<void> {
  const exists = await db.dailyTasks.where("date").equals(today).filter((d) => d.todoTaskId === t.id && d.status !== "done").count();
  if (exists) {
    showUndoToast(`「${t.title}」はもう今日の作業にあります`);
    return;
  }
  const category = t.category || "ToDo";
  const master = await findOrCreateMasterTask(category, t.title, (t.estimateMinutes ?? 0) * 60);
  const order = await db.dailyTasks.where("date").equals(today).count();
  await db.dailyTasks.add({
    id: uid(),
    date: today,
    order,
    masterTaskId: master.id,
    category,
    name: t.title,
    estimatedSeconds: master.estimatedSeconds,
    hasPlan: false,
    status: "pending",
    segments: [],
    accumulatedMs: 0,
    isSpontaneous: true,
    todoTaskId: t.id,
  });
  await db.todoTasks.update(t.id, { myDayDate: today });
  showUndoToast(`「${t.title}」を今日の作業に入れました`);
}

// ━━ 登山: 登山計画書・引き返す判断・活動日記 ━━
export function MountainPlanPanel() {
  const today = todayStr();
  const now = useNow();
  const [workEnd] = useSetting("today.standardWorkEnd", "17:30");
  const tasks = useLiveQuery(() => db.dailyTasks.where("date").equals(today).toArray(), [today]);
  const sunset = hmToMs(today, workEnd) ?? now;
  const plan = useMemo(() => mountainPlan(tasks ?? [], now, sunset), [tasks, now, sunset]);
  const trail = useMemo(() => activityTrail(tasks ?? [], now), [tasks, now]);
  const over = plan.remainingMs > plan.daylightMs;
  return (
    <section className="panel space-y-3 p-4" data-testid="mountain-plan">
      <h3 className="font-display text-sm font-bold text-cream">🧭 登山計画書</h3>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-[11px] text-cream/55">残りのコースタイム</dt>
          <dd className="font-bold tabular-nums text-cream">{formatMsClock(plan.remainingMs)}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-cream/55">日没（{workEnd}）まで</dt>
          <dd className="font-bold tabular-nums text-cream">{formatMsClock(plan.daylightMs)}</dd>
        </div>
      </dl>
      {over ? (
        <div className="space-y-2 rounded-lg border border-alert/50 p-3">
          <p className="text-sm font-bold text-alert">このままでは日没までに下りられません。引き返す勇気も登山のうちです。</p>
          {plan.turnBack.length > 0 ? (
            <ul className="space-y-1.5">
              {plan.turnBack.map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-cream">{t.name}</span>
                  <button
                    className="btn-pill-outline shrink-0 px-3 py-1 text-xs"
                    onClick={async () => {
                      await db.dailyTasks.update(t.id, { date: shiftDateStr(today, 1) });
                      showUndoToast(`「${t.name}」を明日に回しました`, () => db.dailyTasks.update(t.id, { date: today }));
                    }}
                  >
                    明日に回す
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-cream/60">回せる未着手の区間はありません。今の区間を短く切り上げることを考えましょう。</p>
          )}
        </div>
      ) : (
        <p className="text-sm text-cream/70">日没までに下山できる計画です。</p>
      )}
      {trail.length > 0 && (
        <div className="border-t border-cream/10 pt-3">
          <h4 className="mb-1.5 text-xs font-bold text-cream/80">📔 活動日記</h4>
          <ol className="relative space-y-1 border-l border-cream/25 pl-3">
            {trail.map((s, i) => (
              <li key={i} className="text-xs text-cream/85">
                <span className="tabular-nums text-cream/55">
                  {hm(s.start)}〜{hm(s.end)}
                </span>{" "}
                {s.label}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

// ━━ パワプロ: ケガ(働きすぎ)と試合(期日)の戦績 ━━
export function PowerproInjuryPanel() {
  const today = todayStr();
  const records = useLiveQuery(() => db.records.where("date").aboveOrEqual(shiftDateStr(today, -40)).toArray(), [today]);
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const todos = useLiveQuery(() => db.todoTasks.toArray(), []);
  const injury = useMemo(() => injuryRisk(records ?? [], today), [records, today]);
  const season = useMemo(() => seasonRecord(projects ?? [], todos ?? [], today), [projects, todos, today]);
  const LABEL = ["低", "中", "高"] as const;
  return (
    <section className="panel space-y-3 p-4" data-testid="powerpro-injury">
      <div className="flex items-center gap-3">
        <h3 className="font-display text-sm font-bold text-cream">🩹 ケガ率</h3>
        <span className={`rounded px-2 py-0.5 text-sm font-black ${injury.level === 2 ? "bg-alert text-white" : injury.level === 1 ? "bg-yellow-400 text-black" : "bg-cream/15 text-cream"}`}>
          {LABEL[injury.level]}
        </span>
      </div>
      <p className="text-sm text-cream/80">
        {injury.level === 2
          ? `9時間以上の日が${injury.streak}日続いています。「休む」コマンドを選ぶ時です。`
          : injury.level === 1
            ? `9時間以上の日が${injury.streak}日続いています。明日は早めに切り上げましょう。`
            : "体調は万全です。"}
        <span className="ml-1 text-[11px] text-cream/50">（今日 {injury.todayHours.toFixed(1)}時間）</span>
      </p>
      <div className="border-t border-cream/10 pt-3">
        <h4 className="text-xs font-bold text-cream/80">⚾ 直近30日の試合（期日）の戦績</h4>
        <p className="mt-1 text-2xl font-black tabular-nums text-cream">
          {season.wins}勝 {season.losses}敗
        </p>
        <p className="text-[11px] text-cream/55">期日までに終えた案件・ToDoが勝ち、期日を過ぎたものが負けです。</p>
        {season.todaysGames.length > 0 && (
          <p className="mt-1 text-sm font-bold text-cream">本日の試合: {season.todaysGames.join("・")}</p>
        )}
      </div>
    </section>
  );
}

// ━━ 流行り神: 推理ロジック(想定を超えた原因を結ぶ) ━━
export function HayarigamiDeductionPanel() {
  const today = todayStr();
  const records = useLiveQuery(() => db.records.where("date").aboveOrEqual(shiftDateStr(today, -60)).toArray(), [today]);
  const masters = useLiveQuery(() => db.masterTasks.toArray(), []);
  const [causesJson, setCausesJson] = useSetting("hayarigami.causes", "{}");
  const causes = useMemo<Record<string, string>>(() => {
    try {
      return JSON.parse(causesJson) ?? {};
    } catch {
      return {};
    }
  }, [causesJson]);
  const overruns = useMemo(() => findOverruns(records ?? [], masters ?? [], today), [records, masters, today]);
  const unsolved = overruns.filter((o) => !causes[o.record.id]).slice(0, 5);
  const links = useMemo(() => causeLinks(causes, records ?? []), [causes, records]);
  const maxCount = Math.max(1, ...links.map((l) => l.count));
  return (
    <section className="panel space-y-3 p-4" data-testid="hayarigami-deduction">
      <h3 className="font-display text-sm font-bold text-cream">推理ロジック</h3>
      <p className="text-[12px] text-cream/60">想定より長引いた作業の「原因」を結びつけ、よく起きる原因を浮かび上がらせます。</p>
      {unsolved.length === 0 ? (
        <p className="text-sm text-cream/70">未解明の事件はありません。</p>
      ) : (
        <ul className="space-y-2.5">
          {unsolved.map((o) => (
            <li key={o.record.id} className="space-y-1.5 border-l-2 border-alert/60 pl-2.5">
              <p className="text-sm text-cream">
                {o.record.date.slice(5)} {o.record.name}
                <span className="ml-1 text-[11px] text-alert">想定より{o.overMin}分超過</span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {CAUSES.map((c) => (
                  <button
                    key={c}
                    className="rounded border border-cream/25 px-2 py-0.5 text-[11px] text-cream/80 hover:bg-cream/10"
                    onClick={() => setCausesJson(JSON.stringify({ ...causes, [o.record.id]: c }))}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      {links.length > 0 && (
        <div className="space-y-2 border-t border-cream/10 pt-3">
          <h4 className="text-xs font-bold text-cream/80">相関図</h4>
          {links.map((l) => (
            <div key={l.cause} className="space-y-1">
              <div className="flex items-center gap-2 text-sm">
                <span className="w-24 shrink-0 font-bold text-cream">{l.cause}</span>
                <span className="h-2 rounded bg-alert/70" style={{ width: `${(l.count / maxCount) * 60}%` }} />
                <span className="text-[11px] tabular-nums text-cream/60">{l.count}件</span>
              </div>
              <p className="pl-24 text-[11px] text-cream/55">― {l.works.map((w) => `${w.label}(${w.count})`).join("・")}</p>
            </div>
          ))}
          <button className="text-[11px] text-cream/45 underline decoration-dotted" onClick={() => setCausesJson("{}")}>
            推理をやり直す
          </button>
        </div>
      )}
    </section>
  );
}

// ━━ ロボトミー: 収容違反 / 冒険者: クエスト掲示板(どちらも期限を過ぎたToDo) ━━
export function OverdueTodoPanel({ variant }: { variant: "lobotomy" | "adventurer" }) {
  const today = todayStr();
  const todos = useLiveQuery(() => db.todoTasks.toArray(), []);
  const overdue = useMemo(() => overdueTodos(todos ?? [], today), [todos, today]);
  const open = useMemo(
    () => (todos ?? []).filter((t) => !t.completed && !t.parentTaskId && (!t.dueDate || t.dueDate >= today)).slice(0, 5),
    [todos, today]
  );
  if (variant === "lobotomy") {
    if (overdue.length === 0) return null;
    return (
      <section className="panel space-y-2 border-2 border-alert p-4" data-testid="lobotomy-breach">
        <h3 className="flex items-center gap-2 font-display text-sm font-bold text-alert">
          <span className="animate-pulse">⚠</span> 収容違反 {overdue.length}件
        </h3>
        <p className="text-[12px] text-cream/70">期限を過ぎたToDoが収容から逃れています。鎮圧（今日の作業に入れる）してください。</p>
        <ul className="space-y-1.5">
          {overdue.slice(0, 6).map(({ todo, daysOver }) => (
            <li key={todo.id} className="flex items-center gap-2 text-sm">
              <span className="shrink-0 rounded bg-alert/20 px-1.5 text-[11px] font-bold tabular-nums text-alert">+{daysOver}日</span>
              <span className="min-w-0 flex-1 truncate text-cream">{todo.title}</span>
              <button className="btn-pill-outline shrink-0 px-3 py-1 text-xs" onClick={() => addTodoToToday(todo, today)}>
                鎮圧する
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  }
  const quests = [...overdue.map((o) => ({ todo: o.todo, daysOver: o.daysOver })), ...open.map((t) => ({ todo: t, daysOver: 0 }))].slice(0, 8);
  if (quests.length === 0) return null;
  return (
    <section className="panel space-y-2 p-4" data-testid="adventurer-board">
      <h3 className="font-display text-sm font-bold text-cream">📜 クエスト掲示板</h3>
      <p className="text-[12px] text-cream/60">ToDoを受注すると今日の冒険に加わります。期限を過ぎた依頼は、日ごとに魔物が強くなっています。</p>
      <ul className="space-y-1.5">
        {quests.map(({ todo, daysOver }) => (
          <li key={todo.id} className="flex items-center gap-2 text-sm">
            {daysOver > 0 ? (
              <span className="shrink-0 rounded bg-alert/20 px-1.5 text-[11px] font-bold text-alert">Lv+{daysOver}</span>
            ) : (
              <span className="shrink-0 px-1.5 text-[11px] text-cream/50">{todo.dueDate ? todo.dueDate.slice(5) : "期限なし"}</span>
            )}
            <span className="min-w-0 flex-1 truncate text-cream">{todo.title}</span>
            <button className="btn-pill-outline shrink-0 px-3 py-1 text-xs" onClick={() => addTodoToToday(todo, today)}>
              受注する
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ━━ なつやすみ: 月末までの宿題と、絵日記のアルバム ━━
export function NatsuyasumiPanels() {
  const today = todayStr();
  const todos = useLiveQuery(() => db.todoTasks.toArray(), []);
  const records = useLiveQuery(() => db.records.where("date").aboveOrEqual(shiftDateStr(today, -29)).toArray(), [today]);
  const hw = useMemo(() => monthHomework(todos ?? [], today), [todos, today]);
  const album = useMemo(() => diaryAlbum(records ?? [], today), [records, today]);
  const [, m] = today.split("-").map(Number);
  return (
    <>
      <section className="panel space-y-2 p-4" data-testid="natsu-homework">
        <h3 className="font-display text-sm font-bold text-cream">📒 {m}月のしゅくだい</h3>
        <p className="text-sm text-cream/75">
          {m}月{Number(hw.monthEnd.slice(8))}日まで、あと<b className="mx-0.5 text-lg tabular-nums">{hw.daysLeft}</b>日。
          おわった しゅくだい {hw.done.length} / {hw.done.length + hw.open.length}
        </p>
        {hw.open.length === 0 ? (
          <p className="text-sm text-cream/60">今月の しゅくだいは ぜんぶ おわりました。</p>
        ) : (
          <ul className="space-y-1">
            {hw.open.map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[rgb(var(--accent-rgb))]"
                  onChange={() => db.todoTasks.update(t.id, { completed: true, completedAt: Date.now() })}
                  aria-label={`「${t.title}」をおわりにする`}
                />
                <span className="min-w-0 flex-1 truncate text-cream">{t.title}</span>
                <span className="text-[11px] tabular-nums text-cream/55">{t.dueDate!.slice(5).replace("-", "/")}まで</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="panel space-y-2 p-4" data-testid="natsu-album">
        <h3 className="font-display text-sm font-bold text-cream">📷 えにっきの アルバム（30日）</h3>
        <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-6">
          {album.map((d) => (
            <div key={d.date} className={`rounded border p-1 text-center ${d.top ? "border-cream/25 bg-cream/5" : "border-dashed border-cream/15"}`}>
              <p className="text-[10px] tabular-nums text-cream/55">{Number(d.date.slice(8))}日</p>
              <p className="truncate text-[11px] text-cream">{d.top ?? "―"}</p>
              {d.top && <p className="text-[10px] tabular-nums text-cream/50">{d.hours.toFixed(1)}h</p>}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

// ━━ 禅: 一息・今日の一行・石庭 ━━
export function ZenPanels() {
  const today = todayStr();
  const tasks = useLiveQuery(() => db.dailyTasks.where("date").equals(today).toArray(), [today]);
  const [line, setLine] = useDraftSetting(`journal.daily.${today}`, "");
  const [breathing, setBreathing] = useState<number | null>(null);
  useEffect(() => {
    if (breathing === null) return;
    if (breathing <= 0) {
      setBreathing(null);
      return;
    }
    const id = setTimeout(() => setBreathing((b) => (b === null ? null : b - 1)), 1000);
    return () => clearTimeout(id);
  }, [breathing]);
  const stones = (tasks ?? []).filter((t) => t.status === "done" && !t.isProvisional);
  return (
    <section className="space-y-6 py-4 text-center" data-testid="zen-extras">
      {breathing !== null ? (
        <div className="flex flex-col items-center gap-3">
          <div className="zen-breath flex h-32 w-32 items-center justify-center rounded-full border border-cream/30">
            <span className="text-sm text-cream/70">{breathing % 8 < 4 ? "吸う" : "吐く"}</span>
          </div>
          <p className="text-xs tabular-nums text-cream/50">あと {breathing} 秒</p>
          <button className="text-xs text-cream/50 underline decoration-dotted" onClick={() => setBreathing(null)}>
            やめる
          </button>
        </div>
      ) : (
        <button className="text-sm text-cream/70 underline decoration-dotted underline-offset-4" onClick={() => setBreathing(60)}>
          始める前に、一分だけ息を整える
        </button>
      )}

      {/* 石庭: 終えた作業が石になって並ぶ */}
      <div>
        <svg viewBox="0 0 300 70" className="mx-auto w-full max-w-md" role="img" aria-label={`今日終えた作業 ${stones.length}件`}>
          {[14, 26, 38, 50, 62].map((y) => (
            <path key={y} d={`M0 ${y} Q75 ${y - 3} 150 ${y} T300 ${y}`} stroke="rgb(var(--cream-rgb) / 0.12)" fill="none" />
          ))}
          {stones.slice(0, 9).map((t, i) => {
            const x = 30 + ((i * 97) % 240);
            const y = 22 + ((i * 53) % 30);
            const r = 5 + Math.min(9, (t.accumulatedMs ?? 0) / 600_000);
            return (
              <g key={t.id}>
                <ellipse cx={x} cy={y} rx={r + 6} ry={(r + 6) * 0.45} fill="none" stroke="rgb(var(--cream-rgb) / 0.18)" />
                <ellipse cx={x} cy={y} rx={r} ry={r * 0.62} fill="rgb(var(--cream-rgb) / 0.55)" />
              </g>
            );
          })}
        </svg>
        <p className="text-[11px] text-cream/40">{stones.length ? `今日終えたことが ${stones.length} つ、石になりました` : "終えたことは、ここに石として置かれます"}</p>
      </div>

      <div className="mx-auto max-w-md">
        <input
          value={line}
          onChange={(e) => setLine(e.target.value)}
          placeholder="今日の一行"
          aria-label="今日の一行"
          className="w-full border-b border-cream/20 bg-transparent px-1 py-2 text-center text-sm text-cream placeholder:text-cream/30 focus:border-cream/50 focus:outline-none"
        />
      </div>
    </section>
  );
}

// ━━ 図書館: 貸出カウンター(予約・返却期限)と1年の蔵書票 ━━
export function LibraryCounterPanel() {
  const today = todayStr();
  const tasks = useLiveQuery(() => db.dailyTasks.where("date").equals(today).toArray(), [today]);
  const todos = useLiveQuery(() => db.todoTasks.toArray(), []);
  const records = useLiveQuery(() => db.records.where("date").aboveOrEqual(shiftDateStr(today, -400)).toArray(), [today]);
  const reservations = (tasks ?? [])
    .filter((t) => t.scheduledTime && t.status === "pending")
    .sort((a, b) => (a.scheduledTime! < b.scheduledTime! ? -1 : 1));
  const dueSoon = (todos ?? [])
    .filter((t) => !t.completed && !t.parentTaskId && t.dueDate && t.dueDate <= shiftDateStr(today, 7))
    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1))
    .slice(0, 8);
  const card = useMemo(() => yearCard(records ?? [], today), [records, today]);
  const max = Math.max(1, ...card.months.map((x) => x.hours));
  return (
    <>
      <section className="panel space-y-3 p-4" data-testid="library-counter">
        <h3 className="font-display text-sm font-bold text-cream">貸出カウンター</h3>
        <div>
          <h4 className="text-xs font-bold text-cream/75">本日の予約</h4>
          {reservations.length === 0 ? (
            <p className="text-xs text-cream/50">予約はありません</p>
          ) : (
            <ul className="mt-1 space-y-0.5 text-sm">
              {reservations.map((t) => (
                <li key={t.id} className="flex gap-2">
                  <span className="tabular-nums text-cream/60">{t.scheduledTime}</span>
                  <span className="truncate text-cream">{t.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h4 className="text-xs font-bold text-cream/75">返却期限票（7日以内）</h4>
          {dueSoon.length === 0 ? (
            <p className="text-xs text-cream/50">期限の近い本はありません</p>
          ) : (
            <ul className="mt-1 space-y-0.5 text-sm">
              {dueSoon.map((t) => (
                <li key={t.id} className="flex gap-2">
                  <span className={`tabular-nums ${t.dueDate! < today ? "font-bold text-alert" : "text-cream/60"}`}>
                    {t.dueDate!.slice(5).replace("-", "/")}
                    {t.dueDate! < today ? " 延滞" : ""}
                  </span>
                  <span className="truncate text-cream">{t.title}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <section className="panel space-y-2 p-4" data-testid="library-yearcard">
        <h3 className="font-display text-sm font-bold text-cream">蔵書票 ― この1年の貸出記録</h3>
        <p className="text-sm text-cream/75">
          {card.titles}種の本を、のべ {card.totalHours.toFixed(1)} 時間ひもときました。
        </p>
        <div className="flex h-20 items-end gap-1">
          {card.months.map((x) => (
            <div key={x.ym} className="flex flex-1 flex-col items-center gap-0.5">
              <div className="w-full rounded-t bg-cream/40" style={{ height: `${(x.hours / max) * 64}px` }} title={`${x.ym} ${x.hours.toFixed(1)}h`} />
              <span className="text-[9px] tabular-nums text-cream/50">{Number(x.ym.slice(5))}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

// ━━ ハブ: 今の時刻線と時間割の枠 ━━
export function HubTimelineStrip() {
  const today = todayStr();
  const now = useNow();
  const tasks = useLiveQuery(() => db.dailyTasks.where("date").equals(today).toArray(), [today]);
  const startH = 6;
  const endH = 24;
  const dayStart = hmToMs(today, `${String(startH).padStart(2, "0")}:00`)!;
  const span = (endH - startH) * 3600_000;
  const pos = (ms: number) => Math.min(100, Math.max(0, ((ms - dayStart) / span) * 100));
  const boxes = (tasks ?? []).flatMap((t) => {
    if (!t.scheduledTime || !t.timeboxEnd) return [];
    const s = hmToMs(today, t.scheduledTime);
    const e = hmToMs(today, t.timeboxEnd);
    return s !== null && e !== null && e > s ? [{ id: t.id, s, e, name: t.name }] : [];
  });
  const segs = (tasks ?? []).flatMap((t) => t.segments.map((s, i) => ({ id: `${t.id}-${i}`, s: s.start, e: s.end ?? now })));
  return (
    <section className="panel p-3" data-testid="hub-timeline">
      <div className="relative h-10">
        {boxes.map((b) => (
          <div
            key={b.id}
            className="absolute top-0 h-5 overflow-hidden rounded border border-[rgb(var(--accent-rgb)/0.6)] bg-[rgb(var(--accent-rgb)/0.12)] px-1 text-[9px] leading-5 text-cream"
            style={{ left: `${pos(b.s)}%`, width: `${Math.max(1, pos(b.e) - pos(b.s))}%` }}
            title={`時間割 ${hm(b.s)}〜${hm(b.e)} ${b.name}`}
          >
            {b.name}
          </div>
        ))}
        {segs.map((g) => (
          <div key={g.id} className="absolute top-6 h-2 rounded-sm bg-cream/50" style={{ left: `${pos(g.s)}%`, width: `${Math.max(0.4, pos(g.e) - pos(g.s))}%` }} />
        ))}
        <div className="absolute -top-1 bottom-0 w-0.5 bg-alert" style={{ left: `${pos(now)}%` }} aria-label={`今 ${hm(now)}`} />
      </div>
      <div className="mt-1 flex justify-between text-[9px] tabular-nums text-cream/45">
        {[6, 9, 12, 15, 18, 21, 24].map((h) => (
          <span key={h}>{h}</span>
        ))}
      </div>
      <p className="text-[10px] text-cream/45">上の枠が時間割、下の線が実際に計測した時間、赤い線が今です。</p>
    </section>
  );
}
