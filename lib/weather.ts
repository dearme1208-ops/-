import { db } from "./db";
import type { GeoPlace, WeatherForecast } from "./types";

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

// 登録地点ごとに、直近30分以内に取得済みでなければ天気予報を再取得してキャッシュし、
// 通知すべき変化(閾値超え)があれば返す。取得に失敗した場合は保存済みの(古い)データが
// あればそれを使う(アプリを開いている間に取れた時点の情報、という前提のため)
export async function refreshWeatherAndFindAlerts(
  places: GeoPlace[],
  opts: { leadHours: number; thresholdPct: number; nowMs: number; todayDateStr: string }
): Promise<WeatherAlert[]> {
  const alerts: WeatherAlert[] = [];
  for (const place of places) {
    const id = `${place.id}::${opts.todayDateStr}`;
    let record = await db.weatherForecasts.get(id);
    const stale = !record || opts.nowMs - record.fetchedAt > 30 * 60000;
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
    const transition = findUpcomingRainStart(record.hourly, opts.nowMs, opts.leadHours, opts.thresholdPct);
    if (transition && record.notifiedForIso !== transition.atIso) {
      alerts.push({ placeId: place.id, placeLabel: place.label, ...transition });
      await db.weatherForecasts.update(id, { notifiedForIso: transition.atIso });
    }
  }
  return alerts;
}
