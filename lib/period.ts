import {
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
} from "date-fns";

export type PeriodType = "all" | "h1" | "h2" | "month" | "week";

export interface PeriodFilter {
  type: PeriodType;
  fiscalYear?: number; // 年度（4月始まり）。h1/h2で使用
}

export function currentFiscalYear(d: Date = new Date()): number {
  const m = d.getMonth() + 1; // 1-12
  return m >= 4 ? d.getFullYear() : d.getFullYear() - 1;
}

export function getPeriodRange(filter: PeriodFilter, now: Date = new Date()): { start: Date; end: Date } | null {
  switch (filter.type) {
    case "all":
      return null;
    case "week":
      return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
    case "month":
      return { start: startOfMonth(now), end: endOfMonth(now) };
    case "h1": {
      const fy = filter.fiscalYear ?? currentFiscalYear(now);
      return { start: new Date(fy, 3, 1, 0, 0, 0), end: new Date(fy, 8, 30, 23, 59, 59) };
    }
    case "h2": {
      const fy = filter.fiscalYear ?? currentFiscalYear(now);
      return { start: new Date(fy, 9, 1, 0, 0, 0), end: new Date(fy + 1, 2, 31, 23, 59, 59) };
    }
  }
}

export function isDateStrInRange(dateStr: string, range: { start: Date; end: Date } | null): boolean {
  if (!range) return true;
  const d = new Date(dateStr + "T12:00:00");
  return d >= range.start && d <= range.end;
}

export const PERIOD_LABELS: Record<PeriodType, string> = {
  all: "累計",
  h1: "上期",
  h2: "下期",
  month: "今月",
  week: "今週",
};
