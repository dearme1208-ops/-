"use client";

export interface TabDef {
  key: string;
  label: string;
  /** タブを開かなくても件数が分かるよう、ラベル横に出す小さな数字バッジ(0/未指定なら出さない) */
  badge?: number;
  /** アイコン。指定するとラベルと別の要素にし、狭い画面の分類タブで「アイコンを上・名前を下」に積める */
  icon?: string;
  /** 狭い画面で使う短い名前(例:「記録・マスタ」→「記録」)。見た目だけを差し替え、読み上げ等は正式名のまま */
  shortLabel?: string;
}

export default function TabNav({
  tabs,
  active,
  onChange,
  className = "",
  ariaLabel,
}: {
  tabs: TabDef[];
  active: string;
  onChange: (key: string) => void;
  /** 2段表示(GroupedTabNav)で上段・下段を見分けるための追加クラス */
  className?: string;
  ariaLabel?: string;
}) {
  return (
    // tab-nav / tab-chip は演出テーマ側がタブ列だけを狙い撃ちするための目印。
    // 素の見た目は他のボタンと同じ(btn-pill系)なので、テーマを当てない限り変化はない
    <nav className={`tab-nav -mx-4 mb-4 overflow-x-auto px-4 sm:mx-0 sm:px-0 ${className}`} aria-label={ariaLabel}>
      <div className="flex w-max gap-2 sm:w-full sm:flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            data-active={active === t.key ? "true" : "false"}
            className={
              active === t.key
                ? "tab-chip btn-pill whitespace-nowrap text-sm"
                : "tab-chip btn-pill-outline whitespace-nowrap text-sm"
            }
          >
            {t.icon ? (
              <>
                <span className="tab-chip-icon">{t.icon}</span>{" "}
                <span className="tab-chip-label" data-short={t.shortLabel}>
                  {t.label}
                </span>
              </>
            ) : (
              t.label
            )}
            {!!t.badge && (
              <span className="tab-chip-badge ml-1.5 rounded-full bg-alert px-1.5 py-0.5 text-[10px] font-bold leading-none text-ink">
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>
    </nav>
  );
}
