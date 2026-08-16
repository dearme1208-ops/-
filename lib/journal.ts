import { csvEscape } from "./csv";
import type { AppSetting } from "./types";

export const JOURNAL_KEY_PREFIX = "journal.daily.";

export interface JournalEntry {
  date: string;
  text: string;
}

// 「今日の記録」(本日タブの自由記述欄)は journal.daily.<date> というキーで
// 日付ごとに設定テーブルへ保存されている。設定一覧からその分だけ取り出し、
// 空欄(未入力のまま)は振り返り対象として意味が無いので除外し、新しい日付順に並べる
export function journalEntriesFromSettings(settings: AppSetting[]): JournalEntry[] {
  return settings
    .filter((s) => s.key.startsWith(JOURNAL_KEY_PREFIX) && s.value.trim() !== "")
    .map((s) => ({ date: s.key.slice(JOURNAL_KEY_PREFIX.length), text: s.value }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export function journalEntriesToCsv(entries: JournalEntry[]): string {
  const rows = ["date,text"];
  for (const e of entries) {
    rows.push([e.date, csvEscape(e.text)].join(","));
  }
  return rows.join("\n");
}
