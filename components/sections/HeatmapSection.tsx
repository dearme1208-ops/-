"use client";

import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { formatHms } from "@/lib/time";

const DOW_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

export default function HeatmapSection() {
  const records = useLiveQuery(() => db.records.toArray(), []);

  const { categories, matrix, max } = useMemo(() => {
    const cats = new Set<string>();
    const m = new Map<string, number[]>(); // category -> [7 values]
    let maxVal = 0;
    for (const r of records ?? []) {
      if (r.excludedFromStats) continue;
      cats.add(r.category);
      if (!m.has(r.category)) m.set(r.category, new Array(7).fill(0));
      const dow = new Date(r.date + "T12:00:00").getDay();
      const arr = m.get(r.category)!;
      arr[dow] += r.seconds;
      maxVal = Math.max(maxVal, arr[dow]);
    }
    return { categories: [...cats].sort((a, b) => a.localeCompare(b, "ja")), matrix: m, max: maxVal };
  }, [records]);

  function cellColor(value: number): string {
    if (max === 0 || value === 0) return "rgba(233,230,189,0.04)";
    const ratio = Math.min(1, value / max);
    return `rgba(194,59,59,${0.08 + ratio * 0.72})`;
  }

  return (
    <div className="space-y-4">
      <div className="panel overflow-x-auto p-4">
        <table className="w-full min-w-[560px] border-separate border-spacing-1 text-sm">
          <thead>
            <tr>
              <th className="text-left text-xs text-cream/50">区分 ＼ 曜日</th>
              {DOW_LABELS.map((d) => (
                <th key={d} className="w-16 text-center text-xs text-cream/50">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((cat) => (
              <tr key={cat}>
                <td className="whitespace-nowrap pr-2 text-cream">{cat}</td>
                {matrix.get(cat)!.map((v, dow) => (
                  <td
                    key={dow}
                    className="rounded-md text-center text-[11px] tabular-nums text-cream/90"
                    style={{ backgroundColor: cellColor(v), height: 40 }}
                    title={formatHms(v)}
                  >
                    {v > 0 ? formatHms(v) : ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {categories.length === 0 && <p className="py-6 text-sm text-cream/50">データがありません。</p>}
      </div>
    </div>
  );
}
