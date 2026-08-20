"use client";

import { useState } from "react";
import type { BreakRange } from "@/lib/types";
import Modal from "@/components/ui/Modal";

// 強制ストップ付きの休憩帯に入った際に表示する、チェックリスト付きの休憩案内。
// チェック状態はこの休憩のたびに新しく確認できればよく、後から見返す必要はないため
// 永続化はせずローカルstateのみで保持する
export default function BreakChecklistDialog({ range, onClose }: { range: BreakRange; onClose: () => void }) {
  const items = range.checklist ?? [];
  const [checked, setChecked] = useState<Record<number, boolean>>({});

  return (
    <Modal title="☕ 休憩の時間です" onClose={onClose}>
      <p className="mb-3 text-sm text-cream/70">
        {range.start}〜{range.end} は休憩時間です。計測中だった作業は一時停止しました。
      </p>
      {items.length > 0 ? (
        <div className="space-y-2">
          {items.map((item, i) => (
            <label key={i} className="flex items-center gap-2 rounded-lg bg-ink/50 px-3 py-2 text-sm text-cream">
              <input
                type="checkbox"
                checked={!!checked[i]}
                onChange={(e) => setChecked((c) => ({ ...c, [i]: e.target.checked }))}
                className="h-4 w-4 shrink-0 rounded border-cream/30 bg-ink accent-cream"
              />
              <span className={checked[i] ? "text-cream/40 line-through" : ""}>{item}</span>
            </label>
          ))}
        </div>
      ) : (
        <p className="text-sm text-cream/50">少し休憩しましょう。</p>
      )}
      <button className="btn-pill mt-4 w-full text-sm" onClick={onClose}>
        閉じる
      </button>
    </Modal>
  );
}
