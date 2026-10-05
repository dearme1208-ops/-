"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { pauseDailyTask, segmentsAccumulatedMs } from "@/lib/tasks";
import { formatMsClock, todayStr } from "@/lib/time";
import { useWorkContext } from "@/lib/useWorkContext";

// 「今日」を独自の画面に差し替えるモード(図書館・パワプロ・登山など)で、計測中の作業を
// 画面の左下に小さく出し続ける。絵や集計が大きいモードでは、スマホだと計測中の作業が画面の
// 下の方にあり、スクロールしないと「何を計っているか・何分経ったか」が見えず、止めることもできなかった。
// 画面に計測中の作業の表示(data-running-card)が見えている間は、重複するので隠す。
// 押すとその表示までスクロールし、⏸で一時停止できる(完了はモードごとの演出があるので各画面で行う)

export default function RunningNowPill() {
  const date = todayStr();
  const running = useLiveQuery(
    () => db.dailyTasks.where("date").equals(date).filter((t) => t.status === "running" && !t.isProvisional).first(),
    [date]
  );
  const workCtx = useWorkContext();
  const [now, setNow] = useState(() => Date.now());
  const [cardVisible, setCardVisible] = useState(false);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  // 計測中の作業の表示が画面に入っているかを見張る。モードの画面は切り替えで中身が入れ替わる
  // ので、要素の出入りも追いかける
  useEffect(() => {
    if (!running) return;
    const visible = new Set<Element>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) visible.add(e.target);
        else visible.delete(e.target);
      }
      setCardVisible(visible.size > 0);
    });
    const observed = new Set<Element>();
    const scan = () => {
      const cards = document.querySelectorAll("[data-running-card]");
      for (const el of cards) {
        if (observed.has(el)) continue;
        observed.add(el);
        io.observe(el);
      }
      for (const el of [...observed]) {
        if (el.isConnected) continue;
        observed.delete(el);
        visible.delete(el);
        io.unobserve(el);
      }
      setCardVisible(visible.size > 0);
    };
    scan();
    const mo = new MutationObserver(scan);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      io.disconnect();
    };
  }, [running]);

  if (!running || cardVisible) return null;

  return (
    <div
      className="fixed bottom-4 left-3 z-[44] flex max-w-[calc(100vw-9.5rem)] items-center gap-1 rounded-full border border-[rgb(var(--accent-rgb)/0.55)] bg-[rgb(var(--panel-rgb)/0.92)] py-1 pl-3 pr-1 text-cream shadow-lg backdrop-blur toast-in"
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      data-testid="running-now-pill"
    >
      <button
        className="flex min-w-0 items-center gap-2 py-1 text-left"
        onClick={() => document.querySelector("[data-running-card]")?.scrollIntoView({ behavior: "smooth", block: "center" })}
        aria-label={`計測中: ${workCtx.label(running)}`}
      >
        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[rgb(var(--accent-rgb))]" aria-hidden="true" />
        <span className="min-w-0 truncate text-xs font-bold">{workCtx.label(running)}</span>
        <span className="shrink-0 text-xs tabular-nums text-cream/75">{formatMsClock(segmentsAccumulatedMs(running, now))}</span>
      </button>
      <button
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm hover:bg-cream/10"
        onClick={() => pauseDailyTask(running, Date.now())}
        aria-label="一時停止"
        title="一時停止"
      >
        ⏸
      </button>
    </div>
  );
}
