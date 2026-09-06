import type { Weather } from "./mountain";

// 登山モードの文言。図版は常に出て、言葉だけが工程表の言い回しに戻る。
// THEMED は山の言葉、PLAIN は元の言葉。数値そのものはどちらでも同じ
export interface MountainWords {
  title: string;
  subtitle: string;
  todayRoute: string;
  legHeading: string;
  courseTime: string;
  actualTime: string;
  gain: string;
  gainUnit: string;
  altimeter: string;
  altimeterSub: (done: number, total: number) => string;
  daylight: string;
  daylightLeft: (min: number) => string;
  afterSunset: string;
  weatherName: (w: Weather) => string;
  weatherNote: (w: Weather, trouble: number, overrun: number) => string;
  pack: string;
  packNote: (grams: number, overdue: number) => string;
  packUnit: string;
  routeList: string;
  summit: string;
  start: string;
  now: string;
  grade: string;
  waypointsDone: (done: number, total: number) => string;
  collapsed: (n: number) => string;
  daysLeft: (n: number) => string;
  summited: string;
  climbLog: string;
  climbLogLabel: string;
  legStatus: (status: "pending" | "running" | "paused" | "done") => string;
  legOver: string;
  legUnder: string;
  noRoutes: string;
  noLegs: string;
  troubleLeg: string;
}

const THEMED: MountainWords = {
  title: "本日の行程",
  subtitle: "コースタイムと実際の行動時間",
  todayRoute: "本日の行程図",
  legHeading: "区間",
  courseTime: "コースタイム",
  actualTime: "行動時間",
  gain: "獲得標高",
  gainUnit: "m",
  altimeter: "高度計",
  altimeterSub: (done, total) => `${done}/${total}区間 通過`,
  daylight: "日没まで",
  daylightLeft: (min) => `あと${Math.floor(min / 60)}時間${min % 60}分`,
  afterSunset: "日没・ヘッドランプ行動",
  weatherName: (w) => (w === "clear" ? "快晴" : w === "cloudy" ? "曇り" : w === "rain" ? "雨" : "荒天"),
  weatherNote: (w, trouble, overrun) =>
    w === "storm"
      ? `落石${trouble}件・コースタイム超過${overrun}区間。撤退も選択肢です`
      : w === "rain"
        ? `落石${trouble}件・コースタイム超過${overrun}区間。足元に注意`
        : w === "cloudy"
          ? `コースタイム超過${overrun}区間。ペースを確認`
          : "コースタイム内。良い歩きです",
  pack: "ザックの中身",
  packNote: (grams, overdue) =>
    overdue > 0 ? `総重量 ${(grams / 1000).toFixed(1)}kg / 期限切れ${overdue}点が重石に` : `総重量 ${(grams / 1000).toFixed(1)}kg`,
  packUnit: "g",
  routeList: "登攀中の山",
  summit: "山頂",
  start: "登山口",
  now: "現在地",
  grade: "難易度",
  waypointsDone: (done, total) => `通過点 ${done}/${total}`,
  collapsed: (n) => `ルート崩落 ${n}箇所`,
  daysLeft: (n) => (n < 0 ? `${-n}日 超過` : n === 0 ? "本日 下山期限" : `下山期限まで ${n}日`),
  summited: "登頂済み",
  climbLog: "行動記録",
  climbLogLabel: "直近30日の獲得標高",
  legStatus: (s) => (s === "running" ? "行動中" : s === "paused" ? "休憩中" : s === "done" ? "通過" : "未踏"),
  legOver: "コースタイム超過",
  legUnder: "コースタイム内",
  noRoutes: "登攀中の山はありません。案件を登録すると一座として現れます。",
  noLegs: "本日の行程が組まれていません。作業を追加すると区間として並びます。",
  troubleLeg: "落石対応",
};

const PLAIN: MountainWords = {
  title: "本日の作業",
  subtitle: "想定時間と実績時間",
  todayRoute: "本日の進み具合",
  legHeading: "作業",
  courseTime: "想定時間",
  actualTime: "実績時間",
  gain: "実働換算",
  gainUnit: "m",
  altimeter: "進捗計",
  altimeterSub: (done, total) => `${done}/${total}件 完了`,
  daylight: "終業まで",
  daylightLeft: (min) => `あと${Math.floor(min / 60)}時間${min % 60}分`,
  afterSunset: "所定時間を超えています",
  weatherName: (w) => (w === "clear" ? "順調" : w === "cloudy" ? "やや超過" : w === "rain" ? "超過" : "大幅超過"),
  weatherNote: (w, trouble, overrun) =>
    w === "storm"
      ? `トラブル対応${trouble}件・想定超過${overrun}件`
      : w === "rain"
        ? `トラブル対応${trouble}件・想定超過${overrun}件`
        : w === "cloudy"
          ? `想定超過${overrun}件`
          : "想定時間内で進んでいます",
  pack: "未完了のToDo",
  packNote: (grams, overdue) => (overdue > 0 ? `重み合計 ${(grams / 1000).toFixed(1)}kg / 期限切れ${overdue}件` : `重み合計 ${(grams / 1000).toFixed(1)}kg`),
  packUnit: "g",
  routeList: "進行中の案件",
  summit: "完了",
  start: "着手",
  now: "現在",
  grade: "難易度",
  waypointsDone: (done, total) => `段階 ${done}/${total}`,
  collapsed: (n) => `期日超過の段階 ${n}件`,
  daysLeft: (n) => (n < 0 ? `期日を${-n}日超過` : n === 0 ? "本日が期日" : `期日まで ${n}日`),
  summited: "完了済み",
  climbLog: "実績の推移",
  climbLogLabel: "直近30日の実働",
  legStatus: (s) => (s === "running" ? "計測中" : s === "paused" ? "一時停止" : s === "done" ? "完了" : "未着手"),
  legOver: "想定超過",
  legUnder: "想定内",
  noRoutes: "進行中の案件はありません。",
  noLegs: "本日の作業がありません。",
  troubleLeg: "トラブル対応",
};

export function mountainWordsFor(wordingEnabled: boolean): MountainWords {
  return wordingEnabled ? THEMED : PLAIN;
}
