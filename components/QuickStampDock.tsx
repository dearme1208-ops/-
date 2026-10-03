"use client";

import { useCallback, useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { addQuickStamp } from "@/lib/quickStamp";
import { requestTodayAction, type TodayAction } from "@/lib/todayActions";
import { useSetting } from "@/lib/settings";
import { todayStr } from "@/lib/time";
import type { QuickStamp } from "@/lib/types";
import Modal from "@/components/ui/Modal";
import { QuickStampPanel, QuickStampSheet } from "@/components/sections/today/QuickStamp";

// 📍打刻を、本日の作業を独自の画面に差し替える演出テーマ(禅・山・ハブなど)の「今日」でも
// 押せるようにする、画面右下の小さなボタン。本日の作業には下部タブの左に打刻ボタンがあるが、
// 差し替えるモードでは打刻できなかった。未記録の打刻はここから一覧を開いて実績にできる
const TOOLS: { kind: TodayAction; icon: string; label: string }[] = [
  { kind: "add", icon: "+", label: "突発作業を追加" },
  { kind: "trouble", icon: "⚡", label: "トラブル発生" },
  { kind: "dayPlan", icon: "🧭", label: "今日の段取り" },
  { kind: "timebox", icon: "⏱", label: "時間割" },
  { kind: "tomorrow", icon: "🗓", label: "明日の下書き" },
  { kind: "reflection", icon: "🌙", label: "終業の振り返り" },
];

// 本日の作業を独自の画面に差し替えるモードでは、本日の作業にある操作(突発作業・トラブル・
// 段取り・時間割・明日の下書き・振り返り)が出てこなかった。裏で動いている本日の作業へ
// 合図を送って同じダイアログを開く「道具」ボタンを、打刻ボタンの横に置く。呼び名はモードに合わせる
export default function QuickStampDock({ toolsLabel = "道具" }: { toolsLabel?: string }) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const [enabledStr] = useSetting("today.quickStampButton", "true");
  const [justStamped, setJustStamped] = useState<QuickStamp | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const date = todayStr(new Date(now));
  const pending = useLiveQuery(
    () => db.quickStamps.where("date").equals(date).filter((s) => !s.recordId && !s.skipped).count(),
    [date]
  );
  const closeSheet = useCallback(() => setJustStamped(null), []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // ホーム画面ショートカット(/?stamp=1)。本日の作業が開いていない時はこちらで受ける
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("stamp") !== "1") return;
    window.history.replaceState({}, "", window.location.pathname);
    addQuickStamp().then(setJustStamped);
  }, []);

  const stampEnabled = enabledStr === "true";

  return (
    <>
      <div
        className="fixed bottom-4 right-3 z-[45] flex flex-col items-end gap-1.5"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
        data-testid="quick-stamp-dock"
      >
        {justStamped && (
          <div className="w-[min(22rem,calc(100vw-1.5rem))]">
            <QuickStampSheet key={justStamped.id} stamp={justStamped} onClose={closeSheet} />
          </div>
        )}
        {!!pending && !justStamped && (
          <button
            className="panel px-2.5 py-1 text-[11px] font-bold text-cream shadow-lg backdrop-blur"
            onClick={() => setListOpen(true)}
          >
            未記録の打刻 {pending}
          </button>
        )}
        {toolsOpen && (
          <div className="panel grid w-56 gap-1 p-1.5 shadow-lg backdrop-blur" role="menu" aria-label={toolsLabel}>
            {TOOLS.map((t) => (
              <button
                key={t.kind}
                role="menuitem"
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-cream hover:bg-cream/10"
                onClick={() => {
                  setToolsOpen(false);
                  requestTodayAction(t.kind);
                }}
              >
                <span className="w-5 text-center">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <button
            className="panel flex h-11 w-11 flex-col items-center justify-center rounded-full text-[10px] font-bold leading-tight text-cream shadow-lg backdrop-blur active:scale-95"
            onClick={() => setToolsOpen((v) => !v)}
            aria-expanded={toolsOpen}
            aria-label={toolsLabel}
          >
            <span className="text-sm leading-none">🧰</span>
            {toolsLabel}
          </button>
          {stampEnabled && (
            <button
              className="panel flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-full border-2 border-[rgb(var(--accent-rgb)/0.7)] text-[11px] font-bold leading-tight text-cream shadow-lg backdrop-blur active:scale-95"
              onClick={async () => setJustStamped(await addQuickStamp())}
              aria-label="打刻(今の時刻を残す)"
              title="今の時刻を残します。何をしていたかは後で記録に変えられます"
            >
              <span className="text-base leading-none">📍</span>
              打刻
            </button>
          )}
        </div>
      </div>
      {listOpen && (
        <Modal title="📍 今日の打刻" onClose={() => setListOpen(false)}>
          <QuickStampPanel date={date} now={now} />
        </Modal>
      )}
    </>
  );
}
