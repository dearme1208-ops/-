"use client";

import { useSetting } from "@/lib/settings";
import { LIFE_CONTEXT_KEY } from "./aiData";

// 時間割の依頼の使い道。工程表を仕事用と家庭用で別々に使っている場合、家庭の方では
// 「勤務時間」「午前に頭を使う作業」のような仕事前提の頼み方をしないようにする
export default function LifeContextSelect() {
  const [value, setValue] = useSetting(LIFE_CONTEXT_KEY, "仕事");
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-cream/60" role="group" aria-label="この工程表の使い道">
      <span>この工程表の使い道:</span>
      {(["仕事", "家庭"] as const).map((v) => (
        <button
          key={v}
          className={value === v ? "btn-pill px-2.5 py-0.5 text-[11px]" : "btn-pill-outline px-2.5 py-0.5 text-[11px]"}
          onClick={() => setValue(v)}
          aria-pressed={value === v}
        >
          {v === "仕事" ? "💼 仕事" : "🏠 家庭"}
        </button>
      ))}
    </div>
  );
}
