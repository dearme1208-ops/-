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

  it("空白なしの@分類も受け取り、メールアドレスは分類にしない", () => {
    expect(parseCompose("見積書を送る@営業", T)).toMatchObject({ title: "見積書を送る", category: "営業" });
    expect(parseCompose("taro@example.com に返信", T)).toMatchObject({ title: "taro@example.com に返信", category: undefined });
  });

  it("1.5時間 → 90分", () => {
    expect(parseCompose("設計レビュー 1.5時間", T).estimateMin).toBe(90);
  });

  it("期限の読み上げ", () => {
    expect(dueLabel("2026-10-04", T)).toBe("明日 10/4(日)");
    expect(dueLabel("2026-10-09", T)).toBe("10/9(金)");
  });
});

// 2026-11-21 は土曜日
const N = "2026-11-21";

describe("日付の言葉は独立した語の時だけ期限にする", () => {
  it.each([
    "日曜大工の道具を買う",
    "明日は休み",
    "明日の会議",
    "10/12納品",
    "明日中止の連絡をする",
    "3日以内に返信",
    "3日以上あける",
    "3日目の報告",
    "1/2ページを直す",
    "資料を1/3個に減らす",
    // 「金曜日」の「日」を外して「金曜」+「日の定例資料」と読まない
    "金曜日の定例資料",
  ])("%s → 件名はそのまま・期限なし", (input) => {
    expect(parseCompose(input, N)).toMatchObject({ title: input, dueDate: undefined });
  });

  // 区切りも助詞も無く件名が続く書き方。件名の文字を食べずに、日付の言葉だけを期限にする
  it.each([
    ["明日見積書を送る", "見積書を送る", "2026-11-22"],
    ["明日A社に電話", "A社に電話", "2026-11-22"],
    ["見積書を明日送る", "見積書を送る", "2026-11-22"],
    ["金曜に提出", "提出", "2026-11-27"],
    ["来週月曜に提出", "提出", "2026-11-23"],
    ["10月12日納品", "納品", "2027-10-12"],
    ["来週日程調整の連絡", "日程調整の連絡", "2026-11-23"],
    ["来週月次報告を出す", "月次報告を出す", "2026-11-23"],
    ["月曜日報を出す", "日報を出す", "2026-11-23"],
    ["金曜日提出", "提出", "2026-11-27"],
    ["金曜日に提出", "提出", "2026-11-27"],
  ])("%s → 件名「%s」・期限 %s (区切りなし)", (input, title, dueDate) => {
    expect(parseCompose(input, N)).toMatchObject({ title, dueDate });
  });

  it.each([
    ["見積書を明日までに送る", "見積書を送る", "2026-11-22"],
    ["資料は来週月曜までに出す", "資料は出す", "2026-11-23"],
    ["明日までに見積書を送る", "見積書を送る", "2026-11-22"],
    ["今日中に日報", "日報", "2026-11-21"],
    ["今週中に見積を出す", "見積を出す", "2026-11-21"],
    ["25日までに申請する", "申請する", "2026-11-25"],
    ["明日 A社に電話", "A社に電話", "2026-11-22"],
    ["来週月曜 資料", "資料", "2026-11-23"],
    ["来週月曜日 資料", "資料", "2026-11-23"],
    ["金曜 提出", "提出", "2026-11-27"],
    ["今週中 見積", "見積", "2026-11-21"],
    ["10/12 納品", "納品", "2027-10-12"],
    ["12日 会議", "会議", "2026-12-12"],
    ["A社 12日 納品", "A社 納品", "2026-12-12"],
    ["会議の準備 明日", "会議の準備", "2026-11-22"],
    ["請求書、明日まで", "請求書", "2026-11-22"],
  ])("%s → 件名「%s」期限 %s", (input, title, due) => {
    expect(parseCompose(input, N)).toMatchObject({ title, dueDate: due });
  });

  it("見込み時間だけの入力は期限にしない", () => {
    expect(parseCompose("30分 メール", N)).toMatchObject({ title: "メール", estimateMin: 30, dueDate: undefined });
  });
});
