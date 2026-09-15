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
    <nav className="-mx-4 mb-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div className="flex w-max gap-2 sm:w-full sm:flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={
              active === t.key
                ? "btn-pill whitespace-nowrap text-sm"
                : "btn-pill-outline whitespace-nowrap text-sm"
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
