"use client";

import { useState } from "react";
import { db } from "@/lib/db";
import type { ProjectItem } from "@/lib/types";

// 案件の振り返り(次に同じ種類の案件をやるとき気をつけること)。「型にして作る」で
// 同じ種類の新しい案件を作るときに見られる。入力中の値はこの部品の中だけで持ち、
// DBからの反映で入力欄を上書きしない(日本語入力の変換が崩れないように)
export default function RetrospectiveInput({ project }: { project: ProjectItem }) {
  const [text, setText] = useState(project.retrospective ?? "");
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold text-cream/70">📝 振り返り（次に同じ種類の案件をやるとき気をつけること）</span>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          db.projects.update(project.id, { retrospective: e.target.value.trim() ? e.target.value : undefined });
        }}
        rows={3}
        placeholder="例: 先方の担当が2人いるので、見積の送付は両方にCCする"
        className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
        aria-label="案件の振り返り"
      />
      <span className="text-[10px] text-cream/40">「📐 型にして作る」で同じ種類の案件を作るときに表示されます。</span>
    </label>
  );
}
