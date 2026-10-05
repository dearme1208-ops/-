"use client";

import { useState } from "react";
import { downloadTextFile } from "@/lib/report";
import { notesToTodoPrompt, progressPrompt, timeboxPrompt } from "@/lib/aiPrompts";
import { shiftDateStr, todayStr } from "@/lib/time";
import Modal from "@/components/ui/Modal";
import PromptCopyButton from "@/components/ai/PromptCopyButton";
import UpdateImporter from "@/components/ai/UpdateImporter";
import LifeContextSelect from "@/components/ai/LifeContextSelect";
import { copyText, loadSnapshot, loadSpec, loadTimeboxRequest } from "@/components/ai/aiData";
import { snapshotToPlainList } from "@/lib/plainList";

// 別のAI(Claudeなど)に案件・ToDoの進捗の登録や時間割づくりを頼むための画面。
// ①依頼文(頼み方+データ)をワンタップでコピーしてClaudeに貼る ②返ってきた更新を確認して反映する。
// 仕様書と現状のJSONを個別に渡したい場合のために、それぞれのダウンロード/コピーも残す

export default function ProgressSyncModal({ onClose }: { onClose: () => void }) {
  const [message, setMessage] = useState("");
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const plainList = async () => snapshotToPlainList(await loadSnapshot({ includeCompleted }), { includeCompleted });
  const today = todayStr();
  const tomorrow = shiftDateStr(today, 1);
  const snapshotText = async () => JSON.stringify(await loadSnapshot(), null, 2);

  return (
    <Modal title="🤖 AIと進捗をやり取り" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p className="text-xs leading-relaxed text-cream/70">
          ① 頼みたいことのボタンで依頼文をコピーし、Claudeとの会話に貼り付けます（仕様と今の案件・ToDoが入っています）。
          ② Claudeが返した答えを下に貼り付け、確認してから反映します。書かれた操作以外には触れず、反映後も取り消せます。
        </p>

        <section className="space-y-2 rounded-lg border border-cream/15 p-3" data-testid="plain-list">
          <h4 className="text-xs font-bold text-cream/80">📋 今の案件・ToDoをそのまま渡す</h4>
          <p className="text-[11px] leading-relaxed text-cream/60">
            頼みごとや仕様は付けず、登録してある案件・ToDo（段階・サブタスク・期日・対応状況・メモ）を読みやすい一覧にするだけです。
            AIとの会話に貼って、整理や相談の材料にしてください。アプリのデータは何も変わりません。
          </p>
          <label className="flex items-center gap-1.5 text-xs text-cream/75">
            <input
              type="checkbox"
              checked={includeCompleted}
              onChange={(e) => setIncludeCompleted(e.target.checked)}
              className="h-4 w-4 accent-cream"
            />
            完了済みの案件・ToDoも含める（未完了の後ろに、完了日の新しい順で並べます）
          </label>
          <div className="flex flex-wrap items-start gap-2">
            <PromptCopyButton
              label="📋 一覧をコピー"
              className="btn-pill text-xs"
              fileName={`koutei-list-${today}.md`}
              build={plainList}
            />
            <button
              className="btn-pill-outline text-xs"
              onClick={async () => downloadTextFile(`koutei-list-${today}${includeCompleted ? "-all" : ""}.md`, await plainList())}
            >
              ⬇ 一覧を保存（.md）
            </button>
          </div>
        </section>

        <section className="space-y-2">
          <h4 className="text-xs font-bold text-cream/80">① 依頼文をコピーしてClaudeに貼る</h4>
          <div className="grid gap-2">
            <PromptCopyButton
              label="📈 進捗を登録してもらう"
              fileName={`koutei-prompt-progress-${today}.txt`}
              build={async () => progressPrompt(await loadSpec(), await loadSnapshot())}
            />
            <PromptCopyButton
              label="📝 議事録・メールからToDoにしてもらう"
              fileName={`koutei-prompt-notes-${today}.txt`}
              build={async () => notesToTodoPrompt(await loadSpec(), await loadSnapshot())}
            />
            <LifeContextSelect />
            <div className="flex flex-wrap gap-2">
              <PromptCopyButton
                label="⏱ 今日の時間割を組んでもらう"
                fileName={`koutei-prompt-timebox-${today}.txt`}
                build={async () => timeboxPrompt(await loadTimeboxRequest(today))}
              />
              <PromptCopyButton
                label="⏱ 明日の時間割を組んでもらう"
                fileName={`koutei-prompt-timebox-${tomorrow}.txt`}
                build={async () => timeboxPrompt(await loadTimeboxRequest(tomorrow))}
              />
            </div>
          </div>
        </section>

        <section className="space-y-2">
          <h4 className="text-xs font-bold text-cream/80">② Claudeの答えを取り込む</h4>
          <UpdateImporter />
        </section>

        <details className="rounded-lg border border-cream/10 p-2">
          <summary className="cursor-pointer text-xs text-cream/60">仕様書・現状のデータを個別に渡す</summary>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              className="btn-pill-outline text-xs"
              onClick={async () => {
                try {
                  downloadTextFile("koutei-ai-progress-spec.md", await loadSpec());
                } catch {
                  setMessage("仕様書を読み込めませんでした。通信できる状態でもう一度お試しください。");
                }
              }}
            >
              📄 仕様書（.md）をダウンロード
            </button>
            <button
              className="btn-pill-outline text-xs"
              onClick={async () => {
                try {
                  setMessage((await copyText(await loadSpec())) ? "仕様書をコピーしました。" : "コピーできませんでした。ダウンロードをお使いください。");
                } catch {
                  setMessage("仕様書を読み込めませんでした。");
                }
              }}
            >
              仕様書をコピー
            </button>
            <button className="btn-pill-outline text-xs" onClick={async () => downloadTextFile(`koutei-snapshot-${today}.json`, await snapshotText())}>
              ⬇ 現状を書き出す（.json）
            </button>
            <button
              className="btn-pill-outline text-xs"
              onClick={async () => setMessage((await copyText(await snapshotText())) ? "現状をコピーしました。" : "コピーできませんでした。書き出しをお使いください。")}
            >
              現状をコピー
            </button>
          </div>
          {message && (
            <p className="mt-2 text-xs text-cream/70" role="status">
              {message}
            </p>
          )}
        </details>
      </div>
    </Modal>
  );
}
