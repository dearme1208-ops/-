"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { parseBreakRanges } from "@/lib/breaks";
import { useSetting } from "@/lib/settings";
import { formatDateJp, shiftDateStr } from "@/lib/time";
import { hmToMin, layoutTimeboxes, minToHm } from "@/lib/timebox";
import { useWorkContext } from "@/lib/useWorkContext";
import type { DailyTask } from "@/lib/types";
import Modal from "@/components/ui/Modal";
import PromptCopyButton from "@/components/ai/PromptCopyButton";
import UpdateImporter from "@/components/ai/UpdateImporter";
import { loadTimeboxRequest } from "@/components/ai/aiData";
import { timeboxPrompt } from "@/lib/aiPrompts";

// タイムボックス(時間割)を作る。「全部急ぎ」で全部を気にしている時間は、何も進めていないのと同じ。
// 作業ごとに時間の枠を先に決めておき、枠の間はその1つだけ、時間が来たら途中でも止める。
// 決めた枠は作業の予定時刻(scheduledTime)と枠の終わり(timeboxEnd)として保存し、
// 枠の始まりで自動的に開始、終わりで「時間です」と知らせる(TodaySection)

const LENGTH_PRESETS = [15, 25, 45, 60];

function defaultMinutes(t: DailyTask): number {
  // 予定時間があればそれを5分単位に丸める(短すぎ・長すぎは集中の枠として扱いにくいので10〜90分に収める)
  if (t.hasPlan !== false && t.estimatedSeconds > 0) {
    return Math.min(90, Math.max(10, Math.round(t.estimatedSeconds / 60 / 5) * 5));
  }
  return 25;
}

function nextFiveMinutes(now: Date): string {
  const min = now.getHours() * 60 + now.getMinutes();
  return minToHm(Math.ceil((min + 1) / 5) * 5);
}

export default function TimeboxModal({ today, onClose }: { today: string; onClose: () => void }) {
  const workLabel = useWorkContext().label;
  const [target, setTarget] = useState<"today" | "tomorrow">(() => (new Date().getHours() >= 15 ? "tomorrow" : "today"));
  const date = target === "today" ? today : shiftDateStr(today, 1);
  const tasks = useLiveQuery(() => db.dailyTasks.where("date").equals(date).sortBy("order"), [date]);
  const [standardWorkStart] = useSetting("today.standardWorkStart", "08:00");
  const [breakRangesStr] = useSetting("today.provisionalBreakRanges", "[]");
  const breaks = useMemo(() => parseBreakRanges(breakRangesStr), [breakRangesStr]);
  const [gapStr, setGapStr] = useSetting("today.timeboxGapMinutes", "5");
  const gap = Math.max(0, Math.min(30, Number(gapStr) || 0));

  const candidates = useMemo(
    () => (tasks ?? []).filter((t) => !t.isProvisional && (t.status === "pending" || t.status === "paused")),
    [tasks]
  );
  const [startHm, setStartHm] = useState("");
  const [order, setOrder] = useState<string[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [minutes, setMinutes] = useState<Record<string, number>>({});

  // 対象の日を切り替えたら、その日の作業で選び直す。すでに時間割がある作業はその枠を初期値にする。
  // 切り替えた直後は前の日の作業が残っていることがあるので、読み込みがその日のものになってから行う
  const loadedKey = tasks && tasks.every((t) => t.date === date) ? `${date}:${candidates.map((t) => t.id).join(",")}` : null;
  useEffect(() => {
    if (!tasks || loadedKey === null) return;
    const withBox = candidates.filter((t) => t.scheduledTime && t.timeboxEnd);
    const sorted = [
      ...withBox.sort((a, b) => (hmToMin(a.scheduledTime!) ?? 0) - (hmToMin(b.scheduledTime!) ?? 0)),
      ...candidates.filter((t) => !withBox.includes(t)),
    ];
    setOrder(sorted.map((t) => t.id));
    setChosen(new Set((withBox.length > 0 ? withBox : candidates).map((t) => t.id)));
    setMinutes(
      Object.fromEntries(
        candidates.map((t) => {
          const s = t.scheduledTime ? hmToMin(t.scheduledTime) : null;
          const e = t.timeboxEnd ? hmToMin(t.timeboxEnd) : null;
          return [t.id, s !== null && e !== null && e > s ? e - s : defaultMinutes(t)];
        })
      )
    );
    setStartHm(withBox[0]?.scheduledTime ?? (target === "today" ? nextFiveMinutes(new Date()) : standardWorkStart));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedKey]);

  const byId = useMemo(() => new Map(candidates.map((t) => [t.id, t])), [candidates]);
  const ordered = order.map((id) => byId.get(id)).filter((t): t is DailyTask => !!t);
  const slots = useMemo(
    () =>
      layoutTimeboxes(
        ordered.filter((t) => chosen.has(t.id)).map((t) => ({ id: t.id, minutes: minutes[t.id] ?? 25 })),
        startHm || "09:00",
        gap,
        breaks
      ),
    [ordered, chosen, minutes, startHm, gap, breaks]
  );
  const slotById = new Map(slots.map((s) => [s.id, s]));
  const hasExisting = candidates.some((t) => t.timeboxEnd);

  function move(id: string, delta: number) {
    setOrder((prev) => {
      const i = prev.indexOf(id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function apply() {
    await db.transaction("rw", db.dailyTasks, async () => {
      for (const t of candidates) {
        const slot = slotById.get(t.id);
        if (slot) {
          // もう終わった時刻の枠は、決めた直後にまとめて自動開始されないよう「開始済みの知らせ」扱いにする
          const endMs = new Date(`${date}T00:00:00`).getTime() + (hmToMin(slot.end) ?? 0) * 60000;
          await db.dailyTasks.update(t.id, {
            scheduledTime: slot.start,
            timeboxEnd: slot.end,
            timeboxEndHandled: false,
            autoStartNotified: endMs <= Date.now(),
            autoStartDisabled: false,
          });
        } else if (t.timeboxEnd) {
          // 時間割から外した作業は、枠と自動開始の時刻を外す
          await db.dailyTasks.update(t.id, { scheduledTime: undefined, timeboxEnd: undefined, timeboxEndHandled: undefined });
        }
      }
      // 作業リストの並びも時間割の順にそろえる
      const rest = (tasks ?? []).filter((t) => !slotById.has(t.id)).sort((a, b) => a.order - b.order);
      const sequence = [...slots.map((s) => s.id), ...rest.map((t) => t.id)];
      for (let i = 0; i < sequence.length; i++) await db.dailyTasks.update(sequence[i], { order: i });
    });
    onClose();
  }

  async function clearAll() {
    if (!confirm(`${formatDateJp(date)}の時間割を外しますか?(作業そのものは残ります)`)) return;
    await db.transaction("rw", db.dailyTasks, async () => {
      for (const t of candidates) {
        if (t.timeboxEnd) await db.dailyTasks.update(t.id, { scheduledTime: undefined, timeboxEnd: undefined, timeboxEndHandled: undefined });
      }
    });
    onClose();
  }

  return (
    <Modal title="⏱ 時間割を作る（タイムボックス）" onClose={onClose}>
      <div className="space-y-3">
        <p className="rounded-lg border border-cream/15 bg-cream/5 p-2 text-xs leading-relaxed text-cream/75">
          全部を気にしている時間は、何も進めていないのと同じ。作業ごとに時間を先に決めて、その枠の間は1つだけ。
          <b className="text-cream">時間が来たら、途中でも止めて次へ。</b>枠の始まりで自動的に計測を始め、終わりで知らせます。
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {(["today", "tomorrow"] as const).map((k) => (
            <button key={k} className={target === k ? "btn-pill text-xs" : "btn-pill-outline text-xs"} onClick={() => setTarget(k)}>
              {k === "today" ? "今日" : "明日"}（{formatDateJp(k === "today" ? today : shiftDateStr(today, 1))}）
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3 text-xs text-cream/70">
          <label className="flex flex-col gap-1">
            始める時刻
            <input
              type="time"
              value={startHm}
              onChange={(e) => setStartHm(e.target.value)}
              className="rounded-lg border border-cream/20 bg-ink px-2 py-1 text-sm text-cream"
              aria-label="始める時刻"
            />
          </label>
          <label className="flex flex-col gap-1">
            枠の間の小休止
            <select
              value={String(gap)}
              onChange={(e) => setGapStr(e.target.value)}
              className="rounded-lg border border-cream/20 bg-ink px-2 py-1 text-sm text-cream"
            >
              {[0, 5, 10, 15].map((g) => (
                <option key={g} value={g}>
                  {g === 0 ? "なし" : `${g}分`}
                </option>
              ))}
            </select>
          </label>
          {breaks.length > 0 && <span className="text-[10px] text-cream/45">休憩帯（{breaks.map((b) => `${b.start}〜${b.end}`).join("・")}）は避けます</span>}
        </div>

        {candidates.length === 0 ? (
          <p className="text-sm text-cream/50">
            {formatDateJp(date)}の未着手の作業がありません。{target === "tomorrow" ? "先に「明日の下書き」で明日の作業を入れてください。" : "先に作業を追加してください。"}
          </p>
        ) : (
          <div className="max-h-[50vh] space-y-1.5 overflow-y-auto">
            {ordered.map((t, i) => {
              const slot = slotById.get(t.id);
              const on = chosen.has(t.id);
              return (
                <div
                  key={t.id}
                  className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${on ? "border-cream/25 bg-cream/5" : "border-cream/10 opacity-50"}`}
                  data-testid="timebox-item"
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setChosen((prev) => {
                        const next = new Set(prev);
                        if (next.has(t.id)) next.delete(t.id);
                        else next.add(t.id);
                        return next;
                      })
                    }
                    aria-label={`「${t.name}」を時間割に入れる`}
                    className="h-4 w-4 shrink-0 accent-cream"
                  />
                  <span className="w-[88px] shrink-0 text-xs font-bold tabular-nums text-cream">
                    {slot ? `${slot.start}〜${slot.end}` : "―"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-cream/85">{workLabel(t)}</span>
                  <select
                    value={String(minutes[t.id] ?? 25)}
                    onChange={(e) => setMinutes((prev) => ({ ...prev, [t.id]: Number(e.target.value) }))}
                    className="shrink-0 rounded border border-cream/20 bg-ink px-1 py-0.5 text-xs text-cream"
                    aria-label={`「${t.name}」の枠の長さ`}
                    disabled={!on}
                  >
                    {[...new Set([...LENGTH_PRESETS, 10, 20, 30, 40, 50, 90, minutes[t.id] ?? 25])]
                      .sort((a, b) => a - b)
                      .map((m) => (
                        <option key={m} value={m}>
                          {m}分
                        </option>
                      ))}
                  </select>
                  <span className="flex shrink-0 flex-col">
                    <button className="px-1 text-[10px] leading-none text-cream/50 hover:text-cream disabled:opacity-20" onClick={() => move(t.id, -1)} disabled={i === 0} aria-label="前へ">
                      ▲
                    </button>
                    <button
                      className="px-1 text-[10px] leading-none text-cream/50 hover:text-cream disabled:opacity-20"
                      onClick={() => move(t.id, 1)}
                      disabled={i === ordered.length - 1}
                      aria-label="後へ"
                    >
                      ▼
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {slots.length > 0 && (
          <p className="text-xs text-cream/60">
            {slots.length}枠・{slots[0].start}〜{slots[slots.length - 1].end}
          </p>
        )}

        {candidates.length > 0 && (
          // 自分で並べる代わりに、期日・進み具合・過去の所要時間を見てClaudeに組んでもらう
          <details className="rounded-lg border border-cream/15 p-2" data-testid="timebox-ai">
            <summary className="cursor-pointer text-xs font-bold text-cream/80">🤖 Claudeに組んでもらう</summary>
            <div className="mt-2 space-y-2">
              <p className="text-[11px] leading-relaxed text-cream/60">
                {formatDateJp(date)}の作業・期日・進み具合・過去の所要時間・休憩帯を依頼文にまとめてコピーします。Claudeとの会話に貼り、返ってきた答えを下に貼り付けてください。
              </p>
              <PromptCopyButton
                label={`依頼文をコピー（${formatDateJp(date)}）`}
                fileName={`koutei-prompt-timebox-${date}.txt`}
                build={async () => timeboxPrompt(await loadTimeboxRequest(date))}
              />
              <UpdateImporter placeholder="Claudeの答え（planTimebox を含むJSON）をここに貼り付け" />
            </div>
          </details>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          {hasExisting && (
            <button className="btn-pill-outline mr-auto text-xs" onClick={clearAll}>
              時間割を外す
            </button>
          )}
          <button className="btn-pill-outline text-sm" onClick={onClose}>
            キャンセル
          </button>
          <button className="btn-pill text-sm" onClick={apply} disabled={slots.length === 0}>
            この時間割で決める
          </button>
        </div>
      </div>
    </Modal>
  );
}
