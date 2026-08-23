import type { AttentionRow } from "./attention";
import type { MasterTask, WorkRecord } from "./types";
import { computeWeekdayAverages, DOW_LABELS } from "./weekday";
import { computeProductivityByTimeOfDay } from "./timeOfDay";
import { formatHms } from "./time";

export interface WeeklyNarrativeInput {
  kind: "day" | "week" | "month";
  rangeLabel: string;
  allRecords: WorkRecord[]; // 曜日別・時間帯別の「個人のクセ」を見るための全期間の実績
  masterTasks: MasterTask[];
  totalSeconds: number;
  prevTotalSeconds: number;
  attention: AttentionRow[]; // この期間の要注意項目(想定比+30%以上)。overRatio降順
  troubleCount: number;
  overdueTodoCount: number;
  projectMvp: { title: string; totalSeconds: number } | null;
  topGainer: { category: string; name: string; deltaSeconds: number } | null;
}

// 文言の単調さを避けるため、話の種(beat)ごとに複数の言い回しを用意し、期間ラベルを
// 種にした決定的な選択で切り替える(同じ期間を何度開いても同じ文言になる)
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function pick(templates: string[], seed: number, salt: number): string {
  return templates[(seed + salt) % templates.length];
}

const PERIOD_NOUN: Record<WeeklyNarrativeInput["kind"], string> = { day: "今日", week: "今週", month: "今月" };
const PREV_PERIOD_NOUN: Record<WeeklyNarrativeInput["kind"], string> = { day: "前日", week: "先週", month: "先月" };

// 蓄積された実績データから、数値の羅列ではなく文章形式の振り返りを自動生成する。
// 外部AIは使わず、既存の集計ロジック(曜日別平均・時間帯別生産性・要注意リスト等)の
// 結果をテンプレートで文章に組み立てる。パターンの網羅性より「読んで意味が通ること」を優先し、
// 該当データが無い話題は素直に省略する
export function generateWeeklyNarrative(input: WeeklyNarrativeInput): string {
  const seed = hashString(input.rangeLabel);
  const periodNoun = PERIOD_NOUN[input.kind];
  const prevNoun = PREV_PERIOD_NOUN[input.kind];
  const sentences: string[] = [];

  // 1. 合計時間の増減
  if (input.totalSeconds === 0) {
    sentences.push(`${periodNoun}はまだ実績の記録がありません。`);
    return sentences.join("");
  }
  if (input.prevTotalSeconds > 0) {
    const diffPct = Math.round(((input.totalSeconds - input.prevTotalSeconds) / input.prevTotalSeconds) * 100);
    if (Math.abs(diffPct) < 5) {
      sentences.push(
        pick(
          [
            `${periodNoun}は合計${formatHms(input.totalSeconds)}で、${prevNoun}とほぼ同じペースでした。`,
            `${periodNoun}の合計は${formatHms(input.totalSeconds)}。${prevNoun}と比べて大きな変化はありませんでした。`,
          ],
          seed,
          1
        )
      );
    } else if (diffPct > 0) {
      sentences.push(
        pick(
          [
            `${periodNoun}は合計${formatHms(input.totalSeconds)}で、${prevNoun}より${diffPct}%多く働いています。`,
            `${periodNoun}の合計時間は${formatHms(input.totalSeconds)}。${prevNoun}比+${diffPct}%とペースが上がっています。`,
          ],
          seed,
          1
        )
      );
    } else {
      sentences.push(
        pick(
          [
            `${periodNoun}は合計${formatHms(input.totalSeconds)}で、${prevNoun}より${Math.abs(diffPct)}%少なめでした。`,
            `${periodNoun}の合計時間は${formatHms(input.totalSeconds)}。${prevNoun}比${diffPct}%とペースが落ち着いています。`,
          ],
          seed,
          1
        )
      );
    }
  } else {
    sentences.push(`${periodNoun}は合計${formatHms(input.totalSeconds)}働きました。`);
  }

  // 2. 最も増えた作業
  if (input.topGainer && input.topGainer.deltaSeconds > 0) {
    sentences.push(
      `中でも「${input.topGainer.category} / ${input.topGainer.name}」の時間が${prevNoun}より増えています。`
    );
  }

  // 3. 案件MVP
  if (input.projectMvp) {
    sentences.push(
      pick(
        [
          `最も時間を投じた案件は「${input.projectMvp.title}」（${formatHms(input.projectMvp.totalSeconds)}）でした。`,
          `「${input.projectMvp.title}」に最も多くの時間を使いました（${formatHms(input.projectMvp.totalSeconds)}）。`,
        ],
        seed,
        2
      )
    );
  }

  // 4. 個人の得意な曜日・時間帯(全期間の実績から)
  const weekdayAverages = computeWeekdayAverages(input.allRecords).filter((w) => w.dayCount >= 3);
  if (weekdayAverages.length >= 2) {
    const best = [...weekdayAverages].sort((a, b) => b.avgSeconds - a.avgSeconds)[0];
    if (best.avgSeconds > 0) {
      sentences.push(`これまでの傾向では、${DOW_LABELS[best.dow]}曜日に最も作業時間が伸びやすいようです。`);
    }
  }
  const timeOfDayRows = computeProductivityByTimeOfDay(input.allRecords, input.masterTasks);
  if (timeOfDayRows.length >= 2) {
    const best = [...timeOfDayRows].sort((a, b) => b.avgProductivityPct - a.avgProductivityPct)[0];
    sentences.push(
      pick(
        [
          `想定時間に対する達成度で見ると、${best.bucket.label}が最も調子が良い時間帯です（想定比${best.avgProductivityPct}%）。`,
          `${best.bucket.label}の生産性が特に高く、想定比${best.avgProductivityPct}%というペースです。`,
        ],
        seed,
        3
      )
    );
  }

  // 5. 要注意項目
  if (input.attention.length > 0) {
    const top = input.attention[0];
    sentences.push(
      pick(
        [
          `一方、「${top.category} / ${top.name}」は想定より${Math.round(top.overRatio * 100)}%多くかかっており、他にも${
            input.attention.length - 1 > 0 ? `${input.attention.length - 1}件` : "同様の傾向の作業が"
          }想定を超過しています。`,
          `注意したいのは「${top.category} / ${top.name}」で、想定比+${Math.round(top.overRatio * 100)}%となっています（要注意項目 計${input.attention.length}件）。`,
        ],
        seed,
        4
      )
    );
  }

  // 6. トラブル対応
  if (input.troubleCount > 0) {
    sentences.push(`トラブル対応が${input.troubleCount}件発生しました。`);
  }

  // 7. 期限超過のToDo
  if (input.overdueTodoCount > 0) {
    sentences.push(`期限を過ぎたToDoが${input.overdueTodoCount}件残っています。`);
  }

  return sentences.join("");
}
