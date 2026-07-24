"use client";

export interface TabDef {
  key: string;
  label: string;
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
          </button>
        ))}
      </div>
    </nav>
  );
}
