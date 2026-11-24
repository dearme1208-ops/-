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
  // 件数管理の段階は completed が立たず件数で完了が決まるため、isStageDoneで判定する
  // (目標件数に達していても「未完了」と警告され続けないように)
  return allStages.slice(0, idx).filter((s) => !isStageDone(s)).map((s) => s.title);
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

/** 段階があり、すべて済んでいて、案件はまだ未完了か(「案件も完了にしますか」を出す条件) */
export function allStagesDoneButProjectOpen(project: ProjectItem | undefined): boolean {
  const stages = project?.stages ?? [];
  return !!project && !project.completedAt && stages.length > 0 && stages.every(isStageDone);
}

/** まだ済んでいない段階の名前(案件を完了にする前の確認に使う) */
export function openStageTitles(project: ProjectItem | undefined): string[] {
  return (project?.stages ?? []).filter((s) => !isStageDone(s)).map((s) => s.title || "（無題の段階）");
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * 編集画面で直した段階を、保存直前の最新の段階(fresh)へ段階ごと・項目ごとに重ねる。
 * 編集画面は開いた時点の写し(original)を持つため、配列ごと書き戻すと、開いている間に
 * 別の画面で付けた完了などが巻き戻ってしまう。画面で実際に変えた項目だけを勝たせる。
 * ・画面で消した段階は消す ・画面で足した段階は足す
 * ・開いている間に他で足された段階は後ろに残す ・他で消された段階は、画面で直していなければ消えたまま
 * 並びは画面の並び(他で足された段階は後ろ)
 */
export function mergeEditedStages(original: ProjectStage[], edited: ProjectStage[], fresh: ProjectStage[]): ProjectStage[] {
  const originalById = new Map(original.map((s) => [s.id, s]));
  const freshById = new Map(fresh.map((s) => [s.id, s]));
  const editedIds = new Set(edited.map((s) => s.id));
  const out: ProjectStage[] = [];
  for (const e of edited) {
    const o = originalById.get(e.id);
    const f = freshById.get(e.id);
    if (!o) {
      out.push(e);
      continue;
    }
    if (!f) {
      if (!sameValue(o, e)) out.push(e);
      continue;
    }
    const merged: Record<string, unknown> = { ...f };
    const oo = o as unknown as Record<string, unknown>;
    const ee = e as unknown as Record<string, unknown>;
    for (const k of new Set([...Object.keys(oo), ...Object.keys(ee)])) {
      if (sameValue(oo[k], ee[k])) continue;
      if (ee[k] === undefined) delete merged[k];
      else merged[k] = ee[k];
    }
    out.push(merged as unknown as ProjectStage);
  }
  for (const f of fresh) if (!originalById.has(f.id) && !editedIds.has(f.id)) out.push(f);
  return out;
}

/** 段階を1つ書き換える。手元の写しではなく、その場で読み直した最新の案件の、同じidの段階に当てる */
async function updateStageFresh(
  projectId: string,
  stageId: string,
  change: (stage: ProjectStage) => ProjectStage
): Promise<{ before: ProjectStage; after: ProjectStage; project: ProjectItem } | null> {
  return db.transaction("rw", db.projects, async () => {
    const fresh = await db.projects.get(projectId);
    const before = fresh?.stages?.find((s) => s.id === stageId);
    if (!fresh || !before) return null;
    const after = change(before);
    const stages = fresh.stages!.map((s) => (s.id === stageId ? after : s));
    await db.projects.update(projectId, { stages });
    return { before, after, project: { ...fresh, stages } };
  });
}

export interface StageChangeResult {
  /** この操作で段階が済んだか */
  completed: boolean;
  /** この操作で全段階が済み、案件はまだ未完了(「案件も完了にしますか」を出す) */
  offerProjectCompletion: boolean;
}

function resultOf(r: { before: ProjectStage; after: ProjectStage; project: ProjectItem } | null): StageChangeResult | null {
  if (!r) return null;
  const completed = !isStageDone(r.before) && isStageDone(r.after);
  return { completed, offerProjectCompletion: completed && allStagesDoneButProjectOpen(r.project) };
}

/**
 * 段階を完了にする(件数管理の段階は1件進める)。既に済んでいる通常の段階は何もしない
 */
export async function completeProjectStage(projectId: string, stageId: string): Promise<StageChangeResult | null> {
  return resultOf(
    await updateStageFresh(projectId, stageId, (s) => {
      if (s.targetCount && s.targetCount > 0) {
        const count = Math.min(s.targetCount, (s.completedCount ?? 0) + 1);
        const reached = count >= s.targetCount && (s.completedCount ?? 0) < s.targetCount;
        return { ...s, completedCount: count, completedAt: reached ? Date.now() : s.completedAt };
      }
      if (s.completed) return s;
      return { ...s, completed: true, completedAt: Date.now() };
    })
  );
}

export async function toggleProjectStage(project: ProjectItem, stageId: string): Promise<StageChangeResult | null> {
  // 手元の写し(project)の完了状態ではなく、最新の段階を見て切り替える。
  // 別の画面で既に変わっていた場合に、他の段階まで古い状態で上書きしないように
  return resultOf(
    await updateStageFresh(project.id, stageId, (s) => ({
      ...s,
      completed: !s.completed,
      completedAt: !s.completed ? Date.now() : undefined,
    }))
  );
}
