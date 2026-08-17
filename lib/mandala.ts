import type { MandalaChart } from "./types";

// 大谷翔平選手の目標達成シートで知られる、9x9マス(3x3の「ブロック」×さらに3x3の「マス」)の
// マンダラチャート配置を計算する。中心ブロックの中心=目標、中心ブロックの残り8マス=8つの
// テーマ、各テーマに対応する周囲8ブロックはそれぞれ中心にそのテーマを再掲し、残り8マスに
// 具体策を並べる、という本家の構造をそのまま再現する

// ブロック内の8マス(中心を除く)の並び順。行優先で中心(1,1)だけ飛ばす
const SLOT_OFFSETS: [number, number][] = [
  [0, 0],
  [0, 1],
  [0, 2],
  [1, 0],
  [1, 2],
  [2, 0],
  [2, 1],
  [2, 2],
];

export const THEME_COUNT = 8;
export const ACTIONS_PER_THEME = 8;

function slotIndexOf(row: number, col: number): number {
  return SLOT_OFFSETS.findIndex(([r, c]) => r === row && c === col);
}

export type MandalaCellKind = "goal" | "theme" | "action";

export interface MandalaCell {
  kind: MandalaCellKind;
  themeIndex: number; // kind==="goal"の場合は-1
  actionIndex: number; // kind!=="action"の場合は-1
}

// 9x9(行→列の配列)を返す。gridRows[r][c]でアクセスする
export function buildMandalaGrid(): MandalaCell[][] {
  const grid: MandalaCell[][] = [];
  for (let r = 0; r < 9; r++) {
    const row: MandalaCell[] = [];
    for (let c = 0; c < 9; c++) {
      const blockRow = Math.floor(r / 3);
      const blockCol = Math.floor(c / 3);
      const withinRow = r % 3;
      const withinCol = c % 3;

      if (blockRow === 1 && blockCol === 1) {
        // 中心ブロック: 中心=目標、残り8マス=テーマ
        if (withinRow === 1 && withinCol === 1) {
          row.push({ kind: "goal", themeIndex: -1, actionIndex: -1 });
        } else {
          const themeIndex = slotIndexOf(withinRow, withinCol);
          row.push({ kind: "theme", themeIndex, actionIndex: -1 });
        }
      } else {
        // 周囲8ブロック: どのテーマのブロックかをブロック自体の位置から求める
        const themeIndex = slotIndexOf(blockRow, blockCol);
        if (withinRow === 1 && withinCol === 1) {
          // ブロック中心にテーマ名を再掲(本家と同じ演出)
          row.push({ kind: "theme", themeIndex, actionIndex: -1 });
        } else {
          const actionIndex = slotIndexOf(withinRow, withinCol);
          row.push({ kind: "action", themeIndex, actionIndex });
        }
      }
    }
    grid.push(row);
  }
  return grid;
}

export function emptyMandalaChart(title: string): Omit<MandalaChart, "id" | "createdAt" | "updatedAt"> {
  return {
    title,
    goal: "",
    themes: Array.from({ length: THEME_COUNT }, () => ""),
    actions: Array.from({ length: THEME_COUNT }, () => Array.from({ length: ACTIONS_PER_THEME }, () => "")),
    actionTodoIds: Array.from({ length: THEME_COUNT }, () => Array.from({ length: ACTIONS_PER_THEME }, () => undefined)),
  };
}
