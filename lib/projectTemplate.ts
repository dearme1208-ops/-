import { recordBelongsToProject } from "./projects";
import type { ProjectItem, ProjectStage, WorkRecord } from "./types";

// 終わった案件を「型」にして、同じ種類の新しい案件を作る。
// ・段階の構成(名前・件数の目標)をそのまま引き継ぐ
// ・同じ種類(同じ業務区分・詳細作業名)の過去の完了案件の実績から、段階ごと・案件全体の
//   参考時間を求め、新しい案件の見積りの初期値にする
// ・過去の案件に残した振り返り(次に気をつけること)を、新しい案件で見られるようにする

/**
 * 型にする案件と同じ種類の完了済み案件。同じ業務区分・詳細作業名のもの(型にする案件自身も、
 * 完了していれば含む)。CSV取り込みの行が消えたことによる自動完了は、実際に終わったとは
 * 限らないので除く
 */
export function similarCompletedProjects(source: ProjectItem, projects: ProjectItem[]): ProjectItem[] {
  return projects.filter(
    (p) =>
      !!p.completedAt &&
      !p.autoCompletedByImport &&
      p.category === source.category &&
      p.workName === source.workName
  );
}

export interface ReferenceTime {
  /** 実績のあった案件での平均(秒) */
  avgSeconds: number;
  /** 平均の元にした案件の数 */
  samples: number;
}

function projectSeconds(projectId: string, records: WorkRecord[], stageId?: string): number {
  let sum = 0;
  for (const r of records) {
    if (r.excludedFromStats || !recordBelongsToProject(r, projectId)) continue;
    if (stageId !== undefined && r.stageId !== stageId) continue;
    sum += r.seconds;
  }
  return sum;
}

function average(values: number[]): ReferenceTime | null {
  const nonZero = values.filter((v) => v > 0);
  if (nonZero.length === 0) return null;
  return { avgSeconds: Math.round(nonZero.reduce((a, b) => a + b, 0) / nonZero.length), samples: nonZero.length };
}

/** 案件全体の参考時間(同じ種類の完了案件の累計作業時間の平均)。実績が無ければnull */
export function projectReferenceTime(similar: ProjectItem[], records: WorkRecord[]): ReferenceTime | null {
  return average(similar.map((p) => projectSeconds(p.id, records)));
}

/**
 * 段階ごとの参考時間。段階は案件ごとにIDが違うため、段階の名前で対応させる
 * (同じ種類の案件なら段階の名前もたいてい同じになる)。名前→参考時間
 */
export function stageReferenceTimes(similar: ProjectItem[], records: WorkRecord[]): Map<string, ReferenceTime> {
  const byTitle = new Map<string, number[]>();
  for (const p of similar) {
    for (const s of p.stages ?? []) {
      const list = byTitle.get(s.title) ?? [];
      list.push(projectSeconds(p.id, records, s.id));
      byTitle.set(s.title, list);
    }
  }
  const result = new Map<string, ReferenceTime>();
  for (const [title, values] of byTitle) {
    const ref = average(values);
    if (ref) result.set(title, ref);
  }
  return result;
}

export interface Retrospective {
  projectId: string;
  projectTitle: string;
  completedAt: number;
  text: string;
}

/** 同じ種類の過去の案件に残した振り返り。新しいものから */
export function collectRetrospectives(similar: ProjectItem[]): Retrospective[] {
  return similar
    .filter((p) => !!p.retrospective?.trim())
    .map((p) => ({ projectId: p.id, projectTitle: p.title, completedAt: p.completedAt!, text: p.retrospective!.trim() }))
    .sort((a, b) => b.completedAt - a.completedAt);
}

/** 元の案件の「作成から期日まで」の日数。新しい案件の期日の初期値(今日+同じ日数)に使う */
export function plannedDurationDays(source: ProjectItem): number {
  const created = new Date(source.createdAt);
  created.setHours(0, 0, 0, 0);
  const due = new Date(source.dueDate + "T00:00:00");
  return Math.max(0, Math.round((due.getTime() - created.getTime()) / 86400000));
}

/**
 * 型から新しい案件を組み立てる。引き継ぐのは種類(業務区分・詳細作業名・グループ・取引先・単価)と
 * 段階の構成だけで、進捗(完了・件数の実績・期日・対応状況・添付)や分析メモは引き継がない
 */
export function buildProjectFromTemplate(
  source: ProjectItem,
  opts: {
    title: string;
    dueDate: string;
    now: number;
    newId: () => string;
    stageRefs: Map<string, ReferenceTime>;
    totalRef: ReferenceTime | null;
  }
): ProjectItem {
  const stages: ProjectStage[] | undefined = source.stages?.map((s) => {
    const ref = opts.stageRefs.get(s.title);
    return {
      id: opts.newId(),
      title: s.title,
      completed: false,
      ...(s.targetCount != null ? { targetCount: s.targetCount, completedCount: 0 } : {}),
      ...(ref ? { referenceSeconds: ref.avgSeconds } : {}),
    };
  });
  return {
    id: opts.newId(),
    title: opts.title,
    groupName: source.groupName,
    category: source.category,
    workName: source.workName,
    dueDate: opts.dueDate,
    clientId: source.clientId,
    hourlyRate: source.hourlyRate,
    createdAt: opts.now,
    ...(stages && stages.length > 0 ? { stages } : {}),
    ...(opts.totalRef ? { estimatedTotalSeconds: opts.totalRef.avgSeconds } : {}),
    templateFromId: source.id,
  };
}
