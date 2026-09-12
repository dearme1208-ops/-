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

// 段階を「実際に完了した順番」。リスト上の定義順と、実際に片付いた順番はしばしば食い違う
// (後ろの段階を先に済ませる、前の段階を後追いで埋める、など)ため、完了時刻(completedAt)が
// 記録されている段階だけを時刻順に並べ、1始まりの通し番号を割り当てる。
// 完了時刻が残っていない段階(この記録より前に完了した古い段階など)は順番を持たない。
// 分からない順番をでっち上げないための扱いで、表示側では従来どおりチェックだけを出す
export interface StageCompletion {
  rank: number; // 完了時刻が記録されている段階の中で何番目に完了したか(1始まり)
  at: number; // 完了時刻(epoch ms)
  // 定義順で前にある段階を追い越して完了したか。「前の段階がまだ未完了」または
  // 「前の段階のほうが後に完了した」ことが確実に言える場合だけ true にする
  // (前の段階に完了時刻が残っていない場合は判断できないので false のままにする)
  aheadOfPlan: boolean;
}

export function buildStageCompletionOrder(stages: ProjectStage[] | undefined): Map<string, StageCompletion> {
  const result = new Map<string, StageCompletion>();
  if (!stages || stages.length === 0) return result;
  const recorded: { id: string; index: number; at: number }[] = [];
  stages.forEach((stage, index) => {
    if (isStageDone(stage) && stage.completedAt != null) {
      recorded.push({ id: stage.id, index, at: stage.completedAt });
    }
  });
  // 完了時刻が同じ(CSV取り込みで一括に入った場合など)ときは定義順に倒し、
  // 開くたびに番号が入れ替わらないようにする
  recorded.sort((a, b) => a.at - b.at || a.index - b.index);
  recorded.forEach((entry, i) => {
    const aheadOfPlan = stages.some((s, j) => {
      if (j >= entry.index) return false;
      if (!isStageDone(s)) return true;
      return s.completedAt != null && s.completedAt > entry.at;
    });
    result.set(entry.id, { rank: i + 1, at: entry.at, aheadOfPlan });
  });
  return result;
}

// チェック(未完了→完了)方向だけ確認ダイアログを挟む。チェックボックスが小さく、
// 段階が多い案件では誤タップしやすいための保険。前の段階が未完了の場合は
// その旨も確認メッセージに含める(依存関係の警告)。案件タブ・ToDoタブの
// 「案件」ビューなど、複数の画面から同じ挙動で呼べるよう共通化してある
// skipConfirmを立てると、ここでの確認を出さずに切り替える。呼び出し側で
// 独自の確認ダイアログを出している場合(統合ボード)に二重で聞かないため
export async function toggleProjectStage(project: ProjectItem, stageId: string, skipConfirm = false): Promise<void> {
  const allStages = project.stages ?? [];
  const idx = allStages.findIndex((s) => s.id === stageId);
  const stage = allStages[idx];
  if (!skipConfirm && stage && !stage.completed) {
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
