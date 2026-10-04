import { parseCompose, dueLabel } from "./claudeCompose";
import { db, uid } from "./db";
import { findOrCreateMasterTask } from "./master";
import { addQuickStamp } from "./quickStamp";
import { finishDailyTask, pauseDailyTask, pauseRunningProvisional, segmentsAccumulatedMs } from "./tasks";
import { formatMsClock, todayStr } from "./time";
import type { DailyTask } from "./types";

// ターミナルモードのコマンド欄。打ち込むだけで計測・ToDo・打刻を操作する。
// 表示用の出力行を返す。データは他のモードと同じテーブルをそのまま書き換える

export const COMMAND_HELP = [
  "ls                 今日の作業を番号つきで一覧",
  "start <番号|名前>   作業を始める(無ければ作業マスタから探して追加)",
  "pause              計測中の作業を一時停止",
  "done [番号|名前]    作業を完了(省略時は計測中の作業)",
  "todo <文>          ToDoを追加。例: todo 明日までに見積書を送る 30分 @営業",
  "stamp [一言]        今の時刻を打刻",
  "clear              画面の出力を消す",
];

async function pause(task: DailyTask, at: number): Promise<void> {
  await pauseDailyTask(task, at);
}

function pick(tasks: DailyTask[], arg: string): DailyTask | undefined {
  const n = Number(arg);
  if (Number.isInteger(n) && n >= 1 && n <= tasks.length) return tasks[n - 1];
  return tasks.find((t) => t.name === arg) ?? tasks.find((t) => t.name.includes(arg) || `${t.category}/${t.name}`.includes(arg));
}

export async function runCommand(input: string, now: number = Date.now()): Promise<string[]> {
  const line = input.trim();
  if (!line) return [];
  const [cmd, ...rest] = line.split(/\s+/);
  const arg = rest.join(" ").trim();
  const today = todayStr(new Date(now));
  const tasks = (await db.dailyTasks.where("date").equals(today).toArray())
    .filter((t) => !t.isProvisional)
    .sort((a, b) => a.order - b.order);
  const running = tasks.filter((t) => t.status === "running");

  switch (cmd.toLowerCase()) {
    case "help":
    case "?":
      return COMMAND_HELP;
    case "ls": {
      if (tasks.length === 0) return ["(今日の作業はまだありません)"];
      return tasks.map((t, i) => {
        const mark = t.status === "running" ? "▶" : t.status === "done" ? "✓" : t.status === "paused" ? "‖" : "·";
        return `${String(i + 1).padStart(2, " ")} ${mark} ${t.category}/${t.name}  ${formatMsClock(segmentsAccumulatedMs(t, now))}`;
      });
    }
    case "pause": {
      if (running.length === 0) return ["計測中の作業はありません"];
      for (const t of running) await pause(t, now);
      return running.map((t) => `‖ 一時停止: ${t.category}/${t.name}`);
    }
    case "done": {
      const target = arg ? pick(tasks, arg) : running[0];
      if (!target) return [arg ? `見つかりません: ${arg}` : "計測中の作業はありません"];
      if (target.status === "done") return [`もう完了しています: ${target.name}`];
      await finishDailyTask(target, now);
      return [`✓ 完了: ${target.category}/${target.name}`];
    }
    case "start": {
      if (!arg) return ["使い方: start <番号|名前>"];
      let target = pick(tasks.filter((t) => t.status !== "done"), arg);
      // 完了済みの作業を名前で指定した場合は、記録を書き換えないよう同じ作業を新しく始め直す
      const doneMatch = target ? undefined : pick(tasks, arg);
      for (const r of running) if (r.id !== target?.id) await pause(r, now);
      await pauseRunningProvisional(today, now);
      if (target) {
        if (target.status === "running") return [`もう計測中です: ${target.name}`];
        await db.dailyTasks.update(target.id, {
          status: "running",
          segments: [...target.segments, { start: now }],
          ...(target.status === "pending" ? { startedAt: now } : {}),
        });
        return [`▶ 開始: ${target.category}/${target.name}`];
      }
      const masters = doneMatch?.masterTaskId
        ? await db.masterTasks.where("id").equals(doneMatch.masterTaskId).toArray()
        : await db.masterTasks.filter((m) => !m.archived && (m.name === arg || m.name.includes(arg))).toArray();
      const master = masters.find((m) => m.name === arg) ?? masters[0] ?? (await findOrCreateMasterTask("その他", arg, 0));
      const order = tasks.length ? Math.max(...tasks.map((t) => t.order)) + 1 : 0;
      target = {
        id: uid(),
        date: today,
        order,
        masterTaskId: master.id,
        category: master.category,
        name: master.name,
        estimatedSeconds: master.estimatedSeconds,
        hasPlan: false,
        status: "running",
        segments: [{ start: now }],
        accumulatedMs: 0,
        startedAt: now,
        isSpontaneous: true,
        // 案件・段階・ToDoから追加した作業を始め直す時は、その紐付けも引き継ぐ
        ...(doneMatch ? { projectId: doneMatch.projectId, stageId: doneMatch.stageId, todoTaskId: doneMatch.todoTaskId } : {}),
      };
      await db.dailyTasks.add(target);
      return [`▶ 開始: ${master.category}/${master.name}${masters.length ? "" : "(新しい作業として登録)"}`];
    }
    case "todo": {
      const p = parseCompose(arg, today);
      if (!p.title) return ["使い方: todo <内容> 例: todo 明日までに見積書を送る @営業"];
      const list = await db.todoLists.orderBy("order").first();
      const listId = list?.id ?? uid();
      if (!list) await db.todoLists.add({ id: listId, title: "ToDo", order: 0, createdAt: now });
      await db.todoTasks.add({
        id: uid(),
        listId,
        title: p.title,
        category: p.category,
        dueDate: p.dueDate,
        estimateMinutes: p.estimateMin,
        important: p.important,
        completed: false,
        order: await db.todoTasks.count(),
        createdAt: now,
      });
      const extra = [p.dueDate && `期限 ${dueLabel(p.dueDate, today)}`, p.estimateMin && `見込み ${p.estimateMin}分`, p.category && `@${p.category}`, p.important && "重要"]
        .filter(Boolean)
        .join(" ");
      return [`+ ToDo: ${p.title}${extra ? `  [${extra}]` : ""}`];
    }
    case "stamp": {
      const s = await addQuickStamp(now, arg || undefined);
      const d = new Date(s.at);
      return [`📍 打刻 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}${arg ? ` ${arg}` : ""}`];
    }
    default:
      return [`コマンドが見つかりません: ${cmd}(help で一覧)`];
  }
}
