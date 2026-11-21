import { describe, expect, it } from "vitest";
import { csvLines, normalizeCsvDate, parseRecordsCsv, readTextFile, recordsToCsv } from "./csv";
import { parseMasterCsv } from "./masterCsv";
import { parseScheduleCsv } from "./scheduleCsv";
import type { WorkRecord } from "./types";

describe("CSVの取り込み(Excelで開いて保存し直したファイル・書き出したファイルの取り込み直し)", () => {
  it("先頭のBOMがあっても列名を読める", () => {
    const { records, errors } = parseRecordsCsv("﻿id,date,category,name,seconds\nr1,2026-09-29,業務,資料,60");
    expect(errors).toEqual([]);
    expect(records[0].id).toBe("r1");
  });

  it("作業名に改行やカンマがあっても、書き出し→取り込みで元に戻る", () => {
    const r: WorkRecord = { id: "r1", date: "2026-09-29", category: "業務", name: "資料\n2枚目,修正", masterTaskId: "m", method: "Ex\"cel\"", seconds: 90, startedAt: 1, endedAt: 2, excludedFromStats: true };
    const { records, errors } = parseRecordsCsv(recordsToCsv([r]));
    expect(errors).toEqual([]);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ name: "資料\n2枚目,修正", method: 'Ex"cel"', seconds: 90, startedAt: 1, endedAt: 2, excludedFromStats: true });
  });

  it("Excelが書き換えた日付(2026/9/29)とTRUEを読める。読めない日付・負の秒数はスキップ", () => {
    const { records, errors } = parseRecordsCsv(
      "date,category,name,seconds,excludedFromStats\n2026/9/29,業務,資料,60,TRUE\n2026/13/1,業務,資料,60,\n2026-09-29,業務,資料,-5,\n2026-09-29,業務,資料,,"
    );
    expect(records).toHaveLength(1);
    expect(records[0].date).toBe("2026-09-29");
    expect(records[0].excludedFromStats).toBe(true);
    expect(errors).toHaveLength(3);
  });

  it("日付の正規化", () => {
    expect(normalizeCsvDate("2026/1/5")).toBe("2026-01-05");
    expect(normalizeCsvDate("2026年1月5日")).toBe("2026-01-05");
    expect(normalizeCsvDate("2026-02-30")).toBeUndefined();
    expect(normalizeCsvDate("あした")).toBeUndefined();
  });

  it("CRLFと空行、囲みの中のCRLFを扱える", () => {
    expect(csvLines('a,b\r\n\r\n"x\r\ny",z\r\n')).toEqual(["a,b", '"x\r\ny",z']);
  });

  it("作業マスタ: お気に入りのTRUE、負の想定時間", () => {
    const { rows, errors } = parseMasterCsv("category,name,estimatedSeconds,isFavorite\n検査,外観,00:05:00,TRUE\n検査,内部,-10,false");
    expect(rows).toHaveLength(1);
    expect(rows[0].isFavorite).toBe(true);
    expect(errors).toHaveLength(1);
  });

  it("予定: 9:00 は 09:00 にそろえ、日付も正規化する", () => {
    const { rows } = parseScheduleCsv("date,name,startTime,endTime\n2026/9/29,会議,9:00,9:30");
    expect(rows[0]).toMatchObject({ date: "2026-09-29", startTime: "09:00", endTime: "09:30" });
  });

  it("Shift_JISで保存されたファイルも文字化けせずに読む", async () => {
    // 「業務」をShift_JISで表したバイト列
    const bytes = new Uint8Array([0x8b, 0xc6, 0x96, 0xb1]);
    expect(await readTextFile(new Blob([bytes]))).toBe("業務");
    expect(await readTextFile(new Blob(["業務"]))).toBe("業務");
  });

  it("Excelが開始・終了の数値を指数表記(1.7636E+12)に丸めても、日時の列から元の時刻(秒まで)に戻す", () => {
    const startedAt = new Date(2026, 10, 20, 9, 53, 20, 123).getTime();
    const endedAt = startedAt + 600_000;
    const r: WorkRecord = { id: "r1", date: "2026-11-20", category: "組立", name: "A", masterTaskId: "m", seconds: 600, startedAt, endedAt, excludedFromStats: false };
    const csv = recordsToCsv([r]);
    expect(csv.split("\n")[0]).toMatch(/,startedAt,endedAt,.*,開始時刻,終了時刻$/);
    expect(csv).toContain("2026-11-20 09:53:20");

    // そのまま取り込み直せばミリ秒まで元どおり
    expect(parseRecordsCsv(csv).records[0]).toMatchObject({ startedAt, endedAt });

    // Excelで保存し直した状態: 数値は丸められ、日時は「2026/11/20 9:53:20」の形になる
    const excel = csv
      .replace(String(startedAt), "1.7636E+12")
      .replace(String(endedAt), "1.7636E+12")
      .replace("2026-11-20 09:53:20", "2026/11/20 9:53:20")
      .replace("2026-11-20 10:03:20", "2026/11/20 10:03:20");
    const { records, errors } = parseRecordsCsv(excel);
    expect(errors).toEqual([]);
    expect(records[0].startedAt).toBe(new Date(2026, 10, 20, 9, 53, 20).getTime());
    expect(records[0].endedAt).toBe(new Date(2026, 10, 20, 10, 3, 20).getTime());
  });

  it("日時の列を手直ししてあれば、そちらを優先する。秒が落ちただけなら数値の方を使う", () => {
    const startedAt = new Date(2026, 10, 20, 9, 53, 20, 123).getTime();
    const head = "id,date,category,name,seconds,startedAt,endedAt,開始時刻,終了時刻\n";
    const edited = parseRecordsCsv(`${head}r1,2026-11-20,組立,A,600,${startedAt},${startedAt + 600_000},2026/11/20 8:00,2026/11/20 8:10`);
    expect(edited.records[0].startedAt).toBe(new Date(2026, 10, 20, 8, 0, 0).getTime());
    expect(edited.records[0].endedAt).toBe(new Date(2026, 10, 20, 8, 10, 0).getTime());
    const secondsDropped = parseRecordsCsv(`${head}r1,2026-11-20,組立,A,600,${startedAt},${startedAt + 600_000},2026/11/20 9:53,2026/11/20 10:03`);
    expect(secondsDropped.records[0]).toMatchObject({ startedAt, endedAt: startedAt + 600_000 });
  });

  it("指数表記に丸められ、日時の列も無い以前のファイルは、丸められた値を信じずに知らせる", () => {
    const before = Date.now();
    const { records, errors } = parseRecordsCsv("id,date,category,name,seconds,startedAt,endedAt\nr1,2026-11-20,組立,A,600,1.7636E+12,1.7636E+12");
    expect(records).toHaveLength(1);
    expect(records[0].startedAt).not.toBe(1.7636e12);
    expect(records[0].startedAt).toBeGreaterThanOrEqual(before);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("2行目");
  });
});
