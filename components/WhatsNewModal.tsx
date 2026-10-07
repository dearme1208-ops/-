"use client";

import { useSetting, useSettingLoaded } from "@/lib/settings";
import { openQuickCapture } from "@/lib/quickCapture";
import { openHistory, openSearch } from "@/lib/globalPanels";
import { requestTodayAction } from "@/lib/todayActions";
import Modal from "@/components/ui/Modal";

// 更新で増えた機能を、1回だけ短く知らせる。気づかれないまま使われない機能を減らすため。
// 「試す」を押せばその場で開ける。中身を変えたら WHATS_NEW_VERSION を上げる
export const WHATS_NEW_VERSION = "2026-10-07";

const ITEMS: { icon: string; title: string; body: string; action?: () => void }[] = [
  { icon: "✏️", title: "ひとこと入力", body: "思いついたことを1行で。ToDo・今やる・予定・メモ・案件へ振り分けます(キーボードの / でも)。", action: () => openQuickCapture() },
  { icon: "🔍", title: "さがす", body: "ToDo・案件・これまでの実績・メモをまとめて探せます(Ctrl+K でも)。", action: () => openSearch() },
  { icon: "🧩", title: "今日の抜けを埋める", body: "今日のリングの点線が記録のない時間です。押すと、その時間にした作業を選んで埋められます。", action: () => requestTodayAction("dayGaps") },
  { icon: "⏪", title: "少し前に終わってた", body: "計測中のカードから、5/10/15分前や打刻の時刻で終えられます(終了の長押しでも)。" },
  { icon: "↩", title: "完了・削除を元に戻す", body: "完了のお知らせから戻せます。「🕘 操作の履歴」からは、あとからでも戻せます。", action: () => openHistory() },
  { icon: "⏩", title: "ToDoの期日をワンタップで", body: "ToDoの行の ⏩ から、今日・明日・来週月曜・期日なしへ動かせます。" },
  { icon: "🔠", title: "文字の大きさ", body: "設定の「文字の大きさ」で、ぎっしり〜特大を選べます。" },
];

export default function WhatsNewModal() {
  const loaded = useSettingLoaded("ui.whatsNewSeen");
  const [seen, setSeen] = useSetting("ui.whatsNewSeen", "");
  if (!loaded || seen === WHATS_NEW_VERSION) return null;
  const close = () => setSeen(WHATS_NEW_VERSION);
  return (
    <Modal title="✨ 新しくできること" onClose={close}>
      <ul className="space-y-2" data-testid="whats-new">
        {ITEMS.map((it) => (
          <li key={it.title} className="flex items-start gap-3 rounded-lg border border-cream/10 p-2.5">
            <span className="w-6 shrink-0 text-center text-lg leading-6">{it.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-cream">{it.title}</div>
              <div className="text-xs leading-relaxed text-cream/65">{it.body}</div>
            </div>
            {it.action && (
              <button
                className="btn-pill-outline shrink-0 px-3 py-1 text-xs"
                onClick={() => {
                  close();
                  it.action!();
                }}
              >
                試す
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex justify-end">
        <button className="btn-pill text-sm" onClick={close}>
          わかった
        </button>
      </div>
    </Modal>
  );
}
