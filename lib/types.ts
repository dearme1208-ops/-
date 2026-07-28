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
  resumeTaskId?: string; // トラブル対応で中断した作業のID。トラブル完了時に再開する
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
}

export interface AppSetting {
  key: string;
  value: string;
}

export interface ProjectItem {
  id: string;
  title: string; // 件名
  category: string; // 業務区分（大項目）。本日の作業に反映する際の区分になる
  workName: string; // 詳細作業名（本日の作業に反映する際の作業名）
  dueDate: string; // 期日 YYYY-MM-DD
  createdAt: number;
  completedAt?: number;
}
