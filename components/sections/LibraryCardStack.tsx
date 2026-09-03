"use client";

import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import type { DailyTask } from "@/lib/types";

// 図書館モード専用: 通常の縦リストの代わりに、タスクをインデックスカードの束として
// 見せ、右スワイプ/左スワイプで操作する。カードの実際の中身(ボタン等)は呼び出し側の
// renderCardをそのまま使うため、この束自体はドラッグ演出と束の並び順(＝tasksの並び順)を
// 管理するだけで、タスクの状態は一切持たない。スワイプで確定した操作(開始/完了/後回し等)は
// 呼び出し側でDBを更新し、それによってtasksが再ソートされ、自然に次のカードが先頭に来る
const SWIPE_THRESHOLD_PX = 90;
const MAX_VISIBLE_LAYERS = 4;

export default function LibraryCardStack({
  tasks,
  renderCard,
  onSwipeRight,
  onSwipeLeft,
  rightStampLabel,
  leftStampLabel,
}: {
  tasks: DailyTask[];
  renderCard: (task: DailyTask) => ReactNode;
  onSwipeRight: (task: DailyTask) => void;
  onSwipeLeft: (task: DailyTask) => void;
  rightStampLabel: (task: DailyTask) => string;
  leftStampLabel: (task: DailyTask) => string | null;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const [stamp, setStamp] = useState<{ label: string; key: number } | null>(null);
  const dragStartX = useRef<number | null>(null);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartX.current = e.clientX;
    setDrag(0);
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (dragStartX.current === null) return;
    setDrag(e.clientX - dragStartX.current);
  }
  function onPointerUp() {
    const dx = drag;
    dragStartX.current = null;
    setDrag(null);
    if (dx === null) return;
    const top = tasks[0];
    if (!top) return;
    if (dx > SWIPE_THRESHOLD_PX) {
      const label = rightStampLabel(top);
      setStamp({ label, key: Date.now() });
      onSwipeRight(top);
    } else if (dx < -SWIPE_THRESHOLD_PX) {
      const label = leftStampLabel(top);
      if (label) setStamp({ label, key: Date.now() });
      onSwipeLeft(top);
    }
  }

  if (tasks.length === 0) return null;

  const visible = tasks.slice(0, MAX_VISIBLE_LAYERS);

  return (
    <div className="space-y-2" data-library-card-stack>
      <div className="relative">
        {visible.map((task, i) => {
          const isTop = i === 0;
          const dx = isTop && drag !== null ? drag : 0;
          const dragRotate = isTop && drag !== null ? drag / 20 : 0;
          const restRotate = i === 0 ? 0 : (i % 2 === 0 ? -1 : 1) * (1.4 + i * 0.7);
          return (
            <div
              key={task.id}
              data-library-stack-card={isTop ? "top" : "back"}
              className={isTop ? "relative" : "absolute inset-0"}
              style={{
                zIndex: MAX_VISIBLE_LAYERS - i,
                transform: isTop
                  ? `translateX(${dx}px) rotate(${dragRotate}deg)`
                  : `translateY(${i * 8}px) rotate(${restRotate}deg) scale(${1 - i * 0.02})`,
                transition: isTop && drag !== null ? "none" : "transform 0.25s ease",
                touchAction: isTop ? "pan-y" : undefined,
                pointerEvents: isTop ? undefined : "none",
                opacity: isTop ? 1 : Math.max(0.4, 1 - i * 0.16),
              }}
              onPointerDown={isTop ? onPointerDown : undefined}
              onPointerMove={isTop ? onPointerMove : undefined}
              onPointerUp={isTop ? onPointerUp : undefined}
              onPointerCancel={isTop ? onPointerUp : undefined}
            >
              {renderCard(task)}
            </div>
          );
        })}
        {stamp && (
          <div key={stamp.key} className="library-stamp" onAnimationEnd={() => setStamp(null)} aria-hidden="true">
            <span>{stamp.label}</span>
          </div>
        )}
      </div>
      <p className="text-center text-xs text-cream/40">
        右にスワイプで手前のカードを処理、左にスワイプで後ろへ送ります（{tasks.length}枚）
      </p>
    </div>
  );
}
