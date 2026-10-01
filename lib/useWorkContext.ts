import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db";
import { buildWorkContextSources, workContextOf, workNameWithContext, type WorkContextSources, type WorkLinks } from "./workContext";

// 画面から作業名に案件名・親タスク名を添えるためのフック(lib/workContext.ts)。
// 案件とToDoを読み込み、表示用の関数を返す
export function useWorkContext(): {
  src: WorkContextSources;
  /** 「案件名 › 作業名」 */
  label: (item: WorkLinks) => string;
  /** 添える部分だけ(無ければundefined)。作業名と見た目を分けて出したいとき用 */
  context: (item: WorkLinks) => string | undefined;
} {
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const todoTasks = useLiveQuery(() => db.todoTasks.toArray(), []);
  const src = useMemo(() => buildWorkContextSources(projects, todoTasks), [projects, todoTasks]);
  return useMemo(
    () => ({ src, label: (item: WorkLinks) => workNameWithContext(item, src), context: (item: WorkLinks) => workContextOf(item, src) }),
    [src]
  );
}
