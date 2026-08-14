import { db, uid } from "./db";
import type { ProjectItem, ProjectStage, WorkRecord } from "./types";
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

// CSVで指定された段階リストを既存の段階とタイトルでマッチングし、
// 完了状態(completed/completedCount)は引き継ぎつつタイトル・期日・目標件数を更新する。
// 既存に無いタイトルは新規段階として追加する。CSVの段階リストが未定義の行は
// この関数を呼ばず、既存の段階に一切触れない
function mergeStages(existingStages: ProjectStage[] | undefined, csvStages: ParsedProjectStage[]): ProjectStage[] {
  const existingByTitle = new Map((existingStages ?? []).map((s) => [s.title, s]));
  return csvStages.map((s) => {
    const existing = existingByTitle.get(s.title);
    return {
      id: existing?.id ?? uid(),
      title: s.title,
      dueDate: s.dueDate,
      targetCount: s.targetCount,
      completed: existing?.completed ?? false,
      completedCount: existing?.completedCount,
    };
  });
}

export async function upsertProjectsFromCsv(
  rows: ParsedProjectRow[]
): Promise<{ created: number; updated: number; autoCompleted: number }> {
  let created = 0;
  let updated = 0;
  let autoCompleted = 0;
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

      const createdAt = row.createdDate
        ? new Date(row.createdDate + "T00:00:00").getTime()
        : (existing?.createdAt ?? now);
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
          fromImport: true,
          ...(row.stages ? { stages: mergeStages(existing.stages, row.stages) } : {}),
        });
        updated++;
      } else {
        const item: ProjectItem = {
          id: row.id || uid(),
          title: row.title,
          category: row.category,
          workName: row.workName,
          dueDate: row.dueDate,
          createdAt,
          completedAt,
          fromImport: true,
          ...(row.stages && row.stages.length > 0 ? { stages: mergeStages(undefined, row.stages) } : {}),
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
        await db.projects.update(p.id, { completedAt: now });
        autoCompleted++;
      }
    }
  });

  return { created, updated, autoCompleted };
}
