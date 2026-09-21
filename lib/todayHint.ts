import type { ConditionLog, MasterTask, WorkRecord } from "./types";
import { computeBurnoutRisk } from "./burnoutRisk";
import { computeInsights } from "./insights";
import {
  computeProductivityByTimeOfDay,
  computeTimeOfDayInsight,
  TIME_OF_DAY_BUCKETS,
} from "./timeOfDay";

// 要注意リストタブには、体調別・時間帯別・曜日別を横断した分析が揃っている。
// ただしそれは「見に行った人にしか届かない」場所にあり、毎日開くのは本日タブの方。
// ここでは同じ計算結果から「今この瞬間に効くもの」を1つだけ選び、本日タブへ返す。
//
// 並べれば並べるほど読まれなくなるので、必ず1件に絞る。優先順位は
// ①今日の進め方そのものを見直す話(不調の予兆) → ②今すぐ順番を変えられる話(時間帯) →
// ③それ以外の横断的な気づき、とし、行動に移せる近さの順にしてある。
export interface TodayHint {
  icon: string;
  title: string;
  body: string;
  tone: "positive" | "caution";
}

function bucketOfHour(hour: number) {
  return TIME_OF_DAY_BUCKETS.find((b) => hour >= b.startHour && hour < b.endHour) ?? null;
}

export function pickTodayHint({
  records,
  masterTasks,
  conditionLogs,
  now = new Date(),
}: {
  records: WorkRecord[];
  masterTasks: MasterTask[];
  conditionLogs: ConditionLog[];
  now?: Date;
}): TodayHint | null {
  // ① 不調の予兆。今日1日の組み立て方そのものに関わるので最優先で出す
  const burnout = computeBurnoutRisk(records, masterTasks, conditionLogs, now);
  if (burnout) {
    return {
      icon: "⚠️",
      title: "ペースを見直す頃合いかもしれません",
      body: `直近3週間は稼働が+${burnout.hoursChangePct}%、想定に対する生産性は${burnout.productivityChangePt}pt、体調の記録も平均${burnout.conditionChangeLevel}下がっています。`,
      tone: "caution",
    };
  }

  // ② 今いる時間帯が得意か苦手か。手元の作業の順番をすぐ変えられる、いちばん近い話
  const nowBucket = bucketOfHour(now.getHours());
  const timeOfDay = computeTimeOfDayInsight(computeProductivityByTimeOfDay(records, masterTasks));
  if (timeOfDay && nowBucket) {
    if (timeOfDay.best.bucket.id === nowBucket.id) {
      return {
        icon: "🚀",
        title: `今は${nowBucket.label}――いちばんはかどる時間帯です`,
        body: `これまでの${nowBucket.label}は想定比${timeOfDay.best.avgProductivityPct}%。重い作業をここに寄せると得をします。`,
        tone: "positive",
      };
    }
    if (timeOfDay.worst.bucket.id === nowBucket.id) {
      return {
        icon: "🐢",
        title: `今は${nowBucket.label}――想定より時間がかかりがちです`,
        body: `これまでの${nowBucket.label}は想定比${timeOfDay.worst.avgProductivityPct}%。軽い作業や片付けに充てると噛み合います。`,
        tone: "caution",
      };
    }
  }

  // ③ 体調・曜日・作業の前後関係などを横断した気づき(要注意リストと同じもの)。
  // ①②に当てはまらない時だけ計算する
  const insights = computeInsights(records, masterTasks);
  if (insights.length > 0) {
    const top = insights[0];
    return { icon: top.icon, title: top.title, body: top.body, tone: top.tone };
  }

  return null;
}
