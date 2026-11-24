import { db, uid } from "./db";
import { daysBetweenDateStrs, shiftDateStr, todayStr } from "./time";
import type { ProjectItem, ProjectStage, TodoTask, WbsNode, WorkRecord } from "./types";
import type { ParsedProjectRow, ParsedProjectStage } from "./projectsCsv";

// 実績がこの案件に属するか。主案件(projectId)だけでなく、兼務・並行作業向けの
// 追加の案件タグ(secondaryProjectIds)も一致とみなす(集計・レポート用)
export function recordBelongsToProject(record: WorkRecord, projectId: string): boolean {
  return record.projectId === projectId || (record.secondaryProjectIds?.includes(projectId) ?? false);
}

// 案件のマッチングキー。期日は先方で動くことがあるためキーに含めず、
// 件名・詳細作業名の組み合わせで同一案件とみなす
function matchKey(title: string, workName: string): string {
  return `${title}::${workName}`;
}

// CSVで指定された段階リストを既存の段階とタイトルでマッチングし、タイトル・期日・目標件数だけを
// 更新する。既存に無いタイトルは新規段階として追加する。CSVの段階リストが未定義の行は
// この関数を呼ばず、既存の段階に一切触れない。
//
// CSVに載らない情報(完了状態・完了時刻・添付画像・添付メール・対応状況・参考時間など)は
// 既存の段階をそのまま土台にして引き継ぐ。以前は引き継ぐ項目を1つずつ並べていたため、
// 後から増えた項目(添付メール・参考時間・対応状況の変更時刻)が取り込みのたびに消えていた。
//
// CSVに書かれていない既存の段階も消さない(CSVに書かれた段階の後ろに、元の並びのまま残す)。
// CSVは「この段階をこう直す」という指定であって、書かなかった段階を消す指定ではない。
// Excelで一部の段階だけ書き直して取り込むと、残りの段階が完了記録・添付ごと消えていた
function mergeStages(existingStages: ProjectStage[] | undefined, csvStages: ParsedProjectStage[]): ProjectStage[] {
  const existingList = existingStages ?? [];
  const usedIds = new Set<string>();
  const merged = csvStages.map((s): ProjectStage => {
    // 同じタイトルの段階が複数ある場合は、まだ対応付けていないものを上から順に当てる
    const existing = existingList.find((e) => e.title === s.title && !usedIds.has(e.id));
    if (existing) usedIds.add(existing.id);
    const base: ProjectStage = {
      ...(existing ?? { id: uid(), completed: false }),
      title: s.title,
      dueDate: s.dueDate,
      targetCount: s.targetCount,
    };
    // 新しい形のセルにある完了・完了件数・対応状況。案件の完了と同じく、CSV側が未完了でも
    // こちらで完了にしたものは巻き戻さない(古いCSVを取り込み直して完了が消えないように)
    if (s.completedCount !== undefined) base.completedCount = s.completedCount;
    if (s.done && !base.targetCount && !base.completed) {
      base.completed = true;
      base.completedAt = base.completedAt ?? Date.now();
    }
    if (base.targetCount && base.targetCount > 0 && (base.completedCount ?? 0) >= base.targetCount && base.completedAt == null) {
      base.completedAt = Date.now();
    }
    // 変えた時刻(tagChangedAt)はdbのフックが付ける
    if (s.tag !== undefined) base.tag = s.tag || undefined;
    return base;
  });
  return [...merged, ...existingList.filter((e) => !usedIds.has(e.id))];
}

// 後から足した列(対応状況・URL・取引先・アーカイブ・見積・単価・振り返り・先行案件)。
// 列が無い(undefined)項目は含めず、既存の値に触れない。空セルは値を消す
function csvExtraFields(row: ParsedProjectRow): Partial<ProjectItem> {
  const out: Partial<ProjectItem> = {};
  if (row.tag !== undefined) out.tag = row.tag || undefined;
  if (row.url !== undefined) out.url = row.url || undefined;
  if (row.clientId !== undefined) out.clientId = row.clientId || undefined;
  if (row.archived !== undefined) out.archived = row.archived || undefined;
  if (row.estimatedTotalSeconds !== undefined) out.estimatedTotalSeconds = row.estimatedTotalSeconds || undefined;
  if (row.hourlyRate !== undefined) out.hourlyRate = row.hourlyRate ?? undefined;
  if (row.retrospective !== undefined) out.retrospective = row.retrospective || undefined;
  if (row.predecessorProjectIds !== undefined)
    out.predecessorProjectIds = row.predecessorProjectIds.length > 0 ? row.predecessorProjectIds : undefined;
  return out;
}

export async function upsertProjectsFromCsv(
  rows: ParsedProjectRow[]
): Promise<{ created: number; updated: number; autoCompleted: number; autoCompletedTitles: string[] }> {
  let created = 0;
  let updated = 0;
  let autoCompleted = 0;
  // 自動で完了にした案件の件名。件数だけでは「どれが勝手に完了になったか」が分からず、
  // 気付かないまま一覧から消えていたため、呼び出し側で名前を出せるように返す
  const autoCompletedTitles: string[] = [];
  const now = Date.now();
  const touchedKeys = new Set<string>();

  await db.transaction("rw", db.projects, async () => {
    for (const row of rows) {
      touchedKeys.add(matchKey(row.title, row.workName));

      let existingById: ProjectItem | undefined;
      if (row.id) {
        existingById = await db.projects.get(row.id);
      }
      const existingByKey = existingById
        ? undefined
        : await db.projects
            .filter((p) => p.title === row.title && p.workName === row.workName)
            .first();
      const existing = existingById ?? existingByKey;

      // 登録日が変わっていなければ元の時刻をそのまま残す(日付だけのCSVで時刻が0時に丸まらないように)
      const createdAt = row.createdDate
        ? existing && todayStr(new Date(existing.createdAt)) === row.createdDate
          ? existing.createdAt
          : new Date(row.createdDate + "T00:00:00").getTime()
        : (existing?.createdAt ?? now);
      const extra = csvExtraFields(row);
      // completedがfalseの行でも、こちら側で既に完了扱いにしているものを未完了へ巻き戻しはしない
      const completedAt = row.completed ? (existing?.completedAt ?? now) : existing?.completedAt;

      if (existing) {
        await db.projects.update(existing.id, {
          title: row.title,
          category: row.category,
          workName: row.workName,
          dueDate: row.dueDate,
          createdAt,
          completedAt,
          // idで一致した行は、このアプリが書き出したCSVを取り込み直したもの。手動で作った案件に
          // までfromImportを立てると、次に一部の行だけのCSVを取り込んだとき「取り込みに無い」と
          // みなされて勝手に完了にされてしまうため、元から立っていた場合だけそのままにする。
          // 件名・詳細作業名で一致した行(別アプリのCSV)は従来どおりインポート由来として扱う
          ...(existingById ? {} : { fromImport: true }),
          // groupNameが未定義(CSVにgroup列自体が無い)の行では、既存のグループ名に触れない
          ...(row.groupName !== undefined ? { groupName: row.groupName || undefined } : {}),
          ...(row.stages ? { stages: mergeStages(existing.stages, row.stages) } : {}),
          ...extra,
        });
        updated++;
      } else {
        const item: ProjectItem = {
          id: row.id || uid(),
          title: row.title,
          groupName: row.groupName || undefined,
          category: row.category,
          workName: row.workName,
          dueDate: row.dueDate,
          createdAt,
          completedAt,
          fromImport: true,
          ...(row.stages && row.stages.length > 0 ? { stages: mergeStages(undefined, row.stages) } : {}),
          ...extra,
        };
        await db.projects.add(item);
        created++;
      }
    }

    // インポート由来（fromImport）で、かつ今回のインポートに件名・詳細作業名の組み合わせが
    // 見当たらなかった未完了案件は、元アプリ側で完了・削除されたとみなし自動的に完了にする。
    // 手動登録やToDoタブから反映した案件（fromImportが立っていない）はここでは一切触らない
    const importOriginOpen = await db.projects.filter((p) => !!p.fromImport && !p.completedAt).toArray();
    for (const p of importOriginOpen) {
      if (!touchedKeys.has(matchKey(p.title, p.workName))) {
        await db.projects.update(p.id, { completedAt: now, autoCompletedByImport: true });
        autoCompleted++;
        autoCompletedTitles.push(p.title);
      }
    }
  });

  return { created, updated, autoCompleted, autoCompletedTitles };
}

// 業務区分を入れずに作った案件の既定値(案件タブ・Claudeのワークスペースで共通)
export const DEFAULT_PROJECT_CATEGORY = "案件";

// 本日の作業に入れるときの業務区分。未設定の古い案件は件名で代用する(案件タブ・📈進捗で共通)
export function projectCategoryFor(project: Pick<ProjectItem, "category" | "title">): string {
  return project.category?.trim() || project.title;
}

// この案件から作った(=元の)ToDo。未完了を優先し、無ければ完了済みも返す
export async function findOriginTodo(projectId: string): Promise<TodoTask | undefined> {
  const linked = await db.todoTasks.filter((t) => t.projectId === projectId).toArray();
  return linked.find((t) => !t.completed && !t.parentTaskId) ?? linked.find((t) => !t.completed) ?? linked[0];
}

export interface ProjectDeletion {
  project: ProjectItem;
  /** 消したものをすべて戻す。消したあとに付け直された紐づけ・作り直されたものは上書きしない */
  undo: () => Promise<void>;
}

/**
 * 案件を消す。WBS・ToDoの「反映済み」の印・他の案件の先行案件の参照もまとめて外す(1つのトランザクション)。
 * 実績(records)は残す(集計では「削除済みの案件」として出る)
 */
export async function deleteProjectCascade(projectId: string): Promise<ProjectDeletion | null> {
  const snapshot = await db.transaction("rw", db.projects, db.wbsNodes, db.todoTasks, async () => {
    const project = await db.projects.get(projectId);
    if (!project) return null;
    const wbsNodes = await db.wbsNodes.where("projectId").equals(projectId).toArray();
    const todoIds = await db.todoTasks.filter((t) => t.projectId === projectId).primaryKeys();
    const dependentIds = await db.projects.filter((p) => p.predecessorProjectIds?.includes(projectId) ?? false).primaryKeys();
    await db.projects.delete(projectId);
    await db.wbsNodes.bulkDelete(wbsNodes.map((n) => n.id));
    // ToDo側に紐づけが残ると、存在しない案件に「反映済み」のまま再反映できなくなる
    for (const id of todoIds) await db.todoTasks.update(id, { projectId: undefined });
    for (const id of dependentIds) {
      const p = await db.projects.get(id);
      const rest = (p?.predecessorProjectIds ?? []).filter((pid) => pid !== projectId);
      await db.projects.update(id, { predecessorProjectIds: rest.length > 0 ? rest : undefined });
    }
    return { project, wbsNodes, todoIds, dependentIds };
  });
  if (!snapshot) return null;
  const { project, wbsNodes, todoIds, dependentIds } = snapshot;
  return {
    project,
    undo: async () => {
      await db.transaction("rw", db.projects, db.wbsNodes, db.todoTasks, async () => {
        if (!(await db.projects.get(project.id))) await db.projects.add(project);
        for (const n of wbsNodes) if (!(await db.wbsNodes.get(n.id))) await db.wbsNodes.add(n);
        for (const id of todoIds) {
          // 消したあとで別の案件へ反映し直したToDoは、その新しい紐づけを優先する
          const t = await db.todoTasks.get(id);
          if (t && !t.projectId) await db.todoTasks.update(id, { projectId: project.id });
        }
        for (const id of dependentIds) {
          const p = await db.projects.get(id);
          if (!p || p.predecessorProjectIds?.includes(project.id)) continue;
          await db.projects.update(id, { predecessorProjectIds: [...(p.predecessorProjectIds ?? []), project.id] });
        }
      });
    },
  };
}

/**
 * 案件を完了/未完了にする。手で完了にしたものは「取り込みで自動完了」の印を外す。
 * 取り消しは、そのあと完了状態が別の操作で変わっていなければ元に戻す
 */
export async function setProjectCompleted(
  projectId: string,
  completed: boolean
): Promise<{ before: ProjectItem; completedAt: number | undefined; undo: () => Promise<void> } | null> {
  const before = await db.projects.get(projectId);
  if (!before) return null;
  const completedAt = completed ? (before.completedAt ?? Date.now()) : undefined;
  await db.projects.update(projectId, { completedAt, autoCompletedByImport: false });
  return {
    before,
    completedAt,
    undo: async () => {
      const current = await db.projects.get(projectId);
      if (!current || current.completedAt !== completedAt) return;
      await db.projects.update(projectId, { completedAt: before.completedAt, autoCompletedByImport: before.autoCompletedByImport });
    },
  };
}

/**
 * 案件の複製(「型にして作る」と違い、そのまま写す)。段階・対応状況・URL・取引先・単価・見積は写し、
 * 実績・完了状態・添付は写さない。期日は元の登録日からの日数を保ったまま、今日を登録日として付け直す。
 * withWbs なら WBS も(進捗0で)写す
 */
export async function duplicateProject(projectId: string, opts: { withWbs?: boolean; now?: number } = {}): Promise<ProjectItem | null> {
  const src = await db.projects.get(projectId);
  if (!src) return null;
  const now = opts.now ?? Date.now();
  const offset = daysBetweenDateStrs(todayStr(new Date(src.createdAt)), todayStr(new Date(now)));
  const shift = (d: string | undefined) => (d ? shiftDateStr(d, offset) : undefined);
  const stages: ProjectStage[] | undefined = src.stages?.map((s) => ({
    id: uid(),
    title: s.title,
    completed: false,
    ...(s.dueDate ? { dueDate: shift(s.dueDate) } : {}),
    ...(s.tag ? { tag: s.tag } : {}),
    ...(s.targetCount != null ? { targetCount: s.targetCount, completedCount: 0 } : {}),
    ...(s.referenceSeconds != null ? { referenceSeconds: s.referenceSeconds } : {}),
  }));
  const copy: ProjectItem = {
    id: uid(),
    title: `${src.title}（複製）`,
    ...(src.groupName ? { groupName: src.groupName } : {}),
    category: src.category,
    workName: src.workName,
    dueDate: shift(src.dueDate)!,
    ...(src.tag ? { tag: src.tag } : {}),
    ...(src.url ? { url: src.url } : {}),
    ...(src.clientId ? { clientId: src.clientId } : {}),
    ...(src.hourlyRate != null ? { hourlyRate: src.hourlyRate } : {}),
    ...(src.estimatedTotalSeconds != null ? { estimatedTotalSeconds: src.estimatedTotalSeconds } : {}),
    createdAt: now,
    ...(stages && stages.length > 0 ? { stages } : {}),
  };
  await db.transaction("rw", db.projects, db.wbsNodes, async () => {
    await db.projects.add(copy);
    if (!opts.withWbs) return;
    const nodes = await db.wbsNodes.where("projectId").equals(projectId).toArray();
    const idMap = new Map(nodes.map((n) => [n.id, uid()]));
    const copies: WbsNode[] = nodes.map((n) => ({
      ...n,
      id: idMap.get(n.id)!,
      projectId: copy.id,
      parentId: n.parentId ? idMap.get(n.parentId) : undefined,
      predecessorIds: n.predecessorIds?.map((id) => idMap.get(id)).filter((id): id is string => !!id),
      startDate: shift(n.startDate),
      endDate: shift(n.endDate),
      progress: 0,
      createdAt: now,
      updatedAt: now,
    }));
    await db.wbsNodes.bulkAdd(copies);
  });
  return copy;
}

/** 段階に付いている実績の合計秒(除外した実績も含む。段階を消す前の確認に使う) */
export function stageRecordedSeconds(records: WorkRecord[], projectId: string, stageId: string): number {
  return records.filter((r) => r.projectId === projectId && r.stageId === stageId).reduce((s, r) => s + r.seconds, 0);
}
