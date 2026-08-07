"use client";

import { useSetting } from "@/lib/settings";
import { CONDITION_LEVELS } from "@/lib/condition";
import ConditionIcon from "./ConditionIcon";

// 設定（オリジナルアイコン / 絵文字）に応じて、体調レベルの見た目を切り替えて表示する
export default function ConditionGlyph({ level, size = 24 }: { level: string; size?: number }) {
  const [iconStyle] = useSetting("condition.iconStyle", "custom");
  if (iconStyle === "emoji") {
    const c = CONDITION_LEVELS.find((c) => c.level === level);
    return (
      <span style={{ fontSize: size * 0.8, lineHeight: 1 }} role="img" aria-label={c?.label}>
        {c?.emoji}
      </span>
    );
  }
  return <ConditionIcon level={level} size={size} />;
}
