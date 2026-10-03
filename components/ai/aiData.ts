import { db } from "@/lib/db";
import { buildTimeboxRequest, type TimeboxRequest } from "@/lib/aiPrompts";
import { parseBreakRanges } from "@/lib/breaks";
import { buildSnapshot, type ProgressSnapshot } from "@/lib/progressSync";
import { DEFAULT_TAG_PRESETS, parsePresetList } from "@/lib/todo";
import { todayStr } from "@/lib/time";

// 依頼文・取り込みで使うデータを、その時点のDBから読み出す(画面を開いた後の変更も反映されるよう、押した時に読む)

export const SPEC_PATH = "/progress-sync-spec.md";

export async function loadSpec(): Promise<string> {
  const res = await fetch(SPEC_PATH);
  if (!res.ok) throw new Error(String(res.status));
  return res.text();
}

async function setting(key: string, fallback: string): Promise<string> {
  return (await db.settings.get(key))?.value ?? fallback;
}

export async function loadTagOptions(): Promise<string[]> {
  const list = parsePresetList(await setting("todo.tagPresets", JSON.stringify(DEFAULT_TAG_PRESETS)));
  return list.length ? list : DEFAULT_TAG_PRESETS;
}

export async function loadBreaks() {
  return parseBreakRanges(await setting("today.provisionalBreakRanges", "[]"));
}

export async function loadSnapshot(): Promise<ProgressSnapshot> {
  const [projects, todoTasks, todoLists, tagOptions] = await Promise.all([
    db.projects.toArray(),
    db.todoTasks.toArray(),
    db.todoLists.toArray(),
    loadTagOptions(),
  ]);
  return buildSnapshot({ projects, todoTasks, todoLists, tagOptions });
}

/** 時間割の依頼の使い道(仕事/家庭)。工程表を仕事用と家庭用で別々に使う人のため、依頼の画面で選んで覚えておく */
export const LIFE_CONTEXT_KEY = "ai.timeboxContext";

export async function loadTimeboxRequest(date: string): Promise<TimeboxRequest> {
  const [dailyTasks, masterTasks, records, projects, todoTasks, breaks, workStart, workEnd, gap, context] = await Promise.all([
    db.dailyTasks.where("date").equals(date).toArray(),
    db.masterTasks.toArray(),
    db.records.toArray(),
    db.projects.toArray(),
    db.todoTasks.toArray(),
    loadBreaks(),
    setting("today.standardWorkStart", "08:00"),
    setting("today.standardWorkEnd", "17:00"),
    setting("today.timeboxGapMinutes", "5"),
    setting(LIFE_CONTEXT_KEY, "仕事"),
  ]);
  return buildTimeboxRequest({
    date,
    now: new Date(),
    dailyTasks,
    masterTasks,
    records,
    projects,
    todoTasks,
    breaks,
    workStart,
    workEnd,
    gapMinutes: Math.max(0, Math.min(30, Number(gap) || 0)),
    context: context === "家庭" ? "家庭" : "仕事",
  });
}

/** 取り込みの確認に使う、今のDBの状態(時間割のため今日以降の作業も含める) */
export async function loadPlanState() {
  const [projects, todoTasks, todoLists, tagOptions, dailyTasks, breaks] = await Promise.all([
    db.projects.toArray(),
    db.todoTasks.toArray(),
    db.todoLists.toArray(),
    loadTagOptions(),
    db.dailyTasks.where("date").aboveOrEqual(todayStr()).toArray(),
    loadBreaks(),
  ]);
  return { projects, todoTasks, todoLists, tagOptions, dailyTasks, breaks };
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** AIの返答に混ざりがちなコードブロックや前後の文章を外して、JSONの部分だけを取り出す */
export function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? body.slice(start, end + 1) : body.trim();
}
