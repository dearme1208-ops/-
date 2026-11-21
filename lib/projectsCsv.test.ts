import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { upsertProjectsFromCsv } from "./projects";
import { parseProjectsCsv, projectsToCsv } from "./projectsCsv";
import type { ProjectItem } from "./types";

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

const base: ProjectItem = { id: "p1", title: "案件", category: "c", workName: "w", dueDate: "2026-12-10", createdAt: 1000 };

async function roundTrip() {
  const { rows, errors } = parseProjectsCsv(projectsToCsv(await db.projects.toArray()));
  expect(errors).toEqual([]);
  return upsertProjectsFromCsv(rows);
}

describe("案件CSVの段階(書き出し→取り込み直し)", () => {
  it("段階名に「:」「;」「\\」があっても、同じ段階として元に戻る", async () => {
    const stages = [
      { id: "s1", title: "10:30 客先打合せ", completed: true, completedAt: 99, dueDate: "2026-12-01" },
      { id: "s2", title: "見積;再見積", completed: false, targetCount: 5, completedCount: 2 },
      { id: "s3", title: "C:\\work の整理", completed: false },
    ];
    await db.projects.add({ ...base, stages });
    await roundTrip();
    const after = (await db.projects.get("p1"))!.stages!;
    expect(after).toEqual(stages);
  });

  it("区切りをエスケープしていない以前のファイルも、末尾の期日・目標件数から読む", () => {
    const csv = [
      "id,title,category,workName,dueDate,stages",
      'p1,案件,c,w,2026-12-10,"10:30 客先打合せ:2026-12-01:;検収:2026/12/5:3;下書き::;メモ書き;初稿:2026-08-20;9:00 朝会"',
    ].join("\n");
    expect(parseProjectsCsv(csv).rows[0].stages).toEqual([
      { title: "10:30 客先打合せ", dueDate: "2026-12-01", targetCount: undefined },
      { title: "検収", dueDate: "2026-12-05", targetCount: 3 },
      { title: "下書き", dueDate: undefined, targetCount: undefined },
      { title: "メモ書き", dueDate: undefined, targetCount: undefined },
      { title: "初稿", dueDate: "2026-08-20", targetCount: undefined },
      { title: "9:00 朝会", dueDate: undefined, targetCount: undefined },
    ]);
  });

  it("CSVに載らない段階の情報(添付メール・参考時間・対応状況など)を取り込みで消さない", async () => {
    const stage = {
      id: "s1",
      title: "検収",
      completed: true,
      completedAt: 5,
      dueDate: "2026-12-01",
      tag: "客先確認中",
      tagChangedAt: 7,
      targetCount: 3,
      completedCount: 2,
      imageDataUrl: "data:i",
      mailFileDataUrl: "data:x;base64,BBBB",
      mailFileName: "a.msg",
      mailSubject: "件名",
      referenceSeconds: 100,
    };
    await db.projects.add({ ...base, stages: [stage] });
    await roundTrip();
    expect((await db.projects.get("p1"))!.stages).toEqual([stage]);
  });

  it("CSVに書かれていない既存の段階は消さず、CSVの段階の後ろに元の並びで残す", async () => {
    await db.projects.add({
      ...base,
      stages: [
        { id: "s1", title: "設計", completed: true, completedAt: 1 },
        { id: "s2", title: "製作", completed: false, mailFileDataUrl: "data:x;base64,BBBB" },
        { id: "s3", title: "検収", completed: false },
      ],
    });
    const { rows } = parseProjectsCsv("id,title,category,workName,dueDate,stages\np1,案件,c,w,2026-12-10,製作:2026-12-20:;出荷::");
    await upsertProjectsFromCsv(rows);
    const after = (await db.projects.get("p1"))!.stages!;
    expect(after.map((s) => s.title)).toEqual(["製作", "出荷", "設計", "検収"]);
    expect(after[0]).toMatchObject({ id: "s2", dueDate: "2026-12-20", mailFileDataUrl: "data:x;base64,BBBB" });
    expect(after[2]).toMatchObject({ id: "s1", completed: true, completedAt: 1 });
    expect(after[3].id).toBe("s3");
  });
});

describe("案件CSVの取り込みと自動完了", () => {
  it("手動で作った案件は、書き出したCSVを取り込み直してもインポート由来にならず、後の一部だけの取り込みで完了にされない", async () => {
    await db.projects.add({ ...base });
    await db.projects.add({ ...base, id: "p2", title: "別件", workName: "w2" });
    await roundTrip();
    expect((await db.projects.get("p1"))!.fromImport).toBeFalsy();
    expect((await db.projects.get("p2"))!.fromImport).toBeFalsy();

    // 「別件」だけのCSVを取り込む
    const { rows } = parseProjectsCsv("id,title,category,workName,dueDate\np2,別件,c,w2,2026-12-10");
    const result = await upsertProjectsFromCsv(rows);
    expect(result.autoCompleted).toBe(0);
    expect(result.autoCompletedTitles).toEqual([]);
    expect((await db.projects.get("p1"))!.completedAt).toBeUndefined();
  });

  it("インポート由来の案件はidで一致してもそのままインポート由来。自動で完了にした案件の件名を返す", async () => {
    await db.projects.add({ ...base, fromImport: true });
    await db.projects.add({ ...base, id: "p2", title: "別件", workName: "w2", fromImport: true });
    await roundTrip();
    expect((await db.projects.get("p1"))!.fromImport).toBe(true);

    const { rows } = parseProjectsCsv("title,category,workName,dueDate\n別件,c,w2,2026-12-10\n新規,c,w3,2026-12-10");
    const result = await upsertProjectsFromCsv(rows);
    expect(result).toMatchObject({ created: 1, updated: 1, autoCompleted: 1, autoCompletedTitles: ["案件"] });
    expect((await db.projects.get("p1"))!.autoCompletedByImport).toBe(true);
  });
});
