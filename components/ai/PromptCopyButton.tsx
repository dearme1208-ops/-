"use client";

import { useState } from "react";
import { downloadTextFile } from "@/lib/report";
import { copyText } from "./aiData";

// 依頼文(頼み方の説明+必要なデータ)をワンタップでコピーするボタン。
// クリップボードが使えない環境(権限・古いブラウザ)では、その場に全文を出して
// 手で選んでコピーするか、ファイルで保存できるようにする

export default function PromptCopyButton({
  label,
  build,
  fileName,
  className = "btn-pill-outline text-xs",
}: {
  label: string;
  /** 押した時点のデータで依頼文を作る */
  build: () => Promise<string>;
  fileName: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "busy" | "copied" | "error">("idle");
  const [fallback, setFallback] = useState<string | null>(null);

  async function run() {
    setState("busy");
    setFallback(null);
    let text: string;
    try {
      text = await build();
    } catch {
      setState("error");
      return;
    }
    if (await copyText(text)) {
      setState("copied");
    } else {
      setFallback(text);
      setState("idle");
    }
  }

  return (
    <div className="space-y-1">
      <button className={className} onClick={run} disabled={state === "busy"}>
        {label}
      </button>
      {state === "copied" && (
        <p className="text-[11px] text-cream/60" role="status">
          コピーしました。Claudeとの会話に貼り付けてください。
        </p>
      )}
      {state === "error" && <p className="text-[11px] font-bold text-alert">依頼文を作れませんでした。通信できる状態でもう一度お試しください。</p>}
      {fallback && (
        <div className="space-y-1">
          <p className="text-[11px] text-cream/60">自動でコピーできませんでした。下の文章を全部選んでコピーするか、ファイルで保存してください。</p>
          <textarea
            readOnly
            value={fallback}
            rows={4}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded-lg border border-cream/20 bg-ink p-2 font-mono text-[10px] text-cream"
            aria-label="依頼文"
          />
          <button className="btn-pill-outline text-[11px]" onClick={() => downloadTextFile(fileName, fallback)}>
            ファイルで保存（.txt）
          </button>
        </div>
      )}
    </div>
  );
}
