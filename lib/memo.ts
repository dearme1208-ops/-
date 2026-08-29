import type { MemoConnector, MemoNote, MemoStroke } from "./types";

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

export const MEMO_NOTE_MIN_WIDTH = 100;
export const MEMO_NOTE_MIN_HEIGHT = 80;

export const MEMO_MIN_ZOOM = 0.25;
export const MEMO_MAX_ZOOM = 3;

export function clampMemoZoom(z: number): number {
  return Math.max(MEMO_MIN_ZOOM, Math.min(MEMO_MAX_ZOOM, z));
}

// 付箋の高さを内容量から見積もる。ヘッダー(掴み手・削除)と色/操作ボタンの行は
// 内容に関わらず常に必要な分(目安70px)として、そこにテキストの行数/チェックリストの
// 項目数に応じた分を積み上げる。幅は既存の付箋と揃えたいので固定のままにする
const MEMO_NOTE_CHROME_HEIGHT = 70;
const MEMO_NOTE_TEXT_LINE_HEIGHT = 20;
const MEMO_NOTE_CHECKLIST_ITEM_HEIGHT = 22;
const MEMO_NOTE_MAX_AUTO_HEIGHT = 480;
// 幅220pxの付箋に日本語がだいたい収まる目安の全角文字数(折り返し行数の見積もり用)
const MEMO_NOTE_CHARS_PER_LINE = 16;

function clampNoteHeight(h: number): number {
  return Math.max(MEMO_NOTE_MIN_HEIGHT, Math.min(MEMO_NOTE_MAX_AUTO_HEIGHT, Math.round(h)));
}

export function estimateTextNoteHeight(text: string): number {
  const lines = text
    .split("\n")
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / MEMO_NOTE_CHARS_PER_LINE)), 0);
  return clampNoteHeight(MEMO_NOTE_CHROME_HEIGHT + Math.max(1, lines) * MEMO_NOTE_TEXT_LINE_HEIGHT);
}

export function estimateChecklistNoteHeight(itemCount: number): number {
  // 「+ 項目を追加」の行の分を少し余分に見込む
  return clampNoteHeight(MEMO_NOTE_CHROME_HEIGHT + Math.max(1, itemCount) * MEMO_NOTE_CHECKLIST_ITEM_HEIGHT + 20);
}

// 消しゴムでなぞった位置から、この半径(ボード論理px)以内に点を持つ手書きストロークを消す対象とする
export const MEMO_ERASER_RADIUS = 14;

// 付箋を結ぶ線は、書き出し時にIDではなくnotes配列内でのインデックスで参照する。
// インポート時に付箋へ新しいIDが振り直されるため、IDのままでは対応が取れなくなるため
export interface MemoConnectorExport {
  fromIndex: number;
  toIndex: number;
  label?: string;
}

export interface MemoBoardExport {
  format: "koutei-hyo-memo";
  version: 1 | 2 | 3;
  title: string;
  exportedAt: number;
  notes: Omit<MemoNote, "id" | "boardId">[];
  strokes: Omit<MemoStroke, "id" | "boardId">[];
  connectors: MemoConnectorExport[];
}

export function serializeMemoBoard(title: string, notes: MemoNote[], strokes: MemoStroke[], connectors: MemoConnector[]): string {
  const indexById = new Map(notes.map((n, i) => [n.id, i]));
  const data: MemoBoardExport = {
    format: "koutei-hyo-memo",
    version: 3,
    title,
    exportedAt: Date.now(),
    notes: notes.map(({ id: _id, boardId: _boardId, ...rest }) => rest),
    strokes: strokes.map(({ id: _id, boardId: _boardId, ...rest }) => rest),
    connectors: connectors
      .filter((c) => indexById.has(c.fromNoteId) && indexById.has(c.toNoteId))
      .map((c) => {
        const entry: MemoConnectorExport = { fromIndex: indexById.get(c.fromNoteId)!, toIndex: indexById.get(c.toNoteId)! };
        if (c.label) entry.label = c.label;
        return entry;
      }),
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
    // 旧バージョン(v1)のファイルにはconnectorsが無いため、その場合は空配列にフォールバックする
    const rawConnectors = Array.isArray(parsed.connectors) ? parsed.connectors : [];
    const connectors: MemoConnectorExport[] = rawConnectors
      .filter(
        (c: unknown): c is MemoConnectorExport =>
          !!c &&
          typeof c === "object" &&
          typeof (c as MemoConnectorExport).fromIndex === "number" &&
          typeof (c as MemoConnectorExport).toIndex === "number" &&
          (c as MemoConnectorExport).fromIndex < notes.length &&
          (c as MemoConnectorExport).toIndex < notes.length
      )
      .map((c: MemoConnectorExport) => ({
        fromIndex: c.fromIndex,
        toIndex: c.toIndex,
        label: typeof c.label === "string" ? c.label : undefined,
      }));
    return {
      format: "koutei-hyo-memo",
      version: 3,
      title: typeof parsed.title === "string" ? parsed.title : "インポートしたメモ",
      exportedAt: typeof parsed.exportedAt === "number" ? parsed.exportedAt : Date.now(),
      notes,
      strokes,
      connectors,
    };
  } catch {
    return null;
  }
}
