"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { formatClock, formatHms, formatDateJp } from "@/lib/time";
import Modal from "@/components/ui/Modal";

// 1日の実績をヒートマップやガントのような静止した集計としてではなく、朝から順に
// タスクが立ち上がって消えていく様子をタイムラプス風に「再生」して見せる。
// 実時間を圧縮再生するだけの単純な仕組みだが、終業後に「今日はこう動いた」を
// 眺め直す体験として、既存の集計系ビューとは違う軸の見せ方になる
const PLAYBACK_MS = 14000; // 1倍速で1日分を再生し切るのにかける実時間(ミリ秒)

// カテゴリ名から見た目の色相を安定して決める(新しい共有パレットを増やさず、この用途だけの軽量な割り当て)
function hueForCategory(category: string): number {
  let h = 0;
  for (let i = 0; i < category.length; i++) h = (h * 31 + category.charCodeAt(i)) % 360;
  return h;
}

export default function DayReplayModal({ date, onClose }: { date: string; onClose: () => void }) {
  const records = useLiveQuery(() => db.records.where("date").equals(date).toArray(), [date]);

  const sorted = useMemo(
    () => (records ?? []).slice().sort((a, b) => a.startedAt - b.startedAt),
    [records]
  );
  const rangeStart = sorted.length > 0 ? Math.min(...sorted.map((r) => r.startedAt)) : 0;
  const rangeEnd = sorted.length > 0 ? Math.max(...sorted.map((r) => r.endedAt)) : 0;
  const totalRangeMs = Math.max(1, rangeEnd - rangeStart);

  const [playheadMs, setPlayheadMs] = useState(0); // rangeStartからの経過ミリ秒(0〜totalRangeMs)
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!playing || sorted.length === 0) return;
    let startWallClock: number | null = null;
    let startPlayhead = playheadMs;
    function tick(now: number) {
      if (startWallClock === null) startWallClock = now;
      const elapsedWall = now - startWallClock;
      const virtualElapsed = (elapsedWall / PLAYBACK_MS) * totalRangeMs * speed;
      const next = startPlayhead + virtualElapsed;
      if (next >= totalRangeMs) {
        setPlayheadMs(totalRangeMs);
        setPlaying(false);
        return;
      }
      setPlayheadMs(next);
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // playheadMsは再生開始時点のスナップショットとしてのみ使うため、依存に含めない(含めると毎フレーム再起動してしまう)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, speed, sorted.length, totalRangeMs]);

  function togglePlay() {
    if (!playing && playheadMs >= totalRangeMs) setPlayheadMs(0); // 最後まで見終わっていたら最初から
    setPlaying((p) => !p);
  }

  function reset() {
    setPlaying(false);
    setPlayheadMs(0);
  }

  const currentClockMs = rangeStart + playheadMs;
  const activeRecord = sorted.find((r) => currentClockMs >= r.startedAt && currentClockMs <= r.endedAt);
  const revealedCount = sorted.filter((r) => currentClockMs >= r.startedAt).length;

  return (
    <Modal title={`📼 ${formatDateJp(date)}のリプレイ`} onClose={onClose}>
      <div className="space-y-4">
        {sorted.length === 0 ? (
          <p className="text-sm text-cream/50">この日の実績が見つかりませんでした。</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 text-xs text-cream/50">
              <span className="tabular-nums">{formatClock(currentClockMs)}</span>
              <span>
                {revealedCount} / {sorted.length}件
              </span>
            </div>

            {/* 現在再生中の作業を、音楽プレイヤーの「再生中」のように大きく見せる */}
            <div className="flex h-14 items-center justify-center rounded-lg border border-cream/15 bg-ink/50 px-3 text-center">
              {activeRecord ? (
                <p className="truncate text-sm font-bold text-cream">
                  {activeRecord.category} / {activeRecord.name}
                </p>
              ) : (
                <p className="text-xs text-cream/30">
                  {playheadMs <= 0 ? "▶ を押すと再生が始まります" : "（作業と作業の合間）"}
                </p>
              )}
            </div>

            {/* タイムライン本体。実績ブロックは再生ヘッドが通過すると現れる */}
            <div className="relative h-24 overflow-hidden rounded-lg border border-cream/15 bg-ink/30">
              {sorted.map((r) => {
                const left = ((r.startedAt - rangeStart) / totalRangeMs) * 100;
                const width = Math.max(0.6, ((r.endedAt - r.startedAt) / totalRangeMs) * 100);
                const revealed = currentClockMs >= r.startedAt;
                const active = r === activeRecord;
                const hue = hueForCategory(r.category);
                return (
                  <div
                    key={r.id}
                    className="absolute top-3 flex h-[72%] flex-col justify-center overflow-hidden rounded px-1.5 transition-all duration-300"
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      backgroundColor: `hsl(${hue} 55% ${active ? 42 : 30}% / ${revealed ? 0.9 : 0.12})`,
                      border: active ? `1px solid hsl(${hue} 70% 65%)` : "1px solid transparent",
                      transform: revealed ? "scaleY(1)" : "scaleY(0.7)",
                      opacity: revealed ? 1 : 0.5,
                    }}
                    title={`${r.category} / ${r.name}（${formatClock(r.startedAt)}〜${formatClock(r.endedAt)}・${formatHms(r.seconds)}）`}
                  >
                    {revealed && width > 6 && (
                      <span className="truncate text-[10px] font-bold text-ink drop-shadow-sm">{r.name}</span>
                    )}
                  </div>
                );
              })}
              {/* 再生ヘッド */}
              <div
                className="absolute top-0 h-full w-px bg-cream/80"
                style={{ left: `${(playheadMs / totalRangeMs) * 100}%` }}
              />
            </div>

            <input
              type="range"
              min={0}
              max={totalRangeMs}
              value={playheadMs}
              onChange={(e) => {
                setPlaying(false);
                setPlayheadMs(Number(e.target.value));
              }}
              className="w-full accent-cream"
            />

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button className="btn-pill text-sm" onClick={togglePlay}>
                  {playing ? "⏸ 一時停止" : playheadMs >= totalRangeMs ? "🔁 最初から再生" : "▶ 再生"}
                </button>
                <button className="btn-pill-outline text-sm" onClick={reset}>
                  ⏮ 巻き戻す
                </button>
              </div>
              <div className="flex items-center gap-1">
                {[1, 2, 4, 8].map((s) => (
                  <button
                    key={s}
                    className={speed === s ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
                    onClick={() => setSpeed(s)}
                  >
                    {s}倍速
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
