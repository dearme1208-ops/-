import Dexie, { type Table } from "dexie";
import type { MasterTask, TemplateItem, DailyTask, WorkRecord, AppSetting } from "./types";

export class KouteiDB extends Dexie {
  masterTasks!: Table<MasterTask, string>;
  templateItems!: Table<TemplateItem, string>;
  dailyTasks!: Table<DailyTask, string>;
  records!: Table<WorkRecord, string>;
  settings!: Table<AppSetting, string>;

  constructor() {
    super("koutei-hyo");
    this.version(1).stores({
      masterTasks: "id, category, name, isFavorite",
      templateItems: "id, weekday, order",
      dailyTasks: "id, date, status, order",
      records: "id, date, category, name, masterTaskId, excludedFromStats",
      settings: "key",
    });
  }
}

export const db = new KouteiDB();

export function uid(): string {
  return crypto.randomUUID();
}
