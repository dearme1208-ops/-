"use client";

import { useCallback, useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { addQuickStamp } from "@/lib/quickStamp";
import { useSetting } from "@/lib/settings";
import { todayStr } from "@/lib/time";
import type { QuickStamp } from "@/lib/types";
import Modal from "@/components/ui/Modal";
import { QuickStampPanel, QuickStampSheet } from "@/components/sections/today/QuickStamp";

// 📍打刻を、本日の作業を独自の画面に差し替える演出テーマ(禅・山・ハブなど)の「今日」でも
// 押せるようにする、画面右下の小さなボタン。本日の作業には下部タブの左に打刻ボタンがあるが、
// 差し替えるモードでは打刻できなかった。未記録の打刻はここから一覧を開いて実績にできる
export default function QuickStampDock() {
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

  if (enabledStr !== "true") return null;

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
        <button
          className="panel flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-full border-2 border-[rgb(var(--accent-rgb)/0.7)] text-[11px] font-bold leading-tight text-cream shadow-lg backdrop-blur active:scale-95"
          onClick={async () => setJustStamped(await addQuickStamp())}
          aria-label="打刻(今の時刻を残す)"
          title="今の時刻を残します。何をしていたかは後で記録に変えられます"
        >
          <span className="text-base leading-none">📍</span>
          打刻
        </button>
      </div>
      {listOpen && (
        <Modal title="📍 今日の打刻" onClose={() => setListOpen(false)}>
          <QuickStampPanel date={date} now={now} />
        </Modal>
      )}
    </>
  );
}
