"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { formatHms, todayStr } from "@/lib/time";
import { segmentsAccumulatedMs } from "@/lib/tasks";
import { computeStreakDays } from "@/lib/streak";
import { tabLabel, useVisualMode, visibleTabKeys, type TabKey } from "@/lib/theme";
import { useSetting } from "@/lib/settings";
import { buildAbilities, buildCondition, buildTurnState, playerRankOf } from "@/lib/powerpro";
import { powerproWordsFor } from "@/lib/powerproWords";
import { readPalette, paintPlayer, paintRankEmblem } from "@/lib/powerproArt";
import { MENU_ENTRIES, buildMenuBadges, todayWorkedSeconds, type MenuBadge } from "@/lib/powerproMenu";
import { paintModeIcon, type TileShape } from "@/lib/powerproMenuArt";
import { PLAIN_MENU_WORDS, menuSkinFor, type MenuSkin } from "@/lib/mainMenu";

// モード選択メニュー。タブへ入る前の入口になる画面。
//
// 家庭用ゲームのモード選択画面の構図をそのまま持ち込む:
//   上段  … 進行状況(何年目・何月・第何週)と、その日の調子
//   左    … 立ち絵と総合評価(立ち絵を持っているモードだけ)
//   中央  … タブのタイルを4列で並べたグリッド。これが主役
//   右    … 常に見えていてほしい数字の縦帯
//   下段  … いま指しているタブの説明
//
// タイルを押すとそのタブの中身へ入り、各タブの左上に出る「◀ メニュー」で戻る。
// モードごとに変わるのはタイルの輪郭と質感、数字の呼び名、進行状況の言い回しだけで、
// 並ぶタイルも件数も共通。バッジの件数・上段の数値はすべて実データの数え上げで、
// 演出のための水増しは一切していない。

export default function MainMenuSection({ onEnter }: { onEnter: (tab: TabKey) => void }) {
  const { mode, wordingEnabled, wordingMode } = useVisualMode();
  const W = powerproWordsFor(wordingEnabled);
  const today = todayStr();
  const [now, setNow] = useState(() => Date.now());
  const [focused, setFocused] = useState<TabKey>("today");

  // 呼べるのはメニューを持つモードだけだが、型の上で必ず値があることにするため既定を用意する
  const skin: MenuSkin = menuSkinFor(mode) ?? menuSkinFor("powerpro")!;
  // 演出テーマ文言がオフのときは、形と色はそのままに言葉だけ元へ戻す
  const eyebrow = wordingEnabled ? skin.eyebrow : PLAIN_MENU_WORDS.eyebrow;
  const chips = wordingEnabled ? skin.chips : PLAIN_MENU_WORDS.chips;
  const rail = wordingEnabled ? skin.rail : PLAIN_MENU_WORDS.rail;
  const enterLabel = wordingEnabled ? skin.enterLabel : PLAIN_MENU_WORDS.enterLabel;
  const rankLabel = wordingEnabled ? skin.rankLabel : PLAIN_MENU_WORDS.rankLabel;

  // タブを絞っているモードでは、そのモードで出ないタブのタイルは並べない
  const entries = useMemo(() => {
    const visible = new Set(visibleTabKeys(mode, MENU_ENTRIES.map((e) => e.key)));
    return MENU_ENTRIES.filter((e) => visible.has(e.key));
  }, [mode]);

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

  const focusedEntry = entries.find((e) => e.key === focused) ?? entries[0];
  const standardHours = Math.max(1, Number(standardHoursStr) || 8);
  const staminaPct = Math.max(0, Math.min(100, Math.round(100 - (workedSeconds / (standardHours * 3600)) * 100)));

  // 枠の配色。育成選手モードは元の濃紺をそのまま、他のモードはアプリのpanel/creamに乗せる。
  // 明るいテーマ(図書館・なつやすみなど)でも文字が読めることを、配色ごとに確かめ直さずに済む
  const navy = skin.navyFrame;
  const headClass = navy ? "bg-gradient-to-r from-[#10203c] to-[#1b3358] text-white" : "bg-panel text-cream";
  const railClass = navy ? "bg-gradient-to-b from-[#1b3358] to-[#0d1a30] text-white" : "bg-panel text-cream";
  const stripClass = navy ? "bg-gradient-to-r from-[#1b3358] to-[#0d1a30] text-white" : "bg-panel text-cream";
  const barClass = navy ? "bg-gradient-to-r from-[#1d4fa0] to-[#2a72c8] text-white" : "bg-cream/10 text-cream";
  const descClass = navy ? "bg-[#0d1a30] text-white/75" : "bg-panel text-cream/75";
  const subTextClass = navy ? "text-white/50" : "text-cream/50";
  const chipClass = navy ? "border-white/20 bg-white/10 text-white" : "border-cream/20 bg-cream/5 text-cream";
  const enterBtnClass = navy
    ? "bg-white/20 text-white hover:bg-white/30"
    : "bg-cream/15 text-cream hover:bg-cream/25";

  return (
    <div className="space-y-2">
      {/* ================= 上段: 進行状況と調子 ================= */}
      <div className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cream/15 px-3 py-2 ${headClass}`}>
        <div className="flex items-baseline gap-2">
          <span className={`text-[10px] uppercase tracking-[0.22em] ${subTextClass}`}>{eyebrow}</span>
          <span className="font-display text-sm font-bold tabular-nums">
            {wordingEnabled ? skin.progress(turn) : today}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          <HeaderChip label={chips[0]} value={`${staminaPct}%`} chipClass={chipClass} subTextClass={subTextClass} />
          <HeaderChip label={chips[1]} value={W.motivationName(condition.motivation)} chipClass={chipClass} subTextClass={subTextClass} />
          <HeaderChip label={chips[2]} value={`${streak}日`} chipClass={chipClass} subTextClass={subTextClass} />
        </div>
      </div>

      {/* 狭い画面では左右の柱が入らないので、立ち絵とランクと数字を横1本の帯にまとめる。
          テレビ画面向けの構図をそのまま縦に潰すのではなく、順番を組み替えて成立させる */}
      <div className={`flex items-center gap-2 overflow-hidden rounded-xl border border-cream/15 px-2 py-1.5 sm:hidden ${stripClass}`}>
        {skin.portrait && (
          <div className="shrink-0">
            <PlayerPortrait
              motivation={condition.motivation}
              running={realTasks.some((t) => t.status === "running")}
              width={58}
            />
          </div>
        )}
        <div className="shrink-0">
          <RankEmblemSmall rank={rank.rank} />
        </div>
        <div className="grid min-w-0 flex-1 grid-cols-4 gap-1">
          <RailStat label={rail[0]} value={formatHms(workedSeconds).slice(0, 5)} navy={navy} />
          <RailStat
            label={rail[1]}
            value={`${realTasks.filter((t) => t.status === "done").length}/${realTasks.length}`}
            navy={navy}
          />
          <RailStat label={rail[2]} value={`${todos.filter((t) => !t.completed && !t.parentTaskId).length}`} navy={navy} />
          <RailStat label={rail[3]} value={`${projects.filter((p) => !p.completedAt).length}`} navy={navy} />
        </div>
      </div>

      <div className="flex gap-2">
        {/* ================= 左: 選手の立ち絵 ================= */}
        {skin.portrait && (
          <div className={`hidden w-[104px] shrink-0 flex-col items-center justify-between overflow-hidden rounded-xl border border-cream/15 py-2 sm:flex ${railClass}`}>
            <PlayerPortrait motivation={condition.motivation} running={realTasks.some((t) => t.status === "running")} />
            <div className="flex flex-col items-center gap-1">
              <RankEmblemSmall rank={rank.rank} />
              <span className={`text-[9px] ${subTextClass}`}>{rankLabel}</span>
            </div>
          </div>
        )}

        {/* ================= 中央: モードのタイル ================= */}
        <div className="min-w-0 flex-1">
          {/* 4列固定だと、ページ幅いっぱいに広がるパソコン版でタイルが際限なく巨大化してしまう
              (スマホ幅では左右の柱が無く4列がちょうど良い大きさに収まる一方、パソコン幅では
              柱を差し引いた残りをたった4つで分け合うことになるため)。画面が広がった分は
              タイルを大きくするのではなく列数を増やして吸収する。18枚が6列でちょうど3段に揃う */}
          <div className="grid grid-cols-4 gap-1.5 sm:gap-2 md:grid-cols-5 lg:grid-cols-6">
            {entries.map((entry) => (
              <ModeTile
                key={entry.key}
                entry={entry}
                label={tabLabel(entry.key, wordingMode, entry.plainLabel)}
                badge={badges.get(entry.key) ?? null}
                selected={focused === entry.key}
                shape={skin.shape}
                chrome={skin.chrome}
                onFocus={() => setFocused(entry.key)}
                onEnter={() => onEnter(entry.key)}
              />
            ))}
          </div>
        </div>

        {/* ================= 右: 常時見せる数字の縦帯 ================= */}
        <div className={`hidden w-[74px] shrink-0 flex-col gap-1 rounded-xl border border-cream/15 p-1.5 sm:flex ${railClass}`}>
          {/* 立ち絵を持たないモードでは左の柱が無いので、総合評価はこちらに出す */}
          {!skin.portrait && (
            <div className="flex flex-col items-center gap-0.5 pb-0.5">
              <RankEmblemSmall rank={rank.rank} />
              <span className={`text-[8px] leading-tight ${subTextClass}`}>{rankLabel}</span>
            </div>
          )}
          <RailStat label={rail[0]} value={formatHms(workedSeconds)} navy={navy} />
          <RailStat
            label={rail[1]}
            value={`${realTasks.filter((t) => t.status === "done").length}/${realTasks.length}`}
            navy={navy}
          />
          <RailStat label={rail[2]} value={`${todos.filter((t) => !t.completed && !t.parentTaskId).length}`} navy={navy} />
          <RailStat label={rail[3]} value={`${projects.filter((p) => !p.completedAt).length}`} navy={navy} />
        </div>
      </div>

      {/* ================= 下段: 指しているモードの説明 ================= */}
      <div className="overflow-hidden rounded-xl border border-cream/15">
        <div className={`flex items-center gap-2 px-3 py-2 ${barClass}`}>
          <span
            className="h-3 w-3 shrink-0 rounded-sm"
            style={{ background: `rgb(${focusedEntry.color.join(",")})` }}
          />
          <span className="shrink-0 font-display text-sm font-bold">
            {tabLabel(focusedEntry.key, wordingMode, focusedEntry.plainLabel)}
          </span>
          <button
            className={`ml-auto shrink-0 rounded-full px-3 py-1 text-[11px] font-bold transition ${enterBtnClass}`}
            onClick={() => onEnter(focusedEntry.key)}
          >
            {enterLabel}
          </button>
        </div>
        {/* 説明は「そのタブで何ができるか」なので、育成選手モード以外は言い換えずに
            そのまま出す。見出しにはモードごとのタブ名が出ているので取り違えは起きない */}
        <p className={`px-3 py-2 text-[11px] leading-relaxed ${descClass}`}>
          {wordingEnabled && skin.navyFrame ? focusedEntry.themedDesc : focusedEntry.plainDesc}
        </p>
      </div>

      <p className="px-1 text-[10px] text-cream/35">
        タイルを1回押すと下の帯に説明が出て、もう1回押すとその画面に入ります（説明の帯のボタンでも入れます）。タイルの下の数字は実際の件数です。
      </p>
    </div>
  );
}

function HeaderChip({
  label,
  value,
  chipClass,
  subTextClass,
}: {
  label: string;
  value: string;
  chipClass: string;
  subTextClass: string;
}) {
  return (
    <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 ${chipClass}`}>
      <span className={subTextClass}>{label}</span>
      <span className="font-bold tabular-nums">{value}</span>
    </span>
  );
}

function RailStat({ label, value, navy }: { label: string; value: string; navy: boolean }) {
  return (
    <div className={`rounded-lg px-1.5 py-1 text-center ${navy ? "bg-black/25" : "bg-ink/60"}`}>
      <div className={`text-[8px] leading-tight ${navy ? "text-white/45" : "text-cream/45"}`}>{label}</div>
      <div className="font-display text-[11px] font-bold leading-tight tabular-nums">{value}</div>
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
  shape,
  chrome,
  onFocus,
  onEnter,
}: {
  entry: (typeof MENU_ENTRIES)[number];
  label: string;
  badge: MenuBadge | null;
  selected: boolean;
  shape: TileShape;
  chrome: "gloss" | "matte";
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
      shape,
      chrome,
    });
  }, [size, entry.glyph, entry.color, selected, badge, shape, chrome]);

  return (
    // 拡大は絵だけでなくボタン全体に掛ける。絵にだけ掛けると、選択中のタイルが
    // 下に伸びて自分のラベルを覆ってしまう
    <button
      type="button"
      className={`group flex flex-col items-center gap-0.5 transition-transform duration-150 focus:outline-none ${
        selected ? "scale-[1.06]" : "hover:scale-[1.03]"
      }`}
      aria-pressed={selected}
      onClick={() => (selected ? onEnter() : onFocus())}
      onDoubleClick={onEnter}
    >
      <div ref={wrapRef} className="w-full">
        <canvas ref={canvasRef} className="block" />
      </div>
      {/* 「曜日別テンプレート」のような長い名前は、9pxのままだと最後の1文字だけが
          2行目に落ちて据わりが悪い。文字数に応じて少しだけ字を詰め、1行に収める。
          それでも入らない場合だけ2行にする(切り捨てはしない) */}
      <span
        className={`line-clamp-2 w-full rounded px-0.5 text-center leading-tight transition ${
          label.length >= 9 ? "text-[8px] sm:text-[9px]" : "text-[9px] sm:text-[10px]"
        } ${selected ? "bg-cream/15 font-bold text-cream" : "text-cream/65"}`}
      >
        {label}
      </span>
    </button>
  );
}

// 左の立ち絵。既存の選手の絵をそのまま小さく描く
function PlayerPortrait({
  motivation,
  running,
  width = 96,
}: {
  motivation: 0 | 1 | 2 | 3 | 4;
  running: boolean;
  width?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    // 絵の縦横比(96:118)を保ったまま、指定された幅で描く
    const w = width, h = Math.round(width * (118 / 96));
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
      baseY: h - Math.round(h * 0.07),
      scale: 0.92 * (w / 96),
      motivation,
      running,
      injured: false,
      accent: pal.accent,
      warm: [255, 240, 210],
      light: 0.8,
    });
  }, [motivation, running, width]);
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
