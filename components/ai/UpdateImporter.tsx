"use client";

import { useRef, useState } from "react";
import { applyProgressPlan, planProgressUpdate, type UpdatePlan } from "@/lib/progressSync";
import { showUndoToast } from "@/lib/toast";
import { extractJson, loadPlanState } from "./aiData";

// AIが返した「進捗の更新」を貼り付け(またはファイル)→操作ごとに確認→反映→取り消し、までの部品。
// 「🤖 AIと進捗をやり取り」と「⏱ 時間割」の両方で使う

export default function UpdateImporter({ placeholder, onApplied }: { placeholder?: string; onApplied?: () => void }) {
  const [input, setInput] = useState("");
  const [plan, setPlan] = useState<UpdatePlan | null>(null);
  const [parseError, setParseError] = useState("");
  const [message, setMessage] = useState("");
  // 直前の反映の取り消し。トーストは画面(モーダル)の裏に隠れるので、ここにも出す
  const [lastUndo, setLastUndo] = useState<(() => Promise<void>) | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function check(text = input) {
    setPlan(null);
    setParseError("");
    setMessage("");
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(text));
    } catch {
      setParseError("JSONとして読めませんでした。AIの返答のうち、```json から ``` までをそのまま貼り付けてください。");
      return;
    }
    setPlan(planProgressUpdate(parsed, await loadPlanState()));
  }

  async function apply() {
    if (!plan) return;
    const okCount = plan.operations.filter((o) => o.ok).length;
    const undo = await applyProgressPlan(plan);
    showUndoToast(`AIからの更新を${okCount}件反映しました`, () => void undo());
    setLastUndo(() => undo);
    setPlan(null);
    setInput("");
    setMessage(`${okCount}件を反映しました。`);
    onApplied?.();
  }

  const okOps = plan?.operations.filter((o) => o.ok) ?? [];
  const ngOps = plan?.operations.filter((o) => !o.ok) ?? [];

  return (
    <div className="space-y-2">
      <textarea
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          setPlan(null);
        }}
        placeholder={placeholder ?? 'AIの返答（{"format": "koutei-progress-update", ...}）をここに貼り付け'}
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
              {o.ok && o.details && o.details.length > 0 && (
                <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-cream/75">
                  {o.details.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              )}
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
      {message && (
        <p className="text-xs text-cream/70" role="status">
          {message}
        </p>
      )}
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
  );
}
