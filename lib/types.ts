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
  quickSlot?: number; // 1〜4。ホーム画面ショートカット(?quickstart=N)から開始/終了できる枠に割り当て済みの場合に設定
}

// 位置情報による地点到着検知(自動開始)で使う、事前登録した場所。
// 到着(半径圏内に入る)を検知すると、紐づく業務区分/作業名で自動的に計測を開始する
export interface GeoPlace {
  id: string;
  label: string; // 表示名（例: A社本社）
  lat: number;
  lon: number;
  radiusMeters: number;
  category: string;
  name: string;
  createdAt: number;
}

// 天気変化の通知で使う、事前登録した場所。地点到着検知(GeoPlace)とは別の独立した登録で、
// 自動開始の紐付け(業務区分/作業名/半径)を持たず、天気予報を取得するための座標のみを持つ
export interface WeatherPlace {
  id: string;
  label: string; // 表示名（例: 自宅）
  lat: number;
  lon: number;
  createdAt: number;
}

// 登録地点(WeatherPlace)ごとに、当日分として取得済みの時間帯別降水確率予報をキャッシュする。
// アプリを開いている間に取得できた情報を保存しておくだけで、閉じている/バックグラウンドの間は
// 更新されない(その時点の情報のまま)。notifiedForIsoで同じ変化を二重通知しないようにする
export interface WeatherForecast {
  id: string; // `${placeId}::${date}`
  placeId: string;
  date: string; // YYYY-MM-DD
  fetchedAt: number;
  hourly: { atIso: string; precipProbability: number }[];
  notifiedForIso?: string;
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
  manualAdjustmentMs?: number; // 「時間を加算」で手動追加した分。segmentsとは独立して保持し、
  // pause/finish時にsegments合計で上書きされないようにする（実際の区間ではないためGanttの
  // セグメント表示には出さず、合計時間の算出時にのみ加算する）
  startedAt?: number;
  endedAt?: number;
  isSpontaneous: boolean;
  notifiedOverrun?: boolean;
  overrunPromptShown?: boolean;
  overrunPromptDismissedAt?: number;
  isProvisional?: boolean; // 未計測時間の自動仮計測タスク（作業未割り当て）
  projectId?: string; // 案件から追加された場合、その案件のID
  stageId?: string; // 案件の段階（マイルストーン）から追加された場合、その段階のID
  todoTaskId?: string; // ToDoタスクから追加された場合、その元になったTodoTaskのID
  // （案件経由の場合も、その案件がTodoタスクから反映されたものならここに元Todoが入る）
  isTrouble?: boolean; // トラブル対応タスクかどうか
  resumeTaskIds?: string[]; // 中断した（一時停止させられた）作業のID一覧。この作業の完了時にまとめて再開する
  note?: string; // 完了時の一言メモ
  scheduledTime?: string; // HH:MM。カレンダー予定インポート等で設定され、その時刻になったら自動的に差し込み開始する
  autoStartNotified?: boolean; // scheduledTimeによる自動開始・通知をすでに行ったか（二重発火防止）
  autoStartDisabled?: boolean; // true の場合、scheduledTimeになっても自動開始せず時刻の目安表示のみにする
  hasPlan?: boolean; // false の場合、この作業インスタンスには「予定」を設定しない（目安のestimatedSecondsは0扱い）。
  // 未設定/trueは従来通り予定ありとして扱う（テンプレート・予定インポート・クイックスタート等は常に予定あり）
  secondaryProjectIds?: string[]; // 兼務・並行作業などで、主案件(projectId)以外にも時間を按分したい場合の
  // 追加の案件タグ。段階完了フロー等には影響せず、集計・レポートでの時間合算にのみ使う
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
  stageId?: string; // 案件の段階（マイルストーン）から追加された作業の場合、その段階のID
  isTrouble?: boolean; // トラブル対応の実績かどうか。詳細作業名が実績ごとに異なるため、
  // ランキング等の集計では詳細作業名を無視し、大項目でひとつにまとめて集計する
  note?: string; // 作業完了時の一言メモ（複数の実績が合算された場合は最後に編集したメモで上書きされる）
  secondaryProjectIds?: string[]; // 主案件(projectId)以外にも時間を按分したい場合の追加の案件タグ
  segments?: TimeSegment[]; // 実際に計測していた区間(一時停止で分断された区間ごと)。
  // 定時以降の実働判定など、startedAt〜endedAtの範囲をそのまま「働いていた」とみなすと
  // 一時停止していた間も含めてしまうため、可能な場合はここから正確な重なりを計算する。
  // 手動加算分やCSV取り込み・実績編集など区間が不明な記録ではundefinedのままになる
}

export interface AppSetting {
  key: string;
  value: string;
}

// 未計測の自動計測から除外する時間帯（休憩など）。日付を問わず毎日この時刻範囲に適用する
export interface BreakRange {
  start: string; // HH:MM
  end: string; // HH:MM
  forceStop?: boolean; // trueの場合、この時刻になると計測中の作業を強制的に一時停止して休憩扱いにする
  checklist?: string[]; // forceStop時に表示するチェックリスト項目（例: 目薬をさす、水を飲む）
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

export interface ProjectStage {
  id: string;
  title: string;
  completed: boolean;
  completedAt?: number; // 完了にした時刻(epoch ms)。レポートで「いつ完了したか」を区別するために使う
  dueDate?: string; // YYYY-MM-DD（任意）
  targetCount?: number; // 目標件数（見積り10件・チーム移籍20件など、件数で進捗管理したい場合に設定）
  completedCount?: number; // targetCountを設定した場合の、これまでの完了件数
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
  autoCompletedByImport?: boolean; // 次回インポートに行が見当たらなくなったことによる自動完了かどうか。
  // 実際に作業が終わったとは限らない(単に詳細作業名が変わって別行扱いになっただけの場合も多い)ため、
  // レポート等で「完了」として讃える対象からは区別して扱う。ユーザーが手動で完了操作をした場合は
  // trueにせず、既にtrueだった場合はfalseへ戻す
  hourlyRate?: number; // この案件専用の時給/単価（円）。無ければカテゴリ別/デフォルト単価を使う
  stages?: ProjectStage[]; // 案件を段階（マイルストーン）に分けて進捗管理する場合に使う
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
  tag?: string; // 対応状況。社内確認中・客先確認中・打ち合わせ など
  category?: string; // 分類。見積・生産性検討・単価改定 など、案件の種類
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

// ---- マンダラチャート ----

// 大谷翔平選手の目標達成シートで知られる9x9マス(3x3ブロックのさらに3x3)の目標設定図。
// 中心1マスの目標→周囲8マスのテーマ→各テーマごとの8マスの具体策、という構造を
// 素直に配列で持つ(グリッド上の座標計算はlib/mandala.ts側で行う)
export interface MandalaChart {
  id: string;
  title: string;
  goal: string;
  themes: string[]; // 長さ8
  actions: string[][]; // actions[themeIndex][actionIndex]、8x8
  // 具体策セルだけ、既存/新規のToDoタスクと紐付けられる。未紐付けはundefined
  actionTodoIds: (string | undefined)[][]; // actionTodoIds[themeIndex][actionIndex]、8x8
  createdAt: number;
  updatedAt: number;
}

// ---- メモ(付箋+手書きボード) ----

// 1ページ完結の固定サイズボード。無限キャンバスにはせず、複数ボードを切り替える形で
// 用途ごとに分ける(付箋の一覧・タッチペンでの手書き・音声入力メモをこの上に置く)
export interface MemoBoard {
  id: string;
  title: string;
  order: number;
  createdAt: number;
}

export interface MemoNote {
  id: string;
  boardId: string;
  x: number; // ボード内の左上からのpx位置
  y: number;
  width: number;
  height: number;
  color: string; // MEMO_NOTE_COLORSのキー
  text: string;
  order: number; // 重なった際の前後関係(ドラッグ/新規作成のたびに最前面へ)
  createdAt: number;
  updatedAt: number;
}

export interface MemoStroke {
  id: string;
  boardId: string;
  points: { x: number; y: number }[]; // ボード内のpx座標。2点未満は保存しない
  color: string; // CSSカラー
  width: number; // 線の太さ(px)
  createdAt: number;
}
