import { describe, expect, it } from "vitest";
import { QUOTA_MESSAGE, createErrorDeduper, describeGlobalError } from "@/lib/globalErrors";

describe("拾われなかったエラーの知らせ", () => {
  it("容量不足は整理の仕方を案内する(Dexieが包んだ場合も)", () => {
    const quota = Object.assign(new Error("x"), { name: "QuotaExceededError" });
    expect(describeGlobalError(quota)).toBe(QUOTA_MESSAGE);
    expect(describeGlobalError(Object.assign(new Error("wrapped"), { name: "AbortError", inner: quota }))).toBe(QUOTA_MESSAGE);
    expect(describeGlobalError(Object.assign(new Error("wrapped"), { inner: quota }))).toBe(QUOTA_MESSAGE);
    expect(describeGlobalError(new Error("QuotaExceededError: The quota has been exceeded."))).toBe(QUOTA_MESSAGE);
  });

  it("取り消し・無害な警告・部品の読み込み失敗は出さない", () => {
    expect(describeGlobalError(Object.assign(new Error("a"), { name: "AbortError" }))).toBe(null);
    expect(describeGlobalError(new Error("ResizeObserver loop completed with undelivered notifications."))).toBe(null);
    expect(describeGlobalError(Object.assign(new Error("Loading chunk 12 failed."), { name: "ChunkLoadError" }))).toBe(null);
  });

  it("そのほかは再読み込みを案内する", () => {
    expect(describeGlobalError(new Error("boom"))).toMatch(/boom.*再読み込み/);
  });

  it("同じ知らせは一定時間内に1回だけ", () => {
    const ok = createErrorDeduper(1000);
    expect(ok("a", 0)).toBe(true);
    expect(ok("a", 500)).toBe(false);
    expect(ok("b", 500)).toBe(true);
    expect(ok("a", 1500)).toBe(true);
  });
});
