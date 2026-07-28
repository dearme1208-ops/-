"use client";

import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { db, uid } from "@/lib/db";
import { findOrCreateMasterTask } from "@/lib/master";
import { upsertTemplateItemsFromCsv } from "@/lib/template";
import { templateItemsToCsv, templateCsvTemplate, parseTemplateCsv } from "@/lib/templateCsv";
import { downloadTextFile } from "@/lib/report";
import { formatHms, parseHmsToSeconds, todayStr } from "@/lib/time";
import type { MasterTask, TemplateItem, Weekday } from "@/lib/types";
import { WEEKDAY_LABELS } from "@/lib/types";
import Modal from "@/components/ui/Modal";
import MasterTaskPicker from "@/components/sections/MasterTaskPicker";

function SortableRow({ item, onDelete }: { item: TemplateItem; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center justify-between gap-2 rounded-lg bg-ink/50 px-3 py-2"
    >
      <div className="flex items-center gap-3">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab text-cream/40 active:cursor-grabbing"
          aria-label="並び替え"
        >
          ⠿
        </button>
        <div>
          <div className="text-xs text-cream/50">{item.category}</div>
          <div className="text-sm text-cream">{item.name}</div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-cream/50 tabular-nums">{formatHms(item.estimatedSeconds)}</span>
        <button className="text-xs text-alert" onClick={onDelete}>
          削除
        </button>
      </div>
    </div>
  );
}

export default function TemplateSection() {
  const [weekday, setWeekday] = useState<Weekday>(1);
  const [showPicker, setShowPicker] = useState(false);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importResult, setImportResult] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const items = useLiveQuery(
    () => db.templateItems.where("weekday").equals(weekday).sortBy("order"),
    [weekday]
  );
  const allItems = useLiveQuery(() => db.templateItems.toArray(), []);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  async function handleDragEnd(event: DragEndEvent) {
    if (!items) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    const reordered = arrayMove(items, oldIndex, newIndex);
    await db.transaction("rw", db.templateItems, async () => {
      for (let i = 0; i < reordered.length; i++) {
        await db.templateItems.update(reordered[i].id, { order: i });
      }
    });
  }

  async function deleteItem(id: string) {
    await db.templateItems.delete(id);
  }

  function downloadTemplate() {
    downloadTextFile("template_template.csv", templateCsvTemplate());
  }

  function exportCsv() {
    if (!allItems) return;
    downloadTextFile(`weekday_template_${todayStr()}.csv`, templateItemsToCsv(allItems));
  }

  async function importCsv(file: File) {
    const text = await file.text();
    const { rows, errors } = parseTemplateCsv(text);
    setImportErrors(errors);
    if (rows.length === 0) {
      setImportResult("");
      return;
    }
    const { created, updated } = await upsertTemplateItemsFromCsv(rows);
    setImportResult(`${created}件を新規追加、${updated}件を更新しました。`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {([1, 2, 3, 4, 5] as Weekday[]).map((w) => (
            <button
              key={w}
              onClick={() => setWeekday(w)}
              className={weekday === w ? "btn-pill text-sm" : "btn-pill-outline text-sm"}
            >
              {WEEKDAY_LABELS[w]}曜日
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
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
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-base font-bold">{WEEKDAY_LABELS[weekday]}曜日のテンプレート</h3>
          <button className="btn-pill-outline text-xs" onClick={() => setShowPicker(true)}>
            + 作業を追加
          </button>
        </div>
        {items && items.length > 0 ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {items.map((item) => (
                  <SortableRow key={item.id} item={item} onDelete={() => deleteItem(item.id)} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <p className="text-sm text-cream/50">この曜日にはまだ作業が登録されていません。</p>
        )}
      </div>

      {showPicker && (
        <TemplatePickerDialog
          weekday={weekday}
          existingCount={items?.length ?? 0}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}

function TemplatePickerDialog({
  weekday,
  existingCount,
  onClose,
}: {
  weekday: Weekday;
  existingCount: number;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"master" | "free">("master");
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [estimate, setEstimate] = useState("00:10:00");

  async function addFromMaster(master: MasterTask) {
    await db.templateItems.add({
      id: uid(),
      weekday,
      order: existingCount,
      masterTaskId: master.id,
      category: master.category,
      name: master.name,
      estimatedSeconds: master.estimatedSeconds,
    });
    onClose();
  }

  async function addFreeform() {
    if (!category.trim() || !name.trim()) return;
    const estimatedSeconds = parseHmsToSeconds(estimate);
    const master = await findOrCreateMasterTask(category, name, estimatedSeconds);
    await db.templateItems.add({
      id: uid(),
      weekday,
      order: existingCount,
      masterTaskId: master.id,
      category: category.trim(),
      name: name.trim(),
      estimatedSeconds,
    });
    onClose();
  }

  return (
    <Modal title={`${WEEKDAY_LABELS[weekday]}曜日に作業を追加`} onClose={onClose}>
      <div className="mb-3 flex gap-2">
        <button
          className={mode === "master" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
          onClick={() => setMode("master")}
        >
          マスタから選択
        </button>
        <button
          className={mode === "free" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
          onClick={() => setMode("free")}
        >
          自由入力
        </button>
      </div>
      {mode === "master" ? (
        <MasterTaskPicker onSelect={addFromMaster} />
      ) : (
        <div className="space-y-2">
          <input
            placeholder="業務区分（大項目）"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
          />
          <input
            placeholder="詳細作業名"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
          />
          <input
            placeholder="想定時間 hh:mm:ss"
            value={estimate}
            onChange={(e) => setEstimate(e.target.value)}
            className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
          />
          <button className="btn-pill text-sm" onClick={addFreeform}>
            追加
          </button>
        </div>
      )}
    </Modal>
  );
}
