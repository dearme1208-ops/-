"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useHomeFilteredRecords } from "@/lib/homeMode";
import { useVisualMode } from "@/lib/theme";
import { computeGrowthStage } from "@/lib/growth";
import { weekStacks } from "@/lib/visuals";
import { formatDateJp, shiftDateStr } from "@/lib/time";
import GrowthTree, { treeStageFromGrowthIndex } from "@/components/ui/GrowthTree";

// 「今週の森」: 7日分を1本ずつの木で並べ、その日の記録時間で育ち具合を見せる(森モード専用)。
// データは「この1週間」(WeekBlocks)と同じ weekStacks を使う(集計から除外した実績は数えない)

const WD = ["日", "月", "火", "水", "木", "金", "土"];
const hoursText = (ms: number) => `${Number((ms / 3_600_000).toFixed(1))}h`;
const hmText = (ms: number) => {
  const m = Math.round(ms / 60_000);
  return m >= 60 ? `${Math.floor(m / 60)}時間${m % 60 ? `${m % 60}分` : ""}` : `${m}分`;
};

export default function WeekForest({ end, today, title = "🌲 今週の森" }: { end: string; today: string; title?: string }) {
  const { homeMode, themedMode } = useVisualMode();
  const from = shiftDateStr(end, -6);
  const records = useHomeFilteredRecords(
    useLiveQuery(() => db.records.where("date").between(from, end, true, true).toArray(), [from, end])
  );
  const days = useMemo(() => weekStacks(records ?? [], end), [records, end]);
  const [active, setActive] = useState<number | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const colRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [colW, setColW] = useState(44);
  const animatedRef = useRef(false);
  const hasData = days.some((d) => d.totalMs > 0);
  const visible = homeMode && records !== undefined && hasData;

  // 列の幅に合わせて木の大きさを決める(390px幅でも横にはみ出さない)
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const measure = () => setColW(el.clientWidth / 7);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [visible]);

  // 最初に出た時だけ、地面から40msずつずらして立ち上がる(動きを減らす設定では出さない)
  useEffect(() => {
    if (!visible || animatedRef.current) return;
    animatedRef.current = true;
    if (typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    colRefs.current.forEach((el, i) =>
      el?.animate?.(
        [
          { transform: "translateY(14px)", opacity: 0 },
          { transform: "translateY(0)", opacity: 1 },
        ],
        { duration: 520, delay: i * 40, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" }
      )
    );
  }, [visible]);

  if (!visible) return null;

  // 木の枠の高さ。幅は0.8倍だが大樹は少し横に広がるので、列幅に対して控えめに
  const size = Math.round(Math.max(34, Math.min(84, colW * 1.05)));
  const label = (date: string) => `${formatDateJp(date)}(${WD[new Date(`${date}T00:00:00`).getDay()]})`;
  const totalMs = days.reduce((s, d) => s + d.totalMs, 0);
  const best = days.reduce((a, b) => (b.totalMs > a.totalMs ? b : a));
  const maxMs = Math.max(1, best.totalMs);
  const summary = `今週の森: 7日間の合計${hoursText(totalMs)}。${days
    .map((d) => `${label(d.date)}${d.date > today ? "未来" : hoursText(d.totalMs)}`)
    .join("、")}。最も長かったのは${label(best.date)}の${hoursText(best.totalMs)}。`;
  const tipId = "week-forest-tip";

  return (
    <section className="panel space-y-2 p-4" data-testid="week-forest">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="section-title font-display">{title}</h3>
        <span className="caption">
          合計 <span className="num">{hoursText(totalMs)}</span>
        </span>
      </div>
      <div className="relative" onMouseLeave={() => setActive(null)}>
        {/* 絵の部分(読み上げは要約1つにまとめる) */}
        <div role="img" aria-label={summary} className="relative">
          <div ref={rowRef} className="relative flex items-end pt-5" style={{ height: size + 20 }}>
            {days.map((d, i) => {
              const future = d.date > today;
              const isToday = d.date === today;
              const stage = treeStageFromGrowthIndex(computeGrowthStage(themedMode, d.totalMs / 1000).index);
              return (
                <div
                  key={d.date}
                  ref={(el) => {
                    colRefs.current[i] = el;
                  }}
                  className="relative flex h-full min-w-0 flex-1 items-end justify-center"
                  style={{ opacity: active !== null && active !== i ? 0.6 : 1, transition: "opacity 160ms ease" }}
                >
                  {isToday && (
                    // 今日の上に浮かぶ淡い月明かり
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded-full"
                      style={{
                        width: 9,
                        height: 9,
                        background: "rgb(var(--cream-rgb) / 0.9)",
                        boxShadow: "0 0 6px 2px rgb(var(--cream-rgb) / 0.35), 0 0 18px 8px rgb(var(--cream-rgb) / 0.12)",
                      }}
                    />
                  )}
                  {future ? (
                    // まだ来ていない日は小さな印だけ
                    <span aria-hidden="true" className="mb-1 h-1.5 w-1.5 rounded-full bg-cream/15" />
                  ) : d.totalMs === 0 ? (
                    // 記録なしの日は小さな芽を薄く
                    <GrowthTree stage={1} size={Math.round(size * 0.55)} className="opacity-30" />
                  ) : (
                    // 木の形は1日の時間の段階で、高さはその週でいちばん長い日に対する比で決める
                    // (同じ段階の日どうしでも、長い日ほど背が高く見えるように)
                    <GrowthTree stage={stage} size={Math.round(size * (0.55 + 0.45 * (d.totalMs / maxMs)))} />
                  )}
                </div>
              );
            })}
          </div>
          {/* みんなで立つ苔むした地面 */}
          <div
            aria-hidden="true"
            className="h-[6px] rounded-full"
            style={{
              background:
                "linear-gradient(to bottom, color-mix(in srgb, rgb(var(--accent-rgb)) 45%, transparent), color-mix(in srgb, rgb(var(--accent-rgb)) 12%, transparent))",
            }}
          />
          <div aria-hidden="true" className="mt-1 flex">
            {days.map((d) => (
              <div key={d.date} className="flex min-w-0 flex-1 flex-col items-center leading-tight">
                <span className={`text-[11px] ${d.date === today ? "font-bold text-cream" : "text-cream/55"}`}>
                  {WD[new Date(`${d.date}T00:00:00`).getDay()]}
                </span>
                <span className={`num text-[10px] ${d.totalMs ? "text-cream/75" : "text-cream/35"}`}>
                  {d.date > today ? "—" : hoursText(d.totalMs)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ホバー・フォーカス・タップの当たり判定(木より大きく、列全体) */}
        <div className="absolute inset-0 flex">
          {days.map((d, i) => (
            <button
              key={d.date}
              type="button"
              className="h-full min-w-0 flex-1 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              aria-label={`${label(d.date)}${d.date === today ? " 今日" : ""} ${d.date > today ? "未来" : hmText(d.totalMs)}`}
              aria-describedby={active === i ? tipId : undefined}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive((a) => (a === i ? null : a))}
              onClick={() => setActive((a) => (a === i ? null : i))}
            />
          ))}
        </div>

        {active !== null && (
          <Tip id={tipId} index={active} day={days[active]} today={today} label={label(days[active].date)} />
        )}
      </div>

      {/* 読み上げ用の値の表 */}
      <table className="sr-only">
        <caption>今週の森(日ごとの記録時間)</caption>
        <thead>
          <tr>
            <th scope="col">日付</th>
            <th scope="col">合計</th>
            <th scope="col">主な区分</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <th scope="row">
                {label(d.date)}
                {d.date === today ? " 今日" : ""}
              </th>
              <td>{d.date > today ? "未来" : hmText(d.totalMs)}</td>
              <td>{d.parts.slice(0, 2).map((p) => `${p.category} ${hmText(p.ms)}`).join("、") || "なし"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Tip({
  id,
  index,
  day,
  today,
  label,
}: {
  id: string;
  index: number;
  day: { date: string; totalMs: number; parts: { category: string; ms: number }[] };
  today: string;
  label: string;
}) {
  // 端の列では吹き出しを内側へ寄せる
  const left = `${((index + 0.5) / 7) * 100}%`;
  const shift = index <= 1 ? "0%" : index >= 5 ? "-100%" : "-50%";
  const future = day.date > today;
  return (
    <div
      id={id}
      role="tooltip"
      className="pointer-events-none absolute top-0 z-10 w-max max-w-[12rem] rounded-lg border border-cream/15 bg-ink/95 px-2.5 py-1.5 text-[11px] leading-snug text-cream shadow-lg"
      style={{ left, transform: `translate(${shift}, -70%)` }}
    >
      <div className="font-bold">
        {label}
        {day.date === today ? " ・今日" : ""}
      </div>
      {future ? (
        <div className="text-cream/60">まだ来ていない日</div>
      ) : (
        <>
          <div>
            合計 <span className="num">{hmText(day.totalMs)}</span>
          </div>
          {day.parts.slice(0, 2).map((p) => (
            <div key={p.category} className="text-cream/70">
              {p.category} <span className="num">{hmText(p.ms)}</span>
            </div>
          ))}
          {day.totalMs === 0 && <div className="text-cream/60">記録なし</div>}
        </>
      )}
    </div>
  );
}
