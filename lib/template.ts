import { db, uid } from "./db";
import { findOrCreateMasterTask } from "./master";
import type { TemplateItem } from "./types";
import type { ParsedTemplateRow } from "./templateCsv";

export async function upsertTemplateItemsFromCsv(
  rows: ParsedTemplateRow[]
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  const nextOrderByWeekday = new Map<number, number>();

  for (const row of rows) {
    let existing: TemplateItem | undefined;
    if (row.id) {
      existing = await db.templateItems.get(row.id);
    }
    if (!existing) {
      existing = await db.templateItems
        .where("weekday")
        .equals(row.weekday)
        .filter((t) => t.category === row.category && t.name === row.name)
        .first();
    }

    const master = await findOrCreateMasterTask(row.category, row.name, row.estimatedSeconds);

    let order = row.order;
    if (order === undefined) {
      if (!nextOrderByWeekday.has(row.weekday)) {
        const count = await db.templateItems.where("weekday").equals(row.weekday).count();
        nextOrderByWeekday.set(row.weekday, count);
      }
      order = nextOrderByWeekday.get(row.weekday)!;
      nextOrderByWeekday.set(row.weekday, order + 1);
    }

    if (existing) {
      await db.templateItems.update(existing.id, {
        weekday: row.weekday,
        order,
        masterTaskId: master.id,
        category: row.category,
        name: row.name,
        estimatedSeconds: row.estimatedSeconds,
      });
      updated++;
    } else {
      const item: TemplateItem = {
        id: row.id || uid(),
        weekday: row.weekday,
        order,
        masterTaskId: master.id,
        category: row.category,
        name: row.name,
        estimatedSeconds: row.estimatedSeconds,
      };
      await db.templateItems.add(item);
      created++;
    }
  }

  return { created, updated };
}
