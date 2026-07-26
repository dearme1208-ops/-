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

export function formatDateJp(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  return `${Number(m)}/${Number(d)}`;
}
