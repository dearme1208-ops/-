"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useSetting } from "@/lib/settings";
import { todayStr, formatHms } from "@/lib/time";
import { computeDailyChallenges, type ChallengeResult } from "@/lib/dailyChallenges";
import { fireConfetti } from "@/lib/confetti";
import { showUndoToast } from "@/lib/toast";

// 毎朝(日付が変わるたびに)8種類のチャレンジテンプレートから3件を決定的に選び、
// その日の作業データから進捗を計算して表示する。どの演出テーマの「本日」画面にも
// 同じ見た目のまま置けるよう、必要なデータは自前でクエリする自己完結コンポーネントにしている
export default function DailyChallengePanel() {
  const date = todayStr();
  const tasks = useLiveQuery(() => db.dailyTasks.where("date").equals(date).toArray(), [date]);
  const todoTasks = useLiveQuery(() => db.todoTasks.toArray(), []);
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const [journal] = useSetting(`journal.daily.${date}`, "");
  const [collapsed, setCollapsed] = useState(false);

  const todoCompletedToday = useMemo(
    () => (todoTasks ?? []).filter((t) => t.completedAt && todayStr(new Date(t.completedAt)) === date).length,
    [todoTasks, date]
  );
  const projectCompletedToday = useMemo(
    () => (projects ?? []).filter((p) => p.completedAt && todayStr(new Date(p.completedAt)) === date).length,
    [projects, date]
  );

  const challenges: ChallengeResult[] = useMemo(() => {
    if (!tasks) return [];
    return computeDailyChallenges(date, {
      tasks,
      todoCompletedToday,
      projectCompletedToday,
      journalNonEmpty: journal.trim().length > 0,
    });
  }, [tasks, todoCompletedToday, projectCompletedToday, journal, date]);

  // マウント時点で既に達成済みだったものは「たった今達成した」扱いにしない
  // (タブを開き直すたびに紙吹雪が出るのを防ぐ)。以後、未達成→達成に切り替わった
  // ものだけを祝う。日付が変わったらリセットする
  const celebratedRef = useRef<{ date: string; ids: Set<string> } | null>(null);
  // 達成したチャレンジは自動的に一覧から消す。マウント時点で既に達成済みのものは
  // 最初から表示せず、その場で達成したものだけ、少し見せてから消す(消える瞬間が
  // 分からないと「急に消えた」ように見えてしまうため)
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set());
  const dismissTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const DISMISS_DELAY_MS = 1800;

  useEffect(() => {
    if (challenges.length === 0) return;
    if (!celebratedRef.current || celebratedRef.current.date !== date) {
      celebratedRef.current = { date, ids: new Set(challenges.filter((c) => c.done).map((c) => c.id)) };
      setDismissedIds(new Set(challenges.filter((c) => c.done).map((c) => c.id)));
      return;
    }
    for (const c of challenges) {
      if (c.done && !celebratedRef.current.ids.has(c.id)) {
        celebratedRef.current.ids.add(c.id);
        fireConfetti();
        showUndoToast(`🎉 デイリーチャレンジ達成「${c.title}」`);
        const id = c.id;
        dismissTimersRef.current.push(
          setTimeout(() => setDismissedIds((prev) => new Set(prev).add(id)), DISMISS_DELAY_MS)
        );
      }
    }
  }, [challenges, date]);

  useEffect(() => {
    return () => {
      for (const timer of dismissTimersRef.current) clearTimeout(timer);
    };
  }, []);

  if (challenges.length === 0) return null;

  const clearedCount = challenges.filter((c) => c.done).length;
  const visibleChallenges = challenges.filter((c) => !dismissedIds.has(c.id));

  function progressLabel(c: ChallengeResult): string {
    if (c.unit === "seconds") return `${formatHms(c.progress)} / ${formatHms(c.target)}`;
    return `${c.progress} / ${c.target}件`;
  }

  return (
    <div className="panel space-y-2 p-4">
      <button className="flex w-full items-center justify-between text-left" onClick={() => setCollapsed((v) => !v)}>
        <h3 className="font-display text-sm font-bold text-cream/80">
          🎲 デイリーチャレンジ <span className="text-xs font-normal text-cream/50">({clearedCount}/{challenges.length})</span>
        </h3>
        <span className="text-cream/60">{collapsed ? "▶" : "▼"}</span>
      </button>
      {!collapsed &&
        (visibleChallenges.length === 0 ? (
          <p className="text-sm text-cream/60">🎉 今日のデイリーチャレンジをすべて達成しました！</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-3">
            {visibleChallenges.map((c) => (
              <div
                key={c.id}
                className={`rounded-lg border px-3 py-2 ${c.done ? "border-alert/40 bg-alert/10" : "border-cream/10 bg-ink/40"}`}
              >
                <div className="flex items-center gap-1.5 text-sm">
                  <span>{c.done ? "✅" : c.icon}</span>
                  <span className={`font-bold ${c.done ? "text-alert" : "text-cream"}`}>{c.title}</span>
                </div>
                <p className="mt-0.5 text-xs text-cream/50">{c.description}</p>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-cream/10">
                  <div
                    className={`h-full rounded-full ${c.done ? "bg-alert" : "bg-cream/50"}`}
                    style={{ width: `${Math.min(100, (c.progress / c.target) * 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-right text-[10px] tabular-nums text-cream/40">{progressLabel(c)}</p>
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}
