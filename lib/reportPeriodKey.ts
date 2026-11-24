import { useEffect } from "react";
import { db } from "./db";
import { getPeriodRange, type PeriodFilter } from "./period";
import { useLiveQuery } from "dexie-react-hooks";
import { shiftDateStr, todayStr } from "./time";

// レポートの一言メモ・振り返り・目標達成の印は「期間の開始日」をキーにして保存する。
// 以前は世界標準時の日付(toISOString)で作っていたため、日本時間では開始日の前日になっていた。
// いまはローカル日付で作り、旧キーの値は一度だけ移し替える(旧キーの値は別名で残す)

export interface ReportPeriodKeys {
  /** ローカル日付のキー(読み書きはこちら) */
  local: string;
  /** 以前の世界標準時のキー(移し替え前の値を読むためだけに使う) */
  legacyUtc: string;
}

/** 期間の開始日から、ローカル/旧UTCの両方のキーを作る。累計は "all" */
export function reportPeriodKeys(kind: PeriodFilter["type"], now: Date = new Date()): ReportPeriodKeys {
  const range = getPeriodRange({ type: kind }, now);
  if (!range) return { local: "all", legacyUtc: "all" };
  const iso = range.start.toISOString();
  const local = todayStr(range.start);
  return kind === "month" ? { local: local.slice(0, 7), legacyUtc: iso.slice(0, 7) } : { local, legacyUtc: iso.slice(0, 10) };
}

/** 期間ごとに保存している設定の種類 */
export const REPORT_PERIOD_PREFIXES = ["report.note.", "report.reflection.", "report.goalCelebrated."] as const;
/** 移し替え前の値を残しておく別名の頭 */
export const REPORT_LEGACY_PREFIX = "reportUtcLegacy.";
/** 移し替え済みの印 */
export const REPORT_KEY_MIGRATED_FLAG = "report.periodKeyLocalMigrated";

const KEY_RE = /^(report\.(?:note|reflection|goalCelebrated)\.[a-z0-9]+\.)(\d{4}-\d{2}(?:-\d{2})?)$/;

/** 旧UTCの期間キー(YYYY-MM-DD / YYYY-MM)を、同じ期間を指すローカルのキーへ。変換できなければnull */
export function legacyUtcPeriodToLocal(utc: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(utc)) {
    // そのUTC日付に入るローカル0時を探す(前日・当日・翌日のどれか)
    for (const d of [shiftDateStr(utc, -1), utc, shiftDateStr(utc, 1)]) {
      if (new Date(`${d}T00:00:00`).toISOString().slice(0, 10) === utc) return d;
    }
    return null;
  }
  if (/^\d{4}-\d{2}$/.test(utc)) {
    const [y, m] = utc.split("-").map(Number);
    for (const cand of [new Date(y, m - 1, 1), new Date(y, m, 1)]) {
      if (cand.toISOString().slice(0, 7) === utc) return todayStr(cand).slice(0, 7);
    }
    return null;
  }
  return null;
}

/** 旧UTCの設定キー全体を、ローカルのキーへ。対象外ならnull */
export function legacyUtcSettingKeyToLocal(key: string): string | null {
  const m = KEY_RE.exec(key);
  if (!m) return null;
  const local = legacyUtcPeriodToLocal(m[2]);
  return local ? m[1] + local : null;
}

export interface SettingRow {
  key: string;
  value: string;
}

/**
 * 移し替えの中身を決める(純粋関数)。rows は移し替え前の対象キーの行。
 * 旧キーとローカルのキーは名前が重なる(日・月は1日/1か月ずれるだけ)ので、
 * まず全部を別名へ控え、ローカルのキーへ置き直し、どこからも置かれない旧キーは消す
 */
export function planReportKeyMigration(rows: SettingRow[]): { puts: SettingRow[]; deletes: string[] } {
  const targets = new Map<string, string>();
  const moved: string[] = [];
  const puts: SettingRow[] = [];
  for (const r of rows) {
    const localKey = legacyUtcSettingKeyToLocal(r.key);
    if (!localKey) continue;
    moved.push(r.key);
    puts.push({ key: REPORT_LEGACY_PREFIX + r.key, value: r.value });
    let value = r.value;
    // 目標達成の印は値にも期間キーを持っている
    if (r.key.startsWith("report.goalCelebrated.")) value = legacyUtcPeriodToLocal(r.value) ?? r.value;
    targets.set(localKey, value);
  }
  for (const [key, value] of targets) puts.push({ key, value });
  const deletes = moved.filter((k) => !targets.has(k));
  return { puts, deletes };
}

let migrationPromise: Promise<void> | null = null;

/** 旧UTCキーをローカルのキーへ一度だけ移し替える(済んだかどうかは設定の印で決める) */
export function migrateReportPeriodKeysOnce(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = db
      .transaction("rw", db.settings, async () => {
        if ((await db.settings.get(REPORT_KEY_MIGRATED_FLAG))?.value === "1") return;
        const rows: SettingRow[] = [];
        for (const p of REPORT_PERIOD_PREFIXES) rows.push(...((await db.settings.where("key").startsWith(p).toArray()) as SettingRow[]));
        const { puts, deletes } = planReportKeyMigration(rows);
        if (deletes.length) await db.settings.bulkDelete(deletes);
        if (puts.length) await db.settings.bulkPut(puts);
        await db.settings.put({ key: REPORT_KEY_MIGRATED_FLAG, value: "1" });
      })
      .catch((e) => {
        console.error("レポートのメモの移し替えに失敗しました", e);
      })
      .finally(() => {
        // 同時に呼ばれた分だけまとめる。済んだ後は印を見て決める(バックアップの復元で印ごと
        // 古い設定に戻った時に、開き直さなくてもまた移し替えられるように)
        migrationPromise = null;
      });
  }
  return migrationPromise;
}

/**
 * 旧UTCキーに残っている値(ローカルのキーに無いときの代わり)。
 * 移し替え前は元の名前、移し替え後は控えの別名から読む。
 * あわせて移し替えを起動する
 */
export function useLegacyReportValue(prefix: string, legacyUtcKey: string): string {
  // 移し替え済みの印を読み終わるまでは何も返さない。読み込み中に元の名前を読むと、移し替え後は
  // そこに「前の期間のローカルのキー」の値が入っているため、一瞬だけ前の日・前の月のメモが出ていた
  // (目標達成の印では、前の日の印を今日の旧キーと取り違えて、今日の達成を出さないことがあった)
  const migrated = useLiveQuery(async () => (await db.settings.get(REPORT_KEY_MIGRATED_FLAG))?.value === "1", []);
  const key = migrated === undefined ? null : migrated ? REPORT_LEGACY_PREFIX + prefix + legacyUtcKey : prefix + legacyUtcKey;
  const value = useLiveQuery(async () => (key ? ((await db.settings.get(key))?.value ?? "") : ""), [key]);
  // 印が無い間(初回・印の無いバックアップを復元した後)は移し替える
  useEffect(() => {
    if (migrated === false) void migrateReportPeriodKeysOnce();
  }, [migrated]);
  return value ?? "";
}
