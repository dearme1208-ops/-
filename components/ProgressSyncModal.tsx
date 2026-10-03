"use client";

import { useRef, useState } from "react";
import { db } from "@/lib/db";
import { downloadTextFile } from "@/lib/report";
import { applyProgressPlan, buildSnapshot, planProgressUpdate, type UpdatePlan } from "@/lib/progressSync";
import { useSetting } from "@/lib/settings";
import { todayStr } from "@/lib/time";
import { DEFAULT_TAG_PRESETS, parsePresetList } from "@/lib/todo";
import { showUndoToast } from "@/lib/toast";
import Modal from "@/components/ui/Modal";

// 別のAI(Claudeなど)に案件・ToDoの進捗を登録してもらうための画面。
// ①仕様書(.md)を渡す ②今の案件・ToDoを書き出して渡す ③返ってきた「進捗の更新」を確認して反映する

const SPEC_PATH = "/progress-sync-spec.md";

/** AIの返答に混ざりがちなコードブロックや前後の文章を外して、JSONの部分だけを取り出す */
export function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? body.slice(start, end + 1) : body.trim();
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function ProgressSyncModal({ onClose }: { onClose: () => void }) {
  const [tagPresetsJson] = useSetting("todo.tagPresets", JSON.stringify(DEFAULT_TAG_PRESETS));
  const [message, setMessage] = useState("");
  const [input, setInput] = useState("");
  const [plan, setPlan] = useState<UpdatePlan | null>(null);
  const [parseError, setParseError] = useState("");
  // 直前の反映の取り消し。トーストはこの画面の裏に隠れるので、画面の中にも出す
  const [lastUndo, setLastUndo] = useState<(() => Promise<void>) | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function loadSpec(): Promise<string> {
    const res = await fetch(SPEC_PATH);
    if (!res.ok) throw new Error(String(res.status));
    return res.text();
  }

  async function snapshotJson(): Promise<string> {
    const [projects, todoTasks, todoLists] = await Promise.all([db.projects.toArray(), db.todoTasks.toArray(), db.todoLists.toArray()]);
    const tagOptions = parsePresetList(tagPresetsJson);
    return JSON.stringify(buildSnapshot({ projects, todoTasks, todoLists, tagOptions: tagOptions.length ? tagOptions : DEFAULT_TAG_PRESETS }), null, 2);
  }

  async function check(text = input) {
    setPlan(null);
    setParseError("");
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(text));
    } catch {
      setParseError("JSONとして読めませんでした。AIの返答のうち、```json から ``` までをそのまま貼り付けてください。");
      return;
    }
    const [projects, todoTasks, todoLists] = await Promise.all([db.projects.toArray(), db.todoTasks.toArray(), db.todoLists.toArray()]);
    setPlan(planProgressUpdate(parsed, { projects, todoTasks, todoLists, tagOptions: parsePresetList(tagPresetsJson) }));
  }

  async function apply() {
    if (!plan) return;
    const okCount = plan.operations.filter((o) => o.ok).length;
    const undo = await applyProgressPlan(plan);
    showUndoToast(`進捗の更新を${okCount}件反映しました`, () => void undo());
    setLastUndo(() => undo);
    setPlan(null);
    setInput("");
    setMessage(`${okCount}件を反映しました。`);
  }

  const okOps = plan?.operations.filter((o) => o.ok) ?? [];
  const ngOps = plan?.operations.filter((o) => !o.ok) ?? [];

  return (
    <Modal title="🤖 AIと進捗をやり取り" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p className="text-xs leading-relaxed text-cream/70">
          別のAI（Claudeなど）に案件・ToDoの進捗を登録してもらう手順です。①仕様書と②今の状態をAIに渡し、AIが返した「進捗の更新」を③に貼り付けて、確認してから反映します。
          書かれた操作以外には触れず、反映後も「元に戻す」で取り消せます。
        </p>

        <section className="space-y-2">
          <h4 className="text-xs font-bold text-cream/80">① 仕様書をAIに渡す（最初の1回）</h4>
          <div className="flex flex-wrap gap-2">
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
                  setMessage((await copyText(await loadSpec())) ? "仕様書をコピーしました。AIとの会話に貼り付けてください。" : "コピーできませんでした。ダウンロードをお使いください。");
                } catch {
                  setMessage("仕様書を読み込めませんでした。");
                }
              }}
            >
              仕様書をコピー
            </button>
          </div>
        </section>

        <section className="space-y-2">
          <h4 className="text-xs font-bold text-cream/80">② 今の案件・ToDoを書き出してAIに渡す</h4>
          <p className="text-[11px] text-cream/50">未完了の案件（段階つき）とToDo（サブタスクつき）を、IDつきのJSONにします。進捗を頼むたびに新しく渡してください。</p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-pill-outline text-xs" onClick={async () => downloadTextFile(`koutei-snapshot-${todayStr()}.json`, await snapshotJson())}>
              ⬇ 現状を書き出す（.json）
            </button>
            <button
              className="btn-pill-outline text-xs"
              onClick={async () => setMessage((await copyText(await snapshotJson())) ? "現状をコピーしました。AIとの会話に貼り付けてください。" : "コピーできませんでした。書き出しをお使いください。")}
            >
              現状をコピー
            </button>
          </div>
        </section>

        <section className="space-y-2">
          <h4 className="text-xs font-bold text-cream/80">③ AIが返した「進捗の更新」を取り込む</h4>
          <textarea
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setPlan(null);
            }}
            placeholder={'AIの返答（{"format": "koutei-progress-update", ...}）をここに貼り付け'}
            rows={5}
            className="w-full rounded-lg border border-cream/20 bg-ink p-2 font-mono text-[11px] text-cream"
            aria-label="進捗の更新"
          />
          <div className="flex flex-wrap gap-2">
            <button className="btn-pill text-xs" onClick={() => check()} disabled={!input.trim()}>
              内容を確認
            </button>
            <button className="btn-pill-outline text-xs" onClick={() => fileRef.current?.click()}>
              ファイルから読む（.json）
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json,.txt,text/plain"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                const text = await file.text();
                setInput(text);
                await check(text);
              }}
            />
          </div>
          {parseError && <p className="text-xs font-bold text-alert">{parseError}</p>}
          {plan?.fatal && <p className="text-xs font-bold text-alert">取り込めません: {plan.fatal}</p>}
          {plan && !plan.fatal && (
            <div className="space-y-2" data-testid="sync-plan">
              {plan.operations.length === 0 && <p className="text-xs text-cream/50">操作がありません。</p>}
              {[...okOps, ...ngOps].map((o) => (
                <div
                  key={o.index}
                  className={`rounded-lg border px-2 py-1.5 text-xs ${o.ok ? "border-cream/20 bg-cream/5 text-cream" : "border-alert/50 text-cream/70"}`}
                  data-testid={o.ok ? "sync-op-ok" : "sync-op-ng"}
                >
                  <p>
                    {o.ok ? "✓ " : "✗ "}
                    {o.summary}
                  </p>
                  {o.error && <p className="mt-0.5 font-bold text-alert">反映しません: {o.error}</p>}
                  {o.warnings.map((w, i) => (
                    <p key={i} className="mt-0.5 text-[11px] text-cream/55">
                      ⚠ {w}
                    </p>
                  ))}
                </div>
              ))}
              <div className="flex flex-wrap items-center justify-end gap-2">
                {ngOps.length > 0 && <span className="mr-auto text-[11px] text-cream/55">✗ の{ngOps.length}件は反映しません</span>}
                <button className="btn-pill text-sm" onClick={apply} disabled={okOps.length === 0}>
                  {okOps.length}件を反映する
                </button>
              </div>
            </div>
          )}
        </section>

        {message && <p className="text-xs text-cream/70" role="status">{message}</p>}
        {lastUndo && (
          <button
            className="btn-pill-outline text-xs"
            onClick={async () => {
              await lastUndo();
              setLastUndo(null);
              setMessage("直前の反映を取り消しました。");
            }}
          >
            ↩ 今の反映を取り消す
          </button>
        )}
      </div>
    </Modal>
  );
}
