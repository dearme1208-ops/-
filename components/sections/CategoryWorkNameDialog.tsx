"use client";

import { useState } from "react";
import type { MasterTask } from "@/lib/types";
import Modal from "@/components/ui/Modal";
import MasterTaskPicker from "@/components/sections/MasterTaskPicker";

// 大項目・詳細作業名を、自由入力か作業マスタからの選択で確定させる共通ダイアログ
export default function CategoryWorkNameDialog({
  title,
  confirmLabel,
  defaultCategory,
  defaultWorkName,
  toggleLabel,
  defaultToggle = false,
  onConfirm,
  onClose,
}: {
  title: string;
  confirmLabel: string;
  defaultCategory?: string;
  defaultWorkName?: string;
  // 指定すると、追加のチェックボックスを表示する(例: 「追加してすぐ開始する」)。
  // 省略時はチェックボックス自体を出さない
  toggleLabel?: string;
  defaultToggle?: boolean;
  onConfirm: (category: string, workName: string, toggle: boolean) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"free" | "master">("free");
  const [category, setCategory] = useState(defaultCategory ?? "");
  const [workName, setWorkName] = useState(defaultWorkName ?? "");
  const [toggle, setToggle] = useState(defaultToggle);

  function confirmFree() {
    if (!category.trim() || !workName.trim()) return;
    onConfirm(category.trim(), workName.trim(), toggle);
  }

  function confirmMaster(t: MasterTask) {
    onConfirm(t.category, t.name, toggle);
  }

  return (
    <Modal title={title} onClose={onClose}>
      <div className="mb-3 flex gap-2">
        <button
          className={mode === "free" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
          onClick={() => setMode("free")}
        >
          自由入力
        </button>
        <button
          className={mode === "master" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
          onClick={() => setMode("master")}
        >
          マスタから選択
        </button>
      </div>
      {toggleLabel && (
        <label className="mb-3 flex items-center gap-1.5 text-xs text-cream/70">
          <input
            type="checkbox"
            checked={toggle}
            onChange={(e) => setToggle(e.target.checked)}
            className="h-4 w-4 rounded border-cream/30 bg-ink accent-cream"
          />
          {toggleLabel}
        </label>
      )}
      {mode === "free" ? (
        <div className="space-y-2">
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
          <button className="btn-pill text-sm" onClick={confirmFree} disabled={!category.trim() || !workName.trim()}>
            {confirmLabel}
          </button>
        </div>
      ) : (
        <MasterTaskPicker onSelect={confirmMaster} />
      )}
    </Modal>
  );
}
