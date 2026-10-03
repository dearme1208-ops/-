"use client";

import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { buildGrove, groveStreak, type GroveDay } from "@/lib/forestLife";
import { useHomeFilteredRecords } from "@/lib/homeMode";
import { shiftDateStr } from "@/lib/time";

// 森モードの「この4週間の木立」(lib/forestLife.ts)

const SIZE: Record<GroveDay["stage"], number> = { none: 0, sprout: 7, young: 13, tree: 20 };

function Tree({ x, base, day, isToday }: { x: number; base: number; day: GroveDay; isToday: boolean }) {
  const h = SIZE[day.stage];
  if (day.stage === "none") {
    // 記録のない日は、責めずに落ち葉をひとつ置くだけ
    return <ellipse cx={x} cy={base - 1.5} rx="2.6" ry="1.2" fill="rgb(var(--cream-rgb) / 0.18)" transform={`rotate(-20 ${x} ${base})`} />;
  }
  const w = h * 0.62;
  const fruits = Math.min(5, day.fruits);
  return (
    <g>
      <rect x={x - 0.8} y={base - 3} width="1.6" height="3" fill="rgb(var(--cream-rgb) / 0.35)" />
      <polygon points={`${x},${base - 3 - h} ${x - w / 2},${base - 3} ${x + w / 2},${base - 3}`} fill={isToday ? "rgb(var(--accent-rgb))" : "rgb(var(--accent-rgb) / 0.7)"} />
      {day.stage !== "sprout" && (
        <polygon
          points={`${x},${base - 3 - h * 1.12} ${x - w * 0.36},${base - 3 - h * 0.5} ${x + w * 0.36},${base - 3 - h * 0.5}`}
          fill={isToday ? "rgb(var(--accent-rgb))" : "rgb(var(--accent-rgb) / 0.85)"}
        />
      )}
      {Array.from({ length: fruits }, (_, i) => (
        <circle key={i} cx={x + ((i % 2 ? 1 : -1) * w) / 4} cy={base - 5 - i * (h / 6)} r="1.1" fill="#e8b04a" />
      ))}
    </g>
  );
}

export function ForestGrove({ today }: { today: string }) {
  // 「茂みへ隠す」で隠した作業の記録は、木立にも数えない(森モードの他の集計と同じ)
  const records = useHomeFilteredRecords(
    useLiveQuery(() => db.records.where("date").aboveOrEqual(shiftDateStr(today, -27)).toArray(), [today])
  );
  const grove = useMemo(() => buildGrove(records ?? [], today), [records, today]);
  const streak = groveStreak(grove);
  const trees = grove.filter((d) => d.stage !== "none").length;
  const rows = [grove.slice(0, 14), grove.slice(14)];
  return (
    <section className="panel p-4" data-testid="forest-grove">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-display text-sm font-bold text-cream/85">🌲 この4週間の木立</h3>
        <span className="text-xs text-cream/55">
          木が{trees}本{streak > 1 ? `・${streak}日続いています` : ""}
        </span>
      </div>
      <svg viewBox="0 0 280 66" className="mt-2 w-full" role="img" aria-label={`記録した日に木が立ちます。この4週間で${trees}本`}>
        {rows.map((row, r) => {
          const base = 30 + r * 33;
          return (
            <g key={r}>
              <line x1="4" x2="276" y1={base} y2={base} stroke="rgb(var(--cream-rgb) / 0.12)" strokeWidth="0.8" />
              {row.map((d, i) => (
                <Tree key={d.date} x={10 + i * 19.3} base={base} day={d} isToday={d.date === today} />
              ))}
            </g>
          );
        })}
      </svg>
      <p className="mt-1 text-[11px] text-cream/45">記録した日に木が立ち、取り組んだ時間で育ち、記録の数だけ実がなります。</p>
    </section>
  );
}
