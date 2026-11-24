"use client";

import { TRASH_ALREADY_RESTORED_MESSAGE } from "@/lib/trash";
import { readTextFile } from "@/lib/csv";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import {
  DEFAULT_PROJECT_CATEGORY,
  deleteProjectCascade,
  duplicateProject,
  findOriginTodo,
  projectCategoryFor,
  recordBelongsToProject,
  setProjectCompleted,
  upsertProjectsFromCsv,
} from "@/lib/projects";
import { addProjectToToday } from "@/lib/progressActions";
import { projectsToCsv, projectsCsvTemplate, parseProjectsCsv } from "@/lib/projectsCsv";
import { downloadTextFile } from "@/lib/report";
import { computeCost, formatYen, parseCategoryRates, resolveCategoryRate } from "@/lib/cost";
import { computeProjectForecast, type ProjectForecast } from "@/lib/projectForecast";
import { computeStagePaceForecast, type StagePaceForecast } from "@/lib/stageProgress";
import { placeProjectOnBoard, removeProjectFromBoard } from "@/lib/boardPlacement";
import {
  buildStageCompletionOrder,
  computeProjectProgress,
  effectiveProjectTag,
  incompletePreviousStageTitles,
  isStageDone,
  openStageTitles,
  toggleProjectStage as toggleProjectStageShared,
} from "@/lib/projectStage";
import { ProjectCascadeDialog, type ProjectCascade } from "@/components/sections/today/LinkedCompletionDialog";
import { summarizePostpones, waitingInfo } from "@/lib/changeTracking";
import { projectWaitingInfo } from "@/lib/waiting";
import { useWaitingSettings } from "@/lib/waitingSettings";
import { useSetting } from "@/lib/settings";
import { DEFAULT_TAG_PRESETS, normalizeUrl, parsePresetList } from "@/lib/todo";
import { cardOverrunClass, useVisualMode, type ThemedMode } from "@/lib/theme";
import {
  daysBetweenDateStrs,
  formatDateJp,
  formatDateShortJp,
  formatDateTimeJp,
  formatHms,
  todayStr,
  shiftDateStr,
} from "@/lib/time";
import type { ProjectItem, ProjectStage } from "@/lib/types";
import ProjectsCalendarView from "@/components/sections/ProjectsCalendarView";
import EditProjectDialog from "@/components/sections/EditProjectDialog";
import CategoryWorkNameDialog from "@/components/sections/CategoryWorkNameDialog";
import ProjectAnalysisDialog from "@/components/sections/ProjectAnalysisDialog";
import WbsDialog from "@/components/sections/WbsDialog";
import ProjectTemplateDialog from "@/components/sections/ProjectTemplateDialog";
import RetrospectiveInput from "@/components/sections/RetrospectiveInput";
import ProjectPPMChart from "@/components/sections/ProjectPPMChart";
import ProgressSyncModal from "@/components/ProgressSyncModal";
import { ProjectClimbPanel, WaitingHourglassPanel } from "@/components/viz/PlanningViz";
import ProjectProgressChart from "@/components/sections/ProjectProgressChart";
import StageDueDensityModal from "@/components/sections/StageDueDensityModal";
import WeeklyReviewModal from "@/components/WeeklyReviewModal";
import Modal from "@/components/ui/Modal";
import TreeView, { type TreeNode, type TreeNodeBadge } from "@/components/ui/TreeView";
import { showUndoToast } from "@/lib/toast";
import { fireConfetti } from "@/lib/confetti";
import { foafNumberOf } from "@/lib/hayarigami";
import { wordsFor as hayarigamiWordsFor } from "@/lib/hayarigamiWords";
import SceneCanvas from "@/components/hayarigami/SceneCanvas";
import BranchTree from "@/components/hayarigami/BranchTree";
import type { BranchNode } from "@/lib/hayarigamiArt";
import { buildPennant, buildStandings } from "@/lib/powerpro";
import { buildRoute, gradeOf } from "@/lib/mountain";
import { mountainWordsFor } from "@/lib/mountainWords";
import { Profile as MountainProfile, Signboard } from "@/components/mountain/MountainCanvas";
import { powerproWordsFor } from "@/lib/powerproWords";
import { PennantBar, Standings } from "@/components/powerpro/PowerproCanvas";
import EmptyArt from "@/components/ui/EmptyArt";
import { IconLabel } from "@/components/ui/Icon";
import { isSubmitEnter } from "@/lib/keyboard";
import { useToday } from "@/lib/useToday";
import { dueLabel, parseCompose } from "@/lib/claudeCompose";

// 案件を新しく登録するときの期日の初期値(今日から何日後か)
const NEW_PROJECT_DUE_DAYS = 7;

const VIEW_MODES = ["gantt", "calendar", "tree", "ppm", "progress"] as const;
type ViewMode = (typeof VIEW_MODES)[number];
const TREE_LEAF_LIMIT = 15;

const DEFAULT_PX_PER_DAY = 28;
const MIN_PX_PER_DAY = 0.3;
const MAX_PX_PER_DAY = 80;
const ROW_H = 40;
const MIN_LABEL_SPACING_PX = 50;

// SWOT/クロスSWOT/BSC/3Cのいずれかに1文字でも入力があるか(一覧のバッジ表示・
// 完了レポートへの反映可否の判定に使う)
function hasAnalysisContent(project: ProjectItem): boolean {
  const groups = [project.swot, project.crossSwot, project.bsc, project.threeC];
  return groups.some((g) => g && Object.values(g).some((v) => v.trim() !== ""));
}

// 完了レポートに載せる、非空欄の項目だけを抜き出した{ラベル: 本文}のフラットな一覧
function analysisSummaryEntries(project: ProjectItem): { label: string; text: string }[] {
  const entries: { label: string; text: string }[] = [];
  const pushGroup = (group: Record<string, string> | undefined, labels: Record<string, string>) => {
    if (!group) return;
    for (const key of Object.keys(labels)) {
      const text = group[key]?.trim();
      if (text) entries.push({ label: labels[key], text });
    }
  };
  pushGroup(project.swot, { strengths: "強み", weaknesses: "弱み", opportunities: "機会", threats: "脅威" });
  pushGroup(project.crossSwot, {
    aggressive: "積極戦略",
    differentiation: "差別化戦略",
    improvement: "改善戦略",
    defensive: "専守・撤退戦略",
  });
  pushGroup(project.bsc, { financial: "財務の視点", customer: "顧客の視点", process: "内部プロセスの視点", growth: "学習と成長の視点" });
  pushGroup(project.threeC, { customer: "3C: 顧客", competitor: "3C: 競合", company: "3C: 自社" });
  return entries;
}

export default function ProjectsSection({
  onAddedToToday,
  initialEditProjectId,
  onInitialEditConsumed,
}: {
  // startedNow: 「すぐに開始する」を選んで追加された場合はtrue。呼び出し元が
  // 「本日の作業」タブへ切り替える際、実行中の一覧をすぐ見せるかどうかの判断に使う
  onAddedToToday?: (startedNow: boolean) => void;
  initialEditProjectId?: string | null;
  onInitialEditConsumed?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [groupName, setGroupName] = useState("");
  const [category, setCategory] = useState("");
  const [workName, setWorkName] = useState("");
  // 期日の初期値は1週間後。今日にしておくと、登録した瞬間から「本日期限」扱いになり
  // 毎回直す手間がかかっていた
  const [dueDate, setDueDate] = useState(() => shiftDateStr(todayStr(), NEW_PROJECT_DUE_DAYS));
  const [clientId, setClientId] = useState("");
  const [pxPerDay, setPxPerDay] = useState(DEFAULT_PX_PER_DAY);
  // 表示の切替(ガント・カレンダー等)は次に開いた時も保つ
  const [viewModeStr, setViewModeStr] = useSetting("projects.viewMode", "gantt");
  const viewMode: ViewMode = (VIEW_MODES as readonly string[]).includes(viewModeStr) ? (viewModeStr as ViewMode) : "gantt";
  const setViewMode = (v: ViewMode) => setViewModeStr(v);
  // ガントチャートを開いた際の初期表示位置。「今日」を基準にするか、登録されている
  // 一番古い期日（案件の中で最も早いcreatedAt/dueDate）を基準にするかを選べるようにする
  const [ganttAnchor, setGanttAnchor] = useSetting("projects.ganttAnchor", "today");
  const [showCsvToolsStr] = useSetting("csvTools.projects", "true");
  const showCsvTools = showCsvToolsStr === "true";
  const [showProgressSync, setShowProgressSync] = useState(false);
  // 完了済み段階の表示切替。設定タブと同じキーを読み書きしているので、どちらで切り替えても
  // 状態は共通で、リロードしても保たれる。段階の確認は案件タブでするものなので、
  // 設定タブまで行かずにここで直接ひっくり返せるようにしてある
  const [showCompletedStagesStr, setShowCompletedStagesStr] = useSetting("projects.showCompletedStages", "true");
  const showCompletedStages = showCompletedStagesStr === "true";
  // 案件・段階の対応状況は、ToDoで使っている選択肢をそのまま共有する
  // (社内確認中・客先確認中 など、同じ語彙で揃えたいため)
  const [tagPresetsStr] = useSetting("todo.tagPresets", JSON.stringify(DEFAULT_TAG_PRESETS));
  const tagOptions = parsePresetList(tagPresetsStr);
  const [editingProject, setEditingProject] = useState<ProjectItem | null>(null);
  const [analysisProject, setAnalysisProject] = useState<ProjectItem | null>(null);
  const [wbsProject, setWbsProject] = useState<ProjectItem | null>(null);
  // 「型にして新しく作る」の元にする案件
  const [templateSource, setTemplateSource] = useState<ProjectItem | null>(null);
  const [stageCompleteConfirm, setStageCompleteConfirm] = useState<{ project: ProjectItem; stageId: string } | null>(
    null
  );
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
  // 案件一覧が主役のタブなのに、フォームが毎回一覧より先に全展開されると
  // スクロール量が増えるだけなので、既定では畳んでおく
  const [showForm, setShowForm] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  // 取引先の登録・編集も毎日は触らないため、フォームと同じく既定では畳んでおく
  const [showClients, setShowClients] = useState(false);
  const [showWeeklyReview, setShowWeeklyReview] = useState(false);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importResult, setImportResult] = useState<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const projects = useLiveQuery(() => db.projects.orderBy("dueDate").toArray(), []);
  const records = useLiveQuery(() => db.records.toArray(), []);
  const clients = useLiveQuery(() => db.clients.orderBy("order").toArray(), []);
  const linkedTodoTasksForClients = useLiveQuery(() => db.todoTasks.toArray(), []);
  const clientNameById = useMemo(() => new Map((clients ?? []).map((c) => [c.id, c.name])), [clients]);
  const today = useToday();
  // 件名に「金曜まで」などの期限の言葉があれば、期日として受け取り件名から外す。
  // 分類(@)や見込み時間も読まれてしまう書き方の時は、件名を変えないよう受け取らない
  // 「明日葉プロジェクト」「水曜会議の準備」のように読み違えることがあるので、「期日として読まない」で外せる
  const [ignoreTitleDue, setIgnoreTitleDue] = useState(false);
  const parsedTitleDue = useMemo(() => {
    const r = parseCompose(title, today);
    if (!r.dueDate || !r.title || r.category || r.estimateMin != null || r.important) return null;
    return { dueDate: r.dueDate, title: r.title };
  }, [title, today]);
  const titleDue = ignoreTitleDue ? null : parsedTitleDue;

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
  // 既存で使われているグループ名の一覧(入力候補用)。表記ゆれで別グループに
  // なってしまわないよう、入力欄のdatalistで既存のものを選びやすくする
  const groupNames = useMemo(() => {
    const set = new Set<string>();
    for (const p of projects ?? []) {
      if (p.groupName) set.add(p.groupName);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ja"));
  }, [projects]);

  // グループごとの案件・進捗のまとめ。取引先別サマリーと同じ考え方で、
  // 同じグループ名の案件をまとめて件数・期限切れ・進捗(段階の完了率)・実績時間を見せる
  const groupSummaries = useMemo(() => {
    return groupNames.map((name) => {
      const groupProjects = (projects ?? []).filter((p) => p.groupName === name);
      const activeProjects = groupProjects.filter((p) => !p.completedAt);
      const overdueProjectCount = activeProjects.filter((p) => p.dueDate < today).length;
      const projectIds = groupProjects.map((p) => p.id);
      const totalSeconds = (records ?? [])
        .filter((r) => !r.excludedFromStats && projectIds.some((pid) => recordBelongsToProject(r, pid)))
        .reduce((sum, r) => sum + r.seconds, 0);
      // 進捗は、グループ内の全案件が持つ段階を合わせて「完了段階数 / 全段階数」で見る。
      // 段階を1つも持たない案件だけのグループでは、案件自体の完了/未完了で代用する
      const allStages = groupProjects.flatMap((p) => p.stages ?? []);
      const progressPct =
        allStages.length > 0
          ? Math.round((allStages.filter(isStageDone).length / allStages.length) * 100)
          : groupProjects.length > 0
            ? Math.round((groupProjects.filter((p) => !!p.completedAt).length / groupProjects.length) * 100)
            : 0;
      return {
        name,
        projectCount: groupProjects.length,
        activeProjectCount: activeProjects.length,
        overdueProjectCount,
        totalSeconds,
        progressPct,
      };
    });
  }, [groupNames, projects, records, today]);

  const { themedMode, wordingEnabled } = useVisualMode();

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

  // 元のToDo(案件に反映したToDo)の紐付けは lib/progressActions.ts の addProjectToToday が行う

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
  // 取引先別・グループ別のまとめと同じく、集計から除外した実績(excludedFromStats)は数えない
  const projectTotalSeconds = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of records ?? []) {
      if (r.excludedFromStats) continue;
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
    const text = await readTextFile(file);
    const { rows, errors } = parseProjectsCsv(text);
    setImportErrors(errors);
    if (rows.length === 0) {
      setImportResult("");
      return;
    }
    const { created, updated, autoCompleted, autoCompletedTitles } = await upsertProjectsFromCsv(rows);
    // どの案件が完了になったのか分かるよう、件名も添える(多い時は先頭の5件)
    const titles = autoCompletedTitles.slice(0, 5).map((t) => `「${t}」`).join("");
    const autoCompletedText =
      autoCompleted > 0
        ? `、${autoCompleted}件を今回のインポートに含まれなかったため自動的に完了にしました（${titles}${autoCompletedTitles.length > 5 ? " ほか" : ""}）`
        : "";
    setImportResult(`${created}件を新規追加、${updated}件を更新しました${autoCompletedText}。`);
  }

  async function addProject() {
    if (!title.trim() || !workName.trim() || !dueDate) return;
    const item: ProjectItem = {
      id: uid(),
      title: titleDue ? titleDue.title : title.trim(),
      groupName: groupName.trim() || undefined,
      // 業務区分を空のまま登録したら既定の区分にする(Claudeのワークスペースと同じ)
      category: category.trim() || DEFAULT_PROJECT_CATEGORY,
      workName: workName.trim(),
      dueDate: titleDue ? titleDue.dueDate : dueDate,
      clientId: clientId || undefined,
      createdAt: Date.now(),
    };
    await db.projects.add(item);
    setTitle("");
    setIgnoreTitleDue(false);
    setGroupName("");
    setCategory("");
    setWorkName("");
    setDueDate(shiftDateStr(todayStr(), NEW_PROJECT_DUE_DAYS));
    // 登録した案件は一覧の下の方に入るため、登録できたことが画面上で分からなかった
    showUndoToast(`案件「${item.title}」を登録しました（期日 ${item.dueDate}）`, async () => {
      await db.projects.delete(item.id);
    });
  }

  // 取引先マスタの追加・リネーム・削除。専用の画面は増やさず、名前を1つ入れる小さな窓だけで
  // 案件タブ内で完結させる(以前のprompt()はスマホのPWAで出ないことがあったため窓に置き換えた)
  const [clientDialog, setClientDialog] = useState<{ kind: "add" } | { kind: "rename"; id: string; current: string } | null>(null);
  async function submitClientDialog(name: string) {
    const d = clientDialog;
    setClientDialog(null);
    if (!d) return;
    if (d.kind === "add") {
      const order = clients?.length ?? 0;
      await db.clients.add({ id: uid(), name, order, createdAt: Date.now() });
    } else {
      await db.clients.update(d.id, { name });
    }
  }
  async function deleteClient(client: { id: string; name: string }) {
    // 確認は出さずに消し、外したタグの付け先を控えておいて「元に戻す」で取引先ごと戻せるようにする
    const removed = await db.clients.get(client.id);
    if (!removed) return;
    const { projectIds, todoIds } = await db.transaction("rw", db.clients, db.projects, db.todoTasks, async () => {
      const projectIds = await db.projects.filter((p) => p.clientId === client.id).primaryKeys();
      const todoIds = await db.todoTasks.filter((t) => t.clientId === client.id).primaryKeys();
      await db.clients.delete(client.id);
      await db.projects.where("id").anyOf(projectIds).modify({ clientId: undefined });
      await db.todoTasks.where("id").anyOf(todoIds).modify({ clientId: undefined });
      return { projectIds, todoIds };
    });
    showUndoToast(`取引先「${removed.name}」を削除しました`, async () => {
      await db.transaction("rw", db.clients, db.projects, db.todoTasks, async () => {
        if (!(await db.clients.get(removed.id))) await db.clients.add(removed);
        // 消したあとで別の取引先を付け直した案件・ToDoはそのままにし、タグが外れたままのものだけ戻す
        await db.projects.where("id").anyOf(projectIds).filter((p) => !p.clientId).modify({ clientId: removed.id });
        await db.todoTasks.where("id").anyOf(todoIds).filter((t) => !t.clientId).modify({ clientId: removed.id });
      });
    });
  }

  async function deleteProject(item: ProjectItem) {
    // WBS・ToDoの紐づけ・先行案件の参照もまとめて外し、「元に戻す」で全部戻す(lib/projects.ts)
    const deletion = await deleteProjectCascade(item.id);
    if (!deletion) return;
    showUndoToast(`「${item.title}」を削除しました`, async () => {
      // ゴミ箱から既に戻していたら何もしない
      if (!(await deletion.undo())) showUndoToast(TRASH_ALREADY_RESTORED_MESSAGE);
    });
  }

  // 複製: 段階・対応状況・URL・取引先を写す(実績は写さない)。WBSがあれば写すかを尋ねる
  const [duplicateTarget, setDuplicateTarget] = useState<{ project: ProjectItem; wbsCount: number } | null>(null);
  async function requestDuplicate(item: ProjectItem) {
    const wbsCount = await db.wbsNodes.where("projectId").equals(item.id).count();
    if (wbsCount > 0) {
      setDuplicateTarget({ project: item, wbsCount });
      return;
    }
    await doDuplicate(item, false);
  }
  async function doDuplicate(item: ProjectItem, withWbs: boolean) {
    setDuplicateTarget(null);
    const copy = await duplicateProject(item.id, { withWbs });
    if (!copy) return;
    showUndoToast(`「${item.title}」を複製しました（期日 ${copy.dueDate}）`, async () => {
      // 複製のあとで手を入れていなければ消す(WBSも一緒に)
      await db.transaction("rw", db.projects, db.wbsNodes, async () => {
        const cur = await db.projects.get(copy.id);
        if (!cur || JSON.stringify(cur.stages ?? []) !== JSON.stringify(copy.stages ?? []) || cur.title !== copy.title) return;
        await db.projects.delete(copy.id);
        await db.wbsNodes.where("projectId").equals(copy.id).delete();
      });
    });
  }

  async function setProjectTag(item: ProjectItem, value: string) {
    await db.projects.update(item.id, { tag: value || undefined });
  }

  // アーカイブ: 削除と違いデータは残したまま、通常の一覧・ガント・カレンダー等から外す。
  // まだ完了していない案件は、見えなくなって期日を落とさないよう先に尋ねる
  const [archiveConfirm, setArchiveConfirm] = useState<ProjectItem | null>(null);
  function toggleArchiveProject(item: ProjectItem) {
    if (!item.archived && !item.completedAt) {
      setArchiveConfirm(item);
      return;
    }
    void setArchived(item, !item.archived);
  }
  async function setArchived(item: ProjectItem, next: boolean) {
    setArchiveConfirm(null);
    await db.projects.update(item.id, { archived: next || undefined });
    showUndoToast(next ? `「${item.title}」をアーカイブしました` : `「${item.title}」のアーカイブを解除しました`, async () => {
      const cur = await db.projects.get(item.id);
      if (!cur || !!cur.archived !== next) return;
      await db.projects.update(item.id, { archived: !next || undefined });
    });
  }

  // 完了まわりの続きの確認(未完了の段階がある・全段階が済んだ・元のToDoも完了にするか)
  const [cascade, setCascade] = useState<ProjectCascade | null>(null);

  async function toggleComplete(item: ProjectItem) {
    if (!item.completedAt) {
      // 未完了の段階が残っていれば、完了にする前に知らせる
      if (openStageTitles(item).length > 0) {
        setCascade({ step: "openStages", projectId: item.id });
        return;
      }
      await completeProjectWithReport(item);
      const origin = await findOriginTodo(item.id);
      if (origin && !origin.completed) setCascade({ step: "originTodo", projectId: item.id });
      return;
    }
    const r = await setProjectCompleted(item.id, false);
    if (!r) return;
    showUndoToast(`「${item.title}」を未完了に戻しました`, r.undo);
  }

  async function completeProjectWithReport(item: ProjectItem) {
    const r = await setProjectCompleted(item.id, true);
    if (!r) return;
    const completedAt = r.completedAt!;
    showUndoToast(`「${item.title}」を完了にしました`, async () => {
      await r.undo();
      setCompletionReport((rep) => (rep?.project.id === item.id ? null : rep));
    });
    fireConfetti();
    const projectRecords = (records ?? []).filter((rec) => !rec.excludedFromStats && recordBelongsToProject(rec, item.id));
    const totalSeconds = projectRecords.reduce((sum, rec) => sum + rec.seconds, 0);
    const createdStr = todayStr(new Date(item.createdAt));
    const completedStr = todayStr(new Date(completedAt));
    setCompletionReport({
      project: { ...item, completedAt },
      totalSeconds,
      recordCount: projectRecords.length,
      daysTaken: Math.max(1, daysBetweenDateStrs(createdStr, completedStr) + 1),
      onTime: completedStr <= item.dueDate,
    });
  }

  // 本日の作業へ入れる入口は📈進捗と共通(同じ段階は重ねない・元のToDoを紐付け・業務区分の既定)
  async function addToToday(item: ProjectItem, category: string, workName: string, stageId?: string, startNow = false) {
    const r = await addProjectToToday({ projectId: item.id, stageId, category, name: workName, startNow, today });
    if (r.status === "missing") return;
    if (r.status === "already") showUndoToast(`「${r.task.name}」はもう本日の作業に入っています`);
    onAddedToToday?.(startNow);
  }

  // チェック(未完了→完了)方向だけ確認モーダルを挟む。段階が多い案件では
  // チェックボックスが小さく誤タップしやすいための保険(外す方向は確認しない)
  async function toggleProjectStage(project: ProjectItem, stageId: string) {
    const stage = project.stages?.find((s) => s.id === stageId);
    if (stage && !stage.completed) {
      setStageCompleteConfirm({ project, stageId });
      return;
    }
    await toggleProjectStageShared(project, stageId);
  }

  async function confirmStageComplete() {
    if (!stageCompleteConfirm) return;
    const r = await toggleProjectStageShared(stageCompleteConfirm.project, stageCompleteConfirm.stageId);
    setStageCompleteConfirm(null);
    // 最後の段階が済んだら「案件も完了にしますか」
    if (r?.offerProjectCompletion) setCascade({ step: "allStagesDone", projectId: stageCompleteConfirm.project.id });
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
    await addToToday(project, projectCategoryFor(project), stage.title, stage.id, stageAddStartNow);
    setStageAddTarget(null);
  }

  // アーカイブ済みは既定では一覧・ガント・カレンダー等から外す。削除と違いデータは残るので、
  // 「アーカイブ済みを表示」をONにすればいつでも通常の一覧に戻せる
  const [showArchivedStr, setShowArchivedStr] = useSetting("projects.showArchived", "false");
  const showArchived = showArchivedStr === "true";
  const archivedProjectCount = useMemo(() => (projects ?? []).filter((p) => p.archived).length, [projects]);

  const rows = useMemo(() => {
    const list = (projects ?? []).filter((p) => showArchived || !p.archived);
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
      // 見積もり総所要時間が無く、段階(チェックリスト)だけで運用している案件向けに、
      // 段階の完了ペースから同じ考え方で期日到達を予測する(forecastが使える場合はそちらを優先)
      const stageForecast = !forecast && !p.completedAt ? computeStagePaceForecast(p, today) ?? undefined : undefined;
      // 見積もり総所要時間があれば、実際の消化ペースに基づく予測(forecast)を優先する。
      // 段階ベースの予測(stageForecast)が使えればそれを次に優先し、どちらも無い案件だけ
      // 従来通り「経過日数のうち何割の日に着手できているか」の簡易判定で代用する
      const paceWarning = forecast
        ? forecast.status === "at-risk" || forecast.status === "overdue"
        : stageForecast
          ? stageForecast.status === "at-risk" || stageForecast.status === "overdue"
          : !p.completedAt && daysLeft <= 3 && daysLeft >= 0 && workDays / daysElapsed < 0.3;
      return { project: p, createdStr, overdue, dueToday, daysLeft, paceWarning, forecast, stageForecast };
    });
  }, [projects, today, projectWorkDays, projectForecasts]);

  const activeRows = useMemo(() => rows.filter((r) => !r.project.completedAt), [rows]);
  const completedRows = useMemo(() => rows.filter((r) => !!r.project.completedAt), [rows]);
  // 完了済みの段階が1件もない間はトグルを出しても切り替える対象がないので、その時は隠す
  const completedStageCount = useMemo(
    () => rows.reduce((n, r) => n + (r.project.stages ?? []).filter(isStageDone).length, 0),
    [rows]
  );

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
        // グループ名が登録されている場合は、件名の代わりにそれを題目として表示する
        label: project.groupName || project.title,
        sublabel: project.groupName ? `${project.title} / ${project.workName}` : project.workName,
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
    // 並び順をCSSのorderで変えるため(スマホではグラフを一覧の後へ)、space-yではなくflexのgapで間を取る
    <div className="flex flex-col gap-4">
      {/* 右寄せのボタン1つだけの段が2つ続いて一覧を押し下げていたので、1段にまとめる。
          登録フォームも一覧の前に大きな枠を置かず、この段のボタンから開く */}
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className={showForm ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
          onClick={() => setShowForm((v) => !v)}
          aria-expanded={showForm}
        >
          ＋ 案件を登録
        </button>
        <button
          className="btn-pill-outline text-xs"
          onClick={() => setShowWeeklyReview(true)}
          title="期日切れの案件・ToDoを1件ずつ見直します"
        >
          📋 週次レビュー
        </button>
        {/* 別のAIに案件・ToDoの進捗を登録してもらう入口(CSVの表示設定とは関係なく出す) */}
        <button
          className="btn-pill-outline text-xs"
          onClick={() => setShowProgressSync(true)}
          title="別のAI(Claudeなど)に案件・ToDoの進捗を登録してもらう"
        >
          🤖 AIと進捗をやり取り
        </button>
      </div>
      {showProgressSync && <ProgressSyncModal onClose={() => setShowProgressSync(false)} />}
      {showForm && (
        <div className="panel px-4 py-3">
          <h2 className="section-title font-display">案件を登録</h2>
          {/* Enterで追加できるようフォームにする(変換確定のEnterでは送らない) */}
          <form
            className="mt-2 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void addProject();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isSubmitEnter(e) && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault();
            }}
          >
            <input
              placeholder="件名"
              aria-label="件名"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
            />
            {parsedTitleDue && (
              <p className="caption flex flex-wrap items-center gap-2" role="status">
                {titleDue ? (
                  <span>
                    期日を {dueLabel(titleDue.dueDate, today)} にして「{titleDue.title}」で登録します
                  </span>
                ) : (
                  <span>件名はそのまま登録します（期日は下で選べます）</span>
                )}
                <button
                  type="button"
                  className="chip text-xs"
                  aria-pressed={ignoreTitleDue}
                  onClick={() => setIgnoreTitleDue((v) => !v)}
                >
                  {titleDue ? "期日として読まない" : "期日として読む"}
                </button>
              </p>
            )}
            <input
              placeholder="グループ名（任意。別アプリで機種名違いでも同じ案件として扱いたい場合に）"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              list="project-group-names"
              className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
            />
            <datalist id="project-group-names">
              {groupNames.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
            <input
              placeholder="区分"
              title={`空のままなら「${DEFAULT_PROJECT_CATEGORY}」になります`}
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
                aria-label="期日"
                value={titleDue ? titleDue.dueDate : dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                disabled={!!titleDue}
                title={titleDue ? "件名の期限の言葉から決めています（「期日として読まない」で外せます）" : undefined}
                className="rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream disabled:opacity-60"
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
            <button type="submit" className="btn-pill text-sm">
              追加
            </button>
          </form>
        </div>
      )}

      {/* 登山と返事待ちの砂時計は、PCでは横に並べて一覧の前に置く。スマホでは一覧を先に見せたいので
          一覧(完了済みを含む)の後ろへ回す(畳まずに開いたまま) */}
      <div className="grid gap-4 max-lg:order-1 lg:grid-cols-2 lg:items-start">
        <ProjectClimbPanel
          onOpen={(id) => {
            const target = projects?.find((p) => p.id === id);
            if (target) setEditingProject(target);
          }}
        />
        <WaitingHourglassPanel
          kind="project"
          onOpen={(id) => {
            const target = projects?.find((p) => p.id === id);
            if (target) setEditingProject(target);
          }}
        />
      </div>

      {/* 育成選手モード: 一覧の前に順位表を置く。段階の消化を勝敗に見立てて勝率順に並べるので、
          走っている案件と止まっている案件が一列で分かる */}
      {themedMode === "powerpro" && (() => {
        const PW = powerproWordsFor(wordingEnabled);
        const rows = buildStandings(projects ?? [], today);
        return (
          <Standings
            rows={rows}
            labels={{
              title: PW.standingsTitle,
              team: PW.standingsTeam,
              win: PW.standingsWin,
              lose: PW.standingsLose,
              rest: PW.standingsRest,
              rate: PW.standingsRate,
              days: PW.standingsDays,
              empty: PW.standingsEmpty,
            }}
            className="mb-3 overflow-hidden rounded-xl"
          />
        );
      })()}

      {(completedStageCount > 0 || archivedProjectCount > 0 || showArchived) && (
        <div className="mb-0 flex flex-wrap justify-end gap-2">
          {archivedProjectCount > 0 || showArchived ? (
            <button
              type="button"
              className={showArchived ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
              onClick={() => setShowArchivedStr(showArchived ? "false" : "true")}
              aria-pressed={showArchived}
              title="アーカイブした案件を、通常の一覧・ガント・カレンダー等に含めるかどうかを切り替えます"
            >
              <IconLabel text={`🗄 アーカイブ済み（${archivedProjectCount}）: ${showArchived ? "表示中" : "非表示"}`} />
            </button>
          ) : null}
          {completedStageCount > 0 && (
            <button
              type="button"
              // 表示の切り替えにすぎないので、ON(表示中)でも塗りの主ボタンにはせず控えめな枠線にする
              className={`btn-pill-outline text-xs ${showCompletedStages ? "" : "text-cream/60"}`}
              onClick={() => setShowCompletedStagesStr(showCompletedStages ? "false" : "true")}
              aria-pressed={showCompletedStages}
              title="各案件の下に並ぶ完了済みの段階を、一覧に出すかどうかを切り替えます（設定タブの同じ項目と連動し、次に開いた時も保たれます）"
            >
              完了済みの段階（{completedStageCount}）: {showCompletedStages ? "表示中" : "非表示"}
            </button>
          )}
        </div>
      )}

      <div className="panel list-rows">
        {activeRows.map(({ project, overdue, dueToday, daysLeft, paceWarning, forecast, stageForecast }) => (
          <ProjectRow
            key={project.id}
            project={project}
            overdue={overdue}
            dueToday={dueToday}
            daysLeft={daysLeft}
            paceWarning={paceWarning}
            forecast={forecast}
            stageForecast={stageForecast}
            themedMode={themedMode}
            totalSeconds={projectTotalSeconds.get(project.id) ?? 0}
            hourlyRate={resolveProjectRate(project)}
            clientName={project.clientId ? clientNameById.get(project.clientId) : undefined}
            stageSecondsFor={(stageId) => stageSeconds.get(`${project.id}::${stageId}`) ?? 0}
            onAddToToday={() => setAddToTodayTarget(project)}
            onToggleComplete={() => toggleComplete(project)}
            onEdit={() => setEditingProject(project)}
            onAnalysis={() => setAnalysisProject(project)}
            onWbs={() => setWbsProject(project)}
            onTemplate={() => setTemplateSource(project)}
            onDuplicate={() => requestDuplicate(project)}
            onDelete={() => deleteProject(project)}
            onArchive={() => toggleArchiveProject(project)}
            onToggleStage={(stageId) => toggleProjectStage(project, stageId)}
            onAddStageToToday={(stage) => addStageToTodayWithConfirm(project, stage)}
            onSetTag={(value) => setProjectTag(project, value)}
            tagOptions={tagOptions}
          />
        ))}
        {activeRows.length === 0 && completedRows.length === 0 && (
          // 一覧の枠の内側なので、空の知らせ自身の枠は消す(border-0)。森モードでは山と旗の線画を添える
          <div className="empty-state border-0">
            <EmptyArt name="projects" />
            <p>案件はまだ登録されていません。</p>
          </div>
        )}
        {activeRows.length === 0 && completedRows.length > 0 && (
          <div className="empty-state border-0">
            <EmptyArt name="projects" />
            <p>未完了の案件はありません。</p>
          </div>
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
            <div className="panel list-rows">
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
                  onAnalysis={() => setAnalysisProject(project)}
                  onWbs={() => setWbsProject(project)}
                  onTemplate={() => setTemplateSource(project)}
                  onDuplicate={() => requestDuplicate(project)}
                  onDelete={() => deleteProject(project)}
                  onArchive={() => toggleArchiveProject(project)}
                  onToggleStage={(stageId) => toggleProjectStage(project, stageId)}
                  onAddStageToToday={(stage) => addStageToTodayWithConfirm(project, stage)}
                  onSetTag={(value) => setProjectTag(project, value)}
                  tagOptions={tagOptions}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* 一覧の後ろに回すもの(スマホでは登山・返事待ちのグラフよりさらに後ろ)。取引先の管理と
          取引先別・グループ別のまとめは毎日は見ないので、一覧を押し下げないよう最後に置く */}
      <div className="order-2 flex flex-col gap-4">
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
              <button
                className={viewMode === "ppm" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
                onClick={() => setViewMode("ppm")}
              >
                PPM分析
              </button>
              <button
                className={viewMode === "progress" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
                onClick={() => setViewMode("progress")}
                title="新規追加と完了のペースを月別に見比べたり、未完了の積み上がり具合を見られます"
              >
                📈 進捗グラフ
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

            {viewMode === "progress" ? (
              <ProjectProgressChart projects={projects ?? []} />
            ) : timelineRows.length === 0 ? (
              <p className="px-1 py-4 text-sm text-cream/50">
                表示する案件がありません（完了済みのみのため。「完了済みも表示」をONにすると見られます）。
              </p>
            ) : viewMode === "calendar" ? (
              <ProjectsCalendarView projects={timelineRows.map((r) => r.project)} today={today} />
            ) : viewMode === "tree" ? (
              <TreeView nodes={projectTree} />
            ) : viewMode === "ppm" ? (
              <ProjectPPMChart
                items={timelineRows.map((r) => ({
                  project: r.project,
                  totalSeconds: projectTotalSeconds.get(r.project.id) ?? 0,
                  hourlyRate: resolveProjectRate(r.project),
                  today,
                }))}
              />
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
                    {/* 先行案件の依存線。WBSの先行タスク矢印と同じ考え方で、案件単位で描く。
                        日付の自動調整はせず、後続の開始(登録日)が先行の終了(期日)より前にある
                        場合に赤で気づきとして示すだけ */}
                    <svg
                      className="pointer-events-none absolute inset-0"
                      width={totalDays * pxPerDay}
                      height={timelineRows.length * ROW_H}
                    >
                      <defs>
                        <marker id="project-gantt-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                          <path d="M0,0 L6,3 L0,6 Z" fill="rgb(var(--cream-rgb) / 0.5)" />
                        </marker>
                      </defs>
                      {timelineRows.flatMap((row, idx) =>
                        (row.project.predecessorProjectIds ?? []).map((predId) => {
                          const predIdx = timelineRows.findIndex((r) => r.project.id === predId);
                          if (predIdx === -1) return null; // 先行案件が完了済みで非表示、または削除済み
                          const pred = timelineRows[predIdx];
                          const y1 = predIdx * ROW_H + ROW_H / 2;
                          const y2 = idx * ROW_H + ROW_H / 2;
                          const x1 = pred.barEnd * pxPerDay;
                          const x2 = row.barStart * pxPerDay;
                          const conflict = x2 < x1;
                          const midX = conflict ? x1 + 10 : x1 + Math.max(6, (x2 - x1) / 2);
                          return (
                            <path
                              key={`${predId}->${row.project.id}`}
                              d={`M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`}
                              fill="none"
                              stroke={conflict ? "rgb(var(--accent-rgb) / 0.8)" : "rgb(var(--cream-rgb) / 0.35)"}
                              strokeWidth={1.5}
                              markerEnd="url(#project-gantt-arrow)"
                            />
                          );
                        })
                      )}
                    </svg>
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

        <div className="panel px-4 py-3">
          <button
            className="flex w-full items-center justify-between text-left"
            onClick={() => setShowClients((v) => !v)}
          >
            <h2 className="section-title font-display">
              取引先{(clients ?? []).length > 0 && `（${(clients ?? []).length}）`}
            </h2>
            <span className="text-xs text-cream/60">{showClients ? "▼" : "▶"}</span>
          </button>
          {showClients && (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {(clients ?? []).map((c) => (
                  <span key={c.id} className="flex items-center gap-1 rounded-full border border-cream/20 px-3 py-1.5 text-sm">
                    {c.name}
                    <button onClick={() => setClientDialog({ kind: "rename", id: c.id, current: c.name })} className="text-cream/50 hover:text-cream" aria-label={`${c.name}の名前を変更`}>
                      ✎
                    </button>
                    <button onClick={() => deleteClient(c)} className="text-cream/50 hover:text-alert" aria-label={`${c.name}を削除`}>
                      ✕
                    </button>
                  </span>
                ))}
                <button className="btn-pill-outline text-sm" onClick={() => setClientDialog({ kind: "add" })}>
                  + 取引先を追加
                </button>
              </div>
              {(clients ?? []).length === 0 && (
                <p className="mt-2 text-xs text-cream/50">
                  取引先を登録すると、案件・ToDoにタグ付けして、取引先ごとの案件数や作業時間をまとめて見られるようになります。
                </p>
              )}
            </>
          )}
        </div>
        {clientDialog && (
          <ClientNameDialog
            key={clientDialog.kind === "rename" ? clientDialog.id : "add"}
            title={clientDialog.kind === "add" ? "取引先を追加" : "取引先名を変更"}
            initialValue={clientDialog.kind === "rename" ? clientDialog.current : ""}
            onSubmit={submitClientDialog}
            onClose={() => setClientDialog(null)}
          />
        )}

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

        {groupSummaries.length > 0 && (
          <div className="panel p-4">
            <h2 className="mb-2 font-display text-lg font-bold">グループ別サマリー</h2>
            <p className="mb-2 text-xs text-cream/50">
              件名・詳細作業名が違っても、同じグループ名を付けた案件をまとめて進捗・実績を確認できます。
            </p>
            <div className="divide-y divide-cream/10">
              {groupSummaries.map((s) => (
                <div key={s.name} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="font-bold">{s.name}</span>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-cream/70">
                    <span>
                      📁 案件 {s.projectCount}件
                      {s.overdueProjectCount > 0 && <span className="ml-1 font-bold text-alert">(期限切れ{s.overdueProjectCount})</span>}
                    </span>
                    <span>📊 進捗 {s.progressPct}%</span>
                    <span>⏱ 実績 {formatHms(s.totalSeconds)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {editingProject && <EditProjectDialog project={editingProject} onClose={() => setEditingProject(null)} />}
      {showWeeklyReview && <WeeklyReviewModal onClose={() => setShowWeeklyReview(false)} />}
      {analysisProject && <ProjectAnalysisDialog project={analysisProject} onClose={() => setAnalysisProject(null)} />}
      {templateSource && (
        <ProjectTemplateDialog
          source={templateSource}
          projects={projects ?? []}
          records={records ?? []}
          onClose={() => setTemplateSource(null)}
        />
      )}
      {wbsProject && <WbsDialog project={wbsProject} onClose={() => setWbsProject(null)} />}

      {stageCompleteConfirm &&
        (() => {
          const { project, stageId } = stageCompleteConfirm;
          const stage = project.stages?.find((s) => s.id === stageId);
          if (!stage) return null;
          const incompletePrevious = incompletePreviousStageTitles(project, stageId);
          return (
            <Modal title="この段階を完了にしますか？" onClose={() => setStageCompleteConfirm(null)}>
              <div className="space-y-2 text-sm text-cream/80">
                <p>
                  案件 <span className="text-cream/50">{project.title}</span> の段階 <b className="text-cream">{stage.title}</b> を完了にします。
                </p>
                {incompletePrevious.length > 0 && (
                  <div className="rounded-lg border border-alert/40 bg-alert/10 px-3 py-2">
                    <p className="text-xs font-bold text-alert">前の段階がまだ完了していません</p>
                    <ul className="mt-1 space-y-0.5">
                      {incompletePrevious.map((title) => (
                        <li key={title} className="truncate text-xs text-cream/70">
                          ・{title}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button className="btn-pill-outline text-sm" onClick={() => setStageCompleteConfirm(null)}>
                  やめる
                </button>
                <button className="btn-pill text-sm" onClick={confirmStageComplete}>
                  完了にする
                </button>
              </div>
            </Modal>
          );
        })()}

      {addToTodayTarget && (
        <CategoryWorkNameDialog
          title="本日の作業に追加"
          confirmLabel="追加する"
          defaultCategory={projectCategoryFor(addToTodayTarget)}
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
              区分: <span className="font-bold text-cream">{projectCategoryFor(stageAddTarget.project)}</span>
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

      {cascade && (
        <ProjectCascadeDialog cascade={cascade} onCompleteProject={completeProjectWithReport} onClose={() => setCascade(null)} />
      )}

      {archiveConfirm && (
        <Modal title="まだ完了していない案件です" onClose={() => setArchiveConfirm(null)}>
          <p className="text-sm text-cream/80">
            「{archiveConfirm.title}」は未完了です（期日 {archiveConfirm.dueDate}）。アーカイブすると通常の一覧・ガント・カレンダー等に出なくなります。
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn-pill-outline text-sm" onClick={() => setArchiveConfirm(null)}>
              やめる
            </button>
            <button className="btn-pill text-sm" onClick={() => setArchived(archiveConfirm, true)}>
              アーカイブする
            </button>
          </div>
        </Modal>
      )}

      {duplicateTarget && (
        <Modal title="案件を複製" onClose={() => setDuplicateTarget(null)}>
          <p className="text-sm text-cream/80">
            「{duplicateTarget.project.title}」にはWBSが{duplicateTarget.wbsCount}件あります。WBSも写しますか?（進捗は0%から）
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn-pill-outline text-sm" onClick={() => doDuplicate(duplicateTarget.project, false)}>
              段階だけ写す
            </button>
            <button className="btn-pill text-sm" onClick={() => doDuplicate(duplicateTarget.project, true)}>
              WBSも写す
            </button>
          </div>
        </Modal>
      )}

      {completionReport && !cascade && (
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
            <div className="border-t border-cream/10 pt-3">
              <RetrospectiveInput project={completionReport.project} />
            </div>
            {hasAnalysisContent(completionReport.project) && (
              <div className="border-t border-cream/10 pt-3">
                <h4 className="mb-2 text-xs font-bold text-cream/70">📝 当初の分析(SWOT等)の振り返り</h4>
                <div className="space-y-2">
                  {analysisSummaryEntries(completionReport.project).map((e, i) => (
                    <div key={i} className="rounded-lg bg-ink px-3 py-2">
                      <div className="text-[10px] text-cream/40">{e.label}</div>
                      <div className="whitespace-pre-wrap text-xs text-cream/80">{e.text}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="mt-4 flex justify-end">
            <button className="btn-pill text-sm" onClick={() => setCompletionReport(null)}>
              閉じる
            </button>
          </div>
        </Modal>
      )}

      {/* CSVの入出力はたまにしか使わないのに一覧を押し下げていたので、画面のいちばん下へ置く。
          取り込みの結果・エラーも押したボタンのそばに出るよう一緒に移す */}
      {showCsvTools && (
        <div className="order-3 flex flex-wrap justify-end gap-2">
          <span className="caption mr-auto self-center">CSV</span>
          <button className="btn-pill-outline text-xs" onClick={downloadTemplate}>
            CSVテンプレート
          </button>
          <button className="btn-pill-outline text-xs" onClick={exportCsv}>
            CSVエクスポート
          </button>
          <button className="btn-pill-outline text-xs" onClick={() => fileInputRef.current?.click()}>
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
      )}

      {importResult && <p className="order-3 text-xs text-cream/70">{importResult}</p>}
      {importErrors.length > 0 && (
        <div className="panel order-3 border border-alert/40 p-3 text-xs text-alert">
          {importErrors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
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
  stageForecast,
  totalSeconds,
  hourlyRate,
  clientName,
  stageSecondsFor,
  onAddToToday,
  onToggleComplete,
  onEdit,
  onAnalysis,
  onWbs,
  onTemplate,
  onDuplicate,
  onDelete,
  onArchive,
  onToggleStage,
  onAddStageToToday,
  onSetTag,
  tagOptions,
  themedMode,
}: {
  project: ProjectItem;
  overdue: boolean;
  dueToday?: boolean;
  daysLeft: number;
  paceWarning?: boolean;
  forecast?: ProjectForecast;
  stageForecast?: StagePaceForecast;
  totalSeconds: number;
  hourlyRate: number | null;
  clientName?: string;
  stageSecondsFor: (stageId: string) => number;
  onAddToToday: () => void;
  onToggleComplete: () => void;
  onEdit: () => void;
  onAnalysis: () => void;
  onWbs: () => void;
  onTemplate: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onArchive: () => void;
  onToggleStage: (stageId: string) => void;
  onAddStageToToday: (stage: ProjectStage) => void;
  onSetTag: (value: string) => void;
  tagOptions: string[];
  themedMode?: ThemedMode | null;
}) {
  const today = useToday();
  // 相手の返事待ちが何日目か・期日を後ろへずらしてきた回数(lib/waiting.ts, lib/changeTracking.ts)
  const { waitingTags, nudgeDays } = useWaitingSettings();
  const waiting = project.completedAt ? null : projectWaitingInfo(project, waitingTags, nudgeDays, Date.now());
  const postpones = project.completedAt ? null : summarizePostpones(project.dueHistory);
  const [showCompletedStagesStr] = useSetting("projects.showCompletedStages", "true");
  const showCompletedStages = showCompletedStagesStr === "true";
  const [stagesCollapsed, setStagesCollapsed] = useState(false);
  const [showStageDueDensity, setShowStageDueDensity] = useState(false);
  // 毎日は使わない操作(分析・WBS・型・ボード・アーカイブ・削除)は「⋯」の中にしまう
  const [moreOpen, setMoreOpen] = useState(false);
  // 進捗率・段階数の表示は全段階を対象にする一方、ここでの一覧描画だけ設定に応じて完了済みを間引く
  const visibleStages = showCompletedStages ? project.stages ?? [] : (project.stages ?? []).filter((s) => !isStageDone(s));
  // 完了した順番。定義順のままでは「どれを先に片付けたか」が読み取れないため、
  // 完了時刻の記録がある段階にだけ通し番号を振り、チェックマークの代わりに出す
  const stageOrder = buildStageCompletionOrder(project.stages);
  const jumpedCount = Array.from(stageOrder.values()).filter((o) => o.aheadOfPlan).length;
  // 怪異調査モード: 案件1件ごとに「事件ファイル」の表紙写真(生成)と、F.O.A.F.データベース風の
  // 通し番号を添える。写真の荒れ具合は延滞状況という実データに連動させる
  const { wordingEnabled } = useVisualMode();
  const hayarigamiMode = themedMode === "hayarigami";
  const hayarigamiIntensity = project.completedAt ? 0.05 : overdue ? 0.85 : dueToday ? 0.5 : 0.25;
  // 分岐ツリー用のノード。段階の並びをそのまま一本道の捜査ルートとして描く
  const branchNodes: BranchNode[] = (project.stages ?? []).map((stage, i) => {
    const done = isStageDone(stage);
    const stageOverdue = !done && !!stage.dueDate && stage.dueDate < today;
    const firstUndone = (project.stages ?? []).findIndex((s) => !isStageDone(s));
    return { done, current: i === firstUndone, overdue: stageOverdue };
  });
  // 育成選手モード: 案件タブは「契約案件」。段階(マイルストーン)を1試合ずつに見立てて、
  // 完了=勝ち・期日超過=負け・未消化=空きマスの勝敗表にする。順位も勝率という実データそのもの
  const powerproMode = themedMode === "powerpro";
  const PW = powerproWordsFor(wordingEnabled);
  // 登山モード: 案件1件を一座の山として、木の山名板と高度断面図に置き換える。
  // 標高も難易度も段階の数・期日という実データから決まる純粋関数の値
  const mountainMode = themedMode === "mountain";
  const MW = mountainWordsFor(wordingEnabled);
  const mountainRoute = mountainMode ? buildRoute(project, today, new Map()) : null;
  const pennant = powerproMode ? buildPennant(project, today) : null;
  const pennantCells: ("win" | "loss" | "rest")[] = powerproMode
    ? (project.stages ?? []).map((stage) => {
        if (isStageDone(stage)) return "win";
        if (stage.dueDate && stage.dueDate < today) return "loss";
        return "rest";
      })
    : [];
  return (
    <>
    <div
      className={`list-row flex-wrap justify-between py-3 ${project.completedAt ? "opacity-50" : ""} ${
        overdue
          ? themedMode
            ? cardOverrunClass(themedMode)
            : "ring-1 ring-alert/40"
          : dueToday
            ? "ring-1 ring-alert/50"
            : ""
      }`}
    >
      {/* 左カラム。基準幅を持たせて伸ばすことで、狭い画面では右の操作ボタンが
          次の行へ回り、段階リストがカード幅いっぱいを使えるようにする */}
      <div className={`min-w-0 grow basis-[260px] ${hayarigamiMode ? "flex gap-2" : ""}`}>
        {hayarigamiMode && (
          <SceneCanvas
            seed={`${project.category ?? "事件"}/${project.title}/${project.workName}`}
            intensity={hayarigamiIntensity}
            night={overdue}
            className="h-14 w-14 shrink-0 overflow-hidden rounded border border-cream/25"
          />
        )}
        <div className="min-w-0">
        {/* 件名を主に、詳細作業名を従に。以前は件名が小さく、詳細作業名の方が大きく見えていた */}
        <div className="text-[0.9375rem] font-bold leading-snug text-cream">
          {hayarigamiMode && (
            <span className="mr-1.5 font-mono text-cream/45">
              {hayarigamiWordsFor(wordingEnabled).fileNoPrefix}
              {foafNumberOf(project.id)}
            </span>
          )}
          {powerproMode && pennant && (
            <span className="mr-1.5 inline-flex items-center gap-1 align-middle">
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-black text-white shadow-[0_1px_0_rgba(12,28,60,0.3)]"
                style={{
                  background:
                    "linear-gradient(to bottom, rgb(var(--accent-rgb)), rgb(var(--accent-rgb) / 0.72))",
                }}
              >
                {wordingEnabled ? pennant.standing : pennant.standingPlain}
              </span>
              {pennant.games > 0 && (
                <span className="rounded-full border border-cream/20 bg-cream/5 px-1.5 py-0.5 text-[10px] tabular-nums text-cream/60">
                  {PW.winLossLabel(pennant.wins, pennant.losses)}
                </span>
              )}
            </span>
          )}
          {project.groupName || project.title}
          {/* 案件そのものの対応状況。段階(マイルストーン)ごとのtagとは別に、
              案件全体としての状況(見積り中・受注確定 など)をここで持つ。
              段階を持つ案件は、対応状況が段階側から自動算出されるため読み取り専用にする */}
          {(project.stages ?? []).length > 0 ? (
            // 段階から決まらない時は「未設定」と出さず何も置かない(情報のない札が並ぶだけだった)
            effectiveProjectTag(project, tagOptions) ? (
              <span
                className="chip ml-2 align-middle"
                data-tone="strong"
                title="対応状況は段階から自動的に決まります"
              >
                {effectiveProjectTag(project, tagOptions)}
              </span>
            ) : null
          ) : (
            <select
              value={project.tag ?? ""}
              onChange={(e) => onSetTag(e.target.value)}
              title="対応状況"
              className={`ml-2 h-6 rounded-full border px-2 align-middle text-[11px] font-bold ${
                project.tag ? "border-cream/40 bg-cream/10 text-cream" : "border-cream/15 bg-transparent text-cream/30"
              }`}
            >
              <option value="">対応状況なし</option>
              {tagOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
              {project.tag && !tagOptions.includes(project.tag) && <option value={project.tag}>{project.tag}</option>}
            </select>
          )}
          {waiting && waiting.days != null && (
            // 返事待ちは「気にかけておく」注意(caution)。催促の目安を過ぎたものだけ警告(alert)にする
            <span
              className="chip ml-1 align-middle tabular-nums"
              data-tone={waiting.overdue ? "alert" : "caution"}
              title={
                waiting.overdue
                  ? `「${waiting.tag}」になってから${waiting.days}日目です。催促や状況確認の目安(${nudgeDays}日目)を過ぎています`
                  : `「${waiting.tag}」になってから${waiting.days}日目`
              }
            >
              {waiting.overdue && "⏰ "}
              {waiting.stageTitle ? `${waiting.stageTitle}: ` : ""}
              {waiting.tag} {waiting.days}日目
            </span>
          )}
          {postpones && postpones.count > 0 && (
            <span
              className="chip ml-1 align-middle tabular-nums"
              data-tone={postpones.count >= 3 ? "alert" : undefined}
              title="案件の期日を後ろへずらした回数と、ずらした日数の合計"
            >
              ↪ 延期{postpones.count}回・計{postpones.totalDays}日
            </span>
          )}
          {project.url && (
            <button
              onClick={() => window.open(normalizeUrl(project.url!), "_blank", "noopener,noreferrer")}
              aria-label="リンクを開く"
              title={project.url}
              className="ml-2 align-middle text-sm text-cream/50 hover:text-cream"
            >
              🔗
            </button>
          )}
          {project.category && <span className="ml-2 text-cream/40">［{project.category}］</span>}
          {project.groupName && (
            <span
              className="chip ml-2"
              title="この案件自体の件名(グループ名が登録されているため、題目にはグループ名を表示しています)"
            >
              📄 {project.title}
            </span>
          )}
          {clientName && (
            <span className="chip ml-2">🏢 {clientName}</span>
          )}
          {hasAnalysisContent(project) && (
            <span
              className="chip ml-2"
              title="SWOT/BSC/3C分析が入力されています"
            >
              📝分析あり
            </span>
          )}
        </div>
        <div className="text-xs text-cream/60">{project.workName}</div>
        <div className={`text-xs ${overdue || dueToday ? "font-bold text-alert" : "text-cream/60"}`}>
          期日 {formatDateJp(project.dueDate)}{" "}
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
            {forecast.status === "no-recent-pace" && (
              <IconLabel text={`😴 直近14日間この案件に未着手（残り見積もり ${formatHms(forecast.remainingSeconds)}）`} />
            )}
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
        ) : stageForecast ? (
          <div
            className={`text-xs ${
              stageForecast.status === "at-risk" || stageForecast.status === "overdue" ? "font-bold text-alert" : "text-cream/60"
            }`}
            title="見積もり総所要時間が無いため、段階(項目)の完了ペース(直近14日間)から算出した納期到達予測です"
          >
            {stageForecast.status === "done" && "✅ 段階はすべて消化済みです"}
            {stageForecast.status === "overdue" && `🔴 期日超過（残り${stageForecast.remainingStages}段階）`}
            {stageForecast.status === "no-recent-pace" && (
              <IconLabel text={`😴 直近14日間この案件は未着手（残り${stageForecast.remainingStages}段階）`} />
            )}
            {stageForecast.status === "on-track" &&
              stageForecast.projectedDaysNeeded !== null &&
              `🎯 順調（今のペースならあと約${Math.ceil(stageForecast.projectedDaysNeeded)}日で完了見込み・残り${stageForecast.remainingStages}段階）`}
            {stageForecast.status === "at-risk" &&
              stageForecast.projectedDaysNeeded !== null &&
              `⚠ 遅延の恐れ（今のペースだと完了まで約${Math.ceil(stageForecast.projectedDaysNeeded)}日かかる見込み。残り${stageForecast.remainingStages}段階${
                stageForecast.requiredPacePerDay
                  ? `・間に合わせるには1日あたり約${Math.ceil(stageForecast.requiredPacePerDay * 10) / 10}段階必要`
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
        {/* 登山モード: 案件の見出しを木の山名板に、進捗を高度断面図に置き換える。
            標高は段階の数(1段階=300m)、難易度は残りの段階数と期日までの日数から決まる */}
        {mountainMode && mountainRoute && (
          <div className="mt-1 w-full space-y-1">
            <Signboard
              name={project.title}
              altitude={mountainRoute.summit}
              grade={gradeOf(mountainRoute)}
              summited={mountainRoute.summited}
              seed={`sign:${project.id}`}
              height={70}
              className="overflow-hidden rounded-lg"
            />
            {mountainRoute.waypoints.length > 0 && (
              <MountainProfile
                summit={mountainRoute.summit}
                current={mountainRoute.current}
                waypoints={mountainRoute.waypoints}
                seed={`prof:${project.id}`}
                labels={{ start: MW.start, summit: MW.summit, now: MW.now }}
                compact
                className="overflow-hidden rounded-lg border border-cream/12"
              />
            )}
          </div>
        )}
        {project.stages && project.stages.length > 0 && (
          <div className="mt-1 w-full">
            {/* 見出しと進捗バーは、スマホでは本文脇に収まる幅に留め、広い画面では左カラムいっぱいに伸ばす */}
            <div className="max-w-[220px] sm:max-w-none">
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
            {hayarigamiMode ? (
              <BranchTree nodes={branchNodes} seed={project.id} className="overflow-hidden rounded border border-cream/15" />
            ) : mountainMode ? (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-cream/5">
                <div
                  className="h-1.5 rounded-full bg-alert"
                  style={{ width: `${Math.round((computeProjectProgress(project.stages) ?? 0) * 100)}%` }}
                />
              </div>
            ) : powerproMode ? (
              <PennantBar
                cells={pennantCells}
                label={PW.pennantLabel}
                className="overflow-hidden rounded border border-cream/15"
              />
            ) : (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-cream/5">
                <div
                  className="h-1.5 rounded-full bg-cream"
                  style={{
                    width: `${Math.round((computeProjectProgress(project.stages) ?? 0) * 100)}%`,
                  }}
                />
              </div>
            )}
            </div>
            {project.stages.filter((s) => !!s.dueDate && !isStageDone(s)).length >= 2 && (
              <button
                type="button"
                onClick={() => setShowStageDueDensity(true)}
                className="mt-1 text-[10px] text-cream/40 hover:text-cream/70"
                title="段階の期日が特定の日に偏っていないか、月カレンダーで確認します"
              >
                📅 期日の混み具合を見る
              </button>
            )}
            {!stagesCollapsed && (
              <div className="mt-1.5 space-y-1">
                {!showCompletedStages && visibleStages.length < project.stages.length && (
                  <div className="text-[10px] text-cream/30">
                    完了済み{project.stages.length - visibleStages.length}段階を非表示中
                  </div>
                )}
                {showCompletedStages && stageOrder.size >= 2 && (
                  <div className="text-[10px] text-cream/30">
                    丸の中の数字は完了した順番
                    {jumpedCount > 0 && `（うち${jumpedCount}段階はリスト上の前の段階を追い越して完了）`}
                  </div>
                )}
                {visibleStages.map((stage) => {
                const seconds = stageSecondsFor(stage.id);
                const isCountBased = stage.targetCount != null;
                const done = isStageDone(stage);
                const stageOverdue = !done && !!stage.dueDate && stage.dueDate < today;
                const stageDueToday = !done && !!stage.dueDate && stage.dueDate === today;
                const order = stageOrder.get(stage.id);
                // 完了済みならチェックの代わりに「何番目に完了したか」を出す。完了時刻の記録が
                // 残っていない段階は番号を持たないので、これまで通りチェックのままにする
                const markLabel = done ? (order ? String(order.rank) : "✓") : "";
                const markTitle = order
                  ? `${order.rank}番目に完了（${formatDateTimeJp(order.at)}）${
                      order.aheadOfPlan ? "／リスト上これより前の段階を追い越して完了" : ""
                    }`
                  : done
                    ? "完了（完了した時刻の記録なし）"
                    : undefined;
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
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[8px] font-bold tabular-nums ${
                          done ? "border-cream bg-cream text-ink" : "border-cream/40"
                        } ${order?.aheadOfPlan ? "ring-1 ring-alert/60" : ""}`}
                        title={markTitle}
                      >
                        {markLabel}
                      </span>
                    ) : (
                      <button
                        onClick={() => onToggleStage(stage.id)}
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[8px] font-bold tabular-nums ${
                          stage.completed ? "border-cream bg-cream text-ink" : "border-cream/40"
                        } ${order?.aheadOfPlan ? "ring-1 ring-alert/60" : ""}`}
                        aria-label={
                          stage.completed
                            ? `未完了に戻す${order ? `（${order.rank}番目に完了）` : ""}`
                            : "完了にする"
                        }
                        title={markTitle}
                      >
                        {markLabel}
                      </button>
                    )}
                    <span className={`flex-1 truncate text-[11px] ${done ? "text-cream/40 line-through" : "text-cream/80"}`}>
                      {stage.title}
                    </span>
                    {!done &&
                      (() => {
                        const w = waitingInfo(stage, waitingTags, nudgeDays, Date.now());
                        if (!w || w.days == null) return null;
                        return (
                          <span
                            className={`shrink-0 text-[10px] tabular-nums ${w.overdue ? "font-bold text-alert" : "text-cream/50"}`}
                            title={`「${w.tag}」になってから${w.days}日目`}
                          >
                            {w.overdue && "⏰ "}
                            {w.tag} {w.days}日目
                          </span>
                        );
                      })()}
                    {order && (
                      <span className="shrink-0 text-[10px] tabular-nums text-cream/35" title={markTitle}>
                        {formatDateShortJp(order.at)}
                      </span>
                    )}
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
                    {stage.referenceSeconds != null && (
                      <span
                        className={`shrink-0 text-[10px] tabular-nums ${
                          !done && seconds > stage.referenceSeconds ? "text-alert" : "text-cream/35"
                        }`}
                        title="型にした案件と同じ種類の過去の案件で、この段階にかかった時間の平均"
                      >
                        目安 {formatHms(stage.referenceSeconds)}
                      </span>
                    )}
                    {stage.dueDate && (
                      <span
                        className={`shrink-0 text-[10px] ${
                          stageOverdue || stageDueToday ? "font-bold text-alert" : "text-cream/40"
                        }`}
                      >
                        {stageOverdue && "⚠ "}
                        {/* 完了日(「9/28」)と同じ短い書き方にそろえる */}
                        期日 {formatDateJp(stage.dueDate)}
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
      </div>
      {/* スマホ幅でも1行に詰め込まず折り返す(詰め込むと文字が縦1列に潰れて読めなくなっていた) */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 [&>button]:whitespace-nowrap">
        <button className="btn-pill-outline text-xs" onClick={onAddToToday}>
          本日の作業に追加
        </button>
        <button className="btn-pill-outline text-xs" onClick={onToggleComplete}>
          {project.completedAt ? "未完了に戻す" : "完了"}
        </button>
        <button className="px-1 py-1.5 text-xs text-cream/60 hover:text-cream" onClick={onEdit} aria-label={`案件「${project.title}」を編集`}>
          編集
        </button>
        <button
          type="button"
          className={`ml-auto rounded-full px-3 py-1 text-base leading-none ${moreOpen ? "text-cream" : "text-cream/50"} hover:text-cream`}
          onClick={() => setMoreOpen((v) => !v)}
          aria-label="そのほかの操作"
          aria-expanded={moreOpen}
          title="そのほかの操作"
        >
          ⋯
        </button>
      </div>
      {/* 「⋯」の中身は操作ボタンの行とは別の段に、区切り線つきで並べる(広い画面でも右端に詰め込まない) */}
      {moreOpen && (
        <div className="mt-2 flex w-full basis-full flex-wrap items-center gap-1.5 border-t border-cream/10 pt-2 [&>button]:whitespace-nowrap">
          <button className="btn-pill-outline text-xs" onClick={onAnalysis} title="SWOT・BSC・3C分析">
            分析
          </button>
          <button className="btn-pill-outline text-xs" onClick={onWbs} title="WBS(作業分解構成図)">
            WBS
          </button>
          <button
            className="btn-pill-outline text-xs"
            onClick={onTemplate}
            title="この案件の段階の構成を引き継いで、同じ種類の新しい案件を作ります(過去の実績から段階ごとの目安時間も出します)"
          >
            <IconLabel text="📐 型にして作る" />
          </button>
          <button
            className="btn-pill-outline text-xs"
            onClick={onDuplicate}
            title="段階・対応状況・URL・取引先をそのまま写した案件を作ります(実績は写しません。期日は登録日からの日数を保ちます)"
          >
            複製
          </button>
          <button
            className="btn-pill-outline text-xs"
            onClick={() => {
              if (project.boardX !== undefined) removeProjectFromBoard(project.id);
              else placeProjectOnBoard(project.id);
            }}
          >
            {project.boardX !== undefined ? "ボードから外す" : "ボードに置く"}
          </button>
          <button
            className="btn-pill-outline text-xs"
            onClick={onArchive}
            title={project.archived ? "通常の一覧・ガント・カレンダー等に戻します" : "削除せずに、通常の一覧・ガント・カレンダー等から外します"}
          >
            <IconLabel text={project.archived ? "🗄 アーカイブ解除" : "🗄 アーカイブ"} />
          </button>
          {/* 削除は他の操作から少し離し、押し間違えにくくする */}
          <button className="btn-pill-outline ml-auto text-xs text-alert" onClick={onDelete} aria-label={`案件「${project.title}」を削除`}>
            削除
          </button>
        </div>
      )}
    </div>
    {showStageDueDensity && (
      <StageDueDensityModal
        stages={project.stages ?? []}
        today={today}
        onClose={() => setShowStageDueDensity(false)}
      />
    )}
    </>
  );
}

// 取引先名を1つ入れてもらう小さな窓(prompt()の代わり)。Enterで保存、Esc(Modal側)・キャンセルで閉じる
function ClientNameDialog({
  title,
  initialValue,
  onSubmit,
  onClose,
}: {
  title: string;
  initialValue: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputId = useId();
  const canSave = value.trim() !== "";
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) onSubmit(value.trim());
        }}
      >
        <label htmlFor={inputId} className="block text-sm text-cream/70">
          取引先名
        </label>
        <input
          id={inputId}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
        />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-pill-outline text-sm" onClick={onClose}>
            キャンセル
          </button>
          <button type="submit" className="btn-pill text-sm" disabled={!canSave}>
            保存
          </button>
        </div>
      </form>
    </Modal>
  );
}
