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

// 付箋の文字色プリセット。背景は薄いパステルで固定なので、どれを選んでも
// 読みやすいよう十分に濃い色だけを並べている
export const MEMO_NOTE_TEXT_COLORS: Record<string, string> = {
  ink: "#1a1a1a",
  red: "#b91c1c",
  blue: "#1d4ed8",
  green: "#15803d",
  purple: "#7e22ce",
  brown: "#92400e",
};
export const DEFAULT_MEMO_NOTE_TEXT_COLOR = "ink";

// ボードの地は暗い色なので、既定は黒ではなく白にする。
// 以前は先頭(既定)が#1a1a1aで、地の#0f0f10とほぼ同じ濃さだったため、
// 何も設定を変えずに手書きすると線が見えなかった
export const MEMO_PEN_COLORS = ["#f2f2f0", "#ef4444", "#3b82f6", "#22c55e", "#1a1a1a"];
export const DEFAULT_MEMO_PEN_COLOR = MEMO_PEN_COLORS[0];
export const DEFAULT_MEMO_PEN_WIDTH = 3;

export const MEMO_BOARD_WIDTH = 2200;
export const MEMO_BOARD_HEIGHT = 1600;

// ボードの地の模様。カードの位置合わせの目安になるだけで、データとは無関係な
// 見た目だけの切り替え(演出テーマにも依存しない)
export const BOARD_BACKGROUND_KINDS = ["none", "grid", "dots", "lines", "checker"] as const;
export type BoardBackgroundKind = (typeof BOARD_BACKGROUND_KINDS)[number];
export const DEFAULT_BOARD_BACKGROUND: BoardBackgroundKind = "none";
export const BOARD_BACKGROUND_LABELS: Record<BoardBackgroundKind, string> = {
  none: "無地",
  grid: "方眼紙",
  dots: "ドットグリッド",
  lines: "罫線ノート",
  checker: "チェック柄",
};

// CSSのbackground-imageで表現する。画像を持ち込まずグラデーションだけで描くので、
// 軽量でどの演出テーマの地色の上でも同じ見え方になる
export function boardBackgroundCss(kind: BoardBackgroundKind): { backgroundImage?: string; backgroundSize?: string } {
  const line = "rgba(242,242,240,0.14)";
  const dot = "rgba(242,242,240,0.22)";
  const check = "rgba(242,242,240,0.06)";
  if (kind === "grid") {
    return {
      backgroundImage: `linear-gradient(${line} 1px, transparent 1px), linear-gradient(90deg, ${line} 1px, transparent 1px)`,
      backgroundSize: "40px 40px",
    };
  }
  if (kind === "dots") {
    return {
      backgroundImage: `radial-gradient(${dot} 1.5px, transparent 1.5px)`,
      backgroundSize: "28px 28px",
    };
  }
  if (kind === "lines") {
    return {
      backgroundImage: `linear-gradient(${line} 1px, transparent 1px)`,
      backgroundSize: "100% 32px",
    };
  }
  if (kind === "checker") {
    return {
      backgroundImage: `linear-gradient(45deg, ${check} 25%, transparent 25%), linear-gradient(-45deg, ${check} 25%, transparent 25%), linear-gradient(45deg, transparent 75%, ${check} 75%), linear-gradient(-45deg, transparent 75%, ${check} 75%)`,
      backgroundSize: "32px 32px",
    };
  }
  return {};
}

// 図形の既定サイズ。付箋と同じく「まずは決まった大きさで置いて、位置だけドラッグで
// 動かす」形にしてあるため(伸縮はできない)、種類ごとに使いやすい大きさを決め打ちする
export const BOARD_SHAPE_DEFAULT_SIZE: Record<"rect" | "circle" | "line" | "arrow", { width: number; height: number }> = {
  rect: { width: 200, height: 130 },
  circle: { width: 150, height: 150 },
  line: { width: 220, height: 40 },
  arrow: { width: 220, height: 40 },
};
export const DEFAULT_BOARD_SHAPE_OPACITY = 0.4;

export const MEMO_NOTE_MIN_WIDTH = 100;
export const MEMO_NOTE_MIN_HEIGHT = 80;

export const MEMO_MIN_ZOOM = 0.25;
export const MEMO_MAX_ZOOM = 3;

// スタンプ(対応状況などの一言を付箋やToDo等にくっ付ける小さな付箋)の既定サイズ
export const BOARD_STAMP_WIDTH = 96;
export const BOARD_STAMP_HEIGHT = 32;
export const DEFAULT_BOARD_STAMP_COLOR = "orange";
// スタンプはくっ付けた対象の上に重ねて見せる注釈なので、対象が最前面固定(pinned/
// MEMO_PINNED_Z_BASE)されていても必ずその上に出るよう、さらに大きな下駄を履かせる
export const BOARD_STAMP_Z_BASE = 2_000_000;

export function clampMemoZoom(z: number): number {
  return Math.max(MEMO_MIN_ZOOM, Math.min(MEMO_MAX_ZOOM, z));
}

// 最前面固定の付箋を、通常の付箋より確実に上へ出すための下駄。
// 通常の重なり順は「掴むたびに1つ増える」カウンタなので、現実的に到達しない値を選ぶ
export const MEMO_PINNED_Z_BASE = 1_000_000;

/**
 * 付箋の重なり順(CSSのz-index)。
 * baseはその画面での通常の重なり順(メモタブは保存されたorder、統合ボードは
 * その場限りのカウンタ)。固定した付箋は下駄を履かせて、常に通常の付箋より上に出す。
 * 固定した付箋どうしの前後関係は、これまでどおりbaseの大小で決まる。
 */
export function memoNoteZIndex(pinned: boolean | undefined, base: number): number {
  return pinned ? MEMO_PINNED_Z_BASE + base : base;
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

// ここから下は、自動サイズ調整で横幅も内容に合わせるための実測ベースの計算。
// 上のestimateTextNoteHeight等は「幅220px固定」を前提にした文字数からの概算だが、
// 幅も可変にすると概算では実際の折り返しと大きくズレてしまうため、キャンバスで
// 実際の文字幅を測って求める(全角/半角混在や絵文字が混ざっても実際の見た目どおりになる)
export const MEMO_NOTE_AUTO_MAX_WIDTH = 420; // 自動サイズ時、横に広がりすぎないための上限
// 自動サイズ時の最小幅。付箋の上部には色スウォッチ・自動サイズボタン等の操作列が
// 並んでおり、MEMO_NOTE_MIN_WIDTH(手動リサイズ時の絶対下限,100px)まで縮めると
// その操作列自体が折り返して崩れてしまう。180pxなら操作列が2行に収まる
const MEMO_NOTE_AUTO_MIN_WIDTH = 180;
const MEMO_NOTE_TEXT_HORIZONTAL_CHROME = 16; // 本文textareaのpx-2(左右16px)相当
const MEMO_NOTE_CHECKLIST_HORIZONTAL_CHROME = 54; // チェックリスト行のチェックボックス・削除ボタン・余白相当

let measureCtx: CanvasRenderingContext2D | null | undefined;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (measureCtx !== undefined) return measureCtx;
  measureCtx = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  return measureCtx;
}

// テーマによって地の文の書体が変わる場合(ターミナル風は等幅フォントに変わる等)があるため、
// ハードコードせず都度実際のbodyの書体を読む
function bodyFontFamily(): string {
  if (typeof document === "undefined") return "sans-serif";
  return getComputedStyle(document.body).fontFamily || "sans-serif";
}

// 付箋本文(textarea, Tailwindのtext-sm=14px)の自動サイズ計算に使うフォント
export function memoNoteTextFont(): string {
  return `400 14px ${bodyFontFamily()}`;
}
// チェックリスト項目(input, Tailwindのtext-xs=12px)の自動サイズ計算に使うフォント
export function memoChecklistItemFont(): string {
  return `400 12px ${bodyFontFamily()}`;
}

// 1行のテキストを、幅maxWidthに収まるよう貪欲に折り返した場合の行数を返す。
// 日本語には単語の区切りが無いため、CSSの折り返しと同様に1文字ずつ判定する簡易近似
function wrappedLineCount(ctx: CanvasRenderingContext2D, line: string, maxWidth: number): number {
  if (line.length === 0) return 1;
  let rows = 1;
  let current = "";
  for (const ch of line) {
    const next = current + ch;
    if (current !== "" && ctx.measureText(next).width > maxWidth) {
      rows++;
      current = ch;
    } else {
      current = next;
    }
  }
  return rows;
}

/**
 * 実際に表示で使っているフォントで文字幅を測り、付箋の横幅を「一番長い行が
 * ちょうど収まる幅」に、縦幅を「そのときの折り返し行数」に合わせる。
 * キャンバスが使えない環境(テスト等)では、幅は最小幅のまま高さだけ従来の
 * 文字数概算(estimateTextNoteHeight)にフォールバックする
 */
export function estimateAutoTextNoteSize(text: string, font: string): { width: number; height: number } {
  const ctx = getMeasureCtx();
  if (!ctx) return { width: MEMO_NOTE_AUTO_MIN_WIDTH, height: estimateTextNoteHeight(text) };
  ctx.font = font;
  const lines = text.split("\n");
  let longest = 0;
  for (const line of lines) longest = Math.max(longest, ctx.measureText(line).width);
  const width = Math.max(
    MEMO_NOTE_AUTO_MIN_WIDTH,
    Math.min(MEMO_NOTE_AUTO_MAX_WIDTH, Math.ceil(longest) + MEMO_NOTE_TEXT_HORIZONTAL_CHROME)
  );
  const maxTextWidth = width - MEMO_NOTE_TEXT_HORIZONTAL_CHROME;
  let rows = 0;
  for (const line of lines) rows += wrappedLineCount(ctx, line, maxTextWidth);
  const height = clampNoteHeight(MEMO_NOTE_CHROME_HEIGHT + Math.max(1, rows) * MEMO_NOTE_TEXT_LINE_HEIGHT);
  return { width, height };
}

// チェックリスト付箋の横幅。各項目はtextareaと違って折り返さない1行入力のため、
// 一番長い項目の文字幅に合わせるだけでよい(縦幅は従来通り項目数だけで決まる)
export function estimateAutoChecklistNoteWidth(items: { text: string }[], font: string): number {
  const ctx = getMeasureCtx();
  if (!ctx) return MEMO_NOTE_AUTO_MIN_WIDTH;
  ctx.font = font;
  let longest = 0;
  for (const item of items) longest = Math.max(longest, ctx.measureText(item.text).width);
  return Math.max(
    MEMO_NOTE_AUTO_MIN_WIDTH,
    Math.min(MEMO_NOTE_AUTO_MAX_WIDTH, Math.ceil(longest) + MEMO_NOTE_CHECKLIST_HORIZONTAL_CHROME)
  );
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
