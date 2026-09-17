"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { CONDITION_LEVELS } from "@/lib/condition";
import { parseReflection } from "@/lib/reflection";
import { formatClock, formatDateJp, formatHms, shiftDateStr, todayStr } from "@/lib/time";
import type { WorkRecord } from "@/lib/types";

// その日の実績を「朝刊の一面」として組版する観測法。
// 見出しは最長作業、社会面は各作業、天気欄は体調、株価欄はカテゴリ別時間、社説は振り返り。
// 数字も文章も全部その日の記録から取るので、同じ日の紙面は二度と作れない
const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];

function headlineFor(top: WorkRecord | undefined, totalSeconds: number, count: number): string {
  if (!top) return "本日、記録なし";
  const hours = Math.floor(top.seconds / 3600);
  if (hours >= 4) return `${top.name}に${hours}時間　終日を投じる`;
  if (count >= 8) return `${count}件を処理　${top.name}を軸に一日`;
  if (totalSeconds >= 6 * 3600) return `${top.name}が最長　総計${Math.floor(totalSeconds / 3600)}時間の稼働`;
  return `${top.name}　本日の中心に`;
}

export default function NewspaperView() {
  const [date, setDate] = useState(() => todayStr());
  const records = useLiveQuery(() => db.records.where("date").equals(date).toArray(), [date]);
  const conditionLogs = useLiveQuery(() => db.conditionLogs.where("date").equals(date).toArray(), [date]);
  const reflectionRow = useLiveQuery(() => db.settings.get(`reflection.daily.${date}`), [date]);
  const journalRow = useLiveQuery(() => db.settings.get(`journal.daily.${date}`), [date]);
  const prevRecords = useLiveQuery(() => db.records.where("date").equals(shiftDateStr(date, -1)).toArray(), [date]);

  const paper = useMemo(() => {
    const list = (records ?? []).slice().sort((a, b) => b.seconds - a.seconds);
    const totalSeconds = list.reduce((s, r) => s + r.seconds, 0);
    const byCategory = new Map<string, number>();
    for (const r of list) byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + r.seconds);
    const prevByCategory = new Map<string, number>();
    for (const r of prevRecords ?? []) prevByCategory.set(r.category, (prevByCategory.get(r.category) ?? 0) + r.seconds);
    const stocks = [...byCategory.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([category, seconds]) => {
        const prev = prevByCategory.get(category) ?? 0;
        const diff = prev === 0 ? null : (seconds - prev) / prev;
        return { category, seconds, diff };
      });
    const firstStart = list.length > 0 ? Math.min(...list.map((r) => r.startedAt)) : null;
    const lastEnd = list.length > 0 ? Math.max(...list.map((r) => r.endedAt)) : null;
    const chronological = (records ?? []).slice().sort((a, b) => a.startedAt - b.startedAt);
    return { list, totalSeconds, stocks, firstStart, lastEnd, chronological, top: list[0] };
  }, [records, prevRecords]);

  const condition = useMemo(() => {
    const logs = (conditionLogs ?? []).slice().sort((a, b) => b.loggedAt - a.loggedAt);
    if (logs.length === 0) return null;
    return CONDITION_LEVELS.find((c) => Number(c.level) === Number(logs[0].level)) ?? null;
  }, [conditionLogs]);

  const reflection = reflectionRow ? parseReflection(reflectionRow.value) : null;
  const journal = journalRow?.value?.trim() ?? "";
  const d = new Date(date + "T00:00:00");
  const issueNumber = Math.floor(d.getTime() / 86400000) - 19000; // 通し番号(日付から決まる固定値)

  return (
    <div className="space-y-3">
      <div className="panel flex flex-wrap items-center gap-2 p-3">
        <h3 className="font-display text-sm font-bold">📰 朝刊一面</h3>
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
        <button className="btn-pill-outline ml-auto text-xs" onClick={() => window.print()}>
          🖨 印刷
        </button>
      </div>

      {/* 紙面本体。ここだけは地の色を紙に寄せ、書体も明朝(serif)に切り替える */}
      <div className="overflow-hidden rounded-lg bg-[#efeade] p-5 text-[#1a1a1a] shadow-lg" style={{ fontFamily: "serif" }}>
        <div className="border-b-4 border-double border-[#1a1a1a] pb-2">
          <div className="flex items-end justify-between gap-3">
            <h1 className="text-3xl font-black tracking-[0.3em]">工程新聞</h1>
            <div className="text-right text-[10px] leading-tight">
              <div>
                {d.getFullYear()}年{d.getMonth() + 1}月{d.getDate()}日（{WEEKDAY_JP[d.getDay()]}）
              </div>
              <div>第{issueNumber}号</div>
              <div>発行：本人</div>
            </div>
          </div>
        </div>

        {/* 一面トップ */}
        <div className="mt-3 border-b border-[#1a1a1a]/40 pb-3">
          <h2 className="text-center text-2xl font-black leading-snug tracking-wide">
            {headlineFor(paper.top, paper.totalSeconds, paper.list.length)}
          </h2>
          <p className="mt-1 text-center text-xs tracking-wider text-[#1a1a1a]/70">
            総稼働 {formatHms(paper.totalSeconds)} ／ {paper.list.length}件
            {paper.firstStart && paper.lastEnd && `　${formatClock(paper.firstStart)}〜${formatClock(paper.lastEnd)}`}
          </p>
        </div>

        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          {/* 社会面(時系列の記事) */}
          <div className="sm:col-span-2">
            <h3 className="mb-1 border-l-4 border-[#1a1a1a] pl-2 text-sm font-bold">きょうの動き</h3>
            {paper.chronological.length === 0 ? (
              <p className="text-xs leading-relaxed text-[#1a1a1a]/60">
                この日の記録は残っていない。紙面に載せるべき出来事はなかった。
              </p>
            ) : (
              <div className="columns-1 gap-4 text-[11px] leading-relaxed sm:columns-2">
                {paper.chronological.map((r) => (
                  <p key={r.id} className="mb-2 break-inside-avoid">
                    <span className="font-bold">【{r.category}】{r.name}　</span>
                    {formatClock(r.startedAt)}から{formatHms(r.seconds)}にわたって行われた。
                    {r.note && `関係者は「${r.note}」と話している。`}
                    {r.excludedFromStats && "なお、この記録は集計から除外されている。"}
                  </p>
                ))}
              </div>
            )}
          </div>

          {/* 右段: 天気・株価・社説 */}
          <div className="space-y-3">
            <div className="border border-[#1a1a1a]/40 p-2">
              <h3 className="mb-1 text-xs font-bold">きょうの体調</h3>
              {condition ? (
                <p className="text-center text-2xl leading-tight">
                  {condition.emoji}
                  <span className="ml-1 align-middle text-xs font-bold">{condition.label}</span>
                </p>
              ) : (
                <p className="text-center text-[11px] text-[#1a1a1a]/60">観測なし</p>
              )}
            </div>

            <div className="border border-[#1a1a1a]/40 p-2">
              <h3 className="mb-1 text-xs font-bold">区分別 時間市況</h3>
              {paper.stocks.length === 0 ? (
                <p className="text-[11px] text-[#1a1a1a]/60">取引なし</p>
              ) : (
                <table className="w-full text-[10px]">
                  <tbody>
                    {paper.stocks.slice(0, 8).map((s) => (
                      <tr key={s.category} className="border-b border-dotted border-[#1a1a1a]/25 last:border-0">
                        <td className="py-0.5 pr-1">{s.category}</td>
                        <td className="py-0.5 text-right tabular-nums">{formatHms(s.seconds)}</td>
                        <td className="w-10 py-0.5 text-right tabular-nums">
                          {s.diff == null ? (
                            <span className="text-[#1a1a1a]/40">新規</span>
                          ) : s.diff >= 0 ? (
                            <span className="text-[#a11]">▲{Math.round(s.diff * 100)}%</span>
                          ) : (
                            <span className="text-[#147]">▼{Math.round(-s.diff * 100)}%</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="mt-1 text-[9px] text-[#1a1a1a]/50">前日比。前日に記録の無い区分は「新規」</p>
            </div>

            <div className="border border-[#1a1a1a]/40 p-2">
              <h3 className="mb-1 text-xs font-bold">社説</h3>
              {reflection?.bestThing || reflection?.carryOver || journal ? (
                <div className="space-y-1 text-[11px] leading-relaxed">
                  {reflection?.bestThing && <p>「{reflection.bestThing}」——本人はこう振り返る。</p>}
                  {reflection?.carryOver && <p>明日への申し送りとして「{reflection.carryOver}」が挙げられた。</p>}
                  {journal && <p className="text-[#1a1a1a]/70">{journal}</p>}
                </div>
              ) : (
                <p className="text-[11px] text-[#1a1a1a]/60">
                  本日の論説は休載。終業の振り返りが書かれた日は、ここにその言葉が載る。
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
