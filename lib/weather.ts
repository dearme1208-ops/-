import { db } from "./db";
import type { WeatherForecast, WeatherPlace } from "./types";

export interface HourlyPrecipPoint {
  atIso: string; // "YYYY-MM-DDTHH:mm" 現地時間(端末のローカル時刻と同じ前提で扱う。アプリ全体の時刻の扱いに合わせる)
  precipProbability: number; // 0-100
}

// Open-Meteo(APIキー不要・無料・サーバー不要)から、指定座標の当日+翌日早朝までの
// 1時間ごとの降水確率を取得する。timezone=autoで座標に応じた現地時間の時刻文字列が返る
export async function fetchHourlyPrecipitation(lat: number, lon: number): Promise<HourlyPrecipPoint[]> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=precipitation_probability&timezone=auto&forecast_days=2`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`天気予報の取得に失敗しました (${res.status})`);
  const data = await res.json();
  const times: string[] = data?.hourly?.time ?? [];
  const probs: number[] = data?.hourly?.precipitation_probability ?? [];
  return times.map((t, i) => ({ atIso: t, precipProbability: probs[i] ?? 0 }));
}

export interface UpcomingRainTransition {
  atIso: string;
  hoursUntil: number;
  precipProbability: number;
}

// 「今」の時点で降水確率が閾値未満で、指定時間(leadHours)以内に閾値以上になる
// 最初の時刻があれば、その変化を返す(既に閾値以上なら新規の変化ではないのでnull)
export function findUpcomingRainStart(
  hourly: HourlyPrecipPoint[],
  nowMs: number,
  leadHours: number,
  thresholdPct: number
): UpcomingRainTransition | null {
  if (hourly.length === 0) return null;
  const sorted = [...hourly].sort((a, b) => new Date(a.atIso).getTime() - new Date(b.atIso).getTime());

  let currentProb: number | null = null;
  for (const p of sorted) {
    if (new Date(p.atIso).getTime() <= nowMs) currentProb = p.precipProbability;
    else break;
  }
  if (currentProb !== null && currentProb >= thresholdPct) return null;

  const windowEndMs = nowMs + leadHours * 3600000;
  for (const p of sorted) {
    const t = new Date(p.atIso).getTime();
    if (t <= nowMs) continue;
    if (t > windowEndMs) break;
    if (p.precipProbability >= thresholdPct) {
      return { atIso: p.atIso, hoursUntil: (t - nowMs) / 3600000, precipProbability: p.precipProbability };
    }
  }
  return null;
}

export interface WeatherAlert {
  placeId: string;
  placeLabel: string;
  atIso: string;
  hoursUntil: number;
  precipProbability: number;
}

export interface CurrentWeatherReading {
  placeId: string;
  placeLabel: string;
  atIso: string;
  precipProbability: number;
  fetchedAt: number;
}

// 「今」の時点(直近の過去、無ければ最初)の時間帯の予報を返す。変化の有無に関わらず
// 「今の天気」を常時表示するために使う
function findCurrentPrecip(hourly: HourlyPrecipPoint[], nowMs: number): HourlyPrecipPoint | null {
  if (hourly.length === 0) return null;
  const sorted = [...hourly].sort((a, b) => new Date(a.atIso).getTime() - new Date(b.atIso).getTime());
  let current: HourlyPrecipPoint | null = null;
  for (const p of sorted) {
    if (new Date(p.atIso).getTime() <= nowMs) current = p;
    else break;
  }
  return current ?? sorted[0];
}

// 「今」以降(現在のバケツを含む)で、最初に降水確率が閾値以上になる時間帯を返す。
// 通知の重複排除・leadHoursの制限は行わず、取得済みの予報全体(当日+翌日早朝まで)から探す。
// 常時表示用(通知したかどうかに関わらず「次に閾値を超えるのはいつか」を示すため)
export function findNextThresholdCrossing(
  hourly: HourlyPrecipPoint[],
  nowMs: number,
  thresholdPct: number
): UpcomingRainTransition | null {
  if (hourly.length === 0) return null;
  const sorted = [...hourly].sort((a, b) => new Date(a.atIso).getTime() - new Date(b.atIso).getTime());
  let startIdx = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (new Date(sorted[i].atIso).getTime() <= nowMs) startIdx = i;
    else break;
  }
  for (let i = startIdx; i < sorted.length; i++) {
    const p = sorted[i];
    if (p.precipProbability >= thresholdPct) {
      const t = new Date(p.atIso).getTime();
      return { atIso: p.atIso, hoursUntil: Math.max(0, (t - nowMs) / 3600000), precipProbability: p.precipProbability };
    }
  }
  return null;
}

export interface WeatherRefreshResult {
  alerts: WeatherAlert[];
  current: CurrentWeatherReading[];
  nextCrossings: WeatherAlert[];
}

// 登録地点ごとに、直近30分以内に取得済みでなければ天気予報を再取得してキャッシュし、
// 通知すべき変化(閾値超え)と、変化の有無に関わらず「今の降水確率」「次に閾値を超える時間帯」を返す。
// 取得に失敗した場合は保存済みの(古い)データがあればそれを使う(アプリを開いている間に取れた時点の情報、という前提のため)
export async function refreshWeatherAndFindAlerts(
  places: WeatherPlace[],
  opts: { leadHours: number; thresholdPct: number; nowMs: number; todayDateStr: string; force?: boolean }
): Promise<WeatherRefreshResult> {
  const alerts: WeatherAlert[] = [];
  const current: CurrentWeatherReading[] = [];
  const nextCrossings: WeatherAlert[] = [];
  for (const place of places) {
    const id = `${place.id}::${opts.todayDateStr}`;
    let record = await db.weatherForecasts.get(id);
    const stale = opts.force || !record || opts.nowMs - record.fetchedAt > 30 * 60000;
    if (stale) {
      try {
        const hourly = await fetchHourlyPrecipitation(place.lat, place.lon);
        const next: WeatherForecast = {
          id,
          placeId: place.id,
          date: opts.todayDateStr,
          fetchedAt: opts.nowMs,
          hourly,
          notifiedForIso: record?.notifiedForIso,
        };
        await db.weatherForecasts.put(next);
        record = next;
      } catch {
        // 取得失敗時は既存の(古い)データがあればそれを使い、無ければこの地点はスキップする
      }
    }
    if (!record) continue;
    const currentPoint = findCurrentPrecip(record.hourly, opts.nowMs);
    if (currentPoint) {
      current.push({
        placeId: place.id,
        placeLabel: place.label,
        atIso: currentPoint.atIso,
        precipProbability: currentPoint.precipProbability,
        fetchedAt: record.fetchedAt,
      });
    }
    const transition = findUpcomingRainStart(record.hourly, opts.nowMs, opts.leadHours, opts.thresholdPct);
    if (transition && record.notifiedForIso !== transition.atIso) {
      alerts.push({ placeId: place.id, placeLabel: place.label, ...transition });
      await db.weatherForecasts.update(id, { notifiedForIso: transition.atIso });
    }
    const crossing = findNextThresholdCrossing(record.hourly, opts.nowMs, opts.thresholdPct);
    if (crossing) {
      nextCrossings.push({ placeId: place.id, placeLabel: place.label, ...crossing });
    }
  }
  return { alerts, current, nextCrossings };
}
