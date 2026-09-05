"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { todayStr } from "@/lib/time";
import { useVisualMode } from "@/lib/theme";
import { buildCalibration, buildThinking, confidenceLabel, type Finding } from "@/lib/claudeThinking";
import { claudeWordsFor } from "@/lib/claudeWords";
import { Calibration, ConfidenceScale, Paper, Rhythm, ThreadRail } from "@/components/claude/ClaudeCanvas";

// Claudeモードの「インサイト」タブ。
//
// 他モードが実データを別の語彙で言い換えるのに対し、この画面は実データを実際に
// 分析して、その結論・根拠・確信度・反証条件を開示する。数字はすべて
// lib/claudeThinking.ts が記録から計算したもので、演出のための値は1つも無い。
//
// 画面の作りは研究ノートに寄せている。左に思考の系(実際に通った手順)、
// 右にその手順の説明。その下に、確信度の高い順に並べた気づき。
export default function ClaudeInsightsSection() {
  const { wordingEnabled } = useVisualMode();
  const W = claudeWordsFor(wordingEnabled);
  const today = todayStr();

  const records = useLiveQuery(() => db.records.toArray(), []);
  const masters = useLiveQuery(() => db.masterTasks.toArray(), []);
  const todos = useLiveQuery(() => db.todoTasks.toArray(), []);
  const projects = useLiveQuery(() => db.projects.toArray(), []);

  const ready = !!records && !!masters && !!todos && !!projects;
  const thinking = useMemo(
    () => (ready ? buildThinking(records!, masters!, todos!, projects!, today) : null),
    [ready, records, masters, todos, projects, today]
  );
  const dots = useMemo(() => (ready ? buildCalibration(records!, masters!) : []), [ready, records, masters]);

  // 思考の系を、開いてから順に灯していく。分析そのものは同期的に終わっているが、
  // 「どの順で考えたか」を読み手が追えるように、手順を1つずつ見せる
  const [traced, setTraced] = useState(0);
  const stepCount = thinking?.steps.length ?? 0;
  useEffect(() => {
    if (stepCount === 0) return;
    setTraced(0);
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setTraced(i);
      if (i >= stepCount) clearInterval(id);
    }, 260);
    return () => clearInterval(id);
  }, [stepCount]);

  const [openId, setOpenId] = useState<string | null>(null);

  // 時間帯ごとの着手件数。分析と同じ実績から数える
  const hours = useMemo(() => {
    const acc = new Array(24).fill(0);
    for (const r of records ?? []) {
      if (r.excludedFromStats || !r.startedAt) continue;
      acc[new Date(r.startedAt).getHours()] += 1;
    }
    return acc;
  }, [records]);

  if (!thinking) {
    return <p className="px-1 py-8 text-center text-sm text-cream/40">…</p>;
  }

  const overCount = dots.filter((d) => d.over).length;

  return (
    <div className="space-y-6">
      {/* ══ 見出し ══ */}
      <header className="space-y-2">
        <h2 className="font-display text-2xl font-bold tracking-tight text-cream">{W.insightTitle}</h2>
        <p className="max-w-prose text-[13px] leading-relaxed text-cream/55">{W.insightLead}</p>
        <div className="h-px w-full bg-cream/10" />
      </header>

      {thinking.usableRecords === 0 ? (
        <p className="rounded-xl border border-cream/10 bg-panel/60 p-6 text-center text-sm text-cream/50">{W.noData}</p>
      ) : (
        <>
          {/* ══ どう考えたか ══ */}
          <section>
            <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-cream/40">{W.thinkingTitle}</h3>
            <p className="mt-1 text-[12px] text-cream/45">{W.thinkingLead}</p>
            <ol className="mt-3">
              {thinking.steps.map((s, i) => (
                <li key={s.label} className="flex gap-2.5">
                  <ThreadRail
                    lit={i < traced}
                    first={i === 0}
                    last={i === thinking.steps.length - 1}
                    seed={`step${i}`}
                  />
                  <div
                    className="min-w-0 flex-1 pb-5 transition-opacity duration-500"
                    style={{ opacity: i < traced ? 1 : 0.25 }}
                  >
                    <p className="font-display text-[13px] font-bold leading-5 text-cream/85">{s.label}</p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-cream/50">{s.note}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {/* ══ 気づいたこと ══ */}
          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-cream/40">{W.findingsTitle}</h3>
              <span className="text-[11px] tabular-nums text-cream/35">{thinking.findings.length}</span>
            </div>

            {thinking.findings.length === 0 ? (
              <div className="rounded-xl border border-cream/10 bg-panel/60 p-5">
                <p className="text-sm text-cream/60">{W.findingsEmpty}</p>
                <p className="mt-1 text-[12px] text-cream/40">{W.findingsEmptyHint(thinking.usableRecords)}</p>
              </div>
            ) : (
              thinking.findings.map((f, i) => (
                <FindingCard
                  key={f.id}
                  finding={f}
                  index={i + 1}
                  words={W}
                  open={openId === f.id}
                  onToggle={() => setOpenId(openId === f.id ? null : f.id)}
                />
              ))
            )}
          </section>

          {/* ══ 想定と実績 ══ */}
          <section className="space-y-2">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-cream/40">{W.calibrationTitle}</h3>
            {dots.length === 0 ? (
              <p className="text-[12px] text-cream/40">{W.calibrationEmpty}</p>
            ) : (
              <>
                <p className="max-w-prose text-[12px] leading-relaxed text-cream/50">{W.calibrationLead}</p>
                <div className="relative overflow-hidden rounded-xl border border-cream/10">
                  <Paper seed="calibration" className="absolute inset-0" />
                  <Calibration dots={dots} className="relative" />
                </div>
                <p className="text-[12px] tabular-nums text-cream/45">{W.calibrationOver(overCount, dots.length)}</p>
              </>
            )}
          </section>

          {/* ══ 一日の律動 ══ */}
          <section className="space-y-2">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-cream/40">{W.rhythmTitle}</h3>
            <p className="max-w-prose text-[12px] leading-relaxed text-cream/50">{W.rhythmLead}</p>
            <div className="relative overflow-hidden rounded-xl border border-cream/10">
              <Paper seed="rhythm" className="absolute inset-0" />
              <Rhythm hours={hours} nowHour={new Date().getHours()} className="relative px-1 pt-1" />
            </div>
          </section>
        </>
      )}
    </div>
  );
}

// 気づき1件。畳んだ状態では結論と確信度だけ、開くと根拠・次の一手・反証条件が出る。
// 結論の隣に必ず確信度を置くのは、断定と推測を読み手が取り違えないようにするため
function FindingCard({
  finding,
  index,
  words,
  open,
  onToggle,
}: {
  finding: Finding;
  index: number;
  words: ReturnType<typeof claudeWordsFor>;
  open: boolean;
  onToggle: () => void;
}) {
  const f = finding;
  return (
    <article className="relative overflow-hidden rounded-xl border border-cream/12">
      <Paper seed={f.id} className="absolute inset-0" />
      <div className="relative">
        <button onClick={onToggle} className="block w-full px-4 pb-3 pt-3.5 text-left">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] tabular-nums text-cream/30">
              {String(index).padStart(2, "0")}
            </span>
            <span className="rounded-full border border-alert/30 px-2 py-0.5 text-[10px] tracking-wider text-alert">
              {words.kindLabel(f.kind)}
            </span>
            <span className="ml-auto text-[10px] tabular-nums text-cream/35">{words.sampleLabel(f.sampleSize)}</span>
            <span className={`text-[11px] text-cream/30 transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
          </div>

          <h4 className="mt-2 font-display text-[15px] font-bold leading-snug text-cream">{f.headline}</h4>

          <div className="mt-2.5 flex items-center gap-2.5">
            <span className="shrink-0 text-[10px] tracking-wider text-cream/40">{words.confidenceLabel}</span>
            <ConfidenceScale value={f.confidence} className="min-w-0 flex-1" />
            <span className="shrink-0 text-[10px] tabular-nums text-cream/50">
              {Math.round(f.confidence * 100)}%・{confidenceLabel(f.confidence)}
            </span>
          </div>
        </button>

        {open && (
          <div className="space-y-3 border-t border-cream/10 px-4 pb-4 pt-3">
            <p className="max-w-prose text-[13px] leading-relaxed text-cream/70">{f.detail}</p>

            <div>
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-cream/35">
                {words.evidenceLabel}
              </p>
              <dl className="space-y-1">
                {f.evidence.map((e) => (
                  <div key={e.label} className="flex gap-3 border-b border-cream/[0.07] pb-1 text-[12px]">
                    <dt className="w-40 shrink-0 text-cream/40">{e.label}</dt>
                    <dd className="min-w-0 flex-1 tabular-nums text-cream/80">{e.value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {f.action && (
              <div className="border-l-2 border-alert/50 pl-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-alert/80">{words.actionLabel}</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-cream/75">{f.action}</p>
              </div>
            )}

            <div className="border-l-2 border-cream/15 pl-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cream/35">{words.counterLabel}</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-cream/50">{f.counterpoint}</p>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
