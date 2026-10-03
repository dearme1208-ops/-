import { describe, expect, it } from "vitest";
import { dueLabel, parseCompose } from "@/lib/claudeCompose";

// 2026-10-03 は土曜日
const T = "2026-10-03";

describe("話し言葉の入力を受け取る", () => {
  it("期限・見込み時間・分類を取り出し、残りを件名にする", () => {
    expect(parseCompose("明日までに見積書を送る 30分 @営業", T)).toEqual({
      title: "見積書を送る",
      category: "営業",
      dueDate: "2026-10-04",
      estimateMin: 30,
      important: false,
    });
  });

  it("末尾の！や【至急】で重要にする", () => {
    expect(parseCompose("請求書の確認！", T)).toMatchObject({ title: "請求書の確認", important: true });
    expect(parseCompose("【至急】 電話を返す", T)).toMatchObject({ title: "電話を返す", important: true });
  });

  it.each([
    ["今日中に 返信", "2026-10-03"],
    ["あさって 打ち合わせ準備", "2026-10-05"],
    ["金曜までに 資料", "2026-10-09"],
    ["土曜 買い物", "2026-10-03"],
    ["来週 定例", "2026-10-05"],
    ["来週の水曜 締め", "2026-10-07"],
    ["今週中 片付け", "2026-10-03"],
    ["10/12 提出", "2026-10-12"],
    ["9月1日 振り返り", "2027-09-01"],
    ["20日まで 申請", "2026-10-20"],
    ["1日 月初処理", "2026-11-01"],
  ])("%s → %s", (input, due) => {
    expect(parseCompose(input, T).dueDate).toBe(due);
  });

  it("所要日数や件名の中の言葉は期限にしない", () => {
    expect(parseCompose("3日で仕上げる", T)).toMatchObject({ title: "3日で仕上げる", dueDate: undefined });
    expect(parseCompose("重要顧客へ連絡", T)).toMatchObject({ title: "重要顧客へ連絡", important: false });
    expect(parseCompose("30分会議の準備", T)).toMatchObject({ title: "30分会議の準備", estimateMin: undefined });
  });

  it("1.5時間 → 90分", () => {
    expect(parseCompose("設計レビュー 1.5時間", T).estimateMin).toBe(90);
  });

  it("期限の読み上げ", () => {
    expect(dueLabel("2026-10-04", T)).toBe("明日 10/4(日)");
    expect(dueLabel("2026-10-09", T)).toBe("10/9(金)");
  });
});
