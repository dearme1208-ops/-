"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { formatHms, todayStr } from "@/lib/time";
import { segmentsAccumulatedMs } from "@/lib/tasks";
import { computeStreakDays } from "@/lib/streak";
import { tabLabel, useVisualMode, type TabKey } from "@/lib/theme";
import { useSetting } from "@/lib/settings";
import { buildAbilities, buildCondition, buildTurnState, playerRankOf } from "@/lib/powerpro";
import { powerproWordsFor } from "@/lib/powerproWords";
import { readPalette, paintPlayer, paintRankEmblem, rankCssColor } from "@/lib/powerproArt";
import { MENU_ENTRIES, buildMenuBadges, todayWorkedSeconds, type MenuBadge } from "@/lib/powerproMenu";
import { paintModeIcon } from "@/lib/powerproMenuArt";

// 育成選手モードのメインメニュー。
//
// 家庭用野球ゲームのモード選択画面の構図をそのまま持ち込む:
//   上段  … 育成の進行状況(何年目・何月・第何週)と、その日の調子
//   左    … 育てている選手の立ち絵とランク
//   中央  … モードのタイルを4列で並べたグリッド。これが主役
//   右    … 常に見えていてほしい数字の縦帯
//   下段  … いま指しているモードの説明(青い帯)
//
// タイルを押すとそのタブの中身へ入り、各タブの左上に出る「◀ メニュー」で戻る。
// タイルの色・記号は演出だが、バッジの件数・上段の数値はすべて実データの数え上げで、
// 演出のための水増しは一切していない。

export default function PowerproMenuSection({ onEnter }: { onEnter: (tab: TabKey) => void }) {
  const { wordingEnabled, wordingMode } = useVisualMode();
  const W = powerproWordsFor(wordingEnabled);
  const today = todayStr();
  const [now, setNow] = useState(() => Date.now());
  const [focused, setFocused] = useState<TabKey>("today");

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const tasks = useLiveQuery(() => db.dailyTasks.where("date").equals(today).sortBy("order"), [today]) ?? [];
  const todos = useLiveQuery(() => db.todoTasks.toArray(), []) ?? [];
  const projects = useLiveQuery(() => db.projects.toArray(), []) ?? [];
  const records = useLiveQuery(() => db.records.toArray(), []) ?? [];
  const masters = useLiveQuery(() => db.masterTasks.toArray(), []) ?? [];
  const [standardHoursStr] = useSetting("overtime.standardDailyHours", "8");

  const realTasks = useMemo(() => tasks.filter((t) => !t.isProvisional), [tasks]);
  const turn = useMemo(() => buildTurnState(today, records, realTasks), [today, records, realTasks]);
  // 経過秒の求め方は他のパワプロ画面と同じものを渡す(同じ画面で数字がずれないように)
  const elapsedOf = useMemo(() => (t: (typeof realTasks)[number]) => Math.round(segmentsAccumulatedMs(t, now) / 1000), [now]);
  const condition = useMemo(() => buildCondition(realTasks, elapsedOf), [realTasks, elapsedOf]);
  const abilities = useMemo(() => buildAbilities(records, todos, masters), [records, todos, masters]);
  const rank = useMemo(() => playerRankOf(abilities), [abilities]);
  const streak = useMemo(() => computeStreakDays(records, today), [records, today]);
  const workedSeconds = useMemo(() => todayWorkedSeconds(realTasks, now), [realTasks, now]);

  // 「要注意」に出す件数は、想定時間の1.3倍を超えて完了した直近30日の実績の数。
  // 要注意リストタブと同じ「想定から離れている」という観点をひとつの数字にしたもの
  const attentionCount = useMemo(() => {
    const est = new Map(masters.map((m) => [m.id, m.estimatedSeconds]));
    const from = new Date(today + "T00:00:00");
    from.setDate(from.getDate() - 30);
    const fromStr = from.toISOString().slice(0, 10);
    return records.filter((r) => {
      if (r.excludedFromStats || r.date < fromStr) return false;
      const e = r.masterTaskId ? est.get(r.masterTaskId) ?? 0 : 0;
      return e > 0 && r.seconds > e * 1.3;
    }).length;
  }, [records, masters, today]);

  const badges = useMemo(
    () => buildMenuBadges({ today, wordingEnabled, tasks: realTasks, todos, projects, records, now, attentionCount }),
    [today, wordingEnabled, realTasks, todos, projects, records, now, attentionCount]
  );

  const focusedEntry = MENU_ENTRIES.find((e) => e.key === focused) ?? MENU_ENTRIES[0];
  const standardHours = Math.max(1, Number(standardHoursStr) || 8);
  const staminaPct = Math.max(0, Math.min(100, Math.round(100 - (workedSeconds / (standardHours * 3600)) * 100)));

  return (
    <div className="space-y-2">
      {/* ================= 上段: 進行状況と調子 ================= */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cream/15 bg-gradient-to-r from-[#10203c] to-[#1b3358] px-3 py-2 text-white">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] uppercase tracking-[0.22em] text-white/50">
            {wordingEnabled ? "SUCCESS" : "MENU"}
          </span>
          <span className="font-display text-sm font-bold tabular-nums">
            {wordingEnabled
              ? `育成${turn.year}年目 ${turn.month}月 第${turn.weekOfMonth}週`
              : `${today}`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          <HeaderChip label={wordingEnabled ? "体力" : "残り時間"} value={`${staminaPct}%`} />
          <HeaderChip label={wordingEnabled ? "調子" : "見積り精度"} value={W.motivationName(condition.motivation)} />
          <HeaderChip label={wordingEnabled ? "連続出場" : "連続記録"} value={`${streak}日`} />
        </div>
      </div>

      {/* 狭い画面では左右の柱が入らないので、立ち絵とランクと数字を横1本の帯にまとめる。
          テレビ画面向けの構図をそのまま縦に潰すのではなく、順番を組み替えて成立させる */}
      <div className="flex items-center gap-2 overflow-hidden rounded-xl border border-cream/15 bg-gradient-to-r from-[#1b3358] to-[#0d1a30] px-2 py-1.5 sm:hidden">
        <div className="shrink-0 scale-[0.62] origin-left" style={{ width: 60, height: 74 }}>
          <PlayerPortrait motivation={condition.motivation} running={realTasks.some((t) => t.status === "running")} />
        </div>
        <div className="shrink-0">
          <RankEmblemSmall rank={rank.rank} />
        </div>
        <div className="grid min-w-0 flex-1 grid-cols-4 gap-1">
          <RailStat label={wordingEnabled ? "練習時間" : "実働"} value={formatHms(workedSeconds).slice(0, 5)} />
          <RailStat
            label={wordingEnabled ? "消化" : "完了"}
            value={`${realTasks.filter((t) => t.status === "done").length}/${realTasks.length}`}
          />
          <RailStat
            label={wordingEnabled ? "交渉中" : "未完了"}
            value={`${todos.filter((t) => !t.completed && !t.parentTaskId).length}`}
          />
          <RailStat
            label={wordingEnabled ? "契約" : "案件"}
            value={`${projects.filter((p) => !p.completedAt).length}`}
          />
        </div>
      </div>

      <div className="flex gap-2">
        {/* ================= 左: 選手の立ち絵 ================= */}
        <div className="hidden w-[104px] shrink-0 flex-col items-center justify-between overflow-hidden rounded-xl border border-cream/15 bg-gradient-to-b from-[#1b3358] to-[#0d1a30] py-2 sm:flex">
          <PlayerPortrait motivation={condition.motivation} running={realTasks.some((t) => t.status === "running")} />
          <div className="flex flex-col items-center gap-1">
            <RankEmblemSmall rank={rank.rank} />
            <span className="text-[9px] text-white/55">{wordingEnabled ? "総合ランク" : "総合評価"}</span>
          </div>
        </div>

        {/* ================= 中央: モードのタイル ================= */}
        <div className="min-w-0 flex-1">
          <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
            {MENU_ENTRIES.map((entry) => (
              <ModeTile
                key={entry.key}
                entry={entry}
                label={tabLabel(entry.key, wordingMode, entry.plainLabel)}
                badge={badges.get(entry.key) ?? null}
                selected={focused === entry.key}
                onFocus={() => setFocused(entry.key)}
                onEnter={() => onEnter(entry.key)}
              />
            ))}
          </div>
        </div>

        {/* ================= 右: 常時見せる数字の縦帯 ================= */}
        <div className="hidden w-[74px] shrink-0 flex-col gap-1 rounded-xl border border-cream/15 bg-gradient-to-b from-[#1b3358] to-[#0d1a30] p-1.5 sm:flex">
          <RailStat label={wordingEnabled ? "練習時間" : "実働"} value={formatHms(workedSeconds)} />
          <RailStat
            label={wordingEnabled ? "消化" : "完了"}
            value={`${realTasks.filter((t) => t.status === "done").length}/${realTasks.length}`}
          />
          <RailStat
            label={wordingEnabled ? "交渉中" : "未完了"}
            value={`${todos.filter((t) => !t.completed && !t.parentTaskId).length}`}
          />
          <RailStat
            label={wordingEnabled ? "契約" : "案件"}
            value={`${projects.filter((p) => !p.completedAt).length}`}
          />
        </div>
      </div>

      {/* ================= 下段: 指しているモードの説明 ================= */}
      <div className="overflow-hidden rounded-xl border border-cream/15">
        <div className="flex items-center gap-2 bg-gradient-to-r from-[#1d4fa0] to-[#2a72c8] px-3 py-2">
          <span
            className="h-3 w-3 shrink-0 rounded-sm"
            style={{ background: `rgb(${focusedEntry.color.join(",")})` }}
          />
          <span className="shrink-0 font-display text-sm font-bold text-white">
            {tabLabel(focusedEntry.key, wordingMode, focusedEntry.plainLabel)}
          </span>
          <button
            className="ml-auto shrink-0 rounded-full bg-white/20 px-3 py-1 text-[11px] font-bold text-white transition hover:bg-white/30"
            onClick={() => onEnter(focusedEntry.key)}
          >
            {wordingEnabled ? "決定 ▶" : "開く ▶"}
          </button>
        </div>
        <p className="bg-[#0d1a30] px-3 py-2 text-[11px] leading-relaxed text-white/75">
          {wordingEnabled ? focusedEntry.themedDesc : focusedEntry.plainDesc}
        </p>
      </div>

      <p className="px-1 text-[10px] text-cream/35">
        タイルを1回押すと下の帯に説明が出て、もう1回押すとその画面に入ります（説明の「
        {wordingEnabled ? "決定" : "開く"}」でも入れます）。タイルの下の数字は実際の件数です。
      </p>
    </div>
  );
}

function HeaderChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-center gap-1 rounded-full border border-white/20 bg-white/10 px-2 py-0.5">
      <span className="text-white/55">{label}</span>
      <span className="font-bold tabular-nums text-white">{value}</span>
    </span>
  );
}

function RailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-black/25 px-1.5 py-1 text-center">
      <div className="text-[8px] leading-tight text-white/45">{label}</div>
      <div className="font-display text-[11px] font-bold leading-tight tabular-nums text-white">{value}</div>
    </div>
  );
}

// 1枚のタイル。1回目のタップで選択(下の帯に説明)、2回目で決定という
// 家庭用ゲームのカーソル操作をそのまま指の操作に置き換えている
function ModeTile({
  entry,
  label,
  badge,
  selected,
  onFocus,
  onEnter,
}: {
  entry: (typeof MENU_ENTRIES)[number];
  label: string;
  badge: MenuBadge | null;
  selected: boolean;
  onFocus: () => void;
  onEnter: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setSize(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size === 0) return;
    const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintModeIcon(ctx, {
      size,
      glyph: entry.glyph,
      color: entry.color,
      selected,
      spark: badge?.spark ?? false,
      badge: badge ? { label: badge.label, value: badge.value, ratio: badge.ratio } : null,
    });
  }, [size, entry.glyph, entry.color, selected, badge]);

  return (
    <button
      type="button"
      className="group flex flex-col items-center gap-0.5 focus:outline-none"
      aria-pressed={selected}
      onClick={() => (selected ? onEnter() : onFocus())}
      onDoubleClick={onEnter}
    >
      <div
        ref={wrapRef}
        className={`w-full transition-transform duration-150 ${selected ? "scale-[1.06]" : "group-hover:scale-[1.03]"}`}
      >
        <canvas ref={canvasRef} className="block" />
      </div>
      <span
        className={`line-clamp-2 w-full rounded px-0.5 text-center text-[9px] leading-tight transition sm:text-[10px] ${
          selected ? "bg-cream/15 font-bold text-cream" : "text-cream/65"
        }`}
      >
        {label}
      </span>
    </button>
  );
}

// 左の立ち絵。既存の選手の絵をそのまま小さく描く
function PlayerPortrait({ motivation, running }: { motivation: 0 | 1 | 2 | 3 | 4; running: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const w = 96, h = 118;
    const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const pal = readPalette();
    paintPlayer(ctx, {
      cx: w / 2,
      baseY: h - 8,
      scale: 0.92,
      motivation,
      running,
      injured: false,
      accent: pal.accent,
      warm: [255, 240, 210],
      light: 0.8,
    });
  }, [motivation, running]);
  return <canvas ref={ref} className="block" />;
}

function RankEmblemSmall({ rank }: { rank: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const size = 34;
    const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    paintRankEmblem(ctx, { size, rank });
  }, [rank]);
  return <canvas ref={ref} className="block" />;
}
