"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import { findOrCreateMasterTask } from "@/lib/master";
import { useSetting } from "@/lib/settings";
import { computeRemainingEstimatedSeconds } from "@/lib/tasks";
import { formatClock, formatHms, parseHmsToSeconds } from "@/lib/time";
import type { DailyTask, MasterTask } from "@/lib/types";
import Modal from "@/components/ui/Modal";
import MasterTaskPicker from "@/components/sections/MasterTaskPicker";
import VoiceInputButton from "@/components/ui/VoiceInputButton";

// 作業の追加画面の作り。設定でどれを使うか選べる。
//  tabs   … マスタ/自由入力をタブで切り替える(従来どおり)
//  menu   … 最初に「どこから追加するか」を選び、その先が専用の画面になる
//  single … マスタの一覧も自由入力も1枚に載せる
// どの作り方でも、追加そのものの扱い(予定の有無・残り想定時間の繰り越し・
// 仮計測との衝突・自由入力時のマスタ作成)は共通の処理を通る
export type AddTaskStyle = "tabs" | "menu" | "single";

export function normalizeAddTaskStyle(value: string): AddTaskStyle {
  return value === "menu" || value === "single" ? value : "tabs";
}

export default function AddTaskDialog({
  date,
  provisionalRunning,
  lastStopTime,
  onRequestConflictStart,
  onAdded,
  onClose,
}: {
  date: string;
  provisionalRunning: boolean;
  lastStopTime?: number | null;
  onRequestConflictStart: (category: string, name: string, estimatedSeconds: number, masterTaskId: string | undefined) => void;
  // 実際に追加できた時に、その作業が実行中("running")・未着手("pending")のどちらとして
  // 追加されたかを渡す(未計測との競合で呼び出し元に処理を委ねた場合は呼ばれない。
  // その場合はrequestStartNew側で別途「実行中」への切り替えが行われる)
  onAdded?: (status: "running" | "pending") => void;
  onClose: () => void;
}) {
  const [styleStr] = useSetting("today.addTaskStyle", "tabs");
  const style = normalizeAddTaskStyle(styleStr);

  const [mode, setMode] = useState<"master" | "free">("master");
  // メニュー型のときに今どの画面にいるか
  const [pane, setPane] = useState<"menu" | "master" | "favorite" | "free">("menu");
  const [selectedMaster, setSelectedMaster] = useState<MasterTask | null>(null);
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [estimate, setEstimate] = useState("00:10:00");
  // 登録時点では実際の所要時間が読めないことが多いため、既定では「予定」を設定しない
  // （目安に近い「予測」はマスタの平均値から別途ガントチャートに自動表示される）。
  // チェックした場合のみ、この作業に「予定」を設定する
  const [setPlan, setSetPlan] = useState(false);

  // お気に入りはメニュー型でしか使わないので、それ以外のときは引きに行かない
  const favorites = useLiveQuery<MasterTask[]>(
    () =>
      style === "menu"
        ? db.masterTasks.filter((m) => !!m.isFavorite && !m.archived).toArray()
        : Promise.resolve([] as MasterTask[]),
    [style]
  );

  async function insertTask(
    taskCategory: string,
    taskName: string,
    estimatedSeconds: number,
    masterTaskId: string | undefined,
    startAt: number | undefined,
    hasPlan: boolean
  ) {
    // 未計測(仮計測)が既に計測中の状態ですぐ開始しようとした場合、二重計測になって
    // しまうため、ここでは追加せず、呼び出し元（本日タブ）に判断を委ねる
    if (startAt !== undefined && provisionalRunning) {
      onRequestConflictStart(taskCategory, taskName, estimatedSeconds, masterTaskId);
      onClose();
      return;
    }
    const count = (await db.dailyTasks.where("date").equals(date).toArray()).length;
    const task: DailyTask = {
      id: uid(),
      date,
      order: count,
      masterTaskId,
      category: taskCategory,
      name: taskName,
      estimatedSeconds: hasPlan ? estimatedSeconds : 0,
      hasPlan,
      status: startAt !== undefined ? "running" : "pending",
      segments: startAt !== undefined ? [{ start: startAt }] : [],
      accumulatedMs: 0,
      startedAt: startAt,
      isSpontaneous: true,
    };
    await db.dailyTasks.add(task);
    onAdded?.(startAt !== undefined ? "running" : "pending");
    onClose();
  }

  async function submitMasterTask(master: MasterTask, startAt: number | undefined) {
    // 同日中に同じ大項目・詳細作業名の作業が既にあれば、残りの想定時間を繰り越す
    const estimatedSeconds = setPlan
      ? await computeRemainingEstimatedSeconds(date, master.category, master.name, master.estimatedSeconds)
      : 0;
    await insertTask(master.category, master.name, estimatedSeconds, master.id, startAt, setPlan);
  }

  async function submitMaster(startAt: number | undefined) {
    if (!selectedMaster) return;
    await submitMasterTask(selectedMaster, startAt);
  }

  async function submitFreeform(startAt: number | undefined) {
    if (!category.trim() || !name.trim()) return;
    const estimatedSeconds = setPlan ? parseHmsToSeconds(estimate) : 0;
    const master = await findOrCreateMasterTask(category, name, estimatedSeconds);
    await insertTask(category.trim(), name.trim(), estimatedSeconds, master.id, startAt, setPlan);
  }

  // 「追加のみ / (前の作業の終了時刻)から開始 / 追加してすぐ開始」の3つ。
  // どの作り方でも同じ選択肢を出したいので、ここにまとめている
  function Actions({
    submit,
    disabled,
    stacked,
  }: {
    submit: (startAt: number | undefined) => void;
    disabled?: boolean;
    /** 縦積みにする(1枚型・メニュー型のように横幅が足りない場面向け) */
    stacked?: boolean;
  }) {
    const wide = stacked ? " w-full" : "";
    const start = (
      <button key="start" className={`btn-pill text-sm${wide}`} onClick={() => submit(Date.now())} disabled={disabled}>
        追加してすぐ開始
      </button>
    );
    const fromLastStop = lastStopTime != null && (
      <button
        key="from"
        className={`btn-pill-outline text-sm${wide}`}
        onClick={() => submit(lastStopTime)}
        disabled={disabled}
        title="前の作業が終了/一時停止した時刻から、この作業が始まっていたことにします"
      >
        {formatClock(lastStopTime)}から開始
      </button>
    );
    const addOnly = (
      <button key="only" className={`btn-pill-outline text-sm${wide}`} onClick={() => submit(undefined)} disabled={disabled}>
        追加のみ
      </button>
    );
    // 横並びのときは右端が主ボタンになる従来の並び、縦積みのときは上から主ボタンの順にする
    return (
      <div className={`mt-4 flex gap-2 ${stacked ? "flex-col" : "flex-wrap justify-end"}`}>
        {stacked ? [start, fromLastStop, addOnly] : [addOnly, fromLastStop, start]}
      </div>
    );
  }

  // 但し書きはチェックの右へ流し込むと縦に3行へ折り返して読みにくいので、行を分ける
  const planCheckbox = (
    <div className="mb-3">
      <label className="flex items-center gap-1.5 text-xs text-cream/60">
        <input
          type="checkbox"
          checked={setPlan}
          onChange={(e) => setSetPlan(e.target.checked)}
          className="h-4 w-4 shrink-0 rounded border-cream/30 bg-ink accent-cream"
        />
        この作業の「予定」を設定する
      </label>
      <p className="mt-1 text-[11px] leading-relaxed text-cream/40">
        登録時点では読めないことが多いためオフが既定です。マスタの平均から出る「予測」は別途表示されます。
      </p>
    </div>
  );

  const estimateField = setPlan && (
    <div>
      <label className="mb-1 block text-xs text-cream/60">想定時間（予定）</label>
      <input
        placeholder="hh:mm:ss"
        value={estimate}
        onChange={(e) => setEstimate(e.target.value)}
        className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
      />
    </div>
  );

  const freeFields = (
    <div className="space-y-2">
      <div>
        <label className="mb-1 block text-xs text-cream/60">業務区分（大項目）</label>
        <input
          placeholder="例: 資料作成"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-cream/60">詳細作業名</label>
        <div className="flex items-center gap-2">
          <input
            placeholder="例: 見積書の作成"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
          />
          <VoiceInputButton onResult={(text) => setName((v) => (v ? `${v} ${text}` : text))} />
        </div>
      </div>
      {estimateField}
    </div>
  );

  // ------------------------------------------------------------
  // メニュー型
  // ------------------------------------------------------------
  if (style === "menu") {
    return (
      <Modal title="突発作業を追加" onClose={onClose}>
        {pane === "menu" && (
          <div className="space-y-2">
            <p className="text-xs text-cream/50">どこから追加しますか</p>
            <button className="btn-pill w-full text-sm" onClick={() => setPane("master")}>
              作業マスタから選ぶ
            </button>
            <button className="btn-pill w-full text-sm" onClick={() => setPane("favorite")}>
              お気に入りから選ぶ
            </button>
            <button className="btn-pill w-full text-sm" onClick={() => setPane("free")}>
              自由入力する
            </button>
            <button className="btn-pill-outline w-full text-sm" onClick={onClose}>
              閉じる
            </button>
          </div>
        )}

        {pane === "master" && (
          <div>
            {planCheckbox}
            <MasterTaskPicker selectedId={selectedMaster?.id} onSelect={setSelectedMaster} />
            <Actions submit={submitMaster} disabled={!selectedMaster} stacked />
            <button className="btn-pill-outline mt-2 w-full text-sm" onClick={() => setPane("menu")}>
              戻る
            </button>
          </div>
        )}

        {pane === "favorite" && (
          <div>
            {planCheckbox}
            <div className="space-y-1.5">
              {favorites === undefined ? null : favorites.length === 0 ? (
                <p className="text-xs text-cream/50">お気に入りに登録された作業はまだありません。</p>
              ) : (
                favorites.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setSelectedMaster(m)}
                    className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left ${
                      selectedMaster?.id === m.id ? "border-cream bg-cream/10" : "border-cream/15 bg-ink"
                    }`}
                  >
                    <span className="text-alert">★</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[10px] text-cream/45">{m.category}</span>
                      <span className="block truncate text-xs font-bold text-cream/85">{m.name}</span>
                    </span>
                    <span className="shrink-0 text-[10px] tabular-nums text-cream/40">{formatHms(m.estimatedSeconds)}</span>
                  </button>
                ))
              )}
            </div>
            <Actions submit={submitMaster} disabled={!selectedMaster} stacked />
            <button className="btn-pill-outline mt-2 w-full text-sm" onClick={() => setPane("menu")}>
              戻る
            </button>
          </div>
        )}

        {pane === "free" && (
          <div>
            {planCheckbox}
            {freeFields}
            <Actions submit={submitFreeform} disabled={!category.trim() || !name.trim()} stacked />
            <button className="btn-pill-outline mt-2 w-full text-sm" onClick={() => setPane("menu")}>
              戻る
            </button>
          </div>
        )}
      </Modal>
    );
  }

  // ------------------------------------------------------------
  // 1枚型
  // ------------------------------------------------------------
  if (style === "single") {
    return (
      <Modal title="突発作業を追加" onClose={onClose}>
        {planCheckbox}
        <MasterTaskPicker selectedId={selectedMaster?.id} onSelect={setSelectedMaster} />
        <Actions submit={submitMaster} disabled={!selectedMaster} stacked />
        <div className="mt-4 space-y-2 border-t border-cream/10 pt-3">
          <p className="text-xs text-cream/50">マスタに無い作業は、ここに直接書いて追加できます</p>
          <div className="flex gap-1.5">
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="業務区分"
              className="min-w-0 flex-1 rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-xs text-cream"
            />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="詳細作業名"
              className="min-w-0 flex-1 rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-xs text-cream"
            />
            <button
              className="btn-pill-outline shrink-0 text-xs"
              disabled={!category.trim() || !name.trim()}
              onClick={() => submitFreeform(undefined)}
              title="この内容で追加します（計測は始めません）"
            >
              追加
            </button>
          </div>
          {estimateField}
        </div>
      </Modal>
    );
  }

  // ------------------------------------------------------------
  // タブ型(従来)
  // ------------------------------------------------------------
  return (
    <Modal title="突発作業を追加" onClose={onClose}>
      <div className="mb-3 flex gap-2">
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
      </div>

      {planCheckbox}

      {mode === "master" ? (
        <div className="space-y-2">
          <MasterTaskPicker selectedId={selectedMaster?.id} onSelect={setSelectedMaster} />
          <Actions submit={submitMaster} disabled={!selectedMaster} />
        </div>
      ) : (
        <div className="space-y-2">
          {freeFields}
          <Actions submit={submitFreeform} disabled={!category.trim() || !name.trim()} />
        </div>
      )}
    </Modal>
  );
}
