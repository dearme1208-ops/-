import { describe, expect, it } from "vitest";
import { isImeComposing, isSubmitEnter } from "./keyboard";

describe("keyboard", () => {
  it("変換中・変換確定のEnterは送信しない", () => {
    expect(isSubmitEnter({ key: "Enter", isComposing: true })).toBe(false);
    expect(isSubmitEnter({ key: "Enter", keyCode: 229 })).toBe(false);
    expect(isSubmitEnter({ key: "Enter", nativeEvent: { isComposing: true } })).toBe(false);
    expect(isSubmitEnter({ key: "Enter", nativeEvent: { keyCode: 229 } })).toBe(false);
  });
  it("ふつうのEnterは送信、Shift+Enterは改行", () => {
    expect(isSubmitEnter({ key: "Enter" })).toBe(true);
    expect(isSubmitEnter({ key: "Enter", shiftKey: true })).toBe(false);
    expect(isSubmitEnter({ key: "a" })).toBe(false);
  });
  it("isImeComposing", () => {
    expect(isImeComposing({ key: "Escape", keyCode: 229 })).toBe(true);
    expect(isImeComposing({ key: "Escape" })).toBe(false);
  });
});
