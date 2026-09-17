"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { CONDITION_LEVELS } from "@/lib/condition";
import { formatClock, formatHms, shiftDateStr, todayStr } from "@/lib/time";

// 1日の実績を音楽に変換して鳴らす観測法。
// 音階はペンタトニック(どの組み合わせでも濁らない5音)に限定してあるので、
// どんな一日でも「曲」として成立する。荒れた日は荒れた曲になるだけで、外れた音にはならない
const PLAY_SECONDS = 24; // 1日をこの秒数に圧縮して再生する
const BASE_FREQ = 130.81; // C3
const MAJOR_PENTATONIC = [0, 2, 4, 7, 9];
const MINOR_PENTATONIC = [0, 3, 5, 7, 10];
const TIMBRES: OscillatorType[] = ["sine", "triangle", "square", "sawtooth"];

interface Note {
  id: string;
  category: string;
  name: string;
  startedAt: number;
  endedAt: number;
  seconds: number;
  /** 再生上の開始位置(秒) */
  at: number;
  /** 再生上の長さ(秒) */
  dur: number;
  freq: number;
  timbre: OscillatorType;
  gain: number;
}

export default function SoundtrackView() {
  const [date, setDate] = useState(() => todayStr());
  const records = useLiveQuery(() => db.records.where("date").equals(date).toArray(), [date]);
  const conditionLogs = useLiveQuery(() => db.conditionLogs.where("date").equals(date).toArray(), [date]);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<{ ctx: AudioContext; nodes: OscillatorNode[]; startedAt: number } | null>(null);
  const rafRef = useRef(0);

  const condition = useMemo(() => {
    const logs = (conditionLogs ?? []).slice().sort((a, b) => b.loggedAt - a.loggedAt);
    if (logs.length === 0) return null;
    return Number(logs[0].level);
  }, [conditionLogs]);
  // 体調が良い日は長調、優れない日は短調。未記録なら長調
  const scale = condition != null && condition <= 2 ? MINOR_PENTATONIC : MAJOR_PENTATONIC;

  const song = useMemo(() => {
    const list = (records ?? []).slice().sort((a, b) => a.startedAt - b.startedAt);
    if (list.length === 0) return null;
    const categories = [...new Set(list.map((r) => r.category))];
    const spanStart = Math.min(...list.map((r) => r.startedAt));
    const spanEnd = Math.max(...list.map((r) => r.endedAt));
    const span = Math.max(1, spanEnd - spanStart);
    const totalSeconds = list.reduce((s, r) => s + r.seconds, 0);
    const longest = Math.max(...list.map((r) => r.seconds));

    const notes: Note[] = list.map((r) => {
      const idx = categories.indexOf(r.category);
      const degree = scale[idx % scale.length];
      const octave = Math.floor(idx / scale.length);
      const semitone = degree + octave * 12;
      const at = ((r.startedAt - spanStart) / span) * PLAY_SECONDS;
      const dur = Math.max(0.16, ((r.endedAt - r.startedAt) / span) * PLAY_SECONDS);
      return {
        id: r.id,
        category: r.category,
        name: r.name,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        seconds: r.seconds,
        at,
        dur,
        freq: BASE_FREQ * Math.pow(2, semitone / 12),
        timbre: TIMBRES[idx % TIMBRES.length],
        gain: 0.06 + (r.seconds / Math.max(1, longest)) * 0.1,
      };
    });
    return { notes, categories, spanStart, spanEnd, totalSeconds };
  }, [records, scale]);

  function stop() {
    const audio = audioRef.current;
    if (audio) {
      for (const node of audio.nodes) {
        try {
          node.stop();
        } catch {
          // 既に停止済みのノードは無視する
        }
      }
      audio.ctx.close().catch(() => {});
      audioRef.current = null;
    }
    cancelAnimationFrame(rafRef.current);
    setPlaying(false);
    setProgress(0);
  }

  function play() {
    if (!song) return;
    stop();
    const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    const ctx = new AudioCtor();
    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    const nodes: OscillatorNode[] = [];
    const t0 = ctx.currentTime + 0.12;

    for (const n of song.notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = n.timbre;
      osc.frequency.value = n.freq;
      const start = t0 + n.at;
      const end = start + n.dur;
      // 立ち上がり・減衰を付けて、ぶつ切りのクリック音にならないようにする
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(n.gain, start + Math.min(0.06, n.dur * 0.3));
      gain.gain.setValueAtTime(n.gain, Math.max(start + 0.001, end - 0.08));
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain).connect(master);
      osc.start(start);
      osc.stop(end + 0.02);
      nodes.push(osc);
    }

    // 低音の支え。作業のあった時間帯にだけ、1時間ごとに短い持続音を置く
    const hoursWithWork = new Set(song.notes.map((n) => new Date(n.startedAt).getHours()));
    const spanHours = (song.spanEnd - song.spanStart) / 3600000;
    [...hoursWithWork].forEach((hour) => {
      const offsetHours = hour - new Date(song.spanStart).getHours();
      const at = t0 + (offsetHours / Math.max(0.5, spanHours)) * PLAY_SECONDS;
      if (at < t0 || at > t0 + PLAY_SECONDS) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = BASE_FREQ / 2;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.05, at + 0.1);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 1.1);
      osc.connect(gain).connect(master);
      osc.start(at);
      osc.stop(at + 1.2);
      nodes.push(osc);
    });

    audioRef.current = { ctx, nodes, startedAt: t0 };
    setPlaying(true);

    function tick() {
      const audio = audioRef.current;
      if (!audio) return;
      const elapsed = audio.ctx.currentTime - audio.startedAt;
      if (elapsed >= PLAY_SECONDS) {
        stop();
        return;
      }
      setProgress(Math.max(0, elapsed / PLAY_SECONDS));
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  useEffect(() => {
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 日付を変えたら、前の日の曲は止める
  useEffect(() => {
    stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const playheadSeconds = progress * PLAY_SECONDS;
  const conditionLabel = condition != null ? CONDITION_LEVELS.find((c) => Number(c.level) === condition) : null;

  return (
    <div className="space-y-3">
      <div className="panel flex flex-wrap items-center gap-2 p-3">
        <h3 className="font-display text-sm font-bold">🎵 サウンドトラック</h3>
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
        <button className="btn-pill text-sm" onClick={playing ? stop : play} disabled={!song}>
          {playing ? "⏹ 停止" : "▶ この日を再生"}
        </button>
        {song && (
          <span className="text-xs text-cream/50">
            {song.notes.length}音 ・ {scale === MINOR_PENTATONIC ? "短調" : "長調"}
            {conditionLabel && `（体調: ${conditionLabel.label}）`}
          </span>
        )}
      </div>

      {!song ? (
        <div className="panel p-6 text-center text-sm text-cream/50">この日の実績がありません。</div>
      ) : (
        <div className="panel p-4">
          {/* ピアノロール。再生位置に合わせて、鳴っている音が光る */}
          <div className="relative overflow-hidden rounded-lg border border-cream/15 bg-black/40" style={{ height: song.categories.length * 26 + 16 }}>
            {song.categories.map((c, i) => (
              <div
                key={c}
                className="absolute left-0 right-0 border-b border-cream/5"
                style={{ top: i * 26 + 8, height: 26 }}
              >
                <span className="absolute left-1 top-1 z-10 text-[9px] text-cream/40">{c}</span>
              </div>
            ))}
            {song.notes.map((n) => {
              const left = (n.at / PLAY_SECONDS) * 100;
              const width = Math.max(0.6, (n.dur / PLAY_SECONDS) * 100);
              const row = song.categories.indexOf(n.category);
              const active = playing && playheadSeconds >= n.at && playheadSeconds <= n.at + n.dur;
              return (
                <div
                  key={n.id}
                  className={`absolute rounded-sm transition-colors ${active ? "bg-alert" : "bg-cream/45"}`}
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    top: row * 26 + 14,
                    height: 14,
                    boxShadow: active ? "0 0 10px rgb(var(--accent-rgb))" : undefined,
                  }}
                  title={`${n.category} / ${n.name}　${formatClock(n.startedAt)}〜（${formatHms(n.seconds)}）`}
                />
              );
            })}
            {playing && (
              <div
                className="absolute top-0 bottom-0 w-px bg-cream"
                style={{ left: `${progress * 100}%` }}
              />
            )}
          </div>

          <div className="mt-2 flex items-center justify-between text-[10px] text-cream/45">
            <span>{formatClock(song.spanStart)}</span>
            <span>{playing ? `再生中 ${playheadSeconds.toFixed(1)} / ${PLAY_SECONDS}秒` : `1日を${PLAY_SECONDS}秒に圧縮`}</span>
            <span>{formatClock(song.spanEnd)}</span>
          </div>

          <ul className="mt-2 space-y-0.5 text-[10px] leading-relaxed text-cream/40">
            <li>・音の高さ = 業務区分（区分ごとに固定の音。同じ区分は毎回同じ高さで鳴ります）</li>
            <li>・音色 = 区分の並び順で sine / triangle / square / saw を割り当て</li>
            <li>・音の長さ = 作業時間　音量 = その日の最長作業に対する比率</li>
            <li>・調 = 記録した体調（不調の日は短調になります）</li>
            <li>・低く長い音 = 作業があった各時間帯の区切り</li>
          </ul>
        </div>
      )}
    </div>
  );
}
