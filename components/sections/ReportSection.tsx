"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { aggregateRecords } from "@/lib/aggregate";
import { computeAttentionList, type AttentionRow } from "@/lib/attention";
import { getPeriodRange, isDateStrInRange, type PeriodFilter } from "@/lib/period";
import { generateReportText, downloadTextFile } from "@/lib/report";
import { formatHms, todayStr } from "@/lib/time";
import RankingBarChart from "@/components/charts/RankingBarChart";

const TOP_N = 10;

export default function ReportSection() {
  const [kind, setKind] = useState<"week" | "month">("week");

  const records = useLiveQuery(() => db.records.toArray(), []);
  const masterTasks = useLiveQuery(() => db.masterTasks.toArray(), []);

  const title = kind === "week" ? "週報" : "月報";
  const filter: PeriodFilter = { type: kind };

  const data = useMemo(() => {
    if (!records || !masterTasks) return null;
    const range = getPeriodRange(filter);
    const rangeLabel = range
      ? `${range.start.toISOString().slice(0, 10)} 〜 ${range.end.toISOString().slice(0, 10)}`
      : "累計";
    const ranking = aggregateRecords(records, filter, "total");
    const periodRecords = records.filter((r) => isDateStrInRange(r.date, range));
    const attention = computeAttentionList(masterTasks, periodRecords);
    const totalSeconds = ranking.reduce((s, r) => s + r.totalSeconds, 0);
    const totalCount = ranking.reduce((s, r) => s + r.count, 0);
    return { rangeLabel, ranking, attention, totalSeconds, totalCount };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, masterTasks, kind]);

  function download() {
    if (!records || !masterTasks) return;
    const text = generateReportText(title, filter, records, masterTasks);
    const label = kind === "week" ? "weekly" : "monthly";
    downloadTextFile(`report_${label}_${todayStr()}.txt`, text);
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
        <button className="btn-pill-outline text-sm" onClick={download} disabled={!data}>
          ダウンロード (.txt)
        </button>
      </div>

      {!data ? (
        <p className="text-sm text-cream/50">読み込み中...</p>
      ) : data.ranking.length === 0 ? (
        <div className="panel p-6 text-center text-sm text-cream/50">この期間の実績データはまだありません。</div>
      ) : (
        <div className="space-y-4">
          <div className="panel p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="font-display text-2xl font-bold text-cream">{title}</h2>
                <p className="text-sm text-cream/60">{data.rangeLabel}</p>
              </div>
              <p className="text-right text-[10px] leading-tight text-cream/40">
                生成日時
                <br />
                {new Date().toLocaleString("ja-JP")}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="合計作業時間" value={formatHms(data.totalSeconds)} />
            <StatTile label="記録件数" value={`${data.totalCount}件`} />
            <StatTile label="対象タスク数" value={`${data.ranking.length}種類`} />
            <StatTile
              label="要注意項目"
              value={`${data.attention.length}件`}
              accent={data.attention.length > 0}
            />
          </div>

          <div className="panel p-4">
            <h3 className="mb-3 font-display text-sm font-bold text-cream/80">
              📊 作業時間ランキング（上位{Math.min(TOP_N, data.ranking.length)}件）
            </h3>
            <RankingBarChart
              data={data.ranking.slice(0, TOP_N).map((r) => ({
                label: r.name,
                sublabel: r.category,
                value: r.totalSeconds,
              }))}
              formatValue={formatHms}
            />
            {data.ranking.length > TOP_N && (
              <p className="mt-3 text-[10px] text-cream/40">他{data.ranking.length - TOP_N}件（.txtダウンロードで全件確認できます）</p>
            )}
          </div>

          <div className="panel p-4">
            <h3 className="mb-3 font-display text-sm font-bold text-cream/80">
              ⚠️ 要注意項目（想定比+30%以上の超過）
            </h3>
            {data.attention.length === 0 ? (
              <p className="text-sm text-cream/50">該当なし。想定比+30%以上の超過はありません。</p>
            ) : (
              <div className="space-y-2">
                {data.attention.map((a) => (
                  <AttentionRowCard key={a.masterTaskId} row={a} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`panel p-4 ${accent ? "border border-alert/40" : ""}`}>
      <div className="text-xs text-cream/50">{label}</div>
      <div className={`mt-1 font-display text-2xl font-bold tabular-nums ${accent ? "text-alert" : "text-cream"}`}>
        {value}
      </div>
    </div>
  );
}

function AttentionRowCard({ row }: { row: AttentionRow }) {
  const estPct = Math.min(100, (row.estimatedSeconds / row.avgSeconds) * 100);
  return (
    <div className="rounded-lg border border-alert/30 bg-alert/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs text-cream/50">{row.category}</div>
          <div className="text-sm font-bold text-cream">{row.name}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-cream/50">
            想定 {formatHms(row.estimatedSeconds)} → 平均 {formatHms(row.avgSeconds)}（{row.sampleCount}件）
          </div>
          <div className="font-display text-lg font-bold text-alert">+{Math.round(row.overRatio * 100)}%</div>
        </div>
      </div>
      <div className="relative mt-2 h-2.5 w-full overflow-hidden rounded bg-cream/5">
        <div className="absolute inset-y-0 left-0 bg-cream/40" style={{ width: `${estPct}%` }} />
        <div className="absolute inset-y-0 bg-alert" style={{ left: `${estPct}%`, right: 0 }} />
      </div>
    </div>
  );
}
