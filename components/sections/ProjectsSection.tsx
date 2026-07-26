"use client";

import { useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import { findOrCreateMasterTask } from "@/lib/master";
import { daysBetweenDateStrs, formatDateJp, todayStr } from "@/lib/time";
import type { DailyTask, ProjectItem } from "@/lib/types";
import ProjectsCalendarView from "@/components/sections/ProjectsCalendarView";
import EditProjectDialog from "@/components/sections/EditProjectDialog";

type ViewMode = "gantt" | "calendar";

const DEFAULT_PX_PER_DAY = 28;
const MIN_PX_PER_DAY = 0.3;
const MAX_PX_PER_DAY = 80;
const ROW_H = 40;
const MIN_LABEL_SPACING_PX = 50;

export default function ProjectsSection() {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [workName, setWorkName] = useState("");
  const [dueDate, setDueDate] = useState(todayStr());
  const [pxPerDay, setPxPerDay] = useState(DEFAULT_PX_PER_DAY);
  const [addedMessage, setAddedMessage] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("gantt");
  const [editingProject, setEditingProject] = useState<ProjectItem | null>(null);
  const [showForm, setShowForm] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const projects = useLiveQuery(() => db.projects.orderBy("dueDate").toArray(), []);
  const today = todayStr();

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
    await db.projects.update(item.id, { completedAt: item.completedAt ? undefined : Date.now() });
  }

  async function addToToday(item: ProjectItem) {
    // 旧データ(業務区分未登録)との互換のため、未設定なら件名にフォールバックする
    const taskCategory = item.category || item.title;
    const master = await findOrCreateMasterTask(taskCategory, item.workName, 0);
    const count = (await db.dailyTasks.where("date").equals(today).toArray()).length;
    const task: DailyTask = {
      id: uid(),
      date: today,
      order: count,
      masterTaskId: master.id,
      category: taskCategory,
      name: item.workName,
      estimatedSeconds: master.estimatedSeconds,
      status: "pending",
      segments: [],
      accumulatedMs: 0,
      isSpontaneous: true,
    };
    await db.dailyTasks.add(task);
    setAddedMessage(`「${item.workName}」を本日の作業に追加しました。`);
    setTimeout(() => setAddedMessage(""), 3000);
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
      return { project: p, barStart, barEnd: Math.max(barEnd, barStart), overdue, daysLeft };
    });
    return { rangeStartStr: start, totalDays: total, rows: computedRows };
  }, [projects, today]);

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

      {addedMessage && <p className="text-xs text-cream/70">{addedMessage}</p>}

      <div className="panel divide-y divide-cream/10">
        {rows.map(({ project, overdue, daysLeft }) => (
          <div key={project.id} className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 ${project.completedAt ? "opacity-50" : ""}`}>
            <div>
              <div className="text-xs text-cream/50">
                {project.title}
                {project.category && <span className="ml-2 text-cream/40">［{project.category}］</span>}
              </div>
              <div className="text-sm text-cream">{project.workName}</div>
              <div className={`text-xs ${overdue ? "text-alert font-bold" : "text-cream/60"}`}>
                期日 {project.dueDate} {project.completedAt ? "（完了）" : overdue ? `（${-daysLeft}日超過）` : `（残り${daysLeft}日）`}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="btn-pill-outline text-xs" onClick={() => addToToday(project)}>
                本日の作業に追加
              </button>
              <button className="btn-pill-outline text-xs" onClick={() => toggleComplete(project)}>
                {project.completedAt ? "未完了に戻す" : "完了"}
              </button>
              <button className="text-xs text-cream/60 hover:text-cream" onClick={() => setEditingProject(project)}>
                編集
              </button>
              <button className="text-xs text-alert" onClick={() => deleteProject(project)}>
                削除
              </button>
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="px-4 py-6 text-sm text-cream/50">案件はまだ登録されていません。</p>}
      </div>

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
          </div>

          {viewMode === "calendar" ? (
            <ProjectsCalendarView projects={projects ?? []} today={today} />
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
              {rows.map((r) => (
                <div
                  key={r.project.id}
                  className="flex flex-col justify-center overflow-hidden text-[11px] leading-tight text-cream/70"
                  style={{ height: ROW_H }}
                  title={`${r.project.title} / ${r.project.workName}`}
                >
                  <span className="truncate text-cream/50">{r.project.title}</span>
                  <span className="truncate">{r.project.workName}</span>
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

                <div className="relative" style={{ height: rows.length * ROW_H }}>
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
                  {rows.map((r, idx) => {
                    const top = idx * ROW_H;
                    const left = r.barStart * pxPerDay;
                    const width = Math.max((r.barEnd - r.barStart) * pxPerDay, 3);
                    return (
                      <div key={r.project.id} className="absolute left-0 right-0" style={{ top, height: ROW_H }}>
                        <div
                          className={`absolute rounded ${
                            r.project.completedAt ? "bg-cream/30" : r.overdue ? "bg-alert" : "bg-cream/70"
                          }`}
                          style={{ left, width, top: 9, height: 20 }}
                          title={`${r.project.title} / ${r.project.workName}（期日 ${r.project.dueDate}）`}
                        />
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
    </div>
  );
}
