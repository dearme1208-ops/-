import Dexie, { type Table } from "dexie";
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
  }
}

export const db = new KouteiDB();

export function uid(): string {
  return crypto.randomUUID();
}
