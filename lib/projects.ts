import { db, uid } from "./db";
import type { ProjectItem } from "./types";
import type { ParsedProjectRow } from "./projectsCsv";

export async function upsertProjectsFromCsv(
  rows: ParsedProjectRow[]
): Promise<{ created: number; updated: number; skipped: number }> {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const now = Date.now();

  await db.transaction("rw", db.projects, async () => {
    for (const row of rows) {
      // idが指定されている行は、既存のその案件を明示的に更新する意図とみなす
      let existingById: ProjectItem | undefined;
      if (row.id) {
        existingById = await db.projects.get(row.id);
      }

      // 客先（件名）・機種（詳細作業名）・期日が一致する案件が既にある場合は、
      // 重複登録とみなして弾く（idで明示指定されている場合を除く）
      const duplicate = await db.projects
        .filter(
          (p) =>
            p.id !== row.id &&
            p.title === row.title &&
            p.workName === row.workName &&
            p.dueDate === row.dueDate
        )
        .first();

      if (!existingById && duplicate) {
        skipped++;
        continue;
      }

      const existing = existingById ?? duplicate;
      const createdAt = row.createdDate
        ? new Date(row.createdDate + "T00:00:00").getTime()
        : (existing?.createdAt ?? now);
      const completedAt = row.completed ? (existing?.completedAt ?? now) : undefined;

      if (existing) {
        await db.projects.update(existing.id, {
          title: row.title,
          category: row.category,
          workName: row.workName,
          dueDate: row.dueDate,
          createdAt,
          completedAt,
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
        };
        await db.projects.add(item);
        created++;
      }
    }
  });

  return { created, updated, skipped };
}
