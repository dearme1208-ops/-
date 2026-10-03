import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildXlsx } from "@/lib/xlsx";

describe("xlsxの書き出し", () => {
  it("ZIPとして正しく、シートに日本語の文字と数値が入る", () => {
    const bytes = buildXlsx([{ name: "工程表", rows: [["作業", "内容", "想定"], ["業務", "資料作成 <A&B>", 30]], widths: [10, 20, 8] }]);
    const dir = mkdtempSync(join(tmpdir(), "xlsx-"));
    const file = join(dir, "a.xlsx");
    writeFileSync(file, bytes);
    const list = execFileSync("unzip", ["-l", file]).toString();
    expect(list).toContain("xl/worksheets/sheet1.xml");
    expect(execFileSync("unzip", ["-t", file]).toString()).toContain("No errors");
    const sheet = execFileSync("unzip", ["-p", file, "xl/worksheets/sheet1.xml"]).toString();
    expect(sheet).toContain("資料作成 &lt;A&amp;B&gt;");
    expect(sheet).toContain('<c r="C2"><v>30</v></c>');
    expect(execFileSync("unzip", ["-p", file, "xl/workbook.xml"]).toString()).toContain('name="工程表"');
  });
});
