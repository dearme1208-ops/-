import { db, uid } from "./db";
import type { ComposeResult } from "./claudeCompose";
import { findOrCreateMasterTask } from "./master";
import { shiftDateStr } from "./time";
import type { DailyTask } from "./types";

// 「ひとこと入力」: 思いついたことを1行で書き、行き先(ToDo・今やる・今日の予定・メモ・案件)を
// 選ぶだけで入れる。書き方の読み取りはClaudeモードと同じ lib/claudeCompose.ts を使う

export const QUICK_CAPTURE_EVENT = "koutei:quick-capture";

/** どの画面からでも「ひとこと入力」を開く(prefill は共有から受け取った文など) */
export function openQuickCapture(prefill?: string): void {
  window.dispatchEvent(new CustomEvent(QUICK_CAPTURE_EVENT, { detail: prefill ?? "" }));
}

export type CaptureDest = "todo" | "now" | "today" | "memo" | "project";

/**
 * 書いた内容から行き先の候補を決める。
 *  - 長い文・複数行・URLを含む → メモ(あとで読み返す控え)
 *  - 期限・重要の印がある → ToDo
 *  - 見込み時間だけがある → 今日の予定
 *  - それ以外 → ToDo
 */
export function suggestDest(raw: string, parsed: ComposeResult): CaptureDest {
  if (/https?:\/\//.test(raw) || raw.includes("\n") || raw.trim().length > 60) return "memo";
  if (parsed.dueDate || parsed.important) return "todo";
  if (parsed.estimateMin) return "today";
  return "todo";
}

async function firstTodoListId(): Promise<string> {
  const lists = await db.todoLists.orderBy("order").toArray().catch(() => db.todoLists.toArray());
  if (lists.length > 0) return lists[0].id;
  const id = uid();
  await db.todoLists.add({ id, title: "タスク", order: 0, createdAt: Date.now() });
  return id;
}

/** 選んだ行き先に入れる。どこに入れたかを一言で返す(知らせに使う) */
export async function commitCapture(dest: CaptureDest, raw: string, parsed: ComposeResult, today: string): Promise<string> {
  const title = parsed.title || raw.trim().split("\n")[0].slice(0, 80);
  const now = Date.now();
  if (dest === "todo") {
    const listId = await firstTodoListId();
    const order = await db.todoTasks.where("listId").equals(listId).count().catch(() => 0);
    await db.todoTasks.add({
      id: uid(),
      listId,
      title,
      category: parsed.category,
      dueDate: parsed.dueDate,
      estimateMinutes: parsed.estimateMin,
      important: parsed.important,
      completed: false,
      order,
      createdAt: now,
    });
    return `ToDo「${title}」を追加しました`;
  }
  if (dest === "project") {
    await db.projects.add({
      id: uid(),
      title,
      category: parsed.category || "プロジェクト",
      workName: title,
      dueDate: parsed.dueDate ?? shiftDateStr(today, 7),
      createdAt: now,
    });
    return `案件「${title}」を登録しました`;
  }
  if (dest === "memo") {
    const board = (await db.memoBoards.orderBy("order").first().catch(() => undefined)) ?? (await db.memoBoards.toCollection().first());
    let boardId = board?.id;
    if (!boardId) {
      boardId = uid();
      await db.memoBoards.add({ id: boardId, title: "メモ", order: 0, createdAt: now });
    }
    const count = await db.memoNotes.where("boardId").equals(boardId).count();
    await db.memoNotes.add({
      id: uid(),
      boardId,
      x: 24 + (count % 5) * 24,
      y: 24 + (count % 5) * 24,
      width: 220,
      height: 140,
      color: "yellow",
      text: raw.trim(),
      order: now,
      autoSize: true,
      createdAt: now,
      updatedAt: now,
    });
    return "メモに残しました";
  }
  // 今やる / 今日の予定: 本日の作業に入れる
  const master = await findOrCreateMasterTask(parsed.category || "未分類", title, (parsed.estimateMin ?? 0) * 60);
  const order = await db.dailyTasks.where("date").equals(today).count();
  const task: DailyTask = {
    id: uid(),
    date: today,
    order,
    masterTaskId: master.id,
    category: master.category,
    name: master.name,
    estimatedSeconds: (parsed.estimateMin ?? 0) * 60,
    hasPlan: !!parsed.estimateMin,
    status: dest === "now" ? "running" : "pending",
    segments: dest === "now" ? [{ start: now }] : [],
    accumulatedMs: 0,
    startedAt: dest === "now" ? now : undefined,
    isSpontaneous: true,
  };
  await db.dailyTasks.add(task);
  // 計測中だった作業は、本日の作業の見張り(enforceSingleRunning)がこの開始時刻で一時停止する
  return dest === "now" ? `「${title}」を始めました` : `今日の予定に「${title}」を入れました`;
}
