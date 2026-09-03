import { db } from "./db";
import type { ProjectItem, ProjectStage } from "./types";

// 段階の進捗率(0〜1)。目標件数(targetCount)を設定した段階は completedCount/targetCount で、
// それ以外は完了チェックの有無(0 or 1)で表す
export function stageProgressFraction(stage: ProjectStage): number {
  if (stage.targetCount && stage.targetCount > 0) {
    return Math.min(1, (stage.completedCount ?? 0) / stage.targetCount);
  }
  return stage.completed ? 1 : 0;
}

// その段階が完了とみなせるか（件数管理の場合は目標件数に到達したか）
export function isStageDone(stage: ProjectStage): boolean {
  if (stage.targetCount && stage.targetCount > 0) {
    return (stage.completedCount ?? 0) >= stage.targetCount;
  }
  return stage.completed;
}

// 案件全体の進捗率(0〜1)。件数管理の段階は件数の割合、それ以外は完了/未完了として、
// 段階数で均等按分して平均する
export function computeProjectProgress(stages: ProjectStage[] | undefined): number | null {
  if (!stages || stages.length === 0) return null;
  const sum = stages.reduce((s, stage) => s + stageProgressFraction(stage), 0);
  return sum / stages.length;
}

// チェック(未完了→完了)方向だけ確認ダイアログを挟む。チェックボックスが小さく、
// 段階が多い案件では誤タップしやすいための保険。前の段階が未完了の場合は
// その旨も確認メッセージに含める(依存関係の警告)。案件タブ・ToDoタブの
// 「案件」ビューなど、複数の画面から同じ挙動で呼べるよう共通化してある
export async function toggleProjectStage(project: ProjectItem, stageId: string): Promise<void> {
  const allStages = project.stages ?? [];
  const idx = allStages.findIndex((s) => s.id === stageId);
  const stage = allStages[idx];
  if (stage && !stage.completed) {
    const incompletePrevious = allStages.slice(0, idx).filter((s) => !s.completed);
    const warning =
      incompletePrevious.length > 0
        ? `\n\n⚠ 前の段階「${incompletePrevious.map((s) => s.title).join("」「")}」がまだ完了していません。`
        : "";
    if (!confirm(`「${stage.title}」を完了にしますか?${warning}`)) return;
  }
  const stages = allStages.map((s) =>
    s.id === stageId ? { ...s, completed: !s.completed, completedAt: !s.completed ? Date.now() : undefined } : s
  );
  await db.projects.update(project.id, { stages });
}
