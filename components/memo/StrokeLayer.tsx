"use client";

import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { db, uid } from "@/lib/db";
import { MEMO_BOARD_HEIGHT, MEMO_BOARD_WIDTH, MEMO_ERASER_RADIUS } from "@/lib/memo";
import type { MemoStroke } from "@/lib/types";

// ボードの手書き層。メモタブと統合ボードで同じものを使う。
//
// 手書きはボード(memoBoards)に紐づくので、どちらの画面で書いても同じ線が見える。
// 付箋・カードの下に敷き、手書き/消しゴムがOFFのときは pointer-events を切って
// カードのドラッグを邪魔しないようにする。

export default function StrokeLayer({
  boardId,
  strokes,
  zoom,
  penMode,
  eraseMode,
  penColor,
  penWidth,
  canvasRef,
  onErased,
}: {
  boardId: string;
  strokes: MemoStroke[] | undefined;
  zoom: number;
  penMode: boolean;
  eraseMode: boolean;
  penColor: string;
  penWidth: number;
  /** 画像として書き出す等、外から実体が要る場合に渡す */
  canvasRef?: RefObject<HTMLCanvasElement>;
  /** 消したストロークをまとめて渡す(取り消し用) */
  onErased?: (removed: MemoStroke[]) => void;
}) {
  const innerRef = useRef<HTMLCanvasElement>(null);
  const ref = canvasRef ?? innerRef;

  // devicePixelRatio対応。手書き線がぼやけないよう、内部解像度だけ上げてCSS表示サイズは固定する
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = MEMO_BOARD_WIDTH * dpr;
    canvas.height = MEMO_BOARD_HEIGHT * dpr;
    canvas.style.width = `${MEMO_BOARD_WIDTH}px`;
    canvas.style.height = `${MEMO_BOARD_HEIGHT}px`;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.scale(dpr, dpr);
  }, [boardId, ref]);

  // 保存済みのストロークが変わるたびに全描画し直す(通常の線数であれば軽い処理)
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, MEMO_BOARD_WIDTH, MEMO_BOARD_HEIGHT);
    for (const s of strokes ?? []) {
      if (s.points.length < 2) continue;
      ctx.beginPath();
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.moveTo(s.points[0].x, s.points[0].y);
      for (const p of s.points.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
  }, [strokes, ref]);

  // 描画中のストローク座標。React stateにせず、pointermoveのたびに再レンダーが
  // 走らないようにする(タッチペンでの手書きが重くならないようにするための要)
  const drawingRef = useRef<{ x: number; y: number }[] | null>(null);

  // offsetX/offsetYはCSSのtransform: scale()配下での挙動がブラウザによって
  // 一貫しないため、getBoundingClientRect()から自前でズーム込みのボード論理座標に
  // 変換する(ズームしても手書きの座標が狂わないようにするための要)
  function getBoardPoint(clientX: number, clientY: number): { x: number; y: number } {
    const canvas = ref.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom };
  }

  // 消しゴムでなぞった軌跡上にあるストロークを丸ごと削除する。1回のドラッグで消した分は
  // まとめて1件として呼び出し元へ渡す
  const erasedIdsRef = useRef<Set<string>>(new Set());
  const erasedStrokesRef = useRef<MemoStroke[]>([]);
  function eraseAt(point: { x: number; y: number }) {
    for (const s of strokes ?? []) {
      if (erasedIdsRef.current.has(s.id)) continue;
      const hit = s.points.some((p) => Math.hypot(p.x - point.x, p.y - point.y) <= MEMO_ERASER_RADIUS);
      if (hit) {
        erasedIdsRef.current.add(s.id);
        erasedStrokesRef.current.push(s);
        db.memoStrokes.delete(s.id);
      }
    }
  }

  function onPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = ref.current;
    if (!canvas) return;
    if (eraseMode) {
      canvas.setPointerCapture(e.pointerId);
      erasedIdsRef.current = new Set();
      erasedStrokesRef.current = [];
      eraseAt(getBoardPoint(e.clientX, e.clientY));
      return;
    }
    if (!penMode) return;
    canvas.setPointerCapture(e.pointerId);
    const point = getBoardPoint(e.clientX, e.clientY);
    drawingRef.current = [point];
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.beginPath();
      ctx.strokeStyle = penColor;
      ctx.lineWidth = penWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.moveTo(point.x, point.y);
    }
  }

  function onPointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (eraseMode) {
      if (e.buttons !== 1) return;
      eraseAt(getBoardPoint(e.clientX, e.clientY));
      return;
    }
    if (!drawingRef.current) return;
    const point = getBoardPoint(e.clientX, e.clientY);
    drawingRef.current.push(point);
    const ctx = ref.current?.getContext("2d");
    if (ctx) {
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
  }

  async function onPointerUp() {
    if (eraseMode) {
      if (erasedStrokesRef.current.length > 0) onErased?.(erasedStrokesRef.current);
      erasedIdsRef.current = new Set();
      erasedStrokesRef.current = [];
      return;
    }
    const points = drawingRef.current;
    drawingRef.current = null;
    if (!points || points.length < 2 || !boardId) return;
    await db.memoStrokes.add({ id: uid(), boardId, points, color: penColor, width: penWidth, createdAt: Date.now() });
  }

  return (
    <canvas
      ref={ref}
      width={MEMO_BOARD_WIDTH}
      height={MEMO_BOARD_HEIGHT}
      className="absolute left-0 top-0"
      style={{
        touchAction: "none",
        pointerEvents: penMode || eraseMode ? "auto" : "none",
        cursor: eraseMode ? "cell" : undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
}
