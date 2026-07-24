"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { generateReportText, downloadTextFile } from "@/lib/report";
import { todayStr } from "@/lib/time";

export default function ReportSection() {
  const [kind, setKind] = useState<"week" | "month">("week");
  const [preview, setPreview] = useState<string>("");

  const records = useLiveQuery(() => db.records.toArray(), []);
  const masterTasks = useLiveQuery(() => db.masterTasks.toArray(), []);

  function generate() {
    if (!records || !masterTasks) return;
    const title = kind === "week" ? "週報" : "月報";
    const text = generateReportText(title, { type: kind }, records, masterTasks);
    setPreview(text);
  }

  function download() {
    if (!preview) return;
    const label = kind === "week" ? "weekly" : "monthly";
    downloadTextFile(`report_${label}_${todayStr()}.txt`, preview);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          className={kind === "week" ? "btn-pill text-sm" : "btn-pill-outline text-sm"}
          onClick={() => setKind("week")}
        >
          週報
        </button>
        <button
          className={kind === "month" ? "btn-pill text-sm" : "btn-pill-outline text-sm"}
          onClick={() => setKind("month")}
        >
          月報
        </button>
        <button className="btn-pill-outline text-sm" onClick={generate}>
          生成
        </button>
        {preview && (
          <button className="btn-pill text-sm" onClick={download}>
            ダウンロード (.txt)
          </button>
        )}
      </div>

      {preview && (
        <pre className="panel max-h-[560px] overflow-auto whitespace-pre-wrap p-4 text-sm text-cream/90">
          {preview}
        </pre>
      )}
    </div>
  );
}
