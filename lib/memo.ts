import type { MemoNote, MemoStroke } from "./types";

// 付箋の色プリセット。実物の付箋に寄せた配色で、テーマのCSS変数には依存しない
// (ボード自体がどの演出テーマでも同じ見た目であってほしいため)
export const MEMO_NOTE_COLORS: Record<string, { bg: string; border: string }> = {
  yellow: { bg: "#fde68a", border: "#f2c94c" },
  pink: { bg: "#fbcfe8", border: "#f2a6cf" },
  blue: { bg: "#bfdbfe", border: "#8fb8f0" },
  green: { bg: "#bbf7d0", border: "#8fdba8" },
  orange: { bg: "#fed7aa", border: "#f2ac6b" },
};
export const DEFAULT_MEMO_NOTE_COLOR = "yellow";

export const MEMO_PEN_COLORS = ["#1a1a1a", "#dc2626", "#2563eb", "#16a34a"];
export const DEFAULT_MEMO_PEN_COLOR = MEMO_PEN_COLORS[0];
export const DEFAULT_MEMO_PEN_WIDTH = 3;

export const MEMO_BOARD_WIDTH = 1400;
export const MEMO_BOARD_HEIGHT = 1000;

export interface MemoBoardExport {
  format: "koutei-hyo-memo";
  version: 1;
  title: string;
  exportedAt: number;
  notes: Omit<MemoNote, "id" | "boardId">[];
  strokes: Omit<MemoStroke, "id" | "boardId">[];
}

export function serializeMemoBoard(title: string, notes: MemoNote[], strokes: MemoStroke[]): string {
  const data: MemoBoardExport = {
    format: "koutei-hyo-memo",
    version: 1,
    title,
    exportedAt: Date.now(),
    notes: notes.map(({ id: _id, boardId: _boardId, ...rest }) => rest),
    strokes: strokes.map(({ id: _id, boardId: _boardId, ...rest }) => rest),
  };
  return JSON.stringify(data, null, 2);
}

// インポートするJSONの形式を検証しつつ読み込む。他のボードから書き出したもの/
// このアプリ以外からの不正なファイルを渡された場合はnullを返す
export function parseMemoBoardImport(json: string): MemoBoardExport | null {
  try {
    const parsed = JSON.parse(json);
    if (!parsed || parsed.format !== "koutei-hyo-memo" || !Array.isArray(parsed.notes) || !Array.isArray(parsed.strokes)) {
      return null;
    }
    const notes = parsed.notes.filter(
      (n: unknown): n is Omit<MemoNote, "id" | "boardId"> =>
        !!n && typeof n === "object" && typeof (n as MemoNote).text === "string" && typeof (n as MemoNote).x === "number"
    );
    const strokes = parsed.strokes.filter(
      (s: unknown): s is Omit<MemoStroke, "id" | "boardId"> =>
        !!s && typeof s === "object" && Array.isArray((s as MemoStroke).points)
    );
    return {
      format: "koutei-hyo-memo",
      version: 1,
      title: typeof parsed.title === "string" ? parsed.title : "インポートしたメモ",
      exportedAt: typeof parsed.exportedAt === "number" ? parsed.exportedAt : Date.now(),
      notes,
      strokes,
    };
  } catch {
    return null;
  }
}
