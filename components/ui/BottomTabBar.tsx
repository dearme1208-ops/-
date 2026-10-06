"use client";

import type { ReactNode } from "react";

// 「本日の作業」「ToDo」共通の下部固定タブバー。設定(today.tabBarStyle等)で
// 見た目のスタイルを切り替えられるようにするため、見た目のバリエーションを
// このコンポーネント1箇所にまとめている。データ側(タブの一覧・件数・選択状態)は
// 呼び出し側が持ち、このコンポーネントは表示とクリックの通知だけを担当する。
export type TabBarStyle = "pill" | "segment" | "icon" | "stamp";

export interface BottomTabBarItem {
  key: string;
  icon: string;
  label: string;
  count?: number;
  badge?: boolean;
  badgeTitle?: string;
  // trueの場合、adaptiveEmphasis設定がONなら見た目を強調する(例: 実際に計測中の時だけ「実行中」タブを目立たせる)
  emphasize?: boolean;
}

export interface BottomTabBarProgressSegment {
  key: string;
  ratio: number;
  className: string;
}

// 計測中の作業を、件数ではなく中身と経過時間で出すための帯。
// タブバーは画面下に貼り付いているので、どこまでスクロールしても
// 「今なにを計っているか」が視界から消えない
export interface BottomTabBarRunning {
  name: string;
  category: string;
  elapsedLabel: string;
  extraCount: number;
  /** 押したときの動き(実行中タブへ移動する等)。無ければただの表示になる */
  onClick?: () => void;
  /** 想定時間を超過しているか。trueなら放置に気づけるよう強めに強調表示する */
  overrun?: boolean;
  /** 超過時のテーマに応じた一言(例:「🌿 想定より長く森にいます」)。ツールチップに使う。省略時は既定文言 */
  overrunLabel?: string;
  /** 超過時のテーマに応じた光彩アニメーションのクラス名(例: card-overrun-forest)。省略時は既定の光彩 */
  overrunAnimClass?: string;
  /** 帯からそのまま一時停止・完了する(親指の届く画面下で止められるように)。無ければボタンを出さない */
  onPause?: () => void;
  onFinish?: () => void;
}

function RunningStrip({ running }: { running: BottomTabBarRunning }) {
  const overrun = !!running.overrun;
  const title = overrun
    ? `${running.overrunLabel ?? "⚠ 想定時間を超過して計測中"}: ${running.category} / ${running.name}（${running.elapsedLabel}）`
    : `計測中: ${running.category} / ${running.name}（${running.elapsedLabel}）`;
  const inner = (
    <>
      {overrun ? (
        <span className="shrink-0 animate-pulse font-bold text-alert" aria-hidden="true">
          ⚠
        </span>
      ) : (
        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-alert" aria-hidden="true" />
      )}
      <span className={`min-w-0 flex-1 truncate text-left text-xs ${overrun ? "font-bold text-alert" : "text-cream/85"}`}>
        <span className={overrun ? "opacity-70" : "text-cream/45"}>{running.category} / </span>
        {running.name}
      </span>
      {running.extraCount > 0 && (
        <span className="shrink-0 text-[10px] text-cream/45">他{running.extraCount}件</span>
      )}
      <span
        className={`shrink-0 font-display text-sm font-bold tabular-nums ${overrun ? "text-alert" : "text-cream"}`}
      >
        {running.elapsedLabel}
      </span>
    </>
  );
  const className = `panel mb-1 flex w-full items-center gap-2 px-3 py-1.5 shadow-lg backdrop-blur ${
    overrun ? `border-alert ring-2 ring-alert/70 bg-alert/[0.06] ${running.overrunAnimClass ?? "card-overrun"}` : ""
  }`;
  const actions = (running.onPause || running.onFinish) && (
    <span className="flex shrink-0 items-center gap-1">
      {running.onPause && (
        <button
          className="flex h-8 w-8 items-center justify-center rounded-full border border-cream/25 text-sm text-cream hover:bg-cream/10"
          onClick={running.onPause}
          aria-label="一時停止"
          title="一時停止"
        >
          ⏸
        </button>
      )}
      {running.onFinish && (
        <button
          className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgb(var(--accent-rgb))] text-sm font-bold text-ink"
          onClick={running.onFinish}
          aria-label="完了"
          title="完了"
        >
          ✓
        </button>
      )}
    </span>
  );
  if (!running.onClick) {
    return (
      <div className={className} title={title} aria-label={title}>
        {inner}
        {actions}
      </div>
    );
  }
  if (actions) {
    // 帯の文字の部分は押すと実行中タブへ、右端の⏸・✓はその場で操作する
    return (
      <div className={`${className} pr-1.5`} data-testid="running-strip">
        <button className="flex min-w-0 flex-1 items-center gap-2" onClick={running.onClick} title={title} aria-label={title}>
          {inner}
        </button>
        {actions}
      </div>
    );
  }
  return (
    <button className={className} onClick={running.onClick} title={title} aria-label={title}>
      {inner}
    </button>
  );
}

export default function BottomTabBar({
  items,
  activeKey,
  onSelect,
  style,
  adaptiveEmphasis,
  progress,
  running,
  leading,
  above,
}: {
  items: BottomTabBarItem[];
  activeKey: string;
  onSelect: (key: string) => void;
  style: TabBarStyle;
  adaptiveEmphasis?: boolean;
  progress?: BottomTabBarProgressSegment[];
  running?: BottomTabBarRunning | null;
  /** タブの左に並べる操作ボタン(本日の作業の📍打刻など) */
  leading?: ReactNode;
  /** タブバーの上に出す一時的な表示(打刻直後の一言入力など) */
  above?: ReactNode;
}) {
  const activeIndex = Math.max(
    0,
    items.findIndex((it) => it.key === activeKey)
  );
  const showProgress = !!progress && progress.some((p) => p.ratio > 0);
  // 5つ以上並ぶと(ToDoのマイデイ〜返事待ち)、スマホの幅では横1行に収まらず最後のタブが画面の外に
  // はみ出していた。その場合、狭い画面ではアイコンを上・名前を下の2段に積んで全部を収める
  const stacked = items.length + (leading ? 1 : 0) >= 5;
  const stackClass = stacked
    ? "flex min-w-0 flex-col items-center justify-center gap-0.5 px-0.5 py-1.5 text-[11px] leading-tight sm:flex-row sm:gap-1 sm:px-2 sm:py-2 sm:text-sm"
    : "";
  const content = (it: BottomTabBarItem, countNode: ReactNode) =>
    stacked ? (
      <>
        {/* 狭い幅では件数をアイコンの横へ出し、ラベルは全文を見せる */}
        <span className="whitespace-nowrap leading-none">
          {it.icon}
          <span className="text-[10px] sm:hidden">{countNode}</span>
        </span>
        <span className="max-w-full truncate">
          {it.label}
          <span className="hidden sm:inline">{countNode}</span>
        </span>
      </>
    ) : null;

  return (
    <div className="sticky bottom-2 z-[45] pt-2" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      {above}
      {running && (
        <RunningStrip running={running} />
      )}

      {showProgress && (
        <div className="mb-1 flex h-1.5 overflow-hidden rounded-full bg-ink/50">
          {progress!.map(
            (p) =>
              p.ratio > 0 && <div key={p.key} className={p.className} style={{ width: `${Math.round(p.ratio * 100)}%` }} />
          )}
        </div>
      )}

      <div className={leading ? "flex items-stretch gap-1.5" : ""}>
      {leading}
      <div className={leading ? "min-w-0 flex-1" : ""}>
      {style === "segment" && (
        <div className="panel relative flex items-center gap-0 p-1.5 shadow-lg backdrop-blur">
          <div
            className="absolute bottom-1.5 top-1.5 rounded-full border border-[rgb(var(--accent-rgb)/0.8)] bg-[rgb(var(--accent-rgb)/0.28)] transition-all duration-300 ease-out"
            style={{ left: `${(activeIndex / items.length) * 100}%`, width: `${100 / items.length}%` }}
            aria-hidden="true"
          />
          {items.map((it) => {
            const active = it.key === activeKey;
            const emphasized = adaptiveEmphasis && it.emphasize;
            return (
              <button
                key={it.key}
                onClick={() => onSelect(it.key)}
                className={`relative z-10 flex-1 rounded-full transition-transform ${
                  stacked ? stackClass : "flex items-center justify-center gap-1.5 px-2 py-2 text-xs sm:text-sm"
                } ${
                  active ? "font-bold text-cream" : "text-cream/80"
                } ${emphasized ? "scale-[1.06]" : ""}`}
              >
                {it.badge && (
                  <span
                    className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-alert ring-2 ring-ink"
                    title={it.badgeTitle}
                    aria-label={it.badgeTitle}
                  />
                )}
                {stacked ? (
                  content(it, it.count !== undefined && <span className="ml-0.5 tabular-nums opacity-80">({it.count})</span>)
                ) : (
                  <>
                    <span>{it.icon}</span>
                    <span className="truncate">{it.label}</span>
                    {it.count !== undefined && <span className="tabular-nums opacity-80">({it.count})</span>}
                  </>
                )}
              </button>
            );
          })}
        </div>
      )}

      {style === "icon" && (
        <div className="panel flex items-stretch gap-1 p-1.5 shadow-lg backdrop-blur">
          {items.map((it) => {
            const active = it.key === activeKey;
            const emphasized = adaptiveEmphasis && it.emphasize;
            return (
              <button
                key={it.key}
                onClick={() => onSelect(it.key)}
                // 選んでいるタブはアクセント色で塗って太字にする(以前は小さな下線だけで、薄い文字の中で見分けにくかった)
                className={`relative flex flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 transition-transform ${
                  active
                    ? "bg-[rgb(var(--accent-rgb)/0.25)] font-bold text-cream ring-1 ring-[rgb(var(--accent-rgb)/0.75)]"
                    : "text-cream/80"
                } ${emphasized ? "scale-[1.08]" : ""}`}
              >
                {it.badge && (
                  <span
                    className="absolute right-3 top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-alert ring-2 ring-ink"
                    title={it.badgeTitle}
                    aria-label={it.badgeTitle}
                  />
                )}
                <span className="relative text-lg leading-none">
                  {it.icon}
                  {it.count !== undefined && it.count > 0 && (
                    <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-alert px-1 text-[9px] font-bold tabular-nums text-ink">
                      {it.count}
                    </span>
                  )}
                </span>
                <span className="text-[11px] leading-none">{it.label}</span>
                <span
                  className={`mt-0.5 h-0.5 w-4 rounded-full transition-colors ${active ? "bg-[rgb(var(--accent-rgb))]" : "bg-transparent"}`}
                  aria-hidden="true"
                />
              </button>
            );
          })}
        </div>
      )}

      {style === "stamp" && (
        <div className="panel flex items-center gap-1.5 p-1.5 shadow-lg backdrop-blur">
          {items.map((it) => {
            const active = it.key === activeKey;
            const emphasized = adaptiveEmphasis && it.emphasize;
            return (
              <button
                key={it.key}
                onClick={() => onSelect(it.key)}
                className={`relative flex-1 whitespace-nowrap rounded-md border transition-transform ${
                  stacked ? stackClass : "px-1.5 py-2 text-xs sm:px-2 sm:text-sm"
                } ${
                  active
                    ? "border-[rgb(var(--accent-rgb))] bg-[rgb(var(--accent-rgb)/0.22)] font-bold text-cream"
                    : "border-dashed border-cream/35 text-cream/80"
                } ${emphasized ? "scale-[1.05]" : ""}`}
              >
                {active && (
                  <span
                    className="absolute -right-px -top-px h-0 w-0 border-b-[11px] border-l-[11px] border-b-transparent border-l-[rgb(var(--accent-rgb))]"
                    aria-hidden="true"
                  />
                )}
                {it.badge && (
                  <span
                    className="absolute -left-1 -top-1 h-2.5 w-2.5 animate-pulse rounded-full bg-alert ring-2 ring-ink"
                    title={it.badgeTitle}
                    aria-label={it.badgeTitle}
                  />
                )}
                {stacked ? (
                  content(it, it.count !== undefined && <span className="ml-0.5 font-mono tabular-nums opacity-85">[{it.count}]</span>)
                ) : (
                  <>
                    <span>
                      {it.icon} {it.label}
                    </span>
                    {it.count !== undefined && <span className="ml-1 font-mono tabular-nums opacity-85">[{it.count}]</span>}
                  </>
                )}
              </button>
            );
          })}
        </div>
      )}

      {style === "pill" && (
        <div className="panel flex items-center gap-1 p-1.5 shadow-lg backdrop-blur">
          {items.map((it) => {
            const active = it.key === activeKey;
            const emphasized = adaptiveEmphasis && it.emphasize;
            return (
              <button
                key={it.key}
                onClick={() => onSelect(it.key)}
                className={`relative flex-1 whitespace-nowrap transition-transform ${active ? "btn-pill font-bold" : "btn-pill-outline text-cream/90"} ${
                  stacked ? stackClass : "px-1.5 py-2 text-xs sm:px-2 sm:text-sm"
                } ${
                  emphasized ? "scale-[1.05]" : ""
                }`}
              >
                {it.badge && (
                  <span
                    className="absolute -right-1 -top-1 h-3 w-3 animate-pulse rounded-full bg-alert ring-2 ring-ink"
                    title={it.badgeTitle}
                    aria-label={it.badgeTitle}
                  />
                )}
                {stacked ? (
                  content(it, it.count !== undefined && <span className="ml-0.5 tabular-nums opacity-80">({it.count})</span>)
                ) : (
                  <>
                    {it.icon} {it.label}
                    {it.count !== undefined && <span className={`tabular-nums ${active ? "opacity-80" : "opacity-75"}`}>({it.count})</span>}
                  </>
                )}
              </button>
            );
          })}
        </div>
      )}
      </div>
      </div>
    </div>
  );
}
