"use client";

import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { buildCare, buildGrove, groveStreak, type CareItem, type GroveDay } from "@/lib/forestLife";
import { useSetting } from "@/lib/settings";
import { shiftDateStr } from "@/lib/time";

// 森モードの「この4週間の木立」と「暮らしの手入れ」(lib/forestLife.ts)

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
  const records = useLiveQuery(() => db.records.where("date").aboveOrEqual(shiftDateStr(today, -27)).toArray(), [today]);
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

const STATE_LABEL: Record<CareItem["state"], string> = {
  fresh: "まだきれい",
  soon: "そろそろ",
  due: "手入れどき",
  overgrown: "草が伸びています",
};

/** 草の伸び具合(前回から ÷ いつもの間隔)を、3本の草の高さで見せる */
function Grass({ ratio }: { ratio: number }) {
  const h = Math.min(1, ratio / 1.5);
  return (
    <svg viewBox="0 0 24 16" className="h-4 w-6 shrink-0" aria-hidden="true">
      {[5, 12, 19].map((x, i) => {
        const len = 3 + h * (9 + i * 2);
        return <path key={x} d={`M${x} 16 Q${x - 1} ${16 - len / 2} ${x + (i - 1)} ${16 - len}`} stroke={ratio >= 1 ? "rgb(var(--accent-rgb))" : "rgb(var(--cream-rgb) / 0.4)"} strokeWidth="1.6" fill="none" strokeLinecap="round" />;
      })}
    </svg>
  );
}

export function CarePanel({ today, onStart }: { today: string; onStart: (masterId: string) => void }) {
  const records = useLiveQuery(() => db.records.where("date").aboveOrEqual(shiftDateStr(today, -180)).toArray(), [today]);
  const masters = useLiveQuery(() => db.masterTasks.toArray(), []);
  const [ignoredJson, setIgnoredJson] = useSetting("home.care.ignored", "[]");
  const ignored = useMemo(() => {
    try {
      const v = JSON.parse(ignoredJson);
      return Array.isArray(v) ? (v as string[]) : [];
    } catch {
      return [];
    }
  }, [ignoredJson]);
  const items = useMemo(() => buildCare(records ?? [], masters ?? [], today, ignored), [records, masters, today, ignored]);
  if (items.length === 0) return null;
  const needing = items.filter((i) => i.state === "due" || i.state === "overgrown");
  const shown = items.filter((i) => i.state !== "fresh").slice(0, 8);
  const freshCount = items.length - items.filter((i) => i.state !== "fresh").length;
  return (
    <section className="panel space-y-2 p-4" data-testid="forest-care">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h3 className="font-display text-sm font-bold text-cream/85">🌿 暮らしの手入れ</h3>
        <span className="text-xs text-cream/55">{needing.length > 0 ? `手入れどき ${needing.length}件` : "どれも手入れが行き届いています"}</span>
      </div>
      {shown.length > 0 && (
        <ul className="divide-y divide-cream/10">
          {shown.map((i) => (
            <li key={i.masterId} className="flex items-center gap-2.5 py-2">
              <Grass ratio={i.ratio} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-cream">{i.name}</p>
                <p className="text-[11px] text-cream/55">
                  前回から{i.sinceDays}日・いつもは{i.usualDays}日ごと・{STATE_LABEL[i.state]}
                </p>
              </div>
              <button className="btn-pill shrink-0 px-3 py-1.5 text-xs" onClick={() => onStart(i.masterId)}>
                始める
              </button>
              <button
                className="shrink-0 px-1 py-1 text-[11px] text-cream/40 hover:text-cream"
                onClick={() => setIgnoredJson(JSON.stringify([...ignored, i.masterId]))}
                aria-label={`「${i.name}」を手入れの一覧から外す`}
                title="手入れの一覧から外す"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {freshCount > 0 && <p className="text-[11px] text-cream/45">ほかに{freshCount}件は、まだ手入れの間隔が来ていません。</p>}
      {ignored.length > 0 && (
        <button className="text-[11px] text-cream/45 underline decoration-dotted" onClick={() => setIgnoredJson("[]")}>
          外した{ignored.length}件を戻す
        </button>
      )}
      <p className="text-[11px] text-cream/40">3回以上記録した作業の、いつもの間隔を記録から割り出しています。</p>
    </section>
  );
}
