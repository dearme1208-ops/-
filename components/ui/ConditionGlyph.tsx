"use client";

import { useSetting } from "@/lib/settings";
import { useVisualMode } from "@/lib/theme";
import { CONDITION_LEVELS } from "@/lib/condition";
import ConditionIcon from "./ConditionIcon";
import ForestConditionIcon from "./ForestConditionIcon";

// 設定（オリジナルアイコン / 絵文字）に応じて、体調レベルの見た目を切り替えて表示する
export default function ConditionGlyph({ level, size = 24 }: { level: string; size?: number }) {
  const [iconStyle] = useSetting("condition.iconStyle", "custom");
  // 森モードのオリジナルアイコンは「葉のみずみずしさ」版に差し替える。
  // 絵文字を選んでいる人の指定は上書きしない(見た目より本人の選択を優先する)
  const { homeMode } = useVisualMode();
  if (iconStyle === "emoji") {
    const c = CONDITION_LEVELS.find((c) => c.level === level);
    return (
      <span style={{ fontSize: size * 0.8, lineHeight: 1 }} role="img" aria-label={c?.label}>
        {c?.emoji}
      </span>
    );
  }
  if (homeMode) return <ForestConditionIcon level={level} size={size} />;
  return <ConditionIcon level={level} size={size} />;
}
