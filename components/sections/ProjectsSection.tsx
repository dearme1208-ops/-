"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import { findOrCreateMasterTask } from "@/lib/master";
import { upsertProjectsFromCsv, recordBelongsToProject } from "@/lib/projects";
import { computeRemainingEstimatedSeconds } from "@/lib/tasks";
import { projectsToCsv, projectsCsvTemplate, parseProjectsCsv } from "@/lib/projectsCsv";
import { downloadTextFile } from "@/lib/report";
import { computeCost, formatYen, parseCategoryRates, resolveCategoryRate } from "@/lib/cost";
import { computeProjectForecast, type ProjectForecast } from "@/lib/projectForecast";
import { computeProjectProgress, isStageDone } from "@/lib/projectStage";
import { useSetting } from "@/lib/settings";
import { cardOverrunClass, useVisualMode, type ThemedMode } from "@/lib/theme";
import { daysBetweenDateStrs, formatDateJp, formatHms, todayStr } from "@/lib/time";
import type { DailyTask, ProjectItem, ProjectStage } from "@/lib/types";
import ProjectsCalendarView from "@/components/sections/ProjectsCalendarView";
import EditProjectDialog from "@/components/sections/EditProjectDialog";
import CategoryWorkNameDialog from "@/components/sections/CategoryWorkNameDialog";
import Modal from "@/components/ui/Modal";
import TreeView, { type TreeNode, type TreeNodeBadge } from "@/components/ui/TreeView";
import { showUndoToast } from "@/lib/toast";
import { fireConfetti } from "@/lib/confetti";

type ViewMode = "gantt" | "calendar" | "tree";
const TREE_LEAF_LIMIT = 15;

const DEFAULT_PX_PER_DAY = 28;
const MIN_PX_PER_DAY = 0.3;
const MAX_PX_PER_DAY = 80;
const ROW_H = 40;
const MIN_LABEL_SPACING_PX = 50;

export default function ProjectsSection({
  onAddedToToday,
  initialEditProjectId,
  onInitialEditConsumed,
}: {
  onAddedToToday?: () => void;
  initialEditProjectId?: string | null;
  onInitialEditConsumed?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [workName, setWorkName] = useState("");
  const [dueDate, setDueDate] = useState(todayStr());
  const [clientId, setClientId] = useState("");
  const [pxPerDay, setPxPerDay] = useState(DEFAULT_PX_PER_DAY);
  const [viewMode, setViewMode] = useState<ViewMode>("gantt");
  // ガントチャートを開いた際の初期表示位置。「今日」を基準にするか、登録されている
  // 一番古い期日（案件の中で最も早いcreatedAt/dueDate）を基準にするかを選べるようにする
  const [ganttAnchor, setGanttAnchor] = useSetting("projects.ganttAnchor", "today");
  const [editingProject, setEditingProject] = useState<ProjectItem | null>(null);
  const [addToTodayTarget, setAddToTodayTarget] = useState<ProjectItem | null>(null);
  const [stageAddTarget, setStageAddTarget] = useState<{ project: ProjectItem; stage: ProjectStage } | null>(null);
  const [stageAddStartNow, setStageAddStartNow] = useState(false);
  const [completionReport, setCompletionReport] = useState<{
    project: ProjectItem;
    totalSeconds: number;
    recordCount: number;
    daysTaken: number;
    onTime: boolean;
  } | null>(null);
  const [showForm, setShowForm] = useState(true);
  const [showCompleted, setShowCompleted] = useState(false);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importResult, setImportResult] = useState<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const projects = useLiveQuery(() => db.projects.orderBy("dueDate").toArray(), []);
  const records = useLiveQuery(() => db.records.toArray(), []);
  const clients = useLiveQuery(() => db.clients.orderBy("order").toArray(), []);
  const linkedTodoTasksForClients = useLiveQuery(() => db.todoTasks.toArray(), []);
  const clientNameById = useMemo(() => new Map((clients ?? []).map((c) => [c.id, c.name])), [clients]);
  const today = todayStr();

  // 取引先ごとの案件・ToDo・実績時間のまとめ。案件の実績時間は、その取引先に紐づく
  // 案件ID群のいずれかに属する実績(主案件/兼務どちらでも)を合算する
  const clientSummaries = useMemo(() => {
    return (clients ?? []).map((c) => {
      const clientProjects = (projects ?? []).filter((p) => p.clientId === c.id);
      const activeProjects = clientProjects.filter((p) => !p.completedAt);
      const overdueProjectCount = activeProjects.filter((p) => p.dueDate < today).length;
      const clientTodos = (linkedTodoTasksForClients ?? []).filter((t) => t.clientId === c.id);
      const activeTodos = clientTodos.filter((t) => !t.completed);
      const overdueTodoCount = activeTodos.filter((t) => !!t.dueDate && t.dueDate < today).length;
      const projectIds = clientProjects.map((p) => p.id);
      const totalSeconds = (records ?? [])
        .filter((r) => !r.excludedFromStats && projectIds.some((pid) => recordBelongsToProject(r, pid)))
        .reduce((sum, r) => sum + r.seconds, 0);
      return {
        client: c,
        activeProjectCount: activeProjects.length,
        overdueProjectCount,
        activeTodoCount: activeTodos.length,
        overdueTodoCount,
        totalSeconds,
      };
    });
  }, [clients, projects, linkedTodoTasksForClients, records, today]);
  const { themedMode } = useVisualMode();

  // 本日タブの案件バッジの「編集」から遷移してきた場合、該当案件の編集ダイアログを自動的に開く。
  // 開いたら親側の保持値を消費済みにしてもらう(再遷移時の再発火防止)
  useEffect(() => {
    if (!initialEditProjectId || !projects) return;
    const target = projects.find((p) => p.id === initialEditProjectId);
    if (target) {
      setEditingProject(target);
      onInitialEditConsumed?.();
    }
  }, [initialEditProjectId, projects, onInitialEditConsumed]);

  // Todoタブから「案件に反映」された案件は、そのTodoタスク側にprojectIdが立つ。
  // 本日の作業に追加する際、逆引きして元のTodoタスクIDをDailyTask.todoTaskIdに引き継ぐ
  const linkedTodoTasks = useLiveQuery(() => db.todoTasks.toArray(), []);
  const todoTaskIdByProjectId = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of linkedTodoTasks ?? []) {
      if (t.projectId) map.set(t.projectId, t.id);
    }
    return map;
  }, [linkedTodoTasks]);

  const [defaultHourlyRateStr] = useSetting("cost.defaultHourlyRate", "");
  const defaultHourlyRate = Number(defaultHourlyRateStr) > 0 ? Number(defaultHourlyRateStr) : null;
  const [categoryRatesJson] = useSetting("cost.categoryRates", "{}");
  const categoryRates = useMemo(() => parseCategoryRates(categoryRatesJson), [categoryRatesJson]);

  // 案件の概算金額 = (専用単価 ?? カテゴリ別単価 ?? デフォルト単価) × 累計作業時間
  function resolveProjectRate(project: ProjectItem): number | null {
    return project.hourlyRate ?? resolveCategoryRate(project.category, categoryRates, defaultHourlyRate);
  }

  // 案件ごとの累計作業時間（全期間の実績を合算。主案件だけでなく兼務向けの
  // 追加の案件タグ(secondaryProjectIds)がこの案件を含む実績も合算する）
  const projectTotalSeconds = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of records ?? []) {
      const ids = new Set([r.projectId, ...(r.secondaryProjectIds ?? [])].filter((id): id is string => !!id));
      for (const id of ids) map.set(id, (map.get(id) ?? 0) + r.seconds);
    }
    return map;
  }, [records]);

  // 段階ごとの累計作業時間（未完了の段階でも、これまで記録した時間を確認できるようにする）
  const stageSeconds = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of records ?? []) {
      if (!r.projectId || !r.stageId) continue;
      const key = `${r.projectId}::${r.stageId}`;
      map.set(key, (map.get(key) ?? 0) + r.seconds);
    }
    return map;
  }, [records]);

  // 案件ごとに実績が記録されている日数（消化ペースの簡易指標に使う）
  const projectWorkDays = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const r of records ?? []) {
      if (!r.projectId) continue;
      if (!map.has(r.projectId)) map.set(r.projectId, new Set());
      map.get(r.projectId)!.add(r.date);
    }
    return map;
  }, [records]);

  // 見積もり総所要時間が設定されている案件だけ、直近の消化ペースから期日到達予測を算出する
  const projectForecasts = useMemo(() => {
    const map = new Map<string, ProjectForecast>();
    for (const p of projects ?? []) {
      if (p.completedAt) continue;
      const forecast = computeProjectForecast(p, records ?? [], today);
      if (forecast) map.set(p.id, forecast);
    }
    return map;
  }, [projects, records, today]);

  function downloadTemplate() {
    downloadTextFile("projects_template.csv", projectsCsvTemplate());
  }

  function exportCsv() {
    if (!projects) return;
    downloadTextFile(`projects_${todayStr()}.csv`, projectsToCsv(projects));
  }

  async function importCsv(file: File) {
    const text = await file.text();
    const { rows, errors } = parseProjectsCsv(text);
    setImportErrors(errors);
    if (rows.length === 0) {
      setImportResult("");
      return;
    }
    const { created, updated, autoCompleted } = await upsertProjectsFromCsv(rows);
    const autoCompletedText =
      autoCompleted > 0 ? `、${autoCompleted}件を今回のインポートに含まれなかったため自動的に完了にしました` : "";
    setImportResult(`${created}件を新規追加、${updated}件を更新しました${autoCompletedText}。`);
  }

  async function addProject() {
    if (!title.trim() || !category.trim() || !workName.trim() || !dueDate) return;
    const item: ProjectItem = {
      id: uid(),
      title: title.trim(),
      category: category.trim(),
      workName: workName.trim(),
      dueDate,
      clientId: clientId || undefined,
      createdAt: Date.now(),
    };
    await db.projects.add(item);
    setTitle("");
    setCategory("");
    setWorkName("");
    setDueDate(todayStr());
  }

  // 取引先マスタの追加・リネーム・削除。既存の付箋ボード管理(MemoSection)と同じ
  // prompt()ベースの簡易UIにして、専用の画面を増やさず案件タブ内で完結させる
  async function addClient() {
    const name = prompt("取引先名");
    if (!name || !name.trim()) return;
    const order = clients?.length ?? 0;
    await db.clients.add({ id: uid(), name: name.trim(), order, createdAt: Date.now() });
  }
  async function renameClient(client: { id: string; name: string }) {
    const name = prompt("取引先名を変更", client.name);
    if (!name || !name.trim()) return;
    await db.clients.update(client.id, { name: name.trim() });
  }
  async function deleteClient(client: { id: string; name: string }) {
    if (!confirm(`取引先「${client.name}」を削除します。この取引先が付いている案件・ToDoからはタグが外れます。よろしいですか?`)) return;
    await db.transaction("rw", db.clients, db.projects, db.todoTasks, async () => {
      await db.clients.delete(client.id);
      await db.projects.filter((p) => p.clientId === client.id).modify({ clientId: undefined });
      await db.todoTasks.filter((t) => t.clientId === client.id).modify({ clientId: undefined });
    });
  }

  async function deleteProject(item: ProjectItem) {
    await db.projects.delete(item.id);
    showUndoToast(`「${item.title}」を削除しました`, async () => {
      await db.projects.add(item);
    });
  }

  async function toggleComplete(item: ProjectItem) {
    const nowCompleting = !item.completedAt;
    const completedAt = nowCompleting ? Date.now() : undefined;
    await db.projects.update(item.id, { completedAt, autoCompletedByImport: false });
    if (nowCompleting) {
      fireConfetti();
      const projectRecords = (records ?? []).filter((r) => recordBelongsToProject(r, item.id));
      const totalSeconds = projectRecords.reduce((s, r) => s + r.seconds, 0);
      const createdStr = todayStr(new Date(item.createdAt));
      const completedStr = todayStr(new Date(completedAt!));
      setCompletionReport({
        project: item,
        totalSeconds,
        recordCount: projectRecords.length,
        daysTaken: Math.max(1, daysBetweenDateStrs(createdStr, completedStr) + 1),
        onTime: completedStr <= item.dueDate,
      });
    }
  }

  async function addToToday(item: ProjectItem, category: string, workName: string, stageId?: string, startNow = false) {
    const master = await findOrCreateMasterTask(category, workName, 0);
    const estimatedSeconds = await computeRemainingEstimatedSeconds(
      today,
      category,
      workName,
      master.estimatedSeconds
    );
    const todayTasks = await db.dailyTasks.where("date").equals(today).toArray();
    const nowMs = Date.now();
    if (startNow) {
      // 既に計測中の作業があれば、他のテーマ画面の「すぐ開始」系操作と同じく先に一時停止してから始める
      const running = todayTasks.find((t) => t.status === "running");
      if (running) {
        const segments = running.segments.map((s, i) =>
          i === running.segments.length - 1 && s.end === undefined ? { ...s, end: nowMs } : s
        );
        const accumulatedMs = segments.reduce((sum, s) => sum + ((s.end ?? nowMs) - s.start), 0);
        await db.dailyTasks.update(running.id, { segments, status: "paused", accumulatedMs, stoppedAt: nowMs });
      }
    }
    const task: DailyTask = {
      id: uid(),
      date: today,
      order: todayTasks.length,
      masterTaskId: master.id,
      category,
      name: workName,
      estimatedSeconds,
      status: startNow ? "running" : "pending",
      segments: startNow ? [{ start: nowMs }] : [],
      accumulatedMs: 0,
      startedAt: startNow ? nowMs : undefined,
      isSpontaneous: true,
      projectId: item.id,
      stageId,
      todoTaskId: todoTaskIdByProjectId.get(item.id),
    };
    await db.dailyTasks.add(task);
    onAddedToToday?.();
  }

  async function toggleProjectStage(project: ProjectItem, stageId: string) {
    const allStages = project.stages ?? [];
    const idx = allStages.findIndex((s) => s.id === stageId);
    const stage = allStages[idx];
    // 完了にする方向だけ確認する（未完了に戻す操作は誤操作でも実害が小さいため確認しない）。
    // チェックボックスが小さく、段階が多い案件では誤タップしやすいための保険。
    // 前の段階が未完了の場合は、その旨も確認メッセージに含める（依存関係の警告）
    if (stage && !stage.completed) {
      const incompletePrevious = allStages.slice(0, idx).filter((s) => !s.completed);
      const warning =
        incompletePrevious.length > 0
          ? `\n\n⚠ 前の段階「${incompletePrevious.map((s) => s.title).join("」「")}」がまだ完了していません。`
          : "";
      if (!confirm(`「${stage.title}」を完了にしますか?${warning}`)) return;
    }
    const stages = allStages.map((s) =>
      s.id === stageId ? { ...s, completed: !s.completed, completedAt: !s.completed ? Date.now() : undefined } : s
    );
    await db.projects.update(project.id, { stages });
  }

  // 段階を本日の作業に追加する前に、案件の業務区分(大項目)を引き継ぎ、
  // 詳細作業名にはこの段階名がそのまま入ることを明示してから確認する。すぐに開始するかは
  // ダイアログのチェックボックスで選べる
  function addStageToTodayWithConfirm(project: ProjectItem, stage: ProjectStage) {
    setStageAddStartNow(false);
    setStageAddTarget({ project, stage });
  }

  async function confirmStageAddToToday() {
    if (!stageAddTarget) return;
    const { project, stage } = stageAddTarget;
    await addToToday(project, project.category, stage.title, stage.id, stageAddStartNow);
    setStageAddTarget(null);
  }

  const rows = useMemo(() => {
    const list = projects ?? [];
    return list.map((p) => {
      const createdStr = todayStr(new Date(p.createdAt));
      const overdue = !p.completedAt && p.dueDate < today;
      const dueToday = !p.completedAt && p.dueDate === today;
      const daysLeft = daysBetweenDateStrs(today, p.dueDate);
      // 消化ペースの簡易判定: 想定工数が無いため「経過日数のうち何割の日に着手できているか」で代用する
      // (残り日数が僅かなのに、これまでほとんど着手できていない場合に注意を促す)
      const daysElapsed = Math.max(1, daysBetweenDateStrs(createdStr, today) + 1);
      const workDays = projectWorkDays.get(p.id)?.size ?? 0;
      const forecast = projectForecasts.get(p.id);
      // 見積もり総所要時間があれば、実際の消化ペースに基づく予測(forecast)を優先する。
      // 未設定の案件は従来通り「経過日数のうち何割の日に着手できているか」の簡易判定で代用する
      const paceWarning = forecast
        ? forecast.status === "at-risk" || forecast.status === "overdue"
        : !p.completedAt && daysLeft <= 3 && daysLeft >= 0 && workDays / daysElapsed < 0.3;
      return { project: p, createdStr, overdue, dueToday, daysLeft, paceWarning, forecast };
    });
  }, [projects, today, projectWorkDays, projectForecasts]);

  const activeRows = useMemo(() => rows.filter((r) => !r.project.completedAt), [rows]);
  const completedRows = useMemo(() => rows.filter((r) => !!r.project.completedAt), [rows]);

  // ガントチャート・カレンダーは既定で未完了の案件だけを表示する(一覧の「完了済み」欄と同様、
  // デフォルトでは埋もれさせない)。トグルで完了済みも重ねて表示できる
  const [showCompletedInTimeline, setShowCompletedInTimeline] = useState(false);
  const timelineSourceRows = useMemo(
    () => (showCompletedInTimeline ? rows : activeRows),
    [rows, activeRows, showCompletedInTimeline]
  );

  // 系統図ツリー表示: 案件(大)→段階(中)→その段階に紐づく実績(小)のカスケード表示。
  // 段階が無い案件は、案件に直接紐づく実績を子として並べる
  const projectTree = useMemo<TreeNode[]>(() => {
    return timelineSourceRows.map(({ project, overdue, dueToday }) => {
      const stages = project.stages ?? [];
      const projectBadges: TreeNodeBadge[] = [
        { text: formatDateJp(project.dueDate), tone: overdue || dueToday ? "alert" : "muted" },
      ];
      if (project.completedAt) projectBadges.push({ text: "完了", tone: "muted" });

      let children: TreeNode[];
      if (stages.length > 0) {
        children = stages.map((stage) => {
          const stageRecords = (records ?? [])
            .filter((r) => r.projectId === project.id && r.stageId === stage.id)
            .sort((a, b) => b.date.localeCompare(a.date));
          const done = isStageDone(stage);
          const stageOverdue = !done && !!stage.dueDate && stage.dueDate < today;
          const stageBadges: TreeNodeBadge[] = [];
          if (stage.dueDate) stageBadges.push({ text: formatDateJp(stage.dueDate), tone: stageOverdue ? "alert" : "muted" });
          stageBadges.push({ text: done ? "完了" : "未完了", tone: done ? "muted" : "default" });

          const leaves: TreeNode[] = stageRecords.slice(0, TREE_LEAF_LIMIT).map((r) => ({
            id: r.id,
            label: r.name,
            badges: [
              { text: formatDateJp(r.date), tone: "muted" },
              { text: formatHms(r.seconds) },
            ],
          }));
          if (stageRecords.length > TREE_LEAF_LIMIT) {
            leaves.push({ id: `${stage.id}-more`, label: `他${stageRecords.length - TREE_LEAF_LIMIT}件`, badges: [] });
          }

          return {
            id: stage.id,
            label: stage.title,
            emphasis: stageOverdue,
            badges: stageBadges,
            children: leaves,
          };
        });
      } else {
        const directRecords = (records ?? [])
          .filter((r) => r.projectId === project.id && !r.stageId)
          .sort((a, b) => b.date.localeCompare(a.date));
        children = directRecords.slice(0, TREE_LEAF_LIMIT).map((r) => ({
          id: r.id,
          label: r.name,
          badges: [
            { text: formatDateJp(r.date), tone: "muted" },
            { text: formatHms(r.seconds) },
          ],
        }));
        if (directRecords.length > TREE_LEAF_LIMIT) {
          children.push({ id: `${project.id}-more`, label: `他${directRecords.length - TREE_LEAF_LIMIT}件`, badges: [] });
        }
      }

      return {
        id: project.id,
        label: project.title,
        sublabel: project.workName,
        emphasis: overdue,
        badges: projectBadges,
        children,
      };
    });
  }, [timelineSourceRows, records, today]);

  // 「今日」を初期位置にする場合、今日より前の実データ(登録日・期日)が少ないと
  // 中央付近までスクロールできず、常に左端(今日を基準にしなかった場合と同じ位置)に
  // 張り付いてしまう。今日の左側に十分な余白日数を確保しておくためのバッファ。
  // 初期値は控えめにしておき、実際のスクロール領域の幅を見て後述のuseEffectが
  // 必要な分だけ広げる(コンテナ幅に合わせて自動的に収束する)
  const [centeringBufferDays, setCenteringBufferDays] = useState(14);

  // ガントチャートの表示範囲(左端の日付・全体日数、「一番古い期日」の基準位置)は、実際にチャートへ
  // 表示される案件(showCompletedInTimelineの設定に従う)だけを対象に計算する。完了済みを
  // 非表示にしている間は、非表示の完了済み案件の古い期日に範囲や基準位置が引きずられないようにする
  const { rangeStartStr, totalDays, timelineRows } = useMemo(() => {
    let start = today;
    let end = today;
    for (const r of timelineSourceRows) {
      if (r.createdStr < start) start = r.createdStr;
      if (r.project.dueDate < start) start = r.project.dueDate;
      if (r.project.dueDate > end) end = r.project.dueDate;
    }
    if (ganttAnchor === "today") {
      const buffered = todayStr(new Date(new Date(today + "T00:00:00").getTime() - centeringBufferDays * 86400000));
      if (start > buffered) start = buffered;
    }
    end = todayStr(new Date(new Date(end + "T00:00:00").getTime() + 2 * 86400000));
    const total = Math.max(daysBetweenDateStrs(start, end), 1);
    const computedTimelineRows = timelineSourceRows.map((r) => {
      // 登録日(createdAt)が期日より後になっている案件(CSVインポート等で、実際の期日より
      // 後に登録された場合)でも、バーが登録日の位置に潰れて期日側が見えなくなることが
      // ないよう、2つの日付のうち早い方・遅い方でバーの左端・右端を決める
      const a = daysBetweenDateStrs(start, r.createdStr);
      const b = daysBetweenDateStrs(start, r.project.dueDate);
      return { ...r, barStart: Math.min(a, b), barEnd: Math.max(a, b) };
    });
    return { rangeStartStr: start, totalDays: total, timelineRows: computedTimelineRows };
  }, [timelineSourceRows, today, ganttAnchor, centeringBufferDays]);

  const todayIndex = daysBetweenDateStrs(rangeStartStr, today);
  const dayMarks = Array.from({ length: totalDays + 1 }, (_, i) => i);
  const labelStepDays = Math.max(1, Math.ceil(MIN_LABEL_SPACING_PX / pxPerDay));

  function zoomIn() {
    setPxPerDay((v) => Math.min(MAX_PX_PER_DAY, +(v * 1.4).toFixed(2)));
  }
  function zoomOut() {
    setPxPerDay((v) => Math.max(MIN_PX_PER_DAY, +(v / 1.4).toFixed(2)));
  }
  function fitToView() {
    const containerWidth = scrollRef.current?.clientWidth ?? 0;
    if (containerWidth <= 0 || totalDays <= 0) return;
    const fit = Math.max(0, containerWidth - 24) / totalDays;
    setPxPerDay(Math.min(MAX_PX_PER_DAY, Math.max(MIN_PX_PER_DAY, +fit.toFixed(3))));
  }

  // 「今日」を初期位置にする設定の場合、ガントチャート表示時・拡大縮小時に
  // 今日の位置が見える所までスクロールする(「一番古い期日」の場合は既定の左端=0のままにする)。
  // 今日を画面中央に置くために必要な余白日数が現在のバッファより大きい場合は、
  // バッファを広げて再計算させる(コンテナの実幅が分かった時点で1往復だけ調整が入る)
  useEffect(() => {
    if (viewMode !== "gantt") return;
    const el = scrollRef.current;
    if (!el) return;
    if (ganttAnchor !== "today") {
      el.scrollLeft = 0;
      return;
    }
    const neededBufferDays = Math.ceil(el.clientWidth / 2 / pxPerDay) + 1;
    if (neededBufferDays > centeringBufferDays) {
      setCenteringBufferDays(neededBufferDays);
      return;
    }
    el.scrollLeft = Math.max(0, todayIndex * pxPerDay - el.clientWidth / 2);
  }, [viewMode, ganttAnchor, todayIndex, pxPerDay, totalDays, centeringBufferDays]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        <button className="btn-pill-outline text-sm" onClick={downloadTemplate}>
          CSVテンプレート
        </button>
        <button className="btn-pill-outline text-sm" onClick={exportCsv}>
          CSVエクスポート
        </button>
        <button className="btn-pill-outline text-sm" onClick={() => fileInputRef.current?.click()}>
          CSVインポート
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) importCsv(file);
            e.target.value = "";
          }}
        />
      </div>

      {importResult && <p className="text-xs text-cream/70">{importResult}</p>}
      {importErrors.length > 0 && (
        <div className="panel border border-alert/40 p-3 text-xs text-alert">
          {importErrors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}

      <div className="panel p-4">
        <button
          className="flex w-full items-center justify-between text-left"
          onClick={() => setShowForm((v) => !v)}
        >
          <h2 className="font-display text-lg font-bold">案件を登録</h2>
          <span className="text-cream/60">{showForm ? "▼" : "▶"}</span>
        </button>
        {showForm && (
          <div className="mt-2 space-y-2">
            <input
              placeholder="件名"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
            />
            <input
              placeholder="業務区分（大項目）"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
            />
            <input
              placeholder="詳細作業名"
              value={workName}
              onChange={(e) => setWorkName(e.target.value)}
              className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
            />
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-cream/60">期日</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
              />
              <label className="text-xs text-cream/60">取引先</label>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
              >
                <option value="">（なし）</option>
                {(clients ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn-pill text-sm" onClick={addProject}>
              追加
            </button>
          </div>
        )}
      </div>

      <div className="panel p-4">
        <h2 className="mb-2 font-display text-lg font-bold">取引先</h2>
        <div className="flex flex-wrap items-center gap-2">
          {(clients ?? []).map((c) => (
            <span key={c.id} className="flex items-center gap-1 rounded-full border border-cream/20 px-3 py-1.5 text-sm">
              {c.name}
              <button onClick={() => renameClient(c)} className="text-cream/50 hover:text-cream" aria-label={`${c.name}の名前を変更`}>
                ✎
              </button>
              <button onClick={() => deleteClient(c)} className="text-cream/50 hover:text-alert" aria-label={`${c.name}を削除`}>
                ✕
              </button>
            </span>
          ))}
          <button className="btn-pill-outline text-sm" onClick={addClient}>
            + 取引先を追加
          </button>
        </div>
        {(clients ?? []).length === 0 && (
          <p className="mt-2 text-xs text-cream/50">
            取引先を登録すると、案件・ToDoにタグ付けして、取引先ごとの案件数や作業時間をまとめて見られるようになります。
          </p>
        )}
      </div>

      {clientSummaries.length > 0 && (
        <div className="panel p-4">
          <h2 className="mb-2 font-display text-lg font-bold">取引先別サマリー</h2>
          <div className="divide-y divide-cream/10">
            {clientSummaries.map((s) => (
              <div key={s.client.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="font-bold">{s.client.name}</span>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-cream/70">
                  <span>
                    📁 案件 {s.activeProjectCount}件
                    {s.overdueProjectCount > 0 && <span className="ml-1 font-bold text-alert">(期限切れ{s.overdueProjectCount})</span>}
                  </span>
                  <span>
                    ✅ ToDo {s.activeTodoCount}件
                    {s.overdueTodoCount > 0 && <span className="ml-1 font-bold text-alert">(期限切れ{s.overdueTodoCount})</span>}
                  </span>
                  <span>⏱ 実績 {formatHms(s.totalSeconds)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}


      <div className="panel divide-y divide-cream/10">
        {activeRows.map(({ project, overdue, dueToday, daysLeft, paceWarning, forecast }) => (
          <ProjectRow
            key={project.id}
            project={project}
            overdue={overdue}
            dueToday={dueToday}
            daysLeft={daysLeft}
            paceWarning={paceWarning}
            forecast={forecast}
            themedMode={themedMode}
            totalSeconds={projectTotalSeconds.get(project.id) ?? 0}
            hourlyRate={resolveProjectRate(project)}
            clientName={project.clientId ? clientNameById.get(project.clientId) : undefined}
            stageSecondsFor={(stageId) => stageSeconds.get(`${project.id}::${stageId}`) ?? 0}
            onAddToToday={() => setAddToTodayTarget(project)}
            onToggleComplete={() => toggleComplete(project)}
            onEdit={() => setEditingProject(project)}
            onDelete={() => deleteProject(project)}
            onToggleStage={(stageId) => toggleProjectStage(project, stageId)}
            onAddStageToToday={(stage) => addStageToTodayWithConfirm(project, stage)}
          />
        ))}
        {activeRows.length === 0 && completedRows.length === 0 && (
          <p className="px-4 py-6 text-sm text-cream/50">案件はまだ登録されていません。</p>
        )}
        {activeRows.length === 0 && completedRows.length > 0 && (
          <p className="px-4 py-6 text-sm text-cream/50">未完了の案件はありません。</p>
        )}
      </div>

      {completedRows.length > 0 && (
        <div>
          <button
            className="mb-2 text-xs text-cream/50 hover:text-cream/80"
            onClick={() => setShowCompleted((v) => !v)}
          >
            {showCompleted ? "▼" : "▶"} 完了済み（{completedRows.length}）
          </button>
          {showCompleted && (
            <div className="panel divide-y divide-cream/10">
              {completedRows.map(({ project, overdue, daysLeft }) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  overdue={overdue}
                  daysLeft={daysLeft}
                  totalSeconds={projectTotalSeconds.get(project.id) ?? 0}
                  hourlyRate={resolveProjectRate(project)}
                  clientName={project.clientId ? clientNameById.get(project.clientId) : undefined}
                  stageSecondsFor={(stageId) => stageSeconds.get(`${project.id}::${stageId}`) ?? 0}
                  onAddToToday={() => setAddToTodayTarget(project)}
                  onToggleComplete={() => toggleComplete(project)}
                  onEdit={() => setEditingProject(project)}
                  onDelete={() => deleteProject(project)}
                  onToggleStage={(stageId) => toggleProjectStage(project, stageId)}
                  onAddStageToToday={(stage) => addStageToTodayWithConfirm(project, stage)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              className={viewMode === "gantt" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
              onClick={() => setViewMode("gantt")}
            >
              ガントチャート
            </button>
            <button
              className={viewMode === "calendar" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
              onClick={() => setViewMode("calendar")}
            >
              カレンダー
            </button>
            <button
              className={viewMode === "tree" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
              onClick={() => setViewMode("tree")}
            >
              系統図
            </button>
            <label className="ml-2 flex items-center gap-1.5 text-xs text-cream/60">
              <input
                type="checkbox"
                checked={showCompletedInTimeline}
                onChange={(e) => setShowCompletedInTimeline(e.target.checked)}
                className="h-4 w-4 rounded border-cream/30 bg-ink accent-cream"
              />
              完了済みも表示
            </label>
          </div>

          {timelineRows.length === 0 ? (
            <p className="px-1 py-4 text-sm text-cream/50">
              表示する案件がありません（完了済みのみのため。「完了済みも表示」をONにすると見られます）。
            </p>
          ) : viewMode === "calendar" ? (
            <ProjectsCalendarView projects={timelineRows.map((r) => r.project)} today={today} />
          ) : viewMode === "tree" ? (
            <TreeView nodes={projectTree} />
          ) : (
            <>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-base font-bold">期日ガントチャート</h3>
                <div className="flex items-center gap-1">
                  <span className="mr-1 text-xs text-cream/50">初期位置</span>
                  <button
                    className={ganttAnchor === "today" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
                    onClick={() => setGanttAnchor("today")}
                  >
                    今日
                  </button>
                  <button
                    className={ganttAnchor === "oldest" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
                    onClick={() => setGanttAnchor("oldest")}
                  >
                    一番古い期日
                  </button>
                  <span className="mx-1 h-4 border-l border-cream/15" />
                  <button className="btn-pill-outline px-3 py-1.5 text-sm" onClick={zoomOut} aria-label="縮小">
                    －
                  </button>
                  <button className="btn-pill-outline px-3 py-1.5 text-sm" onClick={zoomIn} aria-label="拡大">
                    ＋
                  </button>
                  <button className="btn-pill-outline text-xs" onClick={fitToView}>
                    全体表示
                  </button>
                </div>
              </div>

              <div className="panel flex p-4">
            {/* 固定ラベル列 */}
            <div className="w-28 shrink-0 pr-2 sm:w-40">
              <div className="mb-2 h-6 border-b border-cream/20" />
              {timelineRows.map((r) => (
                <div
                  key={r.project.id}
                  className="flex flex-col justify-center overflow-hidden text-[11px] leading-tight text-cream/70"
                  style={{ height: ROW_H }}
                  title={`${r.project.title} / ${r.project.workName}`}
                >
                  <span className="truncate">{r.project.title}</span>
                  <span className="truncate text-cream/50">{r.project.workName}</span>
                </div>
              ))}
            </div>

            {/* スクロール可能なタイムライン */}
            <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto">
              <div style={{ width: totalDays * pxPerDay + 24 }}>
                <div className="relative mb-2 h-6 border-b border-cream/20 text-xs text-cream/50">
                  {dayMarks
                    .filter((d) => d % labelStepDays === 0)
                    .map((d) => (
                      <div
                        key={d}
                        className="absolute top-0 border-l border-cream/10 pl-1"
                        style={{ left: d * pxPerDay }}
                      >
                        {formatDateJp(
                          todayStr(new Date(new Date(rangeStartStr + "T00:00:00").getTime() + d * 86400000))
                        )}
                      </div>
                    ))}
                </div>

                <div className="relative" style={{ height: timelineRows.length * ROW_H }}>
                  {dayMarks
                    .filter((d) => d % labelStepDays === 0)
                    .map((d) => (
                      <div
                        key={d}
                        className="absolute top-0 bottom-0 border-l border-cream/5"
                        style={{ left: d * pxPerDay }}
                      />
                    ))}
                  {/* 今日の位置 */}
                  <div
                    className="absolute top-0 bottom-0 border-l-2 border-alert/70"
                    style={{ left: todayIndex * pxPerDay }}
                  />
                  {timelineRows.map((r, idx) => {
                    const top = idx * ROW_H;
                    const left = r.barStart * pxPerDay;
                    const width = Math.max((r.barEnd - r.barStart) * pxPerDay, 3);
                    const progressPct = computeProjectProgress(r.project.stages);
                    return (
                      <div key={r.project.id} className="absolute left-0 right-0" style={{ top, height: ROW_H }}>
                        <div
                          className={`absolute rounded ${
                            r.project.completedAt ? "bg-cream/30" : r.overdue ? "bg-alert" : "bg-cream/70"
                          }`}
                          style={{ left, width, top: 9, height: 20 }}
                          title={`${r.project.title} / ${r.project.workName}（期日 ${r.project.dueDate}）`}
                        />
                        {progressPct !== null && (
                          <div
                            className="absolute rounded bg-cream/10"
                            style={{ left, width, top: 31, height: 4 }}
                            title={`進捗 ${Math.round(progressPct * 100)}%`}
                          >
                            <div
                              className="h-full rounded bg-alert"
                              style={{ width: `${Math.max(progressPct * 100, progressPct > 0 ? 4 : 0)}%` }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
              </div>
              <p className="mt-2 text-xs text-cream/40">赤い縦線が本日の位置です。バーは登録日から期日までの猶予を表します。</p>
            </>
          )}
        </div>
      )}

      {editingProject && <EditProjectDialog project={editingProject} onClose={() => setEditingProject(null)} />}

      {addToTodayTarget && (
        <CategoryWorkNameDialog
          title="本日の作業に追加"
          confirmLabel="追加する"
          defaultCategory={addToTodayTarget.category || addToTodayTarget.title}
          defaultWorkName={addToTodayTarget.workName}
          toggleLabel="追加してすぐ開始する"
          onConfirm={(category, workName, startNow) => {
            addToToday(addToTodayTarget, category, workName, undefined, startNow);
            setAddToTodayTarget(null);
          }}
          onClose={() => setAddToTodayTarget(null)}
        />
      )}

      {stageAddTarget && (
        <Modal title="本日の作業に追加" onClose={() => setStageAddTarget(null)}>
          <div className="space-y-3 text-sm">
            <p className="text-cream/70">
              業務区分（大項目）: <span className="font-bold text-cream">{stageAddTarget.project.category || stageAddTarget.project.title}</span>
              <br />
              詳細作業名: <span className="font-bold text-cream">{stageAddTarget.stage.title}</span>
              {stageAddTarget.stage.targetCount != null && (
                <>
                  <br />
                  件数: {stageAddTarget.stage.completedCount ?? 0}/{stageAddTarget.stage.targetCount}件（完了時に1件進みます）
                </>
              )}
            </p>
            <label className="flex items-center gap-1.5 text-xs text-cream/70">
              <input
                type="checkbox"
                checked={stageAddStartNow}
                onChange={(e) => setStageAddStartNow(e.target.checked)}
                className="h-4 w-4 rounded border-cream/30 bg-ink accent-cream"
              />
              追加してすぐ開始する
            </label>
            <button className="btn-pill w-full text-sm" onClick={confirmStageAddToToday}>
              追加する
            </button>
          </div>
        </Modal>
      )}

      {completionReport && (
        <Modal title="🎉 案件完了レポート" onClose={() => setCompletionReport(null)}>
          <div className="space-y-3 text-sm">
            <div>
              <div className="text-xs text-cream/50">
                {completionReport.project.title}
                {completionReport.project.category && (
                  <span className="ml-2 text-cream/40">［{completionReport.project.category}］</span>
                )}
              </div>
              <div className="font-display text-base font-bold text-cream">{completionReport.project.workName}</div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-ink px-3 py-2">
                <div className="text-[10px] text-cream/40">累計作業時間</div>
                <div className="font-display text-lg font-bold tabular-nums text-cream">
                  {formatHms(completionReport.totalSeconds)}
                </div>
              </div>
              <div className="rounded-lg bg-ink px-3 py-2">
                <div className="text-[10px] text-cream/40">着手から完了まで</div>
                <div className="font-display text-lg font-bold tabular-nums text-cream">
                  {completionReport.daysTaken}日
                </div>
              </div>
              <div className="rounded-lg bg-ink px-3 py-2">
                <div className="text-[10px] text-cream/40">作業記録件数</div>
                <div className="font-display text-lg font-bold tabular-nums text-cream">
                  {completionReport.recordCount}件
                </div>
              </div>
              <div className="rounded-lg bg-ink px-3 py-2">
                <div className="text-[10px] text-cream/40">期日</div>
                <div className={`font-display text-lg font-bold ${completionReport.onTime ? "text-cream" : "text-alert"}`}>
                  {completionReport.onTime ? "期日内" : "期日超過"}
                </div>
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button className="btn-pill text-sm" onClick={() => setCompletionReport(null)}>
              閉じる
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ProjectRow({
  project,
  overdue,
  dueToday,
  daysLeft,
  paceWarning,
  forecast,
  totalSeconds,
  hourlyRate,
  clientName,
  stageSecondsFor,
  onAddToToday,
  onToggleComplete,
  onEdit,
  onDelete,
  onToggleStage,
  onAddStageToToday,
  themedMode,
}: {
  project: ProjectItem;
  overdue: boolean;
  dueToday?: boolean;
  daysLeft: number;
  paceWarning?: boolean;
  forecast?: ProjectForecast;
  totalSeconds: number;
  hourlyRate: number | null;
  clientName?: string;
  stageSecondsFor: (stageId: string) => number;
  onAddToToday: () => void;
  onToggleComplete: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleStage: (stageId: string) => void;
  onAddStageToToday: (stage: ProjectStage) => void;
  themedMode?: ThemedMode | null;
}) {
  const today = todayStr();
  const [showCompletedStagesStr] = useSetting("projects.showCompletedStages", "true");
  const showCompletedStages = showCompletedStagesStr === "true";
  const [stagesCollapsed, setStagesCollapsed] = useState(false);
  // 進捗率・段階数の表示は全段階を対象にする一方、ここでの一覧描画だけ設定に応じて完了済みを間引く
  const visibleStages = showCompletedStages ? project.stages ?? [] : (project.stages ?? []).filter((s) => !isStageDone(s));
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 ${project.completedAt ? "opacity-50" : ""} ${
        overdue
          ? themedMode
            ? cardOverrunClass(themedMode)
            : "ring-1 ring-alert/40"
          : dueToday
            ? "ring-1 ring-alert/50"
            : ""
      }`}
    >
      <div>
        <div className="text-xs text-cream/50">
          {project.title}
          {project.category && <span className="ml-2 text-cream/40">［{project.category}］</span>}
          {clientName && (
            <span className="ml-2 rounded-full border border-cream/20 px-1.5 py-0.5 text-[10px] text-cream/60">🏢 {clientName}</span>
          )}
        </div>
        <div className="text-sm text-cream">{project.workName}</div>
        <div className={`text-xs ${overdue || dueToday ? "font-bold text-alert" : "text-cream/60"}`}>
          期日 {project.dueDate}{" "}
          {project.completedAt
            ? "（完了）"
            : overdue
              ? `（${-daysLeft}日超過）`
              : dueToday
                ? "（本日期限）"
                : `（残り${daysLeft}日）`}
          {dueToday && (
            <span className="ml-1 rounded-full bg-alert/20 px-1.5 py-0.5 text-[9px] font-bold text-alert">本日</span>
          )}
        </div>
        {forecast ? (
          <div
            className={`text-xs ${
              forecast.status === "at-risk" || forecast.status === "overdue" ? "font-bold text-alert" : "text-cream/60"
            }`}
            title="見積もり総所要時間と、直近14日間の消化ペースから算出した納期到達予測です"
          >
            {forecast.status === "done" && "✅ 見積もり時間分は消化済みです"}
            {forecast.status === "overdue" && `🔴 期日超過（残り見積もり ${formatHms(forecast.remainingSeconds)}）`}
            {forecast.status === "no-recent-pace" &&
              `😴 直近14日間この案件に未着手（残り見積もり ${formatHms(forecast.remainingSeconds)}）`}
            {forecast.status === "on-track" &&
              forecast.projectedDaysNeeded !== null &&
              `🎯 順調（今のペースならあと約${Math.ceil(forecast.projectedDaysNeeded)}日で完了見込み・残り${formatHms(forecast.remainingSeconds)}）`}
            {forecast.status === "at-risk" &&
              forecast.projectedDaysNeeded !== null &&
              `⚠ 遅延の恐れ（今のペースだと完了まで約${Math.ceil(forecast.projectedDaysNeeded)}日かかる見込み。残り${formatHms(forecast.remainingSeconds)}${
                forecast.requiredPaceSecondsPerDay
                  ? `・間に合わせるには1日あたり${formatHms(forecast.requiredPaceSecondsPerDay)}必要`
                  : ""
              }）`}
          </div>
        ) : (
          paceWarning && (
            <div className="text-xs font-bold text-alert" title="残り日数が少ないですが、これまであまり着手できていないようです">
              ⚠ ペースに遅れの可能性
            </div>
          )
        )}
        {project.stages && project.stages.length > 0 && (
          <div className="mt-1 max-w-[220px]">
            <button
              type="button"
              onClick={() => setStagesCollapsed((c) => !c)}
              className="mb-0.5 flex w-full items-center justify-between text-[10px] text-cream/50"
              aria-expanded={!stagesCollapsed}
              aria-label={stagesCollapsed ? "段階リストを展開" : "段階リストを折りたたむ"}
            >
              <span className="flex items-center gap-1">
                <span className={`inline-block transition-transform ${stagesCollapsed ? "-rotate-90" : ""}`}>▾</span>
                進捗 {project.stages.length}段階
              </span>
              <span className="font-bold tabular-nums text-cream/70">
                {Math.round((computeProjectProgress(project.stages) ?? 0) * 100)}%
              </span>
            </button>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-cream/5">
              <div
                className="h-1.5 rounded-full bg-cream"
                style={{
                  width: `${Math.round((computeProjectProgress(project.stages) ?? 0) * 100)}%`,
                }}
              />
            </div>
            {!stagesCollapsed && (
              <div className="mt-1.5 space-y-1">
                {!showCompletedStages && visibleStages.length < project.stages.length && (
                  <div className="text-[10px] text-cream/30">
                    完了済み{project.stages.length - visibleStages.length}段階を非表示中
                  </div>
                )}
                {visibleStages.map((stage) => {
                const seconds = stageSecondsFor(stage.id);
                const isCountBased = stage.targetCount != null;
                const done = isStageDone(stage);
                const stageOverdue = !done && !!stage.dueDate && stage.dueDate < today;
                const stageDueToday = !done && !!stage.dueDate && stage.dueDate === today;
                return (
                  <div
                    key={stage.id}
                    className={`flex items-center gap-1.5 rounded ${
                      stageOverdue
                        ? themedMode
                          ? `${cardOverrunClass(themedMode)} bg-alert/10`
                          : "bg-alert/10 ring-1 ring-alert/40"
                        : stageDueToday
                          ? "bg-alert/10 ring-1 ring-alert/40"
                          : ""
                    }`}
                  >
                    {isCountBased ? (
                      <span
                        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border text-[8px] ${
                          done ? "border-cream bg-cream text-ink" : "border-cream/40"
                        }`}
                      >
                        {done ? "✓" : ""}
                      </span>
                    ) : (
                      <button
                        onClick={() => onToggleStage(stage.id)}
                        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border text-[8px] ${
                          stage.completed ? "border-cream bg-cream text-ink" : "border-cream/40"
                        }`}
                        aria-label={stage.completed ? "未完了に戻す" : "完了にする"}
                      >
                        {stage.completed ? "✓" : ""}
                      </button>
                    )}
                    <span className={`flex-1 truncate text-[11px] ${done ? "text-cream/40 line-through" : "text-cream/80"}`}>
                      {stage.title}
                    </span>
                    {isCountBased && (
                      <span className="shrink-0 text-[10px] font-bold tabular-nums text-cream/70">
                        {stage.completedCount ?? 0}/{stage.targetCount}件
                      </span>
                    )}
                    {seconds > 0 && (
                      <span
                        className="shrink-0 text-[10px] tabular-nums text-cream/40"
                        title={done ? "この段階に費やした累計作業時間" : "この段階にこれまで費やした作業時間（未完了）"}
                      >
                        {formatHms(seconds)}
                      </span>
                    )}
                    {stage.dueDate && (
                      <span
                        className={`shrink-0 text-[10px] ${
                          stageOverdue || stageDueToday ? "font-bold text-alert" : "text-cream/40"
                        }`}
                      >
                        {stageOverdue && "⚠ "}
                        {stage.dueDate}
                        {stageDueToday && (
                          <span className="ml-1 rounded-full bg-alert/20 px-1 py-0.5 text-[9px] font-bold text-alert">
                            本日
                          </span>
                        )}
                      </span>
                    )}
                    <button
                      onClick={() => onAddStageToToday(stage)}
                      className="btn-pill-outline shrink-0 px-2.5 py-1 text-xs"
                      title="この段階を本日の作業に追加"
                    >
                      ＋本日
                    </button>
                  </div>
                );
              })}
              </div>
            )}
          </div>
        )}
        {totalSeconds > 0 && (
          <div className="text-xs text-cream/70">
            累計作業時間 <span className="font-bold tabular-nums text-cream">{formatHms(totalSeconds)}</span>
            {hourlyRate !== null && (
              <span className="ml-2 text-cream/50">
                （概算 <span className="font-bold text-cream/80">{formatYen(computeCost(totalSeconds, hourlyRate))}</span>）
              </span>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button className="btn-pill-outline text-xs" onClick={onAddToToday}>
          本日の作業に追加
        </button>
        <button className="btn-pill-outline text-xs" onClick={onToggleComplete}>
          {project.completedAt ? "未完了に戻す" : "完了"}
        </button>
        <button className="text-xs text-cream/60 hover:text-cream" onClick={onEdit}>
          編集
        </button>
        <button className="text-xs text-alert" onClick={onDelete}>
          削除
        </button>
      </div>
    </div>
  );
}
