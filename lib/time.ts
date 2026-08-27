export function formatHms(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((v) => String(v).padStart(2, "0")).join(":");
}

export function parseHmsToSeconds(hms: string): number {
  const parts = hms.split(":").map((p) => parseInt(p, 10) || 0);
  while (parts.length < 3) parts.unshift(0);
  const [h, m, s] = parts.slice(-3);
  return h * 3600 + m * 60 + s;
}

export function formatMsClock(totalMs: number): string {
  return formatHms(totalMs / 1000);
}

// "HH:MM" を小数の時（例: "08:30" → 8.5）に変換する。不正な値はfallbackを返す
export function parseHourStr(hhmm: string, fallback: number): number {
  const [h, m] = hhmm.split(":").map((v) => Number(v));
  if (!Number.isFinite(h)) return fallback;
  return h + (Number.isFinite(m) ? m : 0) / 60;
}

// 同日内の "HH:MM" 同士の差を秒で返す（endがstart以前の場合は0）
export function diffHmToSeconds(startHm: string, endHm: string): number {
  const [sh, sm] = startHm.split(":").map(Number);
  const [eh, em] = endHm.split(":").map(Number);
  if (![sh, sm, eh, em].every(Number.isFinite)) return 0;
  return Math.max(0, (eh * 60 + em - (sh * 60 + sm)) * 60);
}

// 時刻表示 (hh:mm) 例: 15:42
export function formatClock(epochMs: number): string {
  const d = new Date(epochMs);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export function todayStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function jsWeekdayToApp(date: Date): 1 | 2 | 3 | 4 | 5 | null {
  const d = date.getDay(); // 0=Sun..6=Sat
  if (d >= 1 && d <= 5) return d as 1 | 2 | 3 | 4 | 5;
  return null;
}

// "YYYY-MM-DD"同士の日数差 (to - from)
export function daysBetweenDateStrs(fromStr: string, toStr: string): number {
  const from = new Date(fromStr + "T00:00:00");
  const to = new Date(toStr + "T00:00:00");
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

// "YYYY-MM-DD"にdeltaDays日を加減した日付文字列を返す(前日/翌日ボタン・週送りなどに使う)
export function shiftDateStr(dateStr: string, deltaDays: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + deltaDays);
  return todayStr(d);
}

export function formatDateJp(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  return `${Number(m)}/${Number(d)}`;
}

// epoch msを<input type="datetime-local">用の"YYYY-MM-DDTHH:mm"文字列に変換する(ローカル時刻基準)
export function toDatetimeLocalValue(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// <input type="datetime-local">の"YYYY-MM-DDTHH:mm"文字列をepoch ms(ローカル時刻として解釈)に変換する
export function fromDatetimeLocalValue(value: string): number | undefined {
  if (!value) return undefined;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : undefined;
}

// 通知時刻の表示用(例: 8/27 14:30)
export function formatDateTimeJp(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
