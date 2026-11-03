"use client";

import { useState } from "react";
import { findOrCreateMasterTask } from "@/lib/master";
import { segmentsAccumulatedMs } from "@/lib/tasks";
import { formatClock, formatHms, formatMsClock, parseHmsToSeconds } from "@/lib/time";
import { clockOnDate, closedSegmentsMs, defaultSplitAt, splitSegmentsAt } from "@/lib/provisionalSplit";
import type { DailyTask, MasterTask } from "@/lib/types";
import MasterTaskPicker from "@/components/sections/MasterTaskPicker";
import { useWorkContext } from "@/lib/useWorkContext";

type Mode = "today" | "done" | "favorite" | "master" | "free" | "split";

/** 仮計測の時間の割り当て先 */
export type ProvisionalTarget =
  | { kind: "existing"; taskId: string }
  | { kind: "new"; category: string; name: string; estimatedSeconds: number; masterTaskId?: string; hasPlan: boolean; isTrouble?: boolean };

/** 途中で区切った後半の扱い */
export type ProvisionalSecondHalf =
  | { mode: "continue"; target: ProvisionalTarget }
  | { mode: "finish"; target: ProvisionalTarget }
  | { mode: "provisional" };

const targetKey = (t: ProvisionalTarget | null) =>
  !t ? "" : t.kind === "existing" ? `task:${t.taskId}` : `new:${t.masterTaskId ?? `${t.category}::${t.name}`}`;

export default function ProvisionalTaskCard({
  task,
  now,
  candidateTasks,
  completedTasks,
  favorites,
  onAssignExisting,
  onAssignNew,
  onFinishAsIs,
  onRecordAs,
  onSplit,
}: {
  task: DailyTask;
  now: number;
  candidateTasks: DailyTask[];
  completedTasks: DailyTask[];
  favorites: MasterTask[];
  onAssignExisting: (targetId: string) => void | Promise<void>;
  onAssignNew: (
    category: string,
    name: string,
    estimatedSeconds: number,
    masterTaskId: string | undefined,
    hasPlan: boolean,
    isTrouble?: boolean
  ) => void | Promise<void>;
  onFinishAsIs: () => void | Promise<void>;
  /** 仮計測の時間をその作業の時間として記録し、計測をやめる(完了した作業に付ける時など) */
  onRecordAs: (target: ProvisionalTarget) => void | Promise<void>;
  /** 途中の時刻で区切り、前半と後半を別々の作業に割り当てる */
  onSplit: (splitAt: number, first: ProvisionalTarget, second: ProvisionalSecondHalf) => void | Promise<void>;
}) {
  const workCtx = useWorkContext();
  const [mode, setMode] = useState<Mode>(
    candidateTasks.length > 0 ? "today" : completedTasks.length > 0 ? "done" : favorites.length > 0 ? "favorite" : "master"
  );
  const [selectedMaster, setSelectedMaster] = useState<MasterTask | null>(null);
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [estimate, setEstimate] = useState("00:10:00");
  // 突発作業の追加と同様、既定では「予定」を設定しない。チェックした場合のみ設定する
  const [setPlan, setSetPlan] = useState(false);

  const elapsedMs = segmentsAccumulatedMs(task, now);

  async function confirmMaster() {
    if (!selectedMaster) return;
    await onAssignNew(
      selectedMaster.category,
      selectedMaster.name,
      selectedMaster.estimatedSeconds,
      selectedMaster.id,
      setPlan
    );
  }

  async function confirmFree() {
    if (!category.trim() || !name.trim()) return;
    const estimatedSeconds = parseHmsToSeconds(estimate);
    const master = await findOrCreateMasterTask(category.trim(), name.trim(), estimatedSeconds);
    await onAssignNew(category.trim(), name.trim(), estimatedSeconds, master.id, setPlan);
  }

  // この未計測時間を「トラブル対応」として確定する(想定時間なし、予定なしで即確定)
  async function assignTrouble() {
    await onAssignNew("トラブル対応", `トラブル ${formatClock(now)}`, 0, undefined, false, true);
  }

  return (
    <div className="panel border-2 border-alert bg-alert/[0.06] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-1 text-xs font-bold text-alert">
            <span className="h-2 w-2 animate-pulse rounded-full bg-alert" />
            仮計測中（未割り当て）
          </div>
          <div className="font-display text-base font-bold">{task.name}</div>
          {task.startedAt && (
            <div className="text-xs text-cream/50">{formatClock(task.startedAt)} から未計測が続いています</div>
          )}
        </div>
        <div className="font-display text-2xl font-bold tabular-nums text-alert">{formatMsClock(elapsedMs)}</div>
      </div>

      <div className="mt-3 border-t border-cream/10 pt-3">
        <p className="mb-2 text-xs text-cream/60">この時間をどの作業に割り当てますか？</p>
        <div className="mb-2 flex flex-wrap gap-2">
          {candidateTasks.length > 0 && (
            <button
              className={mode === "today" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
              onClick={() => setMode("today")}
            >
              本日の作業から選択
            </button>
          )}
          {completedTasks.length > 0 && (
            <button
              className={mode === "done" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
              onClick={() => setMode("done")}
            >
              ✅ 完了した作業から
            </button>
          )}
          {favorites.length > 0 && (
            <button
              className={mode === "favorite" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
              onClick={() => setMode("favorite")}
            >
              ★ お気に入りから選択
            </button>
          )}
          <button
            className={mode === "master" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setMode("master")}
          >
            マスタから選択
          </button>
          <button
            className={mode === "free" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setMode("free")}
          >
            自由入力
          </button>
          <button
            className={mode === "split" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setMode("split")}
            title="「◯時◯分までは〇〇、そこからは△△」のように、途中で区切って2つの作業に分ける"
          >
            ✂ 途中で区切る
          </button>
          <button
            className="btn-pill-outline border-alert text-xs text-alert hover:bg-alert/10"
            onClick={assignTrouble}
          >
            🚨 トラブル対応として割り当てる
          </button>
        </div>

        {mode === "today" && (
          <div className="space-y-1.5">
            {candidateTasks.map((t) => (
              <button
                key={t.id}
                onClick={() => onAssignExisting(t.id)}
                className="block w-full rounded-lg bg-ink/60 px-3 py-2 text-left text-sm text-cream hover:bg-ink"
              >
                <span className="text-cream/50">{t.category}</span> {workCtx.label(t)}
                <span className="ml-2 text-xs text-cream/40">{t.status === "paused" ? "（一時停止中）" : "（未着手）"}</span>
              </button>
            ))}
          </div>
        )}

        {mode === "done" && (
          <div className="space-y-1.5" data-testid="provisional-done-list">
            <p className="text-[11px] text-cream/50">
              「記録」はこの{formatMsClock(elapsedMs)}をその作業の時間として付けて計測をやめます。「再開」はその作業としてこのまま計り続けます。
            </p>
            {completedTasks.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-ink/60 px-3 py-2 text-sm text-cream">
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-cream/50">{t.category}</span> {workCtx.label(t)}
                </span>
                <button className="btn-pill text-xs" onClick={() => onRecordAs({ kind: "existing", taskId: t.id })}>
                  記録して終える
                </button>
                <button className="btn-pill-outline text-xs" onClick={() => onAssignExisting(t.id)}>
                  再開して続ける
                </button>
              </div>
            ))}
          </div>
        )}

        {mode === "split" && (
          <SplitPanel
            task={task}
            now={now}
            candidateTasks={candidateTasks}
            completedTasks={completedTasks}
            favorites={favorites}
            onSplit={onSplit}
          />
        )}

        {(mode === "master" || mode === "free") && (
          <label className="mb-2 flex items-center gap-1.5 text-xs text-cream/60">
            <input
              type="checkbox"
              checked={setPlan}
              onChange={(e) => setSetPlan(e.target.checked)}
              className="h-4 w-4 rounded border-cream/30 bg-ink accent-cream"
            />
            この作業の「予定」を設定する
            <span className="text-cream/40">（未計測分の割り当てのためオフが既定です）</span>
          </label>
        )}

        {mode === "favorite" && (
          <div className="flex flex-wrap gap-2">
            {favorites.length === 0 && <p className="text-xs text-cream/50">お気に入りに登録された作業がありません。</p>}
            {favorites.map((f) => (
              <button
                key={f.id}
                onClick={() => onAssignNew(f.category, f.name, f.estimatedSeconds, f.id, false)}
                className="rounded-full border border-cream/30 bg-ink px-3 py-1.5 text-sm text-cream hover:bg-cream/10"
              >
                ★ {f.category} / {f.name}
              </button>
            ))}
          </div>
        )}

        {mode === "master" && (
          <div className="space-y-2">
            <MasterTaskPicker selectedId={selectedMaster?.id} onSelect={setSelectedMaster} />
            <div className="flex justify-end">
              <button className="btn-pill text-sm" onClick={confirmMaster} disabled={!selectedMaster}>
                この作業に割り当てる
              </button>
            </div>
          </div>
        )}

        {mode === "free" && (
          <div className="space-y-2">
            <input
              placeholder="業務区分（大項目）"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
            />
            <input
              placeholder="詳細作業名"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
            />
            {setPlan && (
              <input
                placeholder="想定時間 hh:mm:ss"
                value={estimate}
                onChange={(e) => setEstimate(e.target.value)}
                className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
              />
            )}
            <div className="flex justify-end">
              <button className="btn-pill text-sm" onClick={confirmFree} disabled={!category.trim() || !name.trim()}>
                この作業に割り当てる
              </button>
            </div>
          </div>
        )}

        <div className="mt-3 flex justify-end border-t border-cream/10 pt-3">
          <button className="btn-pill-outline text-xs" onClick={onFinishAsIs}>
            割り当てずに終了
          </button>
        </div>
      </div>
    </div>
  );
}

/** 割り当て先を1つ選ぶ一覧(本日の作業・完了した作業・お気に入り・マスタ) */
function TargetPicker({
  candidateTasks,
  completedTasks,
  favorites,
  value,
  onChange,
  testId,
}: {
  candidateTasks: DailyTask[];
  completedTasks: DailyTask[];
  favorites: MasterTask[];
  value: ProvisionalTarget | null;
  onChange: (t: ProvisionalTarget) => void;
  testId: string;
}) {
  const workCtx = useWorkContext();
  const [showMaster, setShowMaster] = useState(false);
  const selected = targetKey(value);
  const chip = (key: string, label: React.ReactNode, onClick: () => void, sub?: string) => (
    <button
      key={key}
      onClick={onClick}
      aria-pressed={selected === key}
      className={`rounded-full border px-3 py-1 text-xs ${selected === key ? "border-cream bg-cream/20 font-bold text-cream" : "border-cream/25 text-cream/80 hover:bg-cream/10"}`}
    >
      {label}
      {sub && <span className="ml-1 text-[10px] text-cream/45">{sub}</span>}
    </button>
  );
  const fromMaster = (m: MasterTask): ProvisionalTarget => ({ kind: "new", category: m.category, name: m.name, estimatedSeconds: m.estimatedSeconds, masterTaskId: m.id, hasPlan: false });
  return (
    <div className="space-y-1.5" data-testid={testId}>
      {candidateTasks.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {candidateTasks.map((t) => chip(`task:${t.id}`, workCtx.label(t), () => onChange({ kind: "existing", taskId: t.id }), t.status === "paused" ? "一時停止中" : "未着手"))}
        </div>
      )}
      {completedTasks.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {completedTasks.map((t) => chip(`task:${t.id}`, `✅ ${workCtx.label(t)}`, () => onChange({ kind: "existing", taskId: t.id }), "完了"))}
        </div>
      )}
      {favorites.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {favorites.map((f) => chip(targetKey(fromMaster(f)), `★ ${f.name}`, () => onChange(fromMaster(f))))}
        </div>
      )}
      <button className="text-[11px] text-cream/55 underline" onClick={() => setShowMaster((v) => !v)}>
        {showMaster ? "▲ マスタを閉じる" : "▼ マスタから探す"}
      </button>
      {showMaster && (
        <MasterTaskPicker selectedId={value?.kind === "new" ? value.masterTaskId : undefined} onSelect={(m) => onChange(fromMaster(m))} />
      )}
      {value?.kind === "new" && <p className="text-[11px] text-cream/60">選択中: {value.category} / {value.name}</p>}
    </div>
  );
}

/** 「◯時◯分までは〇〇、そこからは△△」と、仮計測を途中で区切って割り当てる */
function SplitPanel({
  task,
  now,
  candidateTasks,
  completedTasks,
  favorites,
  onSplit,
}: {
  task: DailyTask;
  now: number;
  candidateTasks: DailyTask[];
  completedTasks: DailyTask[];
  favorites: MasterTask[];
  onSplit: (splitAt: number, first: ProvisionalTarget, second: ProvisionalSecondHalf) => void | Promise<void>;
}) {
  const start = task.segments[0]?.start ?? task.startedAt ?? now;
  const [hm, setHm] = useState(() => formatClock(defaultSplitAt(start, now)));
  const [first, setFirst] = useState<ProvisionalTarget | null>(null);
  const [secondMode, setSecondMode] = useState<ProvisionalSecondHalf["mode"]>("continue");
  const [second, setSecond] = useState<ProvisionalTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const splitAt = clockOnDate(task.date, hm);
  const inRange = Number.isFinite(splitAt) && splitAt > start && splitAt < now;
  const { before, after } = splitSegmentsAt(task.segments, inRange ? splitAt : start);
  const firstMs = closedSegmentsMs(before);
  const secondMs = closedSegmentsMs(after) + after.filter((s) => s.end === undefined).reduce((sum, s) => sum + (now - s.start), 0);
  const ready = inRange && !!first && (secondMode === "provisional" || !!second);
  const pickerProps = { candidateTasks, completedTasks, favorites };
  return (
    <div className="space-y-3 rounded-lg border border-cream/15 p-3" data-testid="provisional-split">
      <label className="flex flex-wrap items-center gap-2 text-sm text-cream">
        区切る時刻
        <input
          type="time"
          value={hm}
          onChange={(e) => setHm(e.target.value)}
          className="rounded-lg border border-cream/20 bg-ink px-2 py-1 text-cream"
          aria-label="区切る時刻"
        />
        <span className="text-[11px] text-cream/50">
          （{formatClock(start)}〜{formatClock(now)}の間）
        </span>
      </label>
      {!inRange && <p className="text-xs text-alert">{formatClock(start)}より後、今({formatClock(now)})より前の時刻にしてください。</p>}

      <div className="space-y-1.5">
        <p className="text-xs font-bold text-cream/85">
          前半 {formatClock(start)}〜{hm}
          {inRange && <span className="ml-1 font-normal text-cream/55">（{formatHms(Math.round(firstMs / 1000))}）</span>}
          <span className="ml-1 font-normal text-cream/55">は…</span>
        </p>
        <TargetPicker {...pickerProps} value={first} onChange={setFirst} testId="split-first" />
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-bold text-cream/85">
          後半 {hm}〜今
          {inRange && <span className="ml-1 font-normal text-cream/55">（{formatHms(Math.round(secondMs / 1000))}）</span>}
          <span className="ml-1 font-normal text-cream/55">は…</span>
        </p>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["continue", "この作業で計測を続ける"],
              ["finish", "今で終えて記録する"],
              ["provisional", "未割り当てのまま続ける"],
            ] as const
          ).map(([m, label]) => (
            <button key={m} className={secondMode === m ? "btn-pill text-xs" : "btn-pill-outline text-xs"} onClick={() => setSecondMode(m)}>
              {label}
            </button>
          ))}
        </div>
        {secondMode !== "provisional" && <TargetPicker {...pickerProps} value={second} onChange={setSecond} testId="split-second" />}
      </div>

      <div className="flex justify-end">
        <button
          className="btn-pill text-sm"
          disabled={!ready || busy}
          onClick={async () => {
            if (!ready || !first) return;
            setBusy(true);
            try {
              await onSplit(splitAt, first, secondMode === "provisional" ? { mode: "provisional" } : { mode: secondMode, target: second! });
            } finally {
              setBusy(false);
            }
          }}
        >
          {hm}で区切って割り当てる
        </button>
      </div>
    </div>
  );
}
