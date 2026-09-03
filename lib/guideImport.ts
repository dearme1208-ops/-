import { db, uid } from "./db";
import type { TodoTask } from "./types";

// 攻略サイトの「攻略チャート」的なテキスト(表をコピペした際によく見られる
// 「見出し(タブ区切り)」+「・箇条書き」+「┗/┣による補足」の並び)を、
// ToDoの親タスク+サブタスクの一覧へ変換する。特定サイト専用にはせず、
// この並びで書かれたテキストであれば貼り付けるだけで使えるようにしている
export interface ParsedGuideTask {
  title: string;
  subtasks: string[];
}

const BULLET_RE = /^[・･]\s*(.+)$/;
const NOTE_RE = /^[┗┣└├]\s*(.+)$/;

export function parseGuideText(text: string): ParsedGuideTask[] {
  const tasks: ParsedGuideTask[] = [];
  let current: ParsedGuideTask | null = null;

  const ensureCurrent = (): ParsedGuideTask => {
    if (!current) {
      current = { title: "インポートしたタスク", subtasks: [] };
      tasks.push(current);
    }
    return current;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    // 「1~3<TAB>あかつき大附属」のような、表の1列目(見出し)が付いている行は新しいタスクの開始
    const tabIdx = rawLine.indexOf("\t");
    if (tabIdx >= 0) {
      const label = rawLine.slice(0, tabIdx).trim();
      const rest = rawLine.slice(tabIdx + 1).trim();
      if (label) {
        const bulletMatch = rest.match(BULLET_RE);
        current = { title: bulletMatch ? label : [label, rest].filter(Boolean).join(" "), subtasks: [] };
        tasks.push(current);
        if (bulletMatch) current.subtasks.push(bulletMatch[1]);
        continue;
      }
    }

    const bulletMatch = line.match(BULLET_RE);
    if (bulletMatch) {
      ensureCurrent().subtasks.push(bulletMatch[1]);
      continue;
    }

    // ┗/┣で始まる行は直前の箇条書きへの補足として扱う(独立したサブタスクにはしない)
    const noteMatch = line.match(NOTE_RE);
    if (noteMatch) {
      const t = ensureCurrent();
      if (t.subtasks.length > 0) {
        t.subtasks[t.subtasks.length - 1] += ` / ${noteMatch[1]}`;
      } else {
        t.subtasks.push(noteMatch[1]);
      }
      continue;
    }

    // 記号の付かない行(セクション内の小見出し等)もそのままサブタスクとして残す
    ensureCurrent().subtasks.push(line);
  }

  return tasks.filter((t) => t.title.trim().length > 0);
}

// 解析結果をToDoの親タスク+サブタスクとして登録する
export async function createTasksFromGuide(
  parsed: ParsedGuideTask[],
  listId: string,
  sourceLabel: string
): Promise<number> {
  const now = Date.now();
  let created = 0;
  for (let i = 0; i < parsed.length; i++) {
    const { title, subtasks } = parsed[i];
    const parentId = uid();
    const parentTask: TodoTask = {
      id: parentId,
      listId,
      title,
      notes: sourceLabel || undefined,
      important: false,
      completed: false,
      order: now + i,
      createdAt: now,
    };
    await db.todoTasks.add(parentTask);
    created++;
    for (let j = 0; j < subtasks.length; j++) {
      const subtask: TodoTask = {
        id: uid(),
        listId,
        parentTaskId: parentId,
        title: subtasks[j],
        important: false,
        completed: false,
        order: now + i * 1000 + j,
        createdAt: now,
      };
      await db.todoTasks.add(subtask);
      created++;
    }
  }
  return created;
}
