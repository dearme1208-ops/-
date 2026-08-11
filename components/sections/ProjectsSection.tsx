"use client";

import { useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import { findOrCreateMasterTask } from "@/lib/master";
import { upsertProjectsFromCsv } from "@/lib/projects";
import { computeRemainingEstimatedSeconds } from "@/lib/tasks";
import { projectsToCsv, projectsCsvTemplate, parseProjectsCsv } from "@/lib/projectsCsv";
import { downloadTextFile } from "@/lib/report";
import { computeCost, formatYen, parseCategoryRates, resolveCategoryRate } from "@/lib/cost";
import { computeProjectProgress, isStageDone } from "@/lib/projectStage";
import { useSetting } from "@/lib/settings";
import { daysBetweenDateStrs, formatDateJp, formatHms, todayStr } from "@/lib/time";
import type { DailyTask, ProjectItem, ProjectStage } from "@/lib/types";
import ProjectsCalendarView from "@/components/sections/ProjectsCalendarView";
import EditProjectDialog from "@/components/sections/EditProjectDialog";
import CategoryWorkNameDialog from "@/components/sections/CategoryWorkNameDialog";
import Modal from "@/components/ui/Modal";

type ViewMode = "gantt" | "calendar";

const DEFAULT_PX_PER_DAY = 28;
const MIN_PX_PER_DAY = 0.3;
const MAX_PX_PER_DAY = 80;
const ROW_H = 40;
const MIN_LABEL_SPACING_PX = 50;

export default function ProjectsSection({ onAddedToToday }: { onAddedToToday?: () => void }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [workName, setWorkName] = useState("");
  const [dueDate, setDueDate] = useState(todayStr());
  const [pxPerDay, setPxPerDay] = useState(DEFAULT_PX_PER_DAY);
  const [viewMode, setViewMode] = useState<ViewMode>("gantt");
  const [editingProject, setEditingProject] = useState<ProjectItem | null>(null);
  const [addToTodayTarget, setAddToTodayTarget] = useState<ProjectItem | null>(null);
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
  const today = todayStr();

  const [defaultHourlyRateStr] = useSetting("cost.defaultHourlyRate", "");
  const defaultHourlyRate = Number(defaultHourlyRateStr) > 0 ? Number(defaultHourlyRateStr) : null;
  const [categoryRatesJson] = useSetting("cost.categoryRates", "{}");
  const categoryRates = useMemo(() => parseCategoryRates(categoryRatesJson), [categoryRatesJson]);

  // 案件の概算金額 = (専用単価 ?? カテゴリ別単価 ?? デフォルト単価) × 累計作業時間
  function resolveProjectRate(project: ProjectItem): number | null {
    return project.hourlyRate ?? resolveCategoryRate(project.category, categoryRates, defaultHourlyRate);
  }

  // 案件ごとの累計作業時間（全期間の実績を合算）
  const projectTotalSeconds = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of records ?? []) {
      if (!r.projectId) continue;
      map.set(r.projectId, (map.get(r.projectId) ?? 0) + r.seconds);
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
      createdAt: Date.now(),
    };
    await db.projects.add(item);
    setTitle("");
    setCategory("");
    setWorkName("");
    setDueDate(todayStr());
  }

  async function deleteProject(item: ProjectItem) {
    if (!confirm(`「${item.title}」を削除しますか?`)) return;
    await db.projects.delete(item.id);
  }

  async function toggleComplete(item: ProjectItem) {
    const nowCompleting = !item.completedAt;
    const completedAt = nowCompleting ? Date.now() : undefined;
    await db.projects.update(item.id, { completedAt });
    if (nowCompleting) {
      const projectRecords = (records ?? []).filter((r) => r.projectId === item.id);
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

  async function addToToday(item: ProjectItem, category: string, workName: string, stageId?: string) {
    const master = await findOrCreateMasterTask(category, workName, 0);
    const estimatedSeconds = await computeRemainingEstimatedSeconds(
      today,
      category,
      workName,
      master.estimatedSeconds
    );
    const count = (await db.dailyTasks.where("date").equals(today).toArray()).length;
    const task: DailyTask = {
      id: uid(),
      date: today,
      order: count,
      masterTaskId: master.id,
      category,
      name: workName,
      estimatedSeconds,
      status: "pending",
      segments: [],
      accumulatedMs: 0,
      isSpontaneous: true,
      projectId: item.id,
      stageId,
    };
    await db.dailyTasks.add(task);
    onAddedToToday?.();
  }

  async function toggleProjectStage(project: ProjectItem, stageId: string) {
    const stages = (project.stages ?? []).map((s) => (s.id === stageId ? { ...s, completed: !s.completed } : s));
    await db.projects.update(project.id, { stages });
  }

  // 段階を本日の作業に追加する前に、案件の業務区分(大項目)を引き継ぎ、
  // 詳細作業名にはこの段階名がそのまま入ることを明示してから確認する
  async function addStageToTodayWithConfirm(project: ProjectItem, stage: ProjectStage) {
    const countNote =
      stage.targetCount != null ? `\n件数: ${stage.completedCount ?? 0}/${stage.targetCount}件（完了時に1件進みます）` : "";
    const ok = confirm(
      `本日の作業に追加します。\n\n業務区分（大項目）: ${project.category || project.title}\n詳細作業名: ${stage.title}${countNote}\n\nよろしいですか?`
    );
    if (!ok) return;
    await addToToday(project, project.category, stage.title, stage.id);
  }

  const { rangeStartStr, totalDays, rows } = useMemo(() => {
    const list = projects ?? [];
    let start = today;
    let end = today;
    for (const p of list) {
      const createdStr = todayStr(new Date(p.createdAt));
      if (createdStr < start) start = createdStr;
      if (p.dueDate < start) start = p.dueDate;
      if (p.dueDate > end) end = p.dueDate;
    }
    end = todayStr(new Date(new Date(end + "T00:00:00").getTime() + 2 * 86400000));
    const total = Math.max(daysBetweenDateStrs(start, end), 1);
    const computedRows = list.map((p) => {
      const createdStr = todayStr(new Date(p.createdAt));
      const barStart = daysBetweenDateStrs(start, createdStr);
      const barEnd = daysBetweenDateStrs(start, p.dueDate);
      const overdue = !p.completedAt && p.dueDate < today;
      const daysLeft = daysBetweenDateStrs(today, p.dueDate);
      // 消化ペースの簡易判定: 想定工数が無いため「経過日数のうち何割の日に着手できているか」で代用する
      // (残り日数が僅かなのに、これまでほとんど着手できていない場合に注意を促す)
      const daysElapsed = Math.max(1, daysBetweenDateStrs(createdStr, today) + 1);
      const workDays = projectWorkDays.get(p.id)?.size ?? 0;
      const paceWarning = !p.completedAt && daysLeft <= 3 && daysLeft >= 0 && workDays / daysElapsed < 0.3;
      return { project: p, barStart, barEnd: Math.max(barEnd, barStart), overdue, daysLeft, paceWarning };
    });
    return { rangeStartStr: start, totalDays: total, rows: computedRows };
  }, [projects, today, projectWorkDays]);

  const activeRows = useMemo(() => rows.filter((r) => !r.project.completedAt), [rows]);
  const completedRows = useMemo(() => rows.filter((r) => !!r.project.completedAt), [rows]);

  // ガントチャート・カレンダーは既定で未完了の案件だけを表示する(一覧の「完了済み」欄と同様、
  // デフォルトでは埋もれさせない)。トグルで完了済みも重ねて表示できる
  const [showCompletedInTimeline, setShowCompletedInTimeline] = useState(false);
  const timelineRows = useMemo(
    () => (showCompletedInTimeline ? rows : activeRows),
    [rows, activeRows, showCompletedInTimeline]
  );

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
            <div className="flex items-center gap-2">
              <label className="text-xs text-cream/60">期日</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
              />
            </div>
            <button className="btn-pill text-sm" onClick={addProject}>
              追加
            </button>
          </div>
        )}
      </div>


      <div className="panel divide-y divide-cream/10">
        {activeRows.map(({ project, overdue, daysLeft, paceWarning }) => (
          <ProjectRow
            key={project.id}
            project={project}
            overdue={overdue}
            daysLeft={daysLeft}
            paceWarning={paceWarning}
            totalSeconds={projectTotalSeconds.get(project.id) ?? 0}
            hourlyRate={resolveProjectRate(project)}
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
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-display text-base font-bold">期日ガントチャート</h3>
                <div className="flex items-center gap-1">
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
          onConfirm={(category, workName) => {
            addToToday(addToTodayTarget, category, workName);
            setAddToTodayTarget(null);
          }}
          onClose={() => setAddToTodayTarget(null)}
        />
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
  daysLeft,
  paceWarning,
  totalSeconds,
  hourlyRate,
  stageSecondsFor,
  onAddToToday,
  onToggleComplete,
  onEdit,
  onDelete,
  onToggleStage,
  onAddStageToToday,
}: {
  project: ProjectItem;
  overdue: boolean;
  daysLeft: number;
  paceWarning?: boolean;
  totalSeconds: number;
  hourlyRate: number | null;
  stageSecondsFor: (stageId: string) => number;
  onAddToToday: () => void;
  onToggleComplete: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleStage: (stageId: string) => void;
  onAddStageToToday: (stage: ProjectStage) => void;
}) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 ${project.completedAt ? "opacity-50" : ""}`}>
      <div>
        <div className="text-xs text-cream/50">
          {project.title}
          {project.category && <span className="ml-2 text-cream/40">［{project.category}］</span>}
        </div>
        <div className="text-sm text-cream">{project.workName}</div>
        <div className={`text-xs ${overdue ? "text-alert font-bold" : "text-cream/60"}`}>
          期日 {project.dueDate} {project.completedAt ? "（完了）" : overdue ? `（${-daysLeft}日超過）` : `（残り${daysLeft}日）`}
        </div>
        {paceWarning && (
          <div className="text-xs font-bold text-alert" title="残り日数が少ないですが、これまであまり着手できていないようです">
            ⚠ ペースに遅れの可能性
          </div>
        )}
        {project.stages && project.stages.length > 0 && (
          <div className="mt-1 max-w-[220px]">
            <div className="mb-0.5 flex items-center justify-between text-[10px] text-cream/50">
              <span>進捗 {project.stages.length}段階</span>
              <span className="font-bold tabular-nums text-cream/70">
                {Math.round((computeProjectProgress(project.stages) ?? 0) * 100)}%
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-cream/5">
              <div
                className="h-1.5 rounded-full bg-cream"
                style={{
                  width: `${Math.round((computeProjectProgress(project.stages) ?? 0) * 100)}%`,
                }}
              />
            </div>
            <div className="mt-1.5 space-y-1">
              {project.stages.map((stage) => {
                const seconds = stageSecondsFor(stage.id);
                const isCountBased = stage.targetCount != null;
                const done = isStageDone(stage);
                return (
                  <div key={stage.id} className="flex items-center gap-1.5">
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
                      <span className="shrink-0 text-[10px] text-cream/40">{stage.dueDate}</span>
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
