"use client";

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

export default function BottomTabBar({
  items,
  activeKey,
  onSelect,
  style,
  adaptiveEmphasis,
  progress,
}: {
  items: BottomTabBarItem[];
  activeKey: string;
  onSelect: (key: string) => void;
  style: TabBarStyle;
  adaptiveEmphasis?: boolean;
  progress?: BottomTabBarProgressSegment[];
}) {
  const activeIndex = Math.max(
    0,
    items.findIndex((it) => it.key === activeKey)
  );
  const showProgress = !!progress && progress.some((p) => p.ratio > 0);

  return (
    <div className="sticky bottom-2 z-10 pt-2" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      {showProgress && (
        <div className="mb-1 flex h-1.5 overflow-hidden rounded-full bg-ink/50">
          {progress!.map(
            (p) =>
              p.ratio > 0 && <div key={p.key} className={p.className} style={{ width: `${Math.round(p.ratio * 100)}%` }} />
          )}
        </div>
      )}

      {style === "segment" && (
        <div className="panel relative flex items-center gap-0 p-1.5 shadow-lg backdrop-blur">
          <div
            className="absolute bottom-1.5 top-1.5 rounded-full border border-alert/60 bg-alert/20 transition-all duration-300 ease-out"
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
                className={`relative z-10 flex flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-2 text-xs transition-transform sm:text-sm ${
                  active ? "font-bold text-cream" : "text-cream/45"
                } ${emphasized ? "scale-[1.06]" : ""}`}
              >
                {it.badge && (
                  <span
                    className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-alert ring-2 ring-ink"
                    title={it.badgeTitle}
                    aria-label={it.badgeTitle}
                  />
                )}
                <span>{it.icon}</span>
                <span className="truncate">{it.label}</span>
                {it.count !== undefined && <span className="tabular-nums opacity-60">({it.count})</span>}
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
                className={`relative flex flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 transition-transform ${
                  active ? "text-cream" : "text-cream/45"
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
                <span className="text-[10px] leading-none">{it.label}</span>
                <span
                  className={`mt-0.5 h-0.5 w-3 rounded-full transition-colors ${active ? "bg-alert" : "bg-transparent"}`}
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
                className={`relative flex-1 rounded-md border px-2 py-2 text-xs transition-transform sm:text-sm ${
                  active ? "border-alert bg-alert/15 text-cream" : "border-dashed border-cream/25 text-cream/55"
                } ${emphasized ? "scale-[1.05]" : ""}`}
              >
                {active && (
                  <span
                    className="absolute -right-px -top-px h-0 w-0 border-b-[11px] border-l-[11px] border-b-transparent border-l-alert"
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
                <span>
                  {it.icon} {it.label}
                </span>
                {it.count !== undefined && <span className="ml-1 font-mono tabular-nums opacity-70">[{it.count}]</span>}
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
                className={`relative flex-1 transition-transform ${active ? "btn-pill" : "btn-pill-outline"} px-2 py-2 text-xs sm:text-sm ${
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
                {it.icon} {it.label}
                {it.count !== undefined && <span className={`tabular-nums ${active ? "opacity-70" : "opacity-50"}`}>({it.count})</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
