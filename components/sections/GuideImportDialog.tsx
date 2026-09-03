"use client";

import { useMemo, useState } from "react";
import Modal from "@/components/ui/Modal";
import { parseGuideText, createTasksFromGuide } from "@/lib/guideImport";
import type { TodoList } from "@/lib/types";

// 攻略サイト等のテキストを貼り付けてToDoに一括変換するダイアログ。
// 「見出し行(タブ区切り) → ・箇条書き → ┗補足」という、攻略チャートで
// よく見る並びをその場で解析してプレビューし、確認してから取り込む
export default function GuideImportDialog({
  lists,
  defaultListId,
  onClose,
  onImported,
}: {
  lists: TodoList[];
  defaultListId?: string;
  onClose: () => void;
  onImported: (count: number) => void;
}) {
  const [text, setText] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [listId, setListId] = useState(defaultListId ?? lists[0]?.id ?? "");
  const [importing, setImporting] = useState(false);

  const parsed = useMemo(() => parseGuideText(text), [text]);
  const subtaskCount = parsed.reduce((sum, t) => sum + t.subtasks.length, 0);

  async function handleImport() {
    if (parsed.length === 0 || !listId) return;
    setImporting(true);
    try {
      const count = await createTasksFromGuide(parsed, listId, sourceLabel.trim());
      onImported(count);
    } finally {
      setImporting(false);
    }
  }

  return (
    <Modal title="📋 ガイドを貼り付けてインポート" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-cream/60">
          攻略サイト等の「見出し＋・箇条書き」形式のテキストをコピーして貼り付けると、見出しをタスク、箇条書きをサブタスクとして一括登録します。
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="ここにテキストを貼り付け"
          rows={8}
          className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-xs text-cream"
        />
        <div className="flex flex-wrap gap-2">
          <select
            value={listId}
            onChange={(e) => setListId(e.target.value)}
            className="flex-1 rounded-lg border border-cream/20 bg-ink px-2 py-2 text-sm text-cream"
          >
            {lists.length === 0 && <option value="">（リストがありません）</option>}
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title}
              </option>
            ))}
          </select>
          <input
            value={sourceLabel}
            onChange={(e) => setSourceLabel(e.target.value)}
            placeholder="出典メモ（任意。例: game8.jp）"
            className="flex-1 rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
          />
        </div>

        {parsed.length > 0 && (
          <div className="max-h-64 overflow-y-auto rounded-lg border border-cream/20 bg-ink p-3 text-xs">
            <p className="mb-2 text-cream/60">
              プレビュー: タスク{parsed.length}件・サブタスク{subtaskCount}件
            </p>
            <ul className="space-y-2">
              {parsed.map((t, i) => (
                <li key={i}>
                  <p className="font-bold text-cream">{t.title}</p>
                  {t.subtasks.length > 0 && (
                    <ul className="ml-3 list-disc space-y-0.5 text-cream/70">
                      {t.subtasks.map((s, j) => (
                        <li key={j}>{s}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-pill-outline text-sm" onClick={onClose}>
            キャンセル
          </button>
          <button
            className="btn-pill text-sm"
            disabled={parsed.length === 0 || !listId || importing}
            onClick={handleImport}
          >
            {importing ? "インポート中…" : `${parsed.length}件のタスクを取り込む`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
