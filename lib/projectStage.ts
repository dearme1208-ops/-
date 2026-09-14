import { db } from "./db";
import type { ProjectItem, ProjectStage } from "./types";
import { highestPriorityTag } from "./tagPriority";

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

// 完了(チェックを入れる)方向へ切り替える前に、前の段階がまだ未完了かどうかを調べる。
// チェックボックスが小さく、段階が多い案件では誤タップしやすいため、呼び出し側(案件タブ・
// ToDoタブの「案件」ビュー・統合ボードなど)はこれを使って確認モーダルを出してから
// toggleProjectStageを呼ぶ想定(ネイティブのconfirmはテーマの見た目に合わずPWAでは
// 表示が不安定なこともあるため、各画面で自前のModalに揃えている)
export function incompletePreviousStageTitles(project: ProjectItem, stageId: string): string[] {
  const allStages = project.stages ?? [];
  const idx = allStages.findIndex((s) => s.id === stageId);
  if (idx === -1) return [];
  return allStages.slice(0, idx).filter((s) => !s.completed).map((s) => s.title);
}

// 案件全体の対応状況。段階を持たない場合は案件自身の対応状況をそのまま使う(=手動設定)。
// 段階を持つ場合は、対応状況は完全に段階側から自動算出され、案件自身に設定した対応状況は
// 使われない(未完了の段階の中で最も優先度の高いものを採用し、未完了の段階に対応状況が
// 1つも見当たらなければ完了済みも含めて探す)。ToDoのeffectiveTagと同じ考え方
export function effectiveProjectTag(project: ProjectItem, priorityOrder: string[]): string | undefined {
  const stages = project.stages ?? [];
  if (stages.length === 0) return project.tag;
  const fromOpen = highestPriorityTag(
    stages.filter((s) => !isStageDone(s)).map((s) => s.tag),
    priorityOrder
  );
  if (fromOpen) return fromOpen;
  return highestPriorityTag(
    stages.map((s) => s.tag),
    priorityOrder
  );
}

export async function toggleProjectStage(project: ProjectItem, stageId: string): Promise<void> {
  const allStages = project.stages ?? [];
  const stages = allStages.map((s) =>
    s.id === stageId ? { ...s, completed: !s.completed, completedAt: !s.completed ? Date.now() : undefined } : s
  );
  await db.projects.update(project.id, { stages });
}
