import type { ProjectItem } from "./types";

export interface ProjectProgressPoint {
  key: string;
  label: string;
  /** その月に新規登録された件数 */
  added: number;
  /** その月に完了した件数 */
  completed: number;
  /** その月末時点で残っている未完了件数の累積(バーンアップ) */
  openAtEnd: number;
}

// 案件タブの「進捗グラフ」用。月ごとの新規追加数・完了数と、月末時点の累積未完了件数
// (バーンアップ)を求める。新規追加のペースが完了のペースを上回り続けているかが、
// 棒(追加)と線(完了)を重ねて見ることで一目で分かる
export function computeProjectProgressTrend(
  projects: ProjectItem[],
  months: number,
  now: number = Date.now()
): ProjectProgressPoint[] {
  const anchor = new Date(now);
  anchor.setDate(1);
  anchor.setHours(0, 0, 0, 0);
  const cursor = new Date(anchor);
  cursor.setMonth(cursor.getMonth() - (months - 1));
  const rangeStartMs = cursor.getTime();

  // 集計開始月より前に登録され、その時点でまだ未完了だった件数を初期値にする
  let openCount = projects.filter(
    (p) => p.createdAt < rangeStartMs && (p.completedAt == null || p.completedAt >= rangeStartMs)
  ).length;

  const points: ProjectProgressPoint[] = [];
  for (let i = 0; i < months; i++) {
    const monthStartMs = cursor.getTime();
    const monthEndMs = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1).getTime();
    const added = projects.filter((p) => p.createdAt >= monthStartMs && p.createdAt < monthEndMs).length;
    const completed = projects.filter(
      (p) => p.completedAt != null && p.completedAt >= monthStartMs && p.completedAt < monthEndMs
    ).length;
    openCount = Math.max(0, openCount + added - completed);
    points.push({
      key: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`,
      label: `${cursor.getMonth() + 1}月`,
      added,
      completed,
      openAtEnd: openCount,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return points;
}
