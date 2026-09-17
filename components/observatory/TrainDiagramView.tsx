"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { formatClock, formatHms, shiftDateStr, todayStr } from "@/lib/time";

// 鉄道の運行図表(ダイヤグラム)と同じ描き方で1日を見る観測法。
// 縦軸が「駅」= 業務区分、横軸が時刻。作業している間は駅に停まっている水平線、
// 別の区分へ移った瞬間が駅間を走る斜めのスジになる。
// 1日に何度も往復していれば、そのままジグザグの多いダイヤとして目に見える
const ROW_H = 34;
const LABEL_W = 96;
const MIN_PX_PER_HOUR = 24;
const MAX_PX_PER_HOUR = 160;

function hueFor(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
  return h;
}

export default function TrainDiagramView() {
  const [date, setDate] = useState(() => todayStr());
  const [pxPerHour, setPxPerHour] = useState(64);
  const records = useLiveQuery(() => db.records.where("date").equals(date).toArray(), [date]);

  const diagram = useMemo(() => {
    const list = (records ?? []).slice().sort((a, b) => a.startedAt - b.startedAt);
    if (list.length === 0) return null;
    // 駅(業務区分)の並びは、その日に最初に訪れた順。実際の路線図と同じで、
    // 並びが変わると同じ1日でも違う形のダイヤになるため、到着順で固定する
    const stations: string[] = [];
    for (const r of list) if (!stations.includes(r.category)) stations.push(r.category);

    const dayStart = new Date(date + "T00:00:00").getTime();
    const times = list.flatMap((r) => [r.startedAt, r.endedAt]);
    const minHour = Math.max(0, Math.floor((Math.min(...times) - dayStart) / 3600000) - 1);
    const maxHour = Math.min(30, Math.ceil((Math.max(...times) - dayStart) / 3600000) + 1);
    return { list, stations, dayStart, minHour, maxHour };
  }, [records, date]);

  if (!records) return <div className="panel p-4 text-sm text-cream/50">読み込み中…</div>;

  return (
    <div className="space-y-3">
      <div className="panel flex flex-wrap items-center gap-2 p-3">
        <h3 className="font-display text-sm font-bold">🚆 運行図表</h3>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-lg border border-cream/20 bg-ink px-3 py-1.5 text-sm text-cream"
        />
        <button className="btn-pill-outline text-xs" onClick={() => setDate(shiftDateStr(date, -1))}>
          ‹ 前日
        </button>
        <button className="btn-pill-outline text-xs" onClick={() => setDate(todayStr())}>
          今日
        </button>
        <button className="btn-pill-outline text-xs" onClick={() => setDate(shiftDateStr(date, 1))}>
          翌日 ›
        </button>
        <span className="ml-auto flex items-center gap-1">
          <button
            className="btn-pill-outline px-3 py-1.5 text-sm"
            onClick={() => setPxPerHour((v) => Math.max(MIN_PX_PER_HOUR, Math.round(v / 1.3)))}
            aria-label="縮小"
          >
            －
          </button>
          <button
            className="btn-pill-outline px-3 py-1.5 text-sm"
            onClick={() => setPxPerHour((v) => Math.min(MAX_PX_PER_HOUR, Math.round(v * 1.3)))}
            aria-label="拡大"
          >
            ＋
          </button>
        </span>
      </div>

      {!diagram ? (
        <div className="panel p-6 text-center text-sm text-cream/50">この日の実績がありません。</div>
      ) : (
        <div className="panel overflow-x-auto p-3">
          {(() => {
            const { list, stations, dayStart, minHour, maxHour } = diagram;
            const hours = maxHour - minHour;
            const chartW = hours * pxPerHour;
            const chartH = stations.length * ROW_H;
            const x = (ms: number) => ((ms - dayStart) / 3600000 - minHour) * pxPerHour;
            const y = (category: string) => stations.indexOf(category) * ROW_H + ROW_H / 2;
            return (
              <svg
                width={LABEL_W + chartW + 12}
                height={chartH + 28}
                className="block"
                role="img"
                aria-label="1日の運行図表"
              >
                {/* 時刻の目盛り */}
                {Array.from({ length: hours + 1 }, (_, i) => minHour + i).map((h) => (
                  <g key={h}>
                    <line
                      x1={LABEL_W + (h - minHour) * pxPerHour}
                      y1={0}
                      x2={LABEL_W + (h - minHour) * pxPerHour}
                      y2={chartH}
                      stroke="rgb(var(--cream-rgb) / 0.12)"
                      strokeWidth={h % 3 === 0 ? 1.2 : 0.6}
                    />
                    <text
                      x={LABEL_W + (h - minHour) * pxPerHour + 2}
                      y={chartH + 14}
                      fontSize={9}
                      fill="rgb(var(--cream-rgb) / 0.45)"
                    >
                      {String(h % 24).padStart(2, "0")}
                    </text>
                  </g>
                ))}
                {/* 駅(業務区分)の線とラベル */}
                {stations.map((s, i) => (
                  <g key={s}>
                    <line
                      x1={LABEL_W}
                      y1={i * ROW_H + ROW_H / 2}
                      x2={LABEL_W + chartW}
                      y2={i * ROW_H + ROW_H / 2}
                      stroke="rgb(var(--cream-rgb) / 0.18)"
                      strokeWidth={1}
                      strokeDasharray="2 4"
                    />
                    <text x={0} y={i * ROW_H + ROW_H / 2 + 3} fontSize={11} fill="rgb(var(--cream-rgb) / 0.75)">
                      {s.length > 7 ? `${s.slice(0, 7)}…` : s}
                    </text>
                  </g>
                ))}
                {/* 駅間を走るスジ(前の作業の終わり → 次の作業の始まり) */}
                {list.slice(0, -1).map((r, i) => {
                  const next = list[i + 1];
                  return (
                    <line
                      key={`run-${r.id}`}
                      x1={LABEL_W + x(r.endedAt)}
                      y1={y(r.category)}
                      x2={LABEL_W + x(next.startedAt)}
                      y2={y(next.category)}
                      stroke="rgb(var(--cream-rgb) / 0.35)"
                      strokeWidth={1.2}
                    />
                  );
                })}
                {/* 駅に停まっている間(=その作業をしていた時間) */}
                {list.map((r) => {
                  const hue = hueFor(r.category);
                  const x1 = LABEL_W + x(r.startedAt);
                  const x2 = LABEL_W + x(r.endedAt);
                  return (
                    <g key={r.id}>
                      <line
                        x1={x1}
                        y1={y(r.category)}
                        x2={Math.max(x2, x1 + 2)}
                        y2={y(r.category)}
                        stroke={`hsl(${hue} 65% 62%)`}
                        strokeWidth={5}
                        strokeLinecap="round"
                      >
                        <title>{`${r.category} / ${r.name}　${formatClock(r.startedAt)}〜${formatClock(r.endedAt)}（${formatHms(r.seconds)}）`}</title>
                      </line>
                      {/* 停車時間が長い作業だけ、スジの上に作業名を出す */}
                      {x2 - x1 > 42 && (
                        <text x={x1 + 3} y={y(r.category) - 7} fontSize={9} fill="rgb(var(--cream-rgb) / 0.7)">
                          {r.name.length > 10 ? `${r.name.slice(0, 10)}…` : r.name}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
            );
          })()}
          <p className="mt-2 text-[10px] leading-relaxed text-cream/40">
            太い横線 = その区分に「停車」していた時間。細い斜線 = 次の区分へ移った「運行」。
            斜線が多い日ほど、区分をまたぐ切り替えが多かった一日です。
          </p>
        </div>
      )}
    </div>
  );
}
