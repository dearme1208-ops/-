import { db, uid } from "./db";
import type { ProjectItem } from "./types";
import type { ParsedProjectRow } from "./projectsCsv";

export async function upsertProjectsFromCsv(
  rows: ParsedProjectRow[]
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  const now = Date.now();

  await db.transaction("rw", db.projects, async () => {
    for (const row of rows) {
      let existing: ProjectItem | undefined;
      if (row.id) {
        existing = await db.projects.get(row.id);
      }
      if (!existing) {
        existing = await db.projects
          .filter((p) => p.title === row.title && p.workName === row.workName && p.dueDate === row.dueDate)
          .first();
      }

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

  return { created, updated };
}
