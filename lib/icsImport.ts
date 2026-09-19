import type { ScheduleRow } from "./scheduleCsv";
import { todayStr } from "./time";

// カレンダー(.ics)の取り込み。
//
// 予定の取り込みは今までCSVだけで、Outlookやスマホのカレンダーから持ってくるには
// 手で作り直すしかなかった。このアプリはバックエンドを持たないのでOAuth連携は取れないが、
// .ics ならOutlookもGoogleカレンダーも書き出せて、スマホの共有からも渡せる。
// 解析はすべてブラウザ内で完結し、どこにも送信されない。
//
// 取り込み結果は予定CSVと同じ ScheduleRow に落とすので、その後の処理
// (作業として差し込む・時刻になったら自動開始する)は既存のものをそのまま使う。
//
// タイムゾーンについて: 末尾がZのUTC表記は端末の時刻に直す。TZID付き・指定なしの
// 場合は「書かれている時刻をそのまま」使う。書き出した側と端末の地域が同じなら
// これで一致し、違う場合だけずれる。一覧に地域名を出して気付けるようにしてある。

/** 既定の取り込み範囲(日数)。1年分の予定を丸ごと作業にしても邪魔になるだけなので区切る */
export const DEFAULT_IMPORT_DAYS = 30;

/** 繰り返しの展開上限。壊れたRRULEで無限に増えないための保険 */
const MAX_OCCURRENCES = 200;

interface IcsProperty {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** 折り返された行(次行が空白/タブ始まり)を1本に戻す */
function unfold(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r\n|\n|\r/)) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += raw.slice(1);
    } else {
      out.push(raw);
    }
  }
  return out;
}

function parseProperty(line: string): IcsProperty | null {
  const colon = line.indexOf(":");
  if (colon === -1) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = head.split(";");
  const name = parts[0].toUpperCase();
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=");
    if (eq === -1) continue;
    params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name, params, value };
}

/** ICSのテキスト値のエスケープを戻す */
function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function dateStrOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function timeStrOf(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface IcsMoment {
  /** 端末のローカル時刻として解釈した日時 */
  at: Date;
  /** 時刻を持たない終日予定 */
  allDay: boolean;
}

function parseMoment(prop: IcsProperty): IcsMoment | null {
  const v = prop.value.trim();
  if (prop.params.VALUE === "DATE" || /^\d{8}$/.test(v)) {
    const y = Number(v.slice(0, 4));
    const m = Number(v.slice(4, 6));
    const d = Number(v.slice(6, 8));
    if (!y || !m || !d) return null;
    return { at: new Date(y, m - 1, d), allDay: true };
  }
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, z] = match;
  if (z === "Z") {
    // UTC表記。Dateに任せて端末の時刻へ直す
    return { at: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)), allDay: false };
  }
  // TZID付き・指定なしは、書かれている時刻をそのままローカルとして扱う
  return { at: new Date(+y, +mo - 1, +d, +h, +mi, +s), allDay: false };
}

/** DURATION(例: PT1H30M)を ms で返す */
function parseDuration(value: string): number | null {
  const m = /^-?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, w, d, h, mi, s] = m;
  const ms =
    (Number(w ?? 0) * 7 * 86400 + Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(mi ?? 0) * 60 + Number(s ?? 0)) *
    1000;
  return ms > 0 ? ms : null;
}

const BYDAY_TO_DOW: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/** RRULE を FREQ=DAILY / WEEKLY の範囲で展開する。それ以外の繰り返しは初回だけ扱う */
function expandRecurrence(start: Date, rrule: string, from: Date, to: Date): Date[] {
  const parts: Record<string, string> = {};
  for (const kv of rrule.split(";")) {
    const eq = kv.indexOf("=");
    if (eq !== -1) parts[kv.slice(0, eq).toUpperCase()] = kv.slice(eq + 1);
  }
  const freq = (parts.FREQ ?? "").toUpperCase();
  if (freq !== "DAILY" && freq !== "WEEKLY") return [start];

  const interval = Math.max(1, Number(parts.INTERVAL ?? 1) || 1);
  const count = parts.COUNT ? Number(parts.COUNT) : null;
  let until: Date | null = null;
  if (parts.UNTIL) {
    const m = parseMoment({ name: "UNTIL", params: {}, value: parts.UNTIL });
    until = m ? m.at : null;
  }
  const byDays = (parts.BYDAY ?? "")
    .split(",")
    .map((d) => BYDAY_TO_DOW[d.replace(/^[+-]?\d+/, "").toUpperCase()])
    .filter((d): d is number => d !== undefined);

  const out: Date[] = [];
  let emitted = 0;
  const cursor = new Date(start);
  // 開始が範囲より前でも、そこから刻んで範囲内まで進める必要がある
  for (let guard = 0; guard < 4000; guard++) {
    if (cursor.getTime() > to.getTime()) break;
    if (count !== null && emitted >= count) break;
    if (until && cursor.getTime() > until.getTime()) break;

    const candidates: Date[] = [];
    if (freq === "WEEKLY" && byDays.length > 0) {
      // その週の指定曜日すべて。時刻は開始時刻を引き継ぐ
      const weekStart = new Date(cursor);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      for (const dow of byDays) {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + dow);
        d.setHours(start.getHours(), start.getMinutes(), 0, 0);
        if (d.getTime() >= start.getTime()) candidates.push(d);
      }
    } else {
      candidates.push(new Date(cursor));
    }

    for (const c of candidates.sort((a, b) => a.getTime() - b.getTime())) {
      if (count !== null && emitted >= count) break;
      if (until && c.getTime() > until.getTime()) continue;
      emitted++;
      if (c.getTime() >= from.getTime() && c.getTime() <= to.getTime()) out.push(c);
      if (out.length >= MAX_OCCURRENCES) return out;
    }

    if (freq === "DAILY") cursor.setDate(cursor.getDate() + interval);
    else cursor.setDate(cursor.getDate() + 7 * interval);
  }
  return out;
}

export interface ParsedIcsResult {
  rows: ScheduleRow[];
  errors: string[];
  /** 終日予定・中止済みなど、意図して取り込まなかった件数 */
  skipped: number;
  /** ファイルに書かれていたタイムゾーン名(あれば)。ずれに気付けるよう画面に出す */
  timezones: string[];
}

export interface IcsImportOptions {
  /** 取り込む範囲の開始日(YYYY-MM-DD)。既定は今日 */
  from?: string;
  /** 取り込む日数。既定は DEFAULT_IMPORT_DAYS */
  days?: number;
  /** 大項目。既定は予定CSVと同じ「予定」 */
  category?: string;
}

export function parseIcsToScheduleRows(text: string, options: IcsImportOptions = {}): ParsedIcsResult {
  const errors: string[] = [];
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    return { rows: [], errors: ["カレンダー(.ics)ファイルではないようです"], skipped: 0, timezones: [] };
  }

  const fromStr = options.from ?? todayStr();
  const from = new Date(`${fromStr}T00:00:00`);
  const to = new Date(from);
  to.setDate(to.getDate() + (options.days ?? DEFAULT_IMPORT_DAYS));
  to.setHours(23, 59, 59, 999);
  const category = options.category || "予定";

  const rows: ScheduleRow[] = [];
  const timezones = new Set<string>();
  let skipped = 0;

  let current: IcsProperty[] | null = null;
  for (const line of unfold(text)) {
    const upper = line.toUpperCase();
    if (upper.startsWith("BEGIN:VEVENT")) {
      current = [];
      continue;
    }
    if (upper.startsWith("END:VEVENT")) {
      if (current) {
        const result = eventToRows(current, { from, to, category });
        if (result.tz) timezones.add(result.tz);
        rows.push(...result.rows);
        skipped += result.skipped;
        if (result.error) errors.push(result.error);
      }
      current = null;
      continue;
    }
    if (current) {
      const prop = parseProperty(line);
      if (prop) current.push(prop);
    }
  }

  rows.sort((a, b) => (a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date)));
  return { rows, errors, skipped, timezones: [...timezones] };
}

function eventToRows(
  props: IcsProperty[],
  ctx: { from: Date; to: Date; category: string }
): { rows: ScheduleRow[]; skipped: number; error?: string; tz?: string } {
  const get = (name: string) => props.find((p) => p.name === name);

  const status = get("STATUS")?.value.toUpperCase();
  if (status === "CANCELLED") return { rows: [], skipped: 1 };

  const dtStart = get("DTSTART");
  if (!dtStart) return { rows: [], skipped: 0, error: "開始日時のない予定をスキップしました" };
  const start = parseMoment(dtStart);
  if (!start) return { rows: [], skipped: 0, error: `開始日時を読めない予定をスキップしました: ${dtStart.value}` };

  const summary = unescapeText(get("SUMMARY")?.value ?? "").trim() || "(件名なし)";
  // 終日予定は開始時刻が無く、そのまま入れると0:00に自動開始してしまう
  if (start.allDay) return { rows: [], skipped: 1 };

  // 所要時間。DTENDが無ければDURATION、どちらも無ければ時間は指定しない
  let durationMs: number | null = null;
  const dtEnd = get("DTEND");
  if (dtEnd) {
    const end = parseMoment(dtEnd);
    if (end && end.at.getTime() > start.at.getTime()) durationMs = end.at.getTime() - start.at.getTime();
  } else {
    const dur = get("DURATION");
    if (dur) durationMs = parseDuration(dur.value);
  }

  // EXDATE(この日は無し)を先に集めておく
  const excluded = new Set<string>();
  for (const p of props) {
    if (p.name !== "EXDATE") continue;
    for (const v of p.value.split(",")) {
      const m = parseMoment({ name: "EXDATE", params: p.params, value: v });
      if (m) excluded.add(`${dateStrOf(m.at)} ${timeStrOf(m.at)}`);
    }
  }

  const rrule = get("RRULE")?.value;
  const occurrences = rrule
    ? expandRecurrence(start.at, rrule, ctx.from, ctx.to)
    : start.at.getTime() >= ctx.from.getTime() && start.at.getTime() <= ctx.to.getTime()
      ? [start.at]
      : [];

  const location = unescapeText(get("LOCATION")?.value ?? "").trim();
  const rows: ScheduleRow[] = [];
  for (const at of occurrences) {
    const date = dateStrOf(at);
    const startTime = timeStrOf(at);
    if (excluded.has(`${date} ${startTime}`)) continue;
    const row: ScheduleRow = { date, category: ctx.category, name: summary, startTime };
    if (durationMs) row.endTime = timeStrOf(new Date(at.getTime() + durationMs));
    if (location) row.notes = location;
    rows.push(row);
  }

  return { rows, skipped: 0, tz: dtStart.params.TZID };
}
