import { describe, expect, it } from "vitest";
import { msUntilNextLocalMidnight } from "./useToday";

describe("msUntilNextLocalMidnight", () => {
  it("23:59:00 なら 60秒+余裕", () => {
    const now = new Date(2026, 10, 24, 23, 59, 0, 0);
    expect(msUntilNextLocalMidnight(now)).toBe(60_000 + 1000);
  });
  it("0時ちょうどなら次の0時まで(約24時間)", () => {
    const now = new Date(2026, 10, 24, 0, 0, 0, 0);
    const next = new Date(2026, 10, 25, 0, 0, 0, 0);
    expect(msUntilNextLocalMidnight(now)).toBe(next.getTime() - now.getTime() + 1000);
  });
  it("月末・年末もまたぐ", () => {
    const now = new Date(2026, 11, 31, 23, 0, 0, 0);
    expect(msUntilNextLocalMidnight(now, 0)).toBe(3_600_000);
  });
  it("発火後の時刻は翌日になる", () => {
    const now = new Date(2026, 10, 24, 12, 34, 56, 789);
    const fired = new Date(now.getTime() + msUntilNextLocalMidnight(now));
    expect(fired.getDate()).toBe(25);
    expect(fired.getHours()).toBe(0);
  });
  it("余裕0でも最低1秒", () => {
    const now = new Date(2026, 10, 24, 23, 59, 59, 999);
    expect(msUntilNextLocalMidnight(now, 0)).toBe(1000);
  });
});
