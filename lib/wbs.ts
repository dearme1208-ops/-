import { csvEscape, parseCsvLine } from "./csv";
import { db, uid } from "./db";
import type { WbsNode } from "./types";

// ===== WBS(作業分解構成図) =====
//
// 案件の段階(ProjectStage)はフラットな1階層のマイルストーンだが、こちらは
// 任意の深さの親子構造(工程→タスク→サブタスク→…)・開始日/終了日・進捗率・
// 先行タスク(依存関係)を持つ、より本格的な工程分解のための構造。
//
// 表示上のWBS番号(1 / 1.1 / 1.1.2 …)は保存しない。並び替え・削除のたびに
// 手で振り直す必要が無いよう、常にその時点の並び順・階層から計算して出す
// (flattenWbsTree参照)。CSVの取り込み・書き出しでもこの番号をキーに使う。

export interface WbsTreeNode extends WbsNode {
  children: WbsTreeNode[];
}

export function buildWbsTree(nodes: WbsNode[]): WbsTreeNode[] {
  const byId = new Map<string, WbsTreeNode>();
  for (const n of nodes) byId.set(n.id, { ...n, children: [] });
  const roots: WbsTreeNode[] = [];
  for (const n of nodes) {
    const tn = byId.get(n.id)!;
    // 親が指定されていても、その親が(削除等で)もう存在しなければ最上位扱いにする
    if (n.parentId && byId.has(n.parentId)) {
      byId.get(n.parentId)!.children.push(tn);
    } else {
      roots.push(tn);
    }
  }
  const sortRec = (list: WbsTreeNode[]) => {
    list.sort((a, b) => a.order - b.order);
    for (const n of list) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

export interface WbsRow {
  node: WbsNode;
  depth: number;
  code: string; // "1.2.3" 形式。表示・CSV入出力の両方で使う
  hasChildren: boolean;
}

// ツリーを表示順(深さ優先)に平らにし、depth・WBS番号を添える。
// respectCollapsed=trueの場合、collapsedなノードの子は結果に含めない
// (ツリー表示・ガント表示の行を1:1で対応させるため、両方が同じ関数を通す)
export function flattenWbsTree(tree: WbsTreeNode[], opts: { respectCollapsed?: boolean } = {}): WbsRow[] {
  const rows: WbsRow[] = [];
  function visit(list: WbsTreeNode[], prefix: string, depth: number) {
    list.forEach((n, i) => {
      const code = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      rows.push({ node: n, depth, code, hasChildren: n.children.length > 0 });
      if (n.children.length > 0 && !(opts.respectCollapsed && n.collapsed)) {
        visit(n.children, code, depth + 1);
      }
    });
  }
  visit(tree, "", 0);
  return rows;
}

/** idで指定したノードの子孫(直下だけでなく孫以下も含む)のID集合。インデント可否・
 * 先行タスク選択肢の除外(自分の子孫を先行に選ぶと矛盾するため)に使う */
export function getDescendantIds(tree: WbsTreeNode[], id: string): Set<string> {
  const result = new Set<string>();
  function collect(n: WbsTreeNode) {
    for (const c of n.children) {
      result.add(c.id);
      collect(c);
    }
  }
  function find(list: WbsTreeNode[]): boolean {
    for (const n of list) {
      if (n.id === id) {
        collect(n);
        return true;
      }
      if (find(n.children)) return true;
    }
    return false;
  }
  find(tree);
  return result;
}

export interface WbsEffective {
  progress: number; // 0〜100
  startDate?: string;
  endDate?: string;
  /** 進捗の重み付け平均に使った実質の日数(親ノードがさらに上の階層で使う) */
  weight: number;
}

function dateDiffDays(startDate: string, endDate: string): number {
  const ms = new Date(endDate + "T00:00:00").getTime() - new Date(startDate + "T00:00:00").getTime();
  return Math.max(1, Math.round(ms / 86400000) + 1);
}

/**
 * 子を持つノードの進捗率・開始日・終了日は、常に子から計算した値を使う
 * (保存されているprogress/startDate/endDateは葉ノードだけで意味を持つ)。
 * 開始日=子の最も早い開始日、終了日=子の最も遅い終了日、進捗率=子の期間(日数)で
 * 重み付けした平均(期間が分からない子は重み1として扱う)
 */
export function computeWbsEffective(tree: WbsTreeNode[]): Map<string, WbsEffective> {
  const map = new Map<string, WbsEffective>();
  function visit(node: WbsTreeNode): WbsEffective {
    let eff: WbsEffective;
    if (node.children.length === 0) {
      const weight = node.startDate && node.endDate ? dateDiffDays(node.startDate, node.endDate) : 1;
      eff = {
        progress: Math.max(0, Math.min(100, node.progress ?? 0)),
        startDate: node.startDate,
        endDate: node.endDate,
        weight,
      };
    } else {
      const childEffs = node.children.map(visit);
      const starts = childEffs.map((c) => c.startDate).filter((d): d is string => !!d);
      const ends = childEffs.map((c) => c.endDate).filter((d): d is string => !!d);
      const totalWeight = childEffs.reduce((s, c) => s + c.weight, 0) || 1;
      eff = {
        progress: childEffs.reduce((s, c) => s + c.progress * c.weight, 0) / totalWeight,
        startDate: starts.length > 0 ? starts.reduce((a, b) => (a < b ? a : b)) : undefined,
        endDate: ends.length > 0 ? ends.reduce((a, b) => (a > b ? a : b)) : undefined,
        weight: totalWeight,
      };
    }
    map.set(node.id, eff);
    return eff;
  }
  for (const root of tree) visit(root);
  return map;
}

/** 案件全体の実データ範囲(ガントの自動フィットに使う)。日付を1件も持たなければnull */
export function computeWbsDateRange(nodes: WbsNode[]): { start: string; end: string } | null {
  const dates: string[] = [];
  for (const n of nodes) {
    if (n.startDate) dates.push(n.startDate);
    if (n.endDate) dates.push(n.endDate);
  }
  if (dates.length === 0) return null;
  return { start: dates.reduce((a, b) => (a < b ? a : b)), end: dates.reduce((a, b) => (a > b ? a : b)) };
}

// ---- CSV取り込み・書き出し ----
// WBSコード(1 / 1.1 / 1.1.2…)を主キーに使う。あちらのファイルに社内IDは無いのが普通で、
// コードなら見ただけで階層が分かり、Excel上でも振りやすいため。先行タスクも同じコードで指定する
// (このアプリ内部のID同士の依存関係へは、取り込み時にコード→IDの対応表を作って変換する)

const WBS_CSV_HEADER = ["コード", "名前", "開始日", "終了日", "進捗率", "先行", "担当者"];

export function wbsCsvTemplate(): string {
  const rows = [
    WBS_CSV_HEADER.join(","),
    "1,要件定義,2026-01-05,2026-01-10,100,,",
    "1.1,ヒアリング,2026-01-05,2026-01-07,100,,田中",
    "1.2,要件確定,2026-01-08,2026-01-10,100,1.1,田中",
    "2,設計,2026-01-11,2026-01-20,40,1,",
    "2.1,基本設計,2026-01-11,2026-01-15,80,1.2,鈴木",
    "2.2,詳細設計,2026-01-16,2026-01-20,0,2.1,鈴木",
  ];
  return rows.join("\n");
}

export function wbsNodesToCsv(nodes: WbsNode[]): string {
  const flat = flattenWbsTree(buildWbsTree(nodes), { respectCollapsed: false });
  const codeById = new Map(flat.map((r) => [r.node.id, r.code]));
  const lines = [WBS_CSV_HEADER.join(",")];
  for (const r of flat) {
    const predCodes = (r.node.predecessorIds ?? [])
      .map((id) => codeById.get(id))
      .filter((c): c is string => !!c)
      .join(";");
    lines.push(
      [
        r.code,
        csvEscape(r.node.title),
        r.node.startDate ?? "",
        r.node.endDate ?? "",
        String(Math.round(r.node.progress ?? 0)),
        predCodes,
        csvEscape(r.node.assignee ?? ""),
      ].join(",")
    );
  }
  return lines.join("\n");
}

export interface ParsedWbsRow {
  code: string;
  parentCode?: string;
  title: string;
  startDate?: string;
  endDate?: string;
  progress: number;
  predecessorCodes: string[];
  assignee?: string;
}

export interface ParsedWbsResult {
  rows: ParsedWbsRow[];
  errors: string[];
}

function parentCodeOf(code: string): string | undefined {
  const idx = code.lastIndexOf(".");
  return idx === -1 ? undefined : code.slice(0, idx);
}

export function parseWbsCsv(text: string): ParsedWbsResult {
  const lines = text.split(/\r\n|\n/).filter((l) => l.trim() !== "");
  const errors: string[] = [];
  if (lines.length === 0) return { rows: [], errors: ["空のファイルです"] };

  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const codeCol = idx("コード");
  const titleCol = idx("名前");
  if (codeCol === -1 || titleCol === -1) {
    return { rows: [], errors: ['必須列 "コード" "名前" が見つかりません(CSVテンプレートをご確認ください)'] };
  }
  const startCol = idx("開始日");
  const endCol = idx("終了日");
  const progressCol = idx("進捗率");
  const predCol = idx("先行");
  const assigneeCol = idx("担当者");

  const rows: ParsedWbsRow[] = [];
  const seenCodes = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const code = cols[codeCol]?.trim();
    const title = cols[titleCol]?.trim();
    if (!code || !title) {
      errors.push(`${i + 1}行目: コードまたは名前が空のためスキップしました`);
      continue;
    }
    if (seenCodes.has(code)) {
      errors.push(`${i + 1}行目: コード "${code}" が重複しているためスキップしました`);
      continue;
    }
    seenCodes.add(code);
    const progressRaw = progressCol !== -1 ? Number(cols[progressCol]) : 0;
    const predecessorCodes =
      predCol !== -1
        ? (cols[predCol] ?? "")
            .split(/[;,]/)
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        : [];
    rows.push({
      code,
      parentCode: parentCodeOf(code),
      title,
      startDate: startCol !== -1 ? cols[startCol]?.trim() || undefined : undefined,
      endDate: endCol !== -1 ? cols[endCol]?.trim() || undefined : undefined,
      progress: Number.isFinite(progressRaw) ? Math.max(0, Math.min(100, progressRaw)) : 0,
      predecessorCodes,
      assignee: assigneeCol !== -1 ? cols[assigneeCol]?.trim() || undefined : undefined,
    });
  }

  // 親コードに対応する行がファイル内に無ければ、階層が壊れないよう最上位として取り込む
  // (書き間違い等で気づけるよう、エラー一覧にも積んでおく)
  const codeSet = new Set(rows.map((r) => r.code));
  for (const r of rows) {
    if (r.parentCode && !codeSet.has(r.parentCode)) {
      errors.push(`コード "${r.code}" の親 "${r.parentCode}" が見つからないため、最上位として取り込みます`);
      r.parentCode = undefined;
    }
  }
  return { rows, errors };
}

/**
 * 取り込んだ行を、指定した案件のWBSノードとして実際に書き込む。
 * mode="replace"はその案件の既存ノードを全部消してから作り直す(WBS表を丸ごと更新したい場合)。
 * mode="append"は既存の最上位・各階層の末尾にそのまま追加する(別のWBS断片を継ぎ足したい場合)。
 * 先行タスクの参照(コード)は同じ取り込みバッチ内でのみ解決する(既存ノードのコードは
 * 保存されていない=その時点の並び順から出す一時的な値のため、バッチをまたいでは解決できない)
 */
export async function applyWbsImport(
  projectId: string,
  rows: ParsedWbsRow[],
  mode: "replace" | "append"
): Promise<{ created: number }> {
  const now = Date.now();
  await db.transaction("rw", db.wbsNodes, async () => {
    if (mode === "replace") {
      const existingIds = await db.wbsNodes.where("projectId").equals(projectId).primaryKeys();
      await db.wbsNodes.bulkDelete(existingIds);
    }

    const idByCode = new Map<string, string>();
    for (const r of rows) idByCode.set(r.code, uid());

    const orderCounters = new Map<string | undefined, number>();
    if (mode === "append") {
      // 追記の場合、それぞれの親の下で既存の兄弟の続きから並べる
      const existing = await db.wbsNodes.where("projectId").equals(projectId).toArray();
      for (const n of existing) {
        const key = n.parentId;
        orderCounters.set(key, Math.max(orderCounters.get(key) ?? -1, n.order) + 1);
      }
    }

    const toAdd: WbsNode[] = rows.map((r) => {
      const parentId = r.parentCode ? idByCode.get(r.parentCode) : undefined;
      const nextOrder = orderCounters.get(parentId) ?? 0;
      orderCounters.set(parentId, nextOrder + 1);
      return {
        id: idByCode.get(r.code)!,
        projectId,
        parentId,
        order: nextOrder,
        title: r.title,
        startDate: r.startDate,
        endDate: r.endDate,
        progress: r.progress,
        predecessorIds: r.predecessorCodes.map((c) => idByCode.get(c)).filter((v): v is string => !!v),
        assignee: r.assignee,
        createdAt: now,
        updatedAt: now,
      };
    });
    await db.wbsNodes.bulkAdd(toAdd);
  });
  return { created: rows.length };
}

// ---- 手入力(アウトライン貼り付け)からの取り込み ----
// CSVはExcel等の既存ファイルからの移行向けだが、手元に何も無く直接タイプ/貼り付けたい
// 場合のために、コードも日付も書かない「ただの階層付き箇条書き」からも取り込めるようにする。
// Tab(またはスペース)でインデントするだけで子になり、日付・進捗率・先行タスク・担当者は
// 取り込み後に各項目の詳細ダイアログから入力する想定(この経路では常に空で作る)。
// 生成した行はapplyWbsImportにそのまま渡せる(ParsedWbsRowと同じ形)ので、
// 取り込み確認・置き換え/追記の選択画面はCSVインポートと完全に共有できる

function stripOutlineBullet(s: string): string {
  return s.replace(/^[-*・□■✓✔☐]\s*/, "").replace(/^\d+[.)、]\s*/, "");
}

/** 行頭のインデント量を「レベル」に変換する。タブはそのまま1レベル、スペースは
 * ファイル内で最初に見つかったインデント幅(既定2)を1レベルとして数える */
function outlineDepthOf(line: string, spaceUnit: number): number {
  let i = 0;
  let depth = 0;
  while (i < line.length) {
    if (line[i] === "\t") {
      depth++;
      i++;
    } else if (spaceUnit > 0 && line.slice(i, i + spaceUnit) === " ".repeat(spaceUnit)) {
      depth++;
      i += spaceUnit;
    } else {
      break;
    }
  }
  return depth;
}

export function parseWbsOutlineText(text: string): ParsedWbsResult {
  const lines = text.split(/\r\n|\n/);
  const errors: string[] = [];

  let spaceUnit = 2;
  for (const line of lines) {
    const m = /^( +)\S/.exec(line);
    if (m && !line.startsWith("\t")) {
      spaceUnit = m[1].length;
      break;
    }
  }

  const rows: ParsedWbsRow[] = [];
  // counters[depth] = そのdepthでこれまでに振った通し番号。codeStack[depth] = そのdepthで
  // 直近に振ったコード(1つ浅いdepthの行が来るたびに、それより深い分は打ち切って振り直す)
  const counters: number[] = [];
  const codeStack: string[] = [];
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const depth = outlineDepthOf(raw, spaceUnit);
    const title = stripOutlineBullet(raw.trim());
    if (!title) continue;

    counters[depth] = (counters[depth] ?? 0) + 1;
    counters.length = depth + 1;
    const parentCode = depth > 0 ? codeStack[depth - 1] : undefined;
    if (depth > 0 && !parentCode) {
      errors.push(`"${title}" の親にあたる行が見当たらないため、最上位として取り込みます`);
    }
    const code = parentCode ? `${parentCode}.${counters[depth]}` : String(counters[depth]);
    codeStack[depth] = code;
    codeStack.length = depth + 1;

    rows.push({ code, parentCode, title, progress: 0, predecessorCodes: [] });
  }
  return { rows, errors };
}
