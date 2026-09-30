import Dexie, { type Table } from "dexie";
import { isFreshlyCreated, trackItemCreate, trackItemUpdate, trackStages } from "./changeTracking";
import type {
  MasterTask,
  TemplateItem,
  DailyTask,
  WorkRecord,
  AppSetting,
  ProjectItem,
  TodoList,
  TodoTask,
  ConditionLog,
  GeoPlace,
  WeatherPlace,
  WeatherForecast,
  MandalaChart,
  MemoBoard,
  MemoNote,
  MemoStroke,
  MemoConnector,
  Client,
  BoardShape,
  BoardStamp,
  WbsNode,
} from "./types";

export class KouteiDB extends Dexie {
  masterTasks!: Table<MasterTask, string>;
  templateItems!: Table<TemplateItem, string>;
  dailyTasks!: Table<DailyTask, string>;
  records!: Table<WorkRecord, string>;
  settings!: Table<AppSetting, string>;
  projects!: Table<ProjectItem, string>;
  todoLists!: Table<TodoList, string>;
  todoTasks!: Table<TodoTask, string>;
  conditionLogs!: Table<ConditionLog, string>;
  geoPlaces!: Table<GeoPlace, string>;
  weatherPlaces!: Table<WeatherPlace, string>;
  weatherForecasts!: Table<WeatherForecast, string>;
  mandalaCharts!: Table<MandalaChart, string>;
  memoBoards!: Table<MemoBoard, string>;
  memoNotes!: Table<MemoNote, string>;
  memoStrokes!: Table<MemoStroke, string>;
  memoConnectors!: Table<MemoConnector, string>;
  clients!: Table<Client, string>;
  boardShapes!: Table<BoardShape, string>;
  boardStamps!: Table<BoardStamp, string>;
  wbsNodes!: Table<WbsNode, string>;

  constructor() {
    super("koutei-hyo");
    this.version(1).stores({
      masterTasks: "id, category, name, isFavorite",
      templateItems: "id, weekday, order",
      dailyTasks: "id, date, status, order",
      records: "id, date, category, name, masterTaskId, excludedFromStats",
      settings: "key",
    });
    this.version(2).stores({
      masterTasks: "id, category, name, isFavorite",
      templateItems: "id, weekday, order",
      dailyTasks: "id, date, status, order",
      records: "id, date, category, name, masterTaskId, excludedFromStats",
      settings: "key",
      projects: "id, dueDate, createdAt",
    });
    this.version(3).stores({
      masterTasks: "id, category, name, isFavorite",
      templateItems: "id, weekday, order",
      dailyTasks: "id, date, status, order",
      records: "id, date, category, name, masterTaskId, excludedFromStats",
      settings: "key",
      projects: "id, dueDate, createdAt",
      todoLists: "id, order",
      todoTasks: "id, listId, parentTaskId, dueDate, completed, myDayDate, order",
    });
    this.version(4).stores({
      masterTasks: "id, category, name, isFavorite",
      templateItems: "id, weekday, order",
      dailyTasks: "id, date, status, order",
      records: "id, date, category, name, masterTaskId, excludedFromStats",
      settings: "key",
      projects: "id, dueDate, createdAt",
      todoLists: "id, order",
      todoTasks: "id, listId, parentTaskId, dueDate, completed, myDayDate, order",
      conditionLogs: "id, date, loggedAt",
    });
    this.version(5).stores({
      masterTasks: "id, category, name, isFavorite",
      templateItems: "id, weekday, order",
      dailyTasks: "id, date, status, order",
      records: "id, date, category, name, masterTaskId, excludedFromStats",
      settings: "key",
      projects: "id, dueDate, createdAt",
      todoLists: "id, order",
      todoTasks: "id, listId, parentTaskId, dueDate, completed, myDayDate, order",
      conditionLogs: "id, date, loggedAt",
      geoPlaces: "id, createdAt",
    });
    this.version(6).stores({
      masterTasks: "id, category, name, isFavorite",
      templateItems: "id, weekday, order",
      dailyTasks: "id, date, status, order",
      records: "id, date, category, name, masterTaskId, excludedFromStats",
      settings: "key",
      projects: "id, dueDate, createdAt",
      todoLists: "id, order",
      todoTasks: "id, listId, parentTaskId, dueDate, completed, myDayDate, order",
      conditionLogs: "id, date, loggedAt",
      geoPlaces: "id, createdAt",
      weatherForecasts: "id, placeId, date",
    });
    this.version(7).stores({
      masterTasks: "id, category, name, isFavorite",
      templateItems: "id, weekday, order",
      dailyTasks: "id, date, status, order",
      records: "id, date, category, name, masterTaskId, excludedFromStats",
      settings: "key",
      projects: "id, dueDate, createdAt",
      todoLists: "id, order",
      todoTasks: "id, listId, parentTaskId, dueDate, completed, myDayDate, order",
      conditionLogs: "id, date, loggedAt",
      geoPlaces: "id, createdAt",
      weatherForecasts: "id, placeId, date",
      weatherPlaces: "id, createdAt",
    });
    this.version(8).stores({
      masterTasks: "id, category, name, isFavorite",
      templateItems: "id, weekday, order",
      dailyTasks: "id, date, status, order",
      records: "id, date, category, name, masterTaskId, excludedFromStats",
      settings: "key",
      projects: "id, dueDate, createdAt",
      todoLists: "id, order",
      todoTasks: "id, listId, parentTaskId, dueDate, completed, myDayDate, order",
      conditionLogs: "id, date, loggedAt",
      geoPlaces: "id, createdAt",
      weatherForecasts: "id, placeId, date",
      weatherPlaces: "id, createdAt",
      mandalaCharts: "id, createdAt",
    });
    this.version(9).stores({
      masterTasks: "id, category, name, isFavorite",
      templateItems: "id, weekday, order",
      dailyTasks: "id, date, status, order",
      records: "id, date, category, name, masterTaskId, excludedFromStats",
      settings: "key",
      projects: "id, dueDate, createdAt",
      todoLists: "id, order",
      todoTasks: "id, listId, parentTaskId, dueDate, completed, myDayDate, order",
      conditionLogs: "id, date, loggedAt",
      geoPlaces: "id, createdAt",
      weatherForecasts: "id, placeId, date",
      weatherPlaces: "id, createdAt",
      mandalaCharts: "id, createdAt",
      memoBoards: "id, order",
      memoNotes: "id, boardId, order",
      memoStrokes: "id, boardId, createdAt",
    });
    this.version(10).stores({
      masterTasks: "id, category, name, isFavorite",
      templateItems: "id, weekday, order",
      dailyTasks: "id, date, status, order",
      records: "id, date, category, name, masterTaskId, excludedFromStats",
      settings: "key",
      projects: "id, dueDate, createdAt",
      todoLists: "id, order",
      todoTasks: "id, listId, parentTaskId, dueDate, completed, myDayDate, order",
      conditionLogs: "id, date, loggedAt",
      geoPlaces: "id, createdAt",
      weatherForecasts: "id, placeId, date",
      weatherPlaces: "id, createdAt",
      mandalaCharts: "id, createdAt",
      memoBoards: "id, order",
      memoNotes: "id, boardId, order",
      memoStrokes: "id, boardId, createdAt",
      memoConnectors: "id, boardId, fromNoteId, toNoteId",
    });
    this.version(11).stores({
      masterTasks: "id, category, name, isFavorite",
      templateItems: "id, weekday, order",
      dailyTasks: "id, date, status, order",
      records: "id, date, category, name, masterTaskId, excludedFromStats",
      settings: "key",
      projects: "id, dueDate, createdAt",
      todoLists: "id, order",
      todoTasks: "id, listId, parentTaskId, dueDate, completed, myDayDate, order",
      conditionLogs: "id, date, loggedAt",
      geoPlaces: "id, createdAt",
      weatherForecasts: "id, placeId, date",
      weatherPlaces: "id, createdAt",
      mandalaCharts: "id, createdAt",
      memoBoards: "id, order",
      memoNotes: "id, boardId, order",
      memoStrokes: "id, boardId, createdAt",
      memoConnectors: "id, boardId, fromNoteId, toNoteId",
      clients: "id, order",
    });
    this.version(12).stores({
      masterTasks: "id, category, name, isFavorite",
      templateItems: "id, weekday, order",
      dailyTasks: "id, date, status, order",
      records: "id, date, category, name, masterTaskId, excludedFromStats",
      settings: "key",
      projects: "id, dueDate, createdAt",
      todoLists: "id, order",
      todoTasks: "id, listId, parentTaskId, dueDate, completed, myDayDate, order",
      conditionLogs: "id, date, loggedAt",
      geoPlaces: "id, createdAt",
      weatherForecasts: "id, placeId, date",
      weatherPlaces: "id, createdAt",
      mandalaCharts: "id, createdAt",
      memoBoards: "id, order",
      memoNotes: "id, boardId, order",
      memoStrokes: "id, boardId, createdAt",
      memoConnectors: "id, boardId, fromNoteId, toNoteId",
      clients: "id, order",
      boardShapes: "id, boardId, order",
    });
    this.version(13).stores({
      masterTasks: "id, category, name, isFavorite",
      templateItems: "id, weekday, order",
      dailyTasks: "id, date, status, order",
      records: "id, date, category, name, masterTaskId, excludedFromStats",
      settings: "key",
      projects: "id, dueDate, createdAt",
      todoLists: "id, order",
      todoTasks: "id, listId, parentTaskId, dueDate, completed, myDayDate, order",
      conditionLogs: "id, date, loggedAt",
      geoPlaces: "id, createdAt",
      weatherForecasts: "id, placeId, date",
      weatherPlaces: "id, createdAt",
      mandalaCharts: "id, createdAt",
      memoBoards: "id, order",
      memoNotes: "id, boardId, order",
      memoStrokes: "id, boardId, createdAt",
      memoConnectors: "id, boardId, fromNoteId, toNoteId",
      clients: "id, order",
      boardShapes: "id, boardId, order",
      boardStamps: "id, boardId, order",
    });
    // WBS(作業分解構成図)用のテーブルを追加。案件1件に対して複数のWbsNodeがぶら下がる
    this.version(14).stores({
      masterTasks: "id, category, name, isFavorite",
      templateItems: "id, weekday, order",
      dailyTasks: "id, date, status, order",
      records: "id, date, category, name, masterTaskId, excludedFromStats",
      settings: "key",
      projects: "id, dueDate, createdAt",
      todoLists: "id, order",
      todoTasks: "id, listId, parentTaskId, dueDate, completed, myDayDate, order",
      conditionLogs: "id, date, loggedAt",
      geoPlaces: "id, createdAt",
      weatherForecasts: "id, placeId, date",
      weatherPlaces: "id, createdAt",
      mandalaCharts: "id, createdAt",
      memoBoards: "id, order",
      memoNotes: "id, boardId, order",
      memoStrokes: "id, boardId, createdAt",
      memoConnectors: "id, boardId, fromNoteId, toNoteId",
      clients: "id, order",
      boardShapes: "id, boardId, order",
      boardStamps: "id, boardId, order",
      wbsNodes: "id, projectId, parentId, order",
    });
  }
}

export const db = new KouteiDB();

// 対応状況の変更日時と期日の変更履歴は、どの画面・取り込みから書き換わっても漏れなく残るよう、
// 個々の画面ではなくDBの作成・更新フックで記録する(判定はlib/changeTracking.ts)
db.todoTasks.hook("creating", (_key, obj) => {
  trackItemCreate(obj, Date.now());
});
db.todoTasks.hook("updating", (mods, _key, obj) => {
  const extra = trackItemUpdate(obj, mods as Record<string, unknown>, Date.now());
  return Object.keys(extra).length > 0 ? extra : undefined;
});
db.projects.hook("creating", (_key, obj) => {
  const now = Date.now();
  trackItemCreate(obj, now);
  if (obj.stages && isFreshlyCreated(obj.createdAt, now)) {
    obj.stages = trackStages(undefined, obj.stages, obj.createdAt ?? now) ?? obj.stages;
  }
});
db.projects.hook("updating", (mods, _key, obj) => {
  const now = Date.now();
  const m = mods as Record<string, unknown>;
  const extra: Record<string, unknown> = { ...trackItemUpdate(obj, m, now) };
  if (Array.isArray(m.stages)) {
    const stages = trackStages(obj.stages, m.stages as ProjectItem["stages"] & object, now);
    if (stages) extra.stages = stages;
  }
  return Object.keys(extra).length > 0 ? extra : undefined;
});

export function uid(): string {
  return crypto.randomUUID();
}
