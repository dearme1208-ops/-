export type Weekday = 1 | 2 | 3 | 4 | 5; // 1=月 ... 5=金

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  1: "月",
  2: "火",
  3: "水",
  4: "木",
  5: "金",
};

export interface MasterTask {
  id: string;
  category: string;
  name: string;
  estimatedSeconds: number;
  isFavorite: boolean;
  sampleCount: number; // 実績平均の算出に使ったサンプル数（表示用）
  createdAt: number;
  updatedAt: number;
  tags?: string[]; // タグ別の作業時間集計に使う自由入力タグ
  archived?: boolean; // 使用頻度の低いマスタをアーカイブした際にtrue。一覧・ピッカーの既定表示から除外する
}

export interface TemplateItem {
  id: string;
  weekday: Weekday;
  order: number;
  masterTaskId?: string;
  category: string;
  name: string;
  estimatedSeconds: number;
}

export type TaskStatus = "pending" | "running" | "paused" | "done";

export interface TimeSegment {
  start: number; // epoch ms
  end?: number; // epoch ms, undefined = still running
}

export interface DailyTask {
  id: string;
  date: string; // YYYY-MM-DD
  order: number;
  masterTaskId?: string;
  category: string;
  name: string;
  estimatedSeconds: number;
  status: TaskStatus;
  segments: TimeSegment[];
  accumulatedMs: number; // completed segments total
  startedAt?: number;
  endedAt?: number;
  isSpontaneous: boolean;
  notifiedOverrun?: boolean;
  overrunPromptShown?: boolean;
  overrunPromptDismissedAt?: number;
  isProvisional?: boolean; // 未計測時間の自動仮計測タスク（作業未割り当て）
  projectId?: string; // 案件から追加された場合、その案件のID
  isTrouble?: boolean; // トラブル対応タスクかどうか
  resumeTaskIds?: string[]; // トラブル対応で中断した（一時停止させられた）作業のID一覧。トラブル完了時にまとめて再開する
  note?: string; // 完了時の一言メモ
}

export interface WorkRecord {
  id: string;
  date: string; // YYYY-MM-DD
  category: string;
  name: string;
  masterTaskId?: string;
  seconds: number;
  startedAt: number;
  endedAt: number;
  excludedFromStats: boolean;
  excludeReason?: "auto-iqr" | "manual";
  manualOverride?: boolean; // true = ユーザーが除外/復活を手動指定済み。自動IQR判定の対象外
  projectId?: string; // 案件から追加された作業の場合、その案件のID
  isTrouble?: boolean; // トラブル対応の実績かどうか。詳細作業名が実績ごとに異なるため、
  // ランキング等の集計では詳細作業名を無視し、大項目でひとつにまとめて集計する
  note?: string; // 作業完了時の一言メモ（複数の実績が合算された場合は最後に編集したメモで上書きされる）
}

export interface AppSetting {
  key: string;
  value: string;
}

// 未計測の自動計測から除外する時間帯（休憩など）。日付を問わず毎日この時刻範囲に適用する
export interface BreakRange {
  start: string; // HH:MM
  end: string; // HH:MM
}

// 体調記録。1日の中で何度でも記録でき、記録時点で計測中だった作業を紐付ける
export interface ConditionLog {
  id: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM（記録した時刻の表示用）
  loggedAt: number;
  level: string; // CONDITION_LEVELSのlevelと対応
  category?: string; // 記録時点で計測中だった作業の大項目（なければ未記録）
  name?: string; // 記録時点で計測中だった作業の詳細作業名
}

export interface ProjectItem {
  id: string;
  title: string; // 件名
  category: string; // 業務区分（大項目）。本日の作業に反映する際の区分になる
  workName: string; // 詳細作業名（本日の作業に反映する際の作業名）
  dueDate: string; // 期日 YYYY-MM-DD
  createdAt: number;
  completedAt?: number;
  fromImport?: boolean; // CSVインポートで作成/更新された案件かどうか。次回インポートで
  // 行が見当たらなくなった場合の自動完了判定はこのフラグが立っている案件だけに適用する
}

// ---- ToDo ----

export interface TodoList {
  id: string;
  title: string;
  order: number;
  createdAt: number;
}

export type RecurrenceType = "daily" | "weekly" | "monthlyDate" | "monthlyWeekday" | "yearly";
export type RecurrenceOrdinal = 1 | 2 | 3 | 4 | -1; // monthlyWeekday用: 第1..4, -1=最終

export interface RecurrenceRule {
  type: RecurrenceType;
  interval: number; // N日ごと/N週ごと/Nヶ月ごと/N年ごと
  weekdays?: number[]; // weekly用: 0=日..6=土
  day?: number; // monthlyDate用: 日付(1-31, -1=月末), yearly用: 日付
  month?: number; // yearly用: 月(1-12)
  weekday?: number; // monthlyWeekday用: 0=日..6=土
  ordinal?: RecurrenceOrdinal;
}

export const RECURRENCE_TYPE_LABELS: Record<RecurrenceType, string> = {
  daily: "毎日",
  weekly: "毎週",
  monthlyDate: "毎月（日付指定）",
  monthlyWeekday: "毎月（第◯曜日）",
  yearly: "毎年",
};

export const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];

export const ORDINAL_LABELS: Record<RecurrenceOrdinal, string> = {
  1: "第1",
  2: "第2",
  3: "第3",
  4: "第4",
  "-1": "最終",
};

export interface TodoTask {
  id: string;
  listId: string;
  parentTaskId?: string; // 設定されていればサブタスク
  title: string;
  action?: string; // 次にすべき具体的な行動。件名(title)とは別に記録する
  url?: string; // 関連リンク。一覧のリンクボタンから直接開ける
  tag?: string; // 社内確認中・客先確認中・打ち合わせ など、件名の頭に付けるラベル
  customer?: string; // 客先名
  notes?: string;
  startDate?: string; // 開始日 YYYY-MM-DD。設定されていれば期日よりこちらを優先してリスト順に反映する
  dueDate?: string; // YYYY-MM-DD
  important: boolean;
  completed: boolean;
  completedAt?: number;
  myDayDate?: string; // この日付の「マイデイ」に追加されている場合にセット
  order: number;
  createdAt: number;
  recurrence?: RecurrenceRule;
  projectId?: string; // 案件タブに反映済みの場合、その案件のID
}
