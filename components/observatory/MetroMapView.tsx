"use client";

import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { isStageDone } from "@/lib/projectStage";
import { formatDateJp, todayStr } from "@/lib/time";

// 案件を路線、段階を駅として地下鉄の路線図に描く観測法。
// 通過済みの駅は塗り、次に止まる駅は二重丸、まだ先の駅は白丸。
// 同じ名前の段階を持つ路線どうしは「乗り換え駅」として点線で結ぶので、
// 複数の案件で同じ工程を抱えていることが一目で分かる
const LINE_GAP = 74;
const STATION_GAP = 108;
const LEFT_PAD = 120;
const TOP_PAD = 42;
const BEND = 18; // 路線図らしい斜めの折れ(px)

function hueFor(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
  return h;
}

export default function MetroMapView() {
  const today = todayStr();
  const projects = useLiveQuery(() => db.projects.toArray(), []);

  const lines = useMemo(() => {
    return (projects ?? [])
      .filter((p) => !p.completedAt && (p.stages ?? []).length > 0)
      .slice(0, 12)
      .map((p) => {
        const stages = p.stages ?? [];
        const nextIndex = stages.findIndex((s) => !isStageDone(s));
        return {
          id: p.id,
          name: p.groupName || p.title,
          dueDate: p.dueDate,
          overdue: p.dueDate < today,
          hue: hueFor(p.groupName || p.title),
          stations: stages.map((s, i) => ({
            id: s.id,
            title: s.title,
            done: isStageDone(s),
            isNext: i === nextIndex,
            dueDate: s.dueDate,
            overdue: !isStageDone(s) && !!s.dueDate && s.dueDate < today,
          })),
        };
      });
  }, [projects, today]);

  // 乗り換え駅: 同じ段階名が2路線以上に出てくる場合、その駅どうしを結ぶ
  const transfers = useMemo(() => {
    const byTitle = new Map<string, { lineIndex: number; stationIndex: number }[]>();
    lines.forEach((line, li) => {
      line.stations.forEach((st, si) => {
        const key = st.title.trim();
        if (!key) return;
        if (!byTitle.has(key)) byTitle.set(key, []);
        byTitle.get(key)!.push({ lineIndex: li, stationIndex: si });
      });
    });
    const out: { title: string; points: { lineIndex: number; stationIndex: number }[] }[] = [];
    for (const [title, points] of byTitle) {
      if (points.length >= 2) out.push({ title, points });
    }
    return out;
  }, [lines]);

  if (!projects) return <div className="panel p-4 text-sm text-cream/50">読み込み中…</div>;
  if (lines.length === 0) {
    return (
      <div className="panel p-6 text-center text-sm text-cream/50">
        段階(マイルストーン)を持つ未完了の案件がありません。案件に段階を追加すると、ここに路線が引かれます。
      </div>
    );
  }

  const maxStations = Math.max(...lines.map((l) => l.stations.length));
  const width = LEFT_PAD + maxStations * STATION_GAP + 120;
  const height = TOP_PAD + lines.length * LINE_GAP + 30;
  const stationX = (i: number) => LEFT_PAD + i * STATION_GAP;
  // 路線は水平に引きつつ、駅ごとにわずかに上下させて路線図特有の折れ線らしさを出す
  const stationY = (lineIndex: number, stationIndex: number) =>
    TOP_PAD + lineIndex * LINE_GAP + (stationIndex % 2 === 0 ? 0 : BEND);

  return (
    <div className="panel p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-base font-bold">🚇 路線図</h3>
        <p className="text-xs text-cream/50">
          {lines.length}路線 ・ 乗り換え駅 {transfers.length}か所
        </p>
      </div>

      <div className="overflow-x-auto">
        <svg width={width} height={height} className="block" role="img" aria-label="案件の路線図">
          {/* 乗り換え通路(同じ段階名の駅どうし) */}
          {transfers.flatMap((tr) =>
            tr.points.slice(0, -1).map((p, i) => {
              const q = tr.points[i + 1];
              return (
                <line
                  key={`${tr.title}-${i}`}
                  x1={stationX(p.stationIndex)}
                  y1={stationY(p.lineIndex, p.stationIndex)}
                  x2={stationX(q.stationIndex)}
                  y2={stationY(q.lineIndex, q.stationIndex)}
                  stroke="rgb(var(--cream-rgb) / 0.25)"
                  strokeWidth={1.2}
                  strokeDasharray="3 4"
                >
                  <title>{`乗り換え: ${tr.title}`}</title>
                </line>
              );
            })
          )}

          {lines.map((line, li) => {
            const pts = line.stations.map((_, si) => `${stationX(si)},${stationY(li, si)}`).join(" ");
            const lastX = stationX(line.stations.length - 1);
            const lastY = stationY(li, line.stations.length - 1);
            return (
              <g key={line.id}>
                {/* 路線名(左端) */}
                <text x={4} y={TOP_PAD + li * LINE_GAP + 4} fontSize={12} fontWeight={700} fill={`hsl(${line.hue} 60% 66%)`}>
                  {line.name.length > 9 ? `${line.name.slice(0, 9)}…` : line.name}
                </text>
                <text x={4} y={TOP_PAD + li * LINE_GAP + 18} fontSize={9} fill={line.overdue ? "rgb(var(--accent-rgb))" : "rgb(var(--cream-rgb) / 0.4)"}>
                  {formatDateJp(line.dueDate)}
                  {line.overdue ? " 超過" : ""}
                </text>
                {/* 路線(太い線) */}
                <polyline
                  points={pts}
                  fill="none"
                  stroke={`hsl(${line.hue} 58% 58%)`}
                  strokeWidth={7}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.85}
                />
                {/* 終点から先、期日までの「未成線」を点線で伸ばす */}
                <line
                  x1={lastX}
                  y1={lastY}
                  x2={lastX + 52}
                  y2={lastY}
                  stroke={`hsl(${line.hue} 40% 50%)`}
                  strokeWidth={2}
                  strokeDasharray="4 5"
                />
                <text x={lastX + 58} y={lastY + 4} fontSize={9} fill="rgb(var(--cream-rgb) / 0.5)">
                  終点
                </text>

                {line.stations.map((st, si) => {
                  const x = stationX(si);
                  const y = stationY(li, si);
                  const isTransfer = transfers.some((tr) => tr.points.some((p) => p.lineIndex === li && p.stationIndex === si));
                  return (
                    <g key={st.id}>
                      <circle
                        cx={x}
                        cy={y}
                        r={st.isNext ? 8 : isTransfer ? 7 : 6}
                        fill={st.done ? `hsl(${line.hue} 58% 58%)` : "rgb(var(--ink-rgb, 11 11 12))"}
                        stroke={st.overdue ? "rgb(var(--accent-rgb))" : `hsl(${line.hue} 58% 70%)`}
                        strokeWidth={st.isNext ? 3 : 2}
                      >
                        <title>{`${st.title}${st.dueDate ? `（期日 ${st.dueDate}）` : ""}${st.done ? " ・通過済み" : st.isNext ? " ・次の停車駅" : ""}`}</title>
                      </circle>
                      {st.isNext && <circle cx={x} cy={y} r={12} fill="none" stroke={`hsl(${line.hue} 58% 70%)`} strokeWidth={1} opacity={0.6} />}
                      <text
                        x={x}
                        y={y - 14}
                        fontSize={9}
                        textAnchor="middle"
                        fill={st.done ? "rgb(var(--cream-rgb) / 0.35)" : st.overdue ? "rgb(var(--accent-rgb))" : "rgb(var(--cream-rgb) / 0.8)"}
                        style={{ textDecoration: st.done ? "line-through" : undefined }}
                      >
                        {st.title.length > 7 ? `${st.title.slice(0, 7)}…` : st.title}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>

      <ul className="mt-2 space-y-0.5 text-[10px] leading-relaxed text-cream/40">
        <li>・1路線 = 1案件（段階を持つ未完了の案件のみ・最大12路線）</li>
        <li>・塗りつぶした駅 = 通過済みの段階　二重丸 = 次の停車駅　白丸 = これから</li>
        <li>・赤い縁の駅 = 期日を過ぎた段階</li>
        <li>・点線の通路 = 同じ段階名を持つ路線どうしの乗り換え駅</li>
      </ul>
    </div>
  );
}
