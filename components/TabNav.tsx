"use client";

export interface TabDef {
  key: string;
  label: string;
  /** タブを開かなくても件数が分かるよう、ラベル横に出す小さな数字バッジ(0/未指定なら出さない) */
  badge?: number;
}

export default function TabNav({
  tabs,
  active,
  onChange,
}: {
  tabs: TabDef[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    // tab-nav / tab-chip は演出テーマ側がタブ列だけを狙い撃ちするための目印。
    // 素の見た目は他のボタンと同じ(btn-pill系)なので、テーマを当てない限り変化はない
    <nav className="tab-nav -mx-4 mb-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
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
            {t.label}
            {!!t.badge && (
              <span className="ml-1.5 rounded-full bg-alert px-1.5 py-0.5 text-[10px] font-bold leading-none text-ink">
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>
    </nav>
  );
}
