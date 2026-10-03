"use client";

import { useRef, useState } from "react";
import { runCommand } from "@/lib/terminalCommands";

// ターミナルモードの最上段に置くコマンド欄(lib/terminalCommands.ts)。
// ↑↓で打ったコマンドを呼び戻せる。日本語の変換確定のEnterでは実行しない
export default function TerminalCommandLine() {
  const [value, setValue] = useState("");
  const [log, setLog] = useState<string[]>(["help でコマンドの一覧"]);
  const [history, setHistory] = useState<string[]>([]);
  const [cursor, setCursor] = useState(-1);
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  async function exec() {
    const cmd = value.trim();
    if (!cmd || busy) return;
    setValue("");
    setCursor(-1);
    setHistory((h) => [cmd, ...h.filter((x) => x !== cmd)].slice(0, 30));
    if (cmd === "clear") {
      setLog([]);
      return;
    }
    setBusy(true);
    try {
      const out = await runCommand(cmd);
      setLog((l) => [...l, `$ ${cmd}`, ...out].slice(-60));
    } catch (e) {
      setLog((l) => [...l, `$ ${cmd}`, `エラー: ${e instanceof Error ? e.message : String(e)}`]);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight }));
    }
  }

  return (
    <div className="panel p-3 font-mono" data-testid="terminal-command">
      <div ref={logRef} className="max-h-40 space-y-0.5 overflow-y-auto text-[12px] leading-relaxed" aria-live="polite">
        {log.map((l, i) => (
          <p key={i} className={`whitespace-pre-wrap break-all ${l.startsWith("$ ") ? "text-cream/50" : "text-[rgb(var(--term-up-rgb))]"}`}>
            {l}
          </p>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2 border-t border-cream/10 pt-2">
        <span className="text-[rgb(var(--term-up-rgb))]" aria-hidden="true">$</span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              exec();
            } else if (e.key === "ArrowUp" && history.length) {
              e.preventDefault();
              const n = Math.min(history.length - 1, cursor + 1);
              setCursor(n);
              setValue(history[n]);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              const n = cursor - 1;
              setCursor(n);
              setValue(n >= 0 ? history[n] : "");
            }
          }}
          placeholder="start 資料作成 / done / todo 明日までに見積書 @営業"
          aria-label="コマンド"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-cream placeholder:text-cream/30 focus:outline-none"
        />
        <button className="shrink-0 rounded border border-cream/20 px-2 py-1 text-[11px] text-cream/70" onClick={exec} disabled={busy}>
          実行
        </button>
      </div>
    </div>
  );
}
