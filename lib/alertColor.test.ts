import { describe, expect, it } from "vitest";
import { alertRgbFor } from "@/components/ThemeInit";

describe("警告色", () => {
  it("赤・橙系のアクセントはそのまま警告色にし、緑・青・灰色のアクセントでは赤系の警告色にする", () => {
    expect(alertRgbFor("194 59 59")).toBeNull();
    expect(alertRgbFor("232 138 74")).toBeNull();
    expect(alertRgbFor("122 180 96")).toBe("214 76 64");
    expect(alertRgbFor("32 108 214")).toBe("214 76 64");
    expect(alertRgbFor("128 128 128")).toBe("214 76 64");
    expect(alertRgbFor("bad")).toBeNull();
  });
});
