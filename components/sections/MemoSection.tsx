"use client";

import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import { useSetting } from "@/lib/settings";
import { downloadTextFile } from "@/lib/report";
import { createSpeechRecognition } from "@/lib/voice";
import { showUndoToast } from "@/lib/toast";
import {
  clampMemoZoom,
  DEFAULT_MEMO_NOTE_COLOR,
  DEFAULT_MEMO_PEN_COLOR,
  DEFAULT_MEMO_PEN_WIDTH,
  estimateTextNoteHeight,
  MEMO_BOARD_HEIGHT,
  MEMO_BOARD_WIDTH,
  MEMO_ERASER_RADIUS,
  MEMO_NOTE_COLORS,
  MEMO_NOTE_MIN_HEIGHT,
  MEMO_NOTE_MIN_WIDTH,
  MEMO_PEN_COLORS,
  parseMemoBoardImport,
  serializeMemoBoard,
} from "@/lib/memo";
import { formatMailNoteText, parseMsgFile, readFileAsDataUrl } from "@/lib/mailImport";
import type { MemoChecklistItem, MemoConnector, MemoNote, MemoStroke } from "@/lib/types";
import { todayStr } from "@/lib/time";

// 直前に削除した付箋/手書き/連結を一時的に保持しておき、トーストから元に戻せるようにする
type MemoUndoEntry =
  | { type: "note"; note: MemoNote; connectors: MemoConnector[] }
  | { type: "strokes"; strokes: MemoStroke[]; label: string }
  | { type: "connector"; connector: MemoConnector };

const MEMO_MINIMAP_WIDTH = 140;
const MEMO_MINIMAP_HEIGHT = Math.round((MEMO_MINIMAP_WIDTH * MEMO_BOARD_HEIGHT) / MEMO_BOARD_WIDTH);

// 付箋+手書きのメモボード。無限キャンバスにはせず、固定サイズの1ページを
// スクロールして使う(はみ出す分は横/縦スクロール)。複数ボードを切り替えられる
export default function MemoSection() {
  const boards = useLiveQuery(() => db.memoBoards.orderBy("order").toArray(), []);
  const [selectedBoardId, setSelectedBoardId] = useSetting("memo.selectedBoardId", "");

  // 初回は既定のボードを1つ用意しておく(他のタブの既定リスト生成と同じパターン)
  useEffect(() => {
    if (boards && boards.length === 0) {
      db.memoBoards.add({ id: uid(), title: "メモ", order: 0, createdAt: Date.now() });
    }
  }, [boards]);

  useEffect(() => {
    if (boards && boards.length > 0 && !boards.some((b) => b.id === selectedBoardId)) {
      setSelectedBoardId(boards[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boards, selectedBoardId]);

  const currentBoard = (boards ?? []).find((b) => b.id === selectedBoardId) ?? null;

  const notes = useLiveQuery(
    () => (selectedBoardId ? db.memoNotes.where("boardId").equals(selectedBoardId).toArray() : Promise.resolve([] as MemoNote[])),
    [selectedBoardId]
  );
  const strokes = useLiveQuery(
    () => (selectedBoardId ? db.memoStrokes.where("boardId").equals(selectedBoardId).toArray() : Promise.resolve([] as MemoStroke[])),
    [selectedBoardId]
  );
  const connectors = useLiveQuery(
    () =>
      selectedBoardId ? db.memoConnectors.where("boardId").equals(selectedBoardId).toArray() : Promise.resolve([] as MemoConnector[]),
    [selectedBoardId]
  );
  const notesById = new Map((notes ?? []).map((n) => [n.id, n]));

  const [penMode, setPenMode] = useState(false);
  // 連結モード。ONの間は付箋をドラッグする代わりに、タップした2つの付箋を線で結ぶ
  const [connectMode, setConnectMode] = useState(false);
  const [connectFromId, setConnectFromId] = useState<string | null>(null);
  // 消しゴムモード。ONの間はなぞった位置に点を持つ手書きストロークを丸ごと消す
  const [eraseMode, setEraseMode] = useState(false);
  function togglePenMode() {
    setPenMode((v) => !v);
    setConnectMode(false);
    setConnectFromId(null);
    setEraseMode(false);
  }
  function toggleConnectMode() {
    setConnectMode((v) => !v);
    setPenMode(false);
    setConnectFromId(null);
    setEraseMode(false);
  }
  function toggleEraseMode() {
    setEraseMode((v) => !v);
    setPenMode(false);
    setConnectMode(false);
    setConnectFromId(null);
  }
  async function selectNoteForConnect(id: string) {
    if (!connectFromId) {
      setConnectFromId(id);
      return;
    }
    if (connectFromId === id) {
      setConnectFromId(null);
      return;
    }
    const fromId = connectFromId;
    setConnectFromId(null);
    if (!selectedBoardId) return;
    const exists = (connectors ?? []).some(
      (c) => (c.fromNoteId === fromId && c.toNoteId === id) || (c.fromNoteId === id && c.toNoteId === fromId)
    );
    if (exists) return;
    await db.memoConnectors.add({ id: uid(), boardId: selectedBoardId, fromNoteId: fromId, toNoteId: id, createdAt: Date.now() });
  }
  async function deleteConnector(id: string) {
    const connector = (connectors ?? []).find((c) => c.id === id);
    await db.memoConnectors.delete(id);
    if (connector) pushUndo({ type: "connector", connector });
  }
  async function editConnectorLabel(c: MemoConnector) {
    const label = prompt("線のラベル(空欄で削除)", c.label ?? "");
    if (label === null) return;
    await db.memoConnectors.update(c.id, { label: label.trim() });
  }

  // 誤って消してしまった付箋・手書き・連結線を、トーストの「元に戻す」から復元できるようにする
  const [undoEntry, setUndoEntry] = useState<MemoUndoEntry | null>(null);
  const undoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function pushUndo(entry: MemoUndoEntry) {
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    setUndoEntry(entry);
    undoTimeoutRef.current = setTimeout(() => setUndoEntry(null), 8000);
  }
  async function restoreUndo() {
    if (!undoEntry) return;
    if (undoEntry.type === "note") {
      await db.memoNotes.add(undoEntry.note);
      if (undoEntry.connectors.length > 0) await db.memoConnectors.bulkAdd(undoEntry.connectors);
    } else if (undoEntry.type === "strokes") {
      await db.memoStrokes.bulkAdd(undoEntry.strokes);
    } else if (undoEntry.type === "connector") {
      await db.memoConnectors.add(undoEntry.connector);
    }
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    setUndoEntry(null);
  }
  function undoMessage(entry: MemoUndoEntry): string {
    if (entry.type === "note") return "付箋を削除しました";
    if (entry.type === "connector") return "連結を削除しました";
    return entry.label;
  }
  const [penColor, setPenColor] = useState(DEFAULT_MEMO_PEN_COLOR);
  const [penWidth, setPenWidth] = useState(DEFAULT_MEMO_PEN_WIDTH);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // フィールド(ボード)の拡大縮小率。CSSのtransform: scale()で見た目だけ拡大縮小し、
  // 実際の付箋・手書きの座標(x, y, points等)はズームに関わらず常にボード上の
  // 論理座標のまま保つ(ズームはあくまで表示上の話)
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pinchRef = useRef<{ startDist: number; startZoom: number } | null>(null);

  // スマホ/タブレットでの2本指ピンチ操作でズームする。preventDefault()を確実に
  // 効かせるため(Reactのtouchmoveはデフォルトでpassiveのため)、ここだけネイティブの
  // addEventListenerを使う
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    function distanceOf(touches: TouchList): number {
      const a = touches[0];
      const b = touches[1];
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    }
    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) {
        pinchRef.current = { startDist: distanceOf(e.touches), startZoom: zoomRef.current };
      }
    }
    function onTouchMove(e: TouchEvent) {
      if (e.touches.length === 2 && pinchRef.current) {
        e.preventDefault();
        const scale = distanceOf(e.touches) / pinchRef.current.startDist;
        setZoom(clampMemoZoom(pinchRef.current.startZoom * scale));
      }
    }
    function onTouchEnd() {
      pinchRef.current = null;
    }
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [selectedBoardId]);

  // PC: Ctrl/Cmd+ホイール(トラックパッドのピンチもブラウザ側でこの形になる)でズーム。
  // 修飾キー無しの通常のホイールはこれまでどおりパネルのスクロールに使う
  function handleWheelZoom(e: ReactWheelEvent<HTMLDivElement>) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.01);
    setZoom((z) => clampMemoZoom(z * factor));
  }

  // ボード上の全ての付箋・手書きがちょうど収まるように拡大縮小・スクロール位置を自動調整する
  function fitToContent() {
    const container = scrollContainerRef.current;
    const allNotes = notes ?? [];
    const allPoints = (strokes ?? []).flatMap((s) => s.points);
    if (!container || (allNotes.length === 0 && allPoints.length === 0)) {
      setZoom(1);
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of allNotes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    }
    for (const p of allPoints) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const PADDING = 40;
    minX = Math.max(0, minX - PADDING);
    minY = Math.max(0, minY - PADDING);
    maxX = Math.min(MEMO_BOARD_WIDTH, maxX + PADDING);
    maxY = Math.min(MEMO_BOARD_HEIGHT, maxY + PADDING);
    const contentWidth = Math.max(1, maxX - minX);
    const contentHeight = Math.max(1, maxY - minY);
    const newZoom = clampMemoZoom(Math.min(container.clientWidth / contentWidth, container.clientHeight / contentHeight));
    setZoom(newZoom);
    requestAnimationFrame(() => {
      if (!scrollContainerRef.current) return;
      scrollContainerRef.current.scrollLeft = minX * newZoom - (container.clientWidth - contentWidth * newZoom) / 2;
      scrollContainerRef.current.scrollTop = minY * newZoom - (container.clientHeight - contentHeight * newZoom) / 2;
    });
  }
  // 付箋の検索。ヒットした付箋へジャンプ(スクロール)+一瞬ハイライトする
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [highlightedNoteId, setHighlightedNoteId] = useState<string | null>(null);
  const searchMatches = (() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return (notes ?? []).filter((n) => {
      const haystack = n.isChecklist ? (n.checklistItems ?? []).map((i) => i.text).join(" ") : n.text;
      return haystack.toLowerCase().includes(q);
    });
  })();
  function jumpToNote(note: MemoNote) {
    const container = scrollContainerRef.current;
    if (container) {
      const cx = (note.x + note.width / 2) * zoom;
      const cy = (note.y + note.height / 2) * zoom;
      container.scrollLeft = cx - container.clientWidth / 2;
      container.scrollTop = cy - container.clientHeight / 2;
    }
    setHighlightedNoteId(note.id);
    setTimeout(() => setHighlightedNoteId((v) => (v === note.id ? null : v)), 1600);
  }
  function searchStep(delta: number) {
    if (searchMatches.length === 0) return;
    const next = (searchIndex + delta + searchMatches.length) % searchMatches.length;
    setSearchIndex(next);
    jumpToNote(searchMatches[next]);
  }
  function handleSearchSubmit() {
    setSearchIndex(0);
    if (searchMatches.length > 0) jumpToNote(searchMatches[0]);
  }

  // ミニマップ用に現在のスクロール位置・表示範囲を追跡する
  const [scrollPos, setScrollPos] = useState({ left: 0, top: 0, w: 0, h: 0 });
  function handleScroll() {
    const el = scrollContainerRef.current;
    if (!el) return;
    setScrollPos({ left: el.scrollLeft, top: el.scrollTop, w: el.clientWidth, h: el.clientHeight });
  }
  useEffect(() => {
    handleScroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, selectedBoardId]);
  function handleMinimapClick(e: ReactMouseEvent<HTMLDivElement>) {
    const container = scrollContainerRef.current;
    if (!container) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mmScale = MEMO_MINIMAP_WIDTH / MEMO_BOARD_WIDTH;
    const boardX = (e.clientX - rect.left) / mmScale;
    const boardY = (e.clientY - rect.top) / mmScale;
    container.scrollLeft = boardX * zoom - container.clientWidth / 2;
    container.scrollTop = boardY * zoom - container.clientHeight / 2;
  }

  // 描画中のストローク座標。React stateにせず、pointermoveのたびに再レンダーが
  // 走らないようにする(タッチペンでの手書きが重くならないようにするための要)
  const drawingRef = useRef<{ x: number; y: number }[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mailFileInputRef = useRef<HTMLInputElement>(null);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceUnsupported, setVoiceUnsupported] = useState(false);
  const voiceRecognitionRef = useRef<ReturnType<typeof createSpeechRecognition>>(null);
  const [statusMessage, setStatusMessage] = useState("");
  // 付箋の重なり順。ドラッグ/新規作成/フォーカスのたびに増やして最前面へ出す
  const maxOrderRef = useRef(0);
  useEffect(() => {
    maxOrderRef.current = (notes ?? []).reduce((m, n) => Math.max(m, n.order), 0);
  }, [notes]);

  // devicePixelRatio対応。手書き線がぼやけないよう、内部解像度だけ上げてCSS表示サイズは固定する
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = MEMO_BOARD_WIDTH * dpr;
    canvas.height = MEMO_BOARD_HEIGHT * dpr;
    canvas.style.width = `${MEMO_BOARD_WIDTH}px`;
    canvas.style.height = `${MEMO_BOARD_HEIGHT}px`;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.scale(dpr, dpr);
  }, [selectedBoardId]);

  // 保存済みのストロークが変わるたびに全描画し直す(通常のノート数・線数であれば軽い処理)
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
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
  }, [strokes]);

  // offsetX/offsetYはCSSのtransform: scale()配下での挙動がブラウザによって
  // 一貫しないため、getBoundingClientRect()から自前でズーム込みのボード論理座標に
  // 変換する(ズームしても手書きの座標が狂わないようにするための要)
  function getBoardPoint(clientX: number, clientY: number): { x: number; y: number } {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom };
  }

  // 消しゴムでなぞった軌跡上にあるストロークを丸ごと削除する。1回のドラッグで消した分は
  // まとめて1件のUndoエントリにする
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
  function handleErasePointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!eraseMode) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    erasedIdsRef.current = new Set();
    erasedStrokesRef.current = [];
    eraseAt(getBoardPoint(e.clientX, e.clientY));
  }
  function handleErasePointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!eraseMode || e.buttons !== 1) return;
    eraseAt(getBoardPoint(e.clientX, e.clientY));
  }
  function handleErasePointerUp() {
    if (erasedStrokesRef.current.length > 0) {
      pushUndo({ type: "strokes", strokes: erasedStrokesRef.current, label: `手書き${erasedStrokesRef.current.length}本を消しました` });
    }
    erasedIdsRef.current = new Set();
    erasedStrokesRef.current = [];
  }
  function handleCanvasPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (eraseMode) return handleErasePointerDown(e);
    return handlePenPointerDown(e);
  }
  function handleCanvasPointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (eraseMode) return handleErasePointerMove(e);
    return handlePenPointerMove(e);
  }
  function handleCanvasPointerUp(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (eraseMode) return handleErasePointerUp();
    return handlePenPointerUp();
  }

  function handlePenPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!penMode) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
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
  function handlePenPointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const point = getBoardPoint(e.clientX, e.clientY);
    drawingRef.current.push(point);
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) {
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
  }
  async function handlePenPointerUp() {
    const points = drawingRef.current;
    drawingRef.current = null;
    if (!points || points.length < 2 || !selectedBoardId) return;
    await db.memoStrokes.add({ id: uid(), boardId: selectedBoardId, points, color: penColor, width: penWidth, createdAt: Date.now() });
  }

  async function undoLastStroke() {
    if (!strokes || strokes.length === 0) return;
    const last = [...strokes].sort((a, b) => a.createdAt - b.createdAt).pop();
    if (last) await db.memoStrokes.delete(last.id);
  }

  async function clearStrokes() {
    if (!selectedBoardId || !strokes || strokes.length === 0) return;
    if (!confirm("この手書きをすべて消去します。よろしいですか?")) return;
    const removed = [...strokes];
    await db.memoStrokes.where("boardId").equals(selectedBoardId).delete();
    pushUndo({ type: "strokes", strokes: removed, label: "手書きを全消去しました" });
  }

  async function addNote(text = "") {
    if (!selectedBoardId) return;
    maxOrderRef.current += 1;
    const offset = (maxOrderRef.current * 24) % 220;
    const note: MemoNote = {
      id: uid(),
      boardId: selectedBoardId,
      x: 40 + offset,
      y: 40 + offset,
      width: 220,
      height: 160,
      color: DEFAULT_MEMO_NOTE_COLOR,
      text,
      order: maxOrderRef.current,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await db.memoNotes.add(note);
  }

  // Outlookの.msgファイル(メールをファイルとして保存した際の既定形式)を1件、
  // 件名を先頭行にした付箋として取り込む。AIによる要約はできないため、
  // 「件名だけでどのメールか分かる」形にすることで概要把握の代わりにする
  const [mailImportBusy, setMailImportBusy] = useState(false);
  const [mailImportError, setMailImportError] = useState("");
  async function addMailNote(file: File) {
    if (!selectedBoardId) return;
    setMailImportBusy(true);
    setMailImportError("");
    try {
      const mail = await parseMsgFile(file);
      const text = formatMailNoteText(mail);
      const mailFileDataUrl = await readFileAsDataUrl(file);
      maxOrderRef.current += 1;
      const offset = (maxOrderRef.current * 24) % 220;
      const note: MemoNote = {
        id: uid(),
        boardId: selectedBoardId,
        x: 40 + offset,
        y: 40 + offset,
        width: 220,
        height: estimateTextNoteHeight(text) + 24,
        color: "blue",
        text,
        order: maxOrderRef.current,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        mailFileDataUrl,
        mailFileName: file.name,
      };
      await db.memoNotes.add(note);
    } catch {
      setMailImportError("メールファイルの読み込みに失敗しました。Outlookの.msg形式のファイルか確認してください。");
    } finally {
      setMailImportBusy(false);
    }
  }
  async function bringToFront(id: string) {
    maxOrderRef.current += 1;
    await db.memoNotes.update(id, { order: maxOrderRef.current });
  }
  async function moveNote(id: string, x: number, y: number) {
    await db.memoNotes.update(id, { x, y, updatedAt: Date.now() });
  }
  async function resizeNote(id: string, width: number, height: number) {
    await db.memoNotes.update(id, { width, height, updatedAt: Date.now() });
  }
  async function commitNoteText(id: string, text: string) {
    await db.memoNotes.update(id, { text, updatedAt: Date.now() });
  }
  async function deleteNote(id: string) {
    const note = notesById.get(id);
    // 空の付箋(書きかけで放置されただけのもの)は確認なしで消せるようにする。
    // 中身があるものは誤タップでの消失を防ぐため確認する(元に戻すトーストはあるが、
    // 消してから気づくより消す前に止められる方が安心なため)
    const hasContent = note && (note.isChecklist ? (note.checklistItems ?? []).some((i) => i.text.trim()) : note.text.trim());
    if (hasContent && !confirm("この付箋を削除しますか?")) return;
    const relatedConnectors = (connectors ?? []).filter((c) => c.fromNoteId === id || c.toNoteId === id);
    await db.transaction("rw", db.memoNotes, db.memoConnectors, async () => {
      await db.memoNotes.delete(id);
      await db.memoConnectors.where("fromNoteId").equals(id).delete();
      await db.memoConnectors.where("toNoteId").equals(id).delete();
    });
    if (note) pushUndo({ type: "note", note, connectors: relatedConnectors });
  }
  async function setNoteColor(id: string, color: string) {
    await db.memoNotes.update(id, { color });
  }
  async function duplicateNote(note: MemoNote) {
    if (!confirm("この付箋を複製しますか?")) return;
    maxOrderRef.current += 1;
    const copy: MemoNote = {
      ...note,
      id: uid(),
      x: Math.min(MEMO_BOARD_WIDTH - note.width, note.x + 24),
      y: Math.min(MEMO_BOARD_HEIGHT - note.height, note.y + 24),
      order: maxOrderRef.current,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      checklistItems: note.checklistItems?.map((item) => ({ ...item, id: uid() })),
    };
    await db.memoNotes.add(copy);
  }
  async function toggleChecklistMode(note: MemoNote) {
    const next = !note.isChecklist;
    // 表示モードを切り替えると、切り替え前の内容(テキスト⇔チェックリスト)は
    // データとしては残るものの画面上は見えなくなる。中身がある場合だけ確認する
    const hasContentToHide = next ? !!note.text.trim() : (note.checklistItems ?? []).some((i) => i.text.trim());
    if (hasContentToHide) {
      const message = next
        ? "チェックリスト表示に切り替えますか?(今のテキストは非表示になります)"
        : "テキスト表示に切り替えますか?(チェックリストの項目は非表示になります)";
      if (!confirm(message)) return;
    }
    const items = next && (!note.checklistItems || note.checklistItems.length === 0) ? [{ id: uid(), text: "", done: false }] : note.checklistItems;
    await db.memoNotes.update(note.id, { isChecklist: next, checklistItems: items });
  }
  async function updateChecklistItems(id: string, items: MemoChecklistItem[]) {
    await db.memoNotes.update(id, { checklistItems: items, updatedAt: Date.now() });
  }

  // 付箋のテキストを、そのままToDoの新規タスクとして追加する。既存のリストが
  // あればその先頭に、無ければ「タスク」という名前のリストを作って追加する
  function noteTextForConvert(note: MemoNote): string {
    if (note.isChecklist) {
      return (note.checklistItems ?? [])
        .map((i) => i.text.trim())
        .filter(Boolean)
        .join(" / ");
    }
    return note.text.trim();
  }

  async function convertNoteToTodo(note: MemoNote) {
    const title = noteTextForConvert(note);
    if (!title) return;
    if (!confirm(`「${title}」をToDoとして追加しますか?`)) return;
    let list = await db.todoLists.orderBy("order").first();
    if (!list) {
      list = { id: uid(), title: "タスク", order: 0, createdAt: Date.now() };
      await db.todoLists.add(list);
    }
    const count = await db.todoTasks.where("listId").equals(list.id).count();
    const id = uid();
    await db.todoTasks.add({
      id,
      listId: list.id,
      title,
      important: false,
      completed: false,
      order: count,
      createdAt: Date.now(),
    });
    showUndoToast(`ToDo「${title}」を追加しました`, async () => {
      await db.todoTasks.delete(id);
    });
  }

  // 付箋のテキストを、そのまま案件の新規項目として追加する。期日は未定のため
  // ひとまず今日にしておき、案件タブで後から調整してもらう想定
  async function convertNoteToProject(note: MemoNote) {
    const title = noteTextForConvert(note);
    if (!title) return;
    if (!confirm(`「${title}」を案件として追加しますか?`)) return;
    const id = uid();
    await db.projects.add({
      id,
      title,
      category: "メモ",
      workName: title,
      dueDate: todayStr(),
      createdAt: Date.now(),
    });
    showUndoToast(`案件「${title}」を追加しました`, async () => {
      await db.projects.delete(id);
    });
  }

  function startVoiceListening() {
    if (voiceListening) return;
    const recognition = createSpeechRecognition();
    if (!recognition) {
      setVoiceUnsupported(true);
      setStatusMessage("この端末・ブラウザは音声入力に対応していません");
      return;
    }
    voiceRecognitionRef.current = recognition;
    recognition.onresult = (e) => {
      const transcript = e.results?.[0]?.[0]?.transcript ?? "";
      if (transcript) {
        addNote(transcript);
        setStatusMessage(`🎤「${transcript}」を付箋にしました`);
      }
    };
    recognition.onerror = () => setStatusMessage("音声を認識できませんでした。もう一度お試しください");
    recognition.onend = () => setVoiceListening(false);
    setVoiceListening(true);
    recognition.start();
  }
  function stopVoiceListening() {
    voiceRecognitionRef.current?.stop();
    setVoiceListening(false);
  }

  function exportBoard() {
    if (!currentBoard) return;
    downloadTextFile(
      `memo_${currentBoard.title}_${todayStr()}.json`,
      serializeMemoBoard(currentBoard.title, notes ?? [], strokes ?? [], connectors ?? [])
    );
  }

  // 付箋・手書き・連結線を1枚の画像として書き出す(共有用)。DOM要素をそのまま
  // 画像化するのではなく、オフスクリーンcanvasへ手動で再描画する
  function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const lines: string[] = [];
    for (const rawLine of text.split("\n")) {
      let current = "";
      for (const ch of rawLine) {
        const trial = current + ch;
        if (current && ctx.measureText(trial).width > maxWidth) {
          lines.push(current);
          current = ch;
        } else {
          current = trial;
        }
      }
      lines.push(current);
    }
    return lines;
  }
  function exportBoardImage() {
    if (!currentBoard) return;
    const off = document.createElement("canvas");
    off.width = MEMO_BOARD_WIDTH;
    off.height = MEMO_BOARD_HEIGHT;
    const ctx = off.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#0f0f10";
    ctx.fillRect(0, 0, MEMO_BOARD_WIDTH, MEMO_BOARD_HEIGHT);
    if (canvasRef.current) ctx.drawImage(canvasRef.current, 0, 0, MEMO_BOARD_WIDTH, MEMO_BOARD_HEIGHT);
    for (const c of connectors ?? []) {
      const from = notesById.get(c.fromNoteId);
      const to = notesById.get(c.toNoteId);
      if (!from || !to) continue;
      const x1 = from.x + from.width / 2;
      const y1 = from.y + from.height / 2;
      const x2 = to.x + to.width / 2;
      const y2 = to.y + to.height / 2;
      ctx.strokeStyle = "rgba(253,230,138,0.75)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      if (c.label) {
        ctx.fillStyle = "#fde68a";
        ctx.font = "10px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(c.label, (x1 + x2) / 2, (y1 + y2) / 2 - 6);
      }
    }
    for (const n of notes ?? []) {
      const colors = MEMO_NOTE_COLORS[n.color] ?? MEMO_NOTE_COLORS[DEFAULT_MEMO_NOTE_COLOR];
      ctx.fillStyle = colors.bg;
      ctx.strokeStyle = colors.border;
      ctx.lineWidth = 2;
      ctx.fillRect(n.x, n.y, n.width, n.height);
      ctx.strokeRect(n.x, n.y, n.width, n.height);
      ctx.fillStyle = "#1a1a1a";
      ctx.font = "13px sans-serif";
      ctx.textAlign = "left";
      const bodyText = n.isChecklist
        ? (n.checklistItems ?? []).map((i) => `${i.done ? "☑" : "☐"} ${i.text}`).join("\n")
        : n.text;
      const lines = wrapCanvasText(ctx, bodyText, n.width - 16);
      lines.slice(0, Math.max(1, Math.floor((n.height - 16) / 16))).forEach((line, i) => {
        ctx.fillText(line, n.x + 8, n.y + 20 + i * 16, n.width - 16);
      });
    }
    off.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `memo_${currentBoard.title}_${todayStr()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, "image/png");
  }

  async function importBoard(file: File) {
    const text = await file.text();
    const data = parseMemoBoardImport(text);
    if (!data || !selectedBoardId) {
      setStatusMessage("このファイルは読み込めませんでした(メモのエクスポート形式ではありません)");
      return;
    }
    await db.transaction("rw", db.memoNotes, db.memoStrokes, db.memoConnectors, async () => {
      let order = maxOrderRef.current;
      const newIds: string[] = [];
      for (const n of data.notes) {
        order += 1;
        const id = uid();
        newIds.push(id);
        await db.memoNotes.add({ ...n, id, boardId: selectedBoardId, order });
      }
      for (const s of data.strokes) {
        await db.memoStrokes.add({ ...s, id: uid(), boardId: selectedBoardId });
      }
      for (const c of data.connectors) {
        const fromNoteId = newIds[c.fromIndex];
        const toNoteId = newIds[c.toIndex];
        if (!fromNoteId || !toNoteId) continue;
        await db.memoConnectors.add({ id: uid(), boardId: selectedBoardId, fromNoteId, toNoteId, createdAt: Date.now() });
      }
    });
    maxOrderRef.current += data.notes.length;
    setStatusMessage(`付箋${data.notes.length}件・手書き${data.strokes.length}件・連結${data.connectors.length}件を読み込みました`);
  }

  async function addBoard() {
    const title = prompt("新しいメモのタイトル");
    if (!title || !title.trim()) return;
    const count = boards?.length ?? 0;
    const id = uid();
    await db.memoBoards.add({ id, title: title.trim(), order: count, createdAt: Date.now() });
    setSelectedBoardId(id);
  }
  async function renameBoard() {
    if (!currentBoard) return;
    const title = prompt("メモのタイトルを変更", currentBoard.title);
    if (!title || !title.trim()) return;
    await db.memoBoards.update(currentBoard.id, { title: title.trim() });
  }
  async function deleteBoard() {
    if (!currentBoard || !boards) return;
    if (boards.length <= 1) {
      setStatusMessage("最後の1件は削除できません");
      return;
    }
    if (!confirm(`「${currentBoard.title}」を削除します。付箋・手書きもすべて削除されます。よろしいですか?`)) return;
    const boardId = currentBoard.id;
    await db.transaction("rw", db.memoBoards, db.memoNotes, db.memoStrokes, db.memoConnectors, async () => {
      await db.memoNotes.where("boardId").equals(boardId).delete();
      await db.memoStrokes.where("boardId").equals(boardId).delete();
      await db.memoConnectors.where("boardId").equals(boardId).delete();
      await db.memoBoards.delete(boardId);
    });
  }

  return (
    <div className="space-y-4">
      <h2 className="font-display text-lg font-bold">メモ</h2>

      <div className="flex flex-wrap items-center gap-2">
        {(boards ?? []).map((b) => (
          <button
            key={b.id}
            className={b.id === selectedBoardId ? "btn-pill text-sm" : "btn-pill-outline text-sm"}
            onClick={() => setSelectedBoardId(b.id)}
          >
            {b.title}
          </button>
        ))}
        <button className="btn-pill-outline text-sm" onClick={addBoard}>
          + 新しいメモ
        </button>
        {currentBoard && (
          <>
            <button className="btn-pill-outline text-xs" onClick={renameBoard}>
              名前を変更
            </button>
            <button className="btn-pill-outline text-xs text-alert" onClick={deleteBoard}>
              削除
            </button>
          </>
        )}
      </div>

      <div className="panel flex flex-wrap items-center gap-2 p-3">
        <button className="btn-pill-outline text-sm" onClick={() => addNote()}>
          + 付箋を追加
        </button>
        <button
          className="btn-pill-outline text-sm"
          onClick={() => mailFileInputRef.current?.click()}
          disabled={mailImportBusy}
        >
          📧 {mailImportBusy ? "読み込み中…" : "メールを追加 (.msg)"}
        </button>
        <button className={penMode ? "btn-pill text-sm" : "btn-pill-outline text-sm"} onClick={togglePenMode}>
          ✏️ 手書き: {penMode ? "ON" : "OFF"}
        </button>
        <button className={connectMode ? "btn-pill text-sm" : "btn-pill-outline text-sm"} onClick={toggleConnectMode}>
          🔗 連結: {connectMode ? "ON" : "OFF"}
        </button>
        <button className={eraseMode ? "btn-pill text-sm" : "btn-pill-outline text-sm"} onClick={toggleEraseMode}>
          🧹 消しゴム: {eraseMode ? "ON" : "OFF"}
        </button>
        {penMode && (
          <>
            <div className="flex items-center gap-1">
              {MEMO_PEN_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setPenColor(c)}
                  className={`h-6 w-6 rounded-full border-2 ${penColor === c ? "border-cream" : "border-transparent"}`}
                  style={{ backgroundColor: c }}
                  aria-label={`ペンの色 ${c}`}
                />
              ))}
            </div>
            <input
              type="range"
              min={1}
              max={10}
              value={penWidth}
              onChange={(e) => setPenWidth(Number(e.target.value))}
              className="w-20"
              aria-label="ペンの太さ"
            />
            <button className="btn-pill-outline text-xs" onClick={undoLastStroke}>
              取り消す
            </button>
            <button className="btn-pill-outline text-xs" onClick={clearStrokes}>
              手書きを全消去
            </button>
          </>
        )}
        {!voiceUnsupported && (
          <button
            className={voiceListening ? "btn-pill-danger text-sm" : "btn-pill-outline text-sm"}
            onClick={voiceListening ? stopVoiceListening : startVoiceListening}
          >
            🎤 {voiceListening ? "聞き取り中..." : "音声で付箋を追加"}
          </button>
        )}
        <button className="btn-pill-outline text-sm" onClick={exportBoard}>
          エクスポート (.json)
        </button>
        <button className="btn-pill-outline text-sm" onClick={() => fileInputRef.current?.click()}>
          インポート (.json)
        </button>
        <button className="btn-pill-outline text-sm" onClick={exportBoardImage}>
          画像として書き出し (.png)
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) importBoard(file);
            e.target.value = "";
          }}
        />
        <input
          ref={mailFileInputRef}
          type="file"
          accept=".msg"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) addMailNote(file);
            e.target.value = "";
          }}
        />
      </div>
      {mailImportError && <p className="px-1 text-xs text-alert">{mailImportError}</p>}

      {connectMode && (
        <p className="text-xs text-cream/50">
          {connectFromId ? "つなげる相手の付箋をタップしてください(同じ付箋をもう一度タップで取り消し)" : "つなげたい付箋を1つ目タップしてください"}
        </p>
      )}
      {eraseMode && <p className="text-xs text-cream/50">消したい手書きの上をなぞってください</p>}
      {statusMessage && <p className="text-xs text-cream/50">{statusMessage}</p>}
      {undoEntry && (
        <div className="panel flex flex-wrap items-center gap-2 p-2 text-xs">
          <span className="text-cream/70">{undoMessage(undoEntry)}</span>
          <button className="btn-pill-outline text-xs" onClick={restoreUndo}>
            元に戻す
          </button>
        </div>
      )}

      <div className="panel flex flex-wrap items-center gap-2 p-3">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setSearchIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSearchSubmit();
          }}
          placeholder="付箋を検索..."
          className="w-40 rounded border border-cream/20 bg-ink px-2 py-1 text-sm text-cream"
        />
        {searchQuery.trim() && (
          <>
            <span className="text-xs tabular-nums text-cream/50">
              {searchMatches.length > 0 ? `${searchIndex + 1} / ${searchMatches.length}件` : "0件"}
            </span>
            <button className="btn-pill-outline text-xs" onClick={() => searchStep(-1)} disabled={searchMatches.length === 0}>
              ＜前へ
            </button>
            <button className="btn-pill-outline text-xs" onClick={() => searchStep(1)} disabled={searchMatches.length === 0}>
              次へ＞
            </button>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-pill-outline text-sm" onClick={() => setZoom((z) => clampMemoZoom(z - 0.1))} aria-label="縮小">
          －
        </button>
        <span className="w-12 text-center text-xs tabular-nums text-cream/60">{Math.round(zoom * 100)}%</span>
        <button className="btn-pill-outline text-sm" onClick={() => setZoom((z) => clampMemoZoom(z + 0.1))} aria-label="拡大">
          ＋
        </button>
        <button className="btn-pill-outline text-xs" onClick={() => setZoom(1)}>
          100%
        </button>
        <button className="btn-pill-outline text-xs" onClick={fitToContent}>
          🔍 全体を表示
        </button>
        <span className="text-[10px] text-cream/40">2本指ピンチ / Ctrl+ホイールでも拡大縮小できます</span>
      </div>

      <div className="relative">
        <div
          ref={scrollContainerRef}
          className="panel overflow-auto p-0"
          style={{ maxHeight: "70vh", touchAction: "pan-x pan-y" }}
          onWheel={handleWheelZoom}
          onScroll={handleScroll}
        >
          <div style={{ width: MEMO_BOARD_WIDTH * zoom, height: MEMO_BOARD_HEIGHT * zoom }}>
            <div
              className="relative bg-[#0f0f10]"
              style={{ width: MEMO_BOARD_WIDTH, height: MEMO_BOARD_HEIGHT, transform: `scale(${zoom})`, transformOrigin: "0 0" }}
            >
              <canvas
                ref={canvasRef}
                width={MEMO_BOARD_WIDTH}
                height={MEMO_BOARD_HEIGHT}
                className="absolute left-0 top-0"
                style={{
                  touchAction: "none",
                  pointerEvents: penMode || eraseMode ? "auto" : "none",
                  cursor: eraseMode ? "cell" : undefined,
                }}
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={handleCanvasPointerUp}
                onPointerCancel={handleCanvasPointerUp}
              />
              <svg
                className="absolute left-0 top-0"
                width={MEMO_BOARD_WIDTH}
                height={MEMO_BOARD_HEIGHT}
                style={{ pointerEvents: "none" }}
              >
                {(connectors ?? []).map((c) => {
                  const from = notesById.get(c.fromNoteId);
                  const to = notesById.get(c.toNoteId);
                  if (!from || !to) return null;
                  const x1 = from.x + from.width / 2;
                  const y1 = from.y + from.height / 2;
                  const x2 = to.x + to.width / 2;
                  const y2 = to.y + to.height / 2;
                  return <line key={c.id} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(253,230,138,0.75)" strokeWidth={2} />;
                })}
              </svg>
              {(notes ?? []).map((note) => (
                <StickyNoteCard
                  key={note.id}
                  note={note}
                  penMode={penMode}
                  connectMode={connectMode}
                  eraseMode={eraseMode}
                  isConnectSource={connectFromId === note.id}
                  isHighlighted={highlightedNoteId === note.id}
                  zoom={zoom}
                  onDragEnd={moveNote}
                  onResizeEnd={resizeNote}
                  onCommitText={commitNoteText}
                  onDelete={deleteNote}
                  onColorChange={setNoteColor}
                  onFocusNote={() => bringToFront(note.id)}
                  onSelectConnect={() => selectNoteForConnect(note.id)}
                  onConvertTodo={() => convertNoteToTodo(note)}
                  onConvertProject={() => convertNoteToProject(note)}
                  onDuplicate={() => duplicateNote(note)}
                  onToggleChecklist={() => toggleChecklistMode(note)}
                  onUpdateChecklistItems={(items) => updateChecklistItems(note.id, items)}
                />
              ))}
              {/* 連結の削除マーカー/ラベルは付箋より後(=DOM上でも手前)に描くことで、
                  付箋の下に隠れて読めなくなるのを防ぐ。線自体は付箋の裏を通っても違和感がないため
                  上のsvgのままにしてある */}
              {!penMode &&
                (connectors ?? []).map((c) => {
                  const from = notesById.get(c.fromNoteId);
                  const to = notesById.get(c.toNoteId);
                  if (!from || !to) return null;
                  const mx = (from.x + from.width / 2 + to.x + to.width / 2) / 2;
                  const my = (from.y + from.height / 2 + to.y + to.height / 2) / 2;
                  return (
                    <div
                      key={c.id}
                      className="absolute flex flex-col items-center gap-1"
                      style={{ left: mx, top: my, zIndex: 999999, transform: "translate(-50%, -50%)" }}
                    >
                      <button
                        onClick={() => editConnectorLabel(c)}
                        className="whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium leading-none"
                        style={{
                          backgroundColor: "rgba(0,0,0,0.8)",
                          border: "1px solid rgba(255,255,255,0.2)",
                          color: c.label ? "#fde68a" : "rgba(255,255,255,0.55)",
                        }}
                      >
                        {c.label || "＋ラベル"}
                      </button>
                      <button
                        onClick={() => deleteConnector(c.id)}
                        title="クリックでこの連結を削除"
                        aria-label="連結を削除"
                        className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] leading-none text-white"
                        style={{ backgroundColor: "rgba(0,0,0,0.8)", border: "1px solid rgba(255,255,255,0.2)" }}
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
        <div
          className="absolute right-2 top-2 rounded border border-cream/20 bg-black/70 p-1"
          style={{ width: MEMO_MINIMAP_WIDTH + 4, height: MEMO_MINIMAP_HEIGHT + 4 }}
        >
          <div
            className="relative cursor-pointer bg-[#0f0f10]"
            style={{ width: MEMO_MINIMAP_WIDTH, height: MEMO_MINIMAP_HEIGHT }}
            onClick={handleMinimapClick}
          >
            {(notes ?? []).map((n) => {
              const mmScale = MEMO_MINIMAP_WIDTH / MEMO_BOARD_WIDTH;
              const colors = MEMO_NOTE_COLORS[n.color] ?? MEMO_NOTE_COLORS[DEFAULT_MEMO_NOTE_COLOR];
              return (
                <div
                  key={n.id}
                  className="absolute"
                  style={{
                    left: n.x * mmScale,
                    top: n.y * mmScale,
                    width: Math.max(2, n.width * mmScale),
                    height: Math.max(2, n.height * mmScale),
                    backgroundColor: colors.bg,
                  }}
                />
              );
            })}
            <div
              className="pointer-events-none absolute border border-cream"
              style={{
                left: (scrollPos.left / zoom) * (MEMO_MINIMAP_WIDTH / MEMO_BOARD_WIDTH),
                top: (scrollPos.top / zoom) * (MEMO_MINIMAP_WIDTH / MEMO_BOARD_WIDTH),
                width: Math.min(MEMO_MINIMAP_WIDTH, (scrollPos.w / zoom) * (MEMO_MINIMAP_WIDTH / MEMO_BOARD_WIDTH)),
                height: Math.min(MEMO_MINIMAP_HEIGHT, (scrollPos.h / zoom) * (MEMO_MINIMAP_WIDTH / MEMO_BOARD_WIDTH)),
              }}
            />
          </div>
        </div>
      </div>
      <p className="text-[10px] text-cream/40">
        ボードは横{MEMO_BOARD_WIDTH}px×縦{MEMO_BOARD_HEIGHT}pxの固定サイズです(無限キャンバスではありません)。パネルをスクロールして全体を確認できます。
      </p>
    </div>
  );
}

function StickyNoteCard({
  note,
  penMode,
  connectMode,
  eraseMode,
  isConnectSource,
  isHighlighted,
  zoom,
  onDragEnd,
  onResizeEnd,
  onCommitText,
  onDelete,
  onColorChange,
  onFocusNote,
  onSelectConnect,
  onConvertTodo,
  onConvertProject,
  onDuplicate,
  onToggleChecklist,
  onUpdateChecklistItems,
}: {
  note: MemoNote;
  penMode: boolean;
  connectMode: boolean;
  eraseMode: boolean;
  isConnectSource: boolean;
  isHighlighted: boolean;
  zoom: number;
  onDragEnd: (id: string, x: number, y: number) => void;
  onResizeEnd: (id: string, width: number, height: number) => void;
  onCommitText: (id: string, text: string) => void;
  onDelete: (id: string) => void;
  onColorChange: (id: string, color: string) => void;
  onFocusNote: () => void;
  onSelectConnect: () => void;
  onConvertTodo: () => void;
  onConvertProject: () => void;
  onDuplicate: () => void;
  onToggleChecklist: () => void;
  onUpdateChecklistItems: (items: MemoChecklistItem[]) => void;
}) {
  // テキストはローカルの下書きとして保持し、フォーカスが外れた時だけDBへ確定する。
  // Dexieの書き込みのたびにliveQueryのechoで再レンダーされる値をcontrolledな
  // textareaへ直結すると、日本語IME変換中に入力欄が上書きされ壊れてしまうため
  const [text, setText] = useState(note.text);
  const idRef = useRef(note.id);
  useEffect(() => {
    if (idRef.current !== note.id) {
      idRef.current = note.id;
      setText(note.text);
    }
  }, [note.id, note.text]);

  const [dragOffset, setDragOffset] = useState<{ dx: number; dy: number } | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  function handleHeaderPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (penMode || connectMode) return;
    onFocusNote();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    setDragOffset({ dx: 0, dy: 0 });
  }
  function handleHeaderPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragStartRef.current) return;
    // clientX/clientYは画面上のピクセル差分のため、拡大縮小中はボード上の論理座標の
    // 差分に変換する(zoomで割る)必要がある。そうしないと縮小表示中に少し動かしただけで
    // 実際には大きく移動してしまう
    setDragOffset({ dx: (e.clientX - dragStartRef.current.x) / zoom, dy: (e.clientY - dragStartRef.current.y) / zoom });
  }
  function handleHeaderPointerUp() {
    if (!dragStartRef.current || !dragOffset) {
      dragStartRef.current = null;
      setDragOffset(null);
      return;
    }
    const newX = Math.max(0, Math.min(MEMO_BOARD_WIDTH - note.width, note.x + dragOffset.dx));
    const newY = Math.max(0, Math.min(MEMO_BOARD_HEIGHT - note.height, note.y + dragOffset.dy));
    onDragEnd(note.id, newX, newY);
    dragStartRef.current = null;
    setDragOffset(null);
  }

  // 大きさの変更。右下の角をドラッグして広げる/縮める(部署名など、既定の大きさに
  // 収まらない文字数の付箋を作れるようにするため)。移動と同様、確定はpointerupのみで行う
  const [resizeOffset, setResizeOffset] = useState<{ dw: number; dh: number } | null>(null);
  const resizeStartRef = useRef<{ x: number; y: number } | null>(null);

  function handleResizePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (penMode || connectMode) return;
    e.stopPropagation();
    onFocusNote();
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeStartRef.current = { x: e.clientX, y: e.clientY };
    setResizeOffset({ dw: 0, dh: 0 });
  }
  function handleResizePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!resizeStartRef.current) return;
    setResizeOffset({ dw: (e.clientX - resizeStartRef.current.x) / zoom, dh: (e.clientY - resizeStartRef.current.y) / zoom });
  }
  function handleResizePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    if (!resizeStartRef.current || !resizeOffset) {
      resizeStartRef.current = null;
      setResizeOffset(null);
      return;
    }
    const newWidth = Math.max(MEMO_NOTE_MIN_WIDTH, Math.min(MEMO_BOARD_WIDTH - note.x, note.width + resizeOffset.dw));
    const newHeight = Math.max(MEMO_NOTE_MIN_HEIGHT, Math.min(MEMO_BOARD_HEIGHT - note.y, note.height + resizeOffset.dh));
    onResizeEnd(note.id, newWidth, newHeight);
    resizeStartRef.current = null;
    setResizeOffset(null);
  }

  const colors = MEMO_NOTE_COLORS[note.color] ?? MEMO_NOTE_COLORS[DEFAULT_MEMO_NOTE_COLOR];
  const left = note.x + (dragOffset?.dx ?? 0);
  const top = note.y + (dragOffset?.dy ?? 0);
  const width = Math.max(MEMO_NOTE_MIN_WIDTH, note.width + (resizeOffset?.dw ?? 0));
  const height = Math.max(MEMO_NOTE_MIN_HEIGHT, note.height + (resizeOffset?.dh ?? 0));

  return (
    <div
      className={`absolute flex flex-col rounded-md border-2 shadow-md ${connectMode ? "cursor-pointer" : ""}`}
      style={{
        left,
        top,
        width,
        height,
        zIndex: note.order,
        pointerEvents: penMode || eraseMode ? "none" : "auto",
        backgroundColor: colors.bg,
        borderColor: isConnectSource ? "#fff" : isHighlighted ? "#38bdf8" : colors.border,
        boxShadow: isConnectSource ? "0 0 0 2px #fff" : isHighlighted ? "0 0 0 3px #38bdf8" : undefined,
        transition: "box-shadow 0.2s, border-color 0.2s",
      }}
      onClick={connectMode ? onSelectConnect : undefined}
    >
      <div
        className="flex shrink-0 cursor-grab items-center justify-between gap-1 px-1.5 py-1 active:cursor-grabbing"
        style={{ touchAction: "none" }}
        onPointerDown={handleHeaderPointerDown}
        onPointerMove={handleHeaderPointerMove}
        onPointerUp={handleHeaderPointerUp}
        onPointerCancel={handleHeaderPointerUp}
      >
        <span className="text-[10px] text-black/40">⠿</span>
        <button
          // 親ヘッダーのonPointerDown(ドラッグ用のsetPointerCapture)にバブリングすると、
          // 以降のclickイベントまでヘッダー側へ奪われてボタンのonClickが発火しなくなるため、
          // ここで先に止めておく
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(note.id);
          }}
          className="text-[10px] leading-none text-black/40 hover:text-red-600"
          aria-label="付箋を削除"
        >
          ✕
        </button>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-1 px-1.5 pb-1">
        <div className="flex items-center gap-1">
          {Object.keys(MEMO_NOTE_COLORS).map((c) => (
            <button
              key={c}
              onClick={(e) => {
                e.stopPropagation();
                onColorChange(note.id, c);
              }}
              className="h-3 w-3 shrink-0 rounded-full border border-black/20"
              style={{ backgroundColor: MEMO_NOTE_COLORS[c].bg }}
              aria-label={`付箋の色を${c}にする`}
            />
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate();
            }}
            className="text-xs leading-none hover:opacity-70"
            title="付箋を複製"
            aria-label="付箋を複製"
          >
            ⧉
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleChecklist();
            }}
            className="text-xs leading-none hover:opacity-70"
            title="チェックリスト表示を切り替え"
            aria-label="チェックリスト表示を切り替え"
          >
            📋
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onConvertTodo();
            }}
            className="text-xs leading-none hover:opacity-70"
            title="ToDoに変換"
            aria-label="ToDoに変換"
          >
            ✅
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onConvertProject();
            }}
            className="text-xs leading-none hover:opacity-70"
            title="案件に変換"
            aria-label="案件に変換"
          >
            📁
          </button>
        </div>
      </div>
      {note.isChecklist ? (
        <ChecklistBody
          items={note.checklistItems ?? []}
          connectMode={connectMode}
          onFocus={onFocusNote}
          onUpdate={onUpdateChecklistItems}
        />
      ) : (
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            // 入力中の文章がこの付箋の高さに収まらなくなったら、はみ出した分だけ
            // 自動で高さを広げる(手動で縮めたサイズより小さくはしない。縮めたい場合は
            // 右下のハンドルで手動リサイズする)
            const ta = e.target;
            const overflow = ta.scrollHeight - ta.clientHeight;
            if (overflow > 2) {
              const newHeight = Math.min(MEMO_BOARD_HEIGHT - note.y, note.height + overflow);
              onResizeEnd(note.id, note.width, newHeight);
            }
          }}
          onFocus={onFocusNote}
          onBlur={() => onCommitText(note.id, text)}
          placeholder="メモ..."
          readOnly={connectMode}
          className="min-h-0 flex-1 resize-none bg-transparent px-2 py-1 text-sm text-black/80 outline-none"
        />
      )}
      {note.mailFileDataUrl && (
        <a
          href={note.mailFileDataUrl}
          download={note.mailFileName || "mail.msg"}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          title="ダウンロードして元のメールを開きます(既定のメールアプリに渡されます)"
          className="mx-2 mb-1.5 flex shrink-0 items-center gap-1 rounded bg-black/10 px-2 py-1 text-[11px] text-black/70 hover:bg-black/20"
        >
          📧 元のメールを開く
        </a>
      )}
      {!penMode && !connectMode && (
        <div
          className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
          style={{ touchAction: "none" }}
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          onPointerCancel={handleResizePointerUp}
        >
          <svg viewBox="0 0 16 16" className="h-full w-full text-black/30">
            <path d="M14 14 L14 8 M14 14 L8 14" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
        </div>
      )}
    </div>
  );
}

// チェックリスト付箋の中身。項目の追加/削除/チェック切り替え/テキスト編集を行う。
// 配列全体を1フィールドとしてDexieに保存しているため、どの編集でも配列を作り直して
// onUpdateへまとめて渡す
function ChecklistBody({
  items,
  connectMode,
  onFocus,
  onUpdate,
}: {
  items: MemoChecklistItem[];
  connectMode: boolean;
  onFocus: () => void;
  onUpdate: (items: MemoChecklistItem[]) => void;
}) {
  function toggleDone(id: string) {
    onUpdate(items.map((i) => (i.id === id ? { ...i, done: !i.done } : i)));
  }
  function commitText(id: string, text: string) {
    onUpdate(items.map((i) => (i.id === id ? { ...i, text } : i)));
  }
  function deleteItem(id: string) {
    // 空の項目(まだ何も書いていない行)は確認なしで消せるようにする
    const item = items.find((i) => i.id === id);
    if (item?.text.trim() && !confirm(`「${item.text}」を削除しますか?`)) return;
    onUpdate(items.filter((i) => i.id !== id));
  }
  function addItem() {
    onUpdate([...items, { id: uid(), text: "", done: false }]);
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1.5 py-1">
      {items.map((item) => (
        <ChecklistItemRow
          key={item.id}
          item={item}
          connectMode={connectMode}
          onFocus={onFocus}
          onToggleDone={() => toggleDone(item.id)}
          onCommitText={(text) => commitText(item.id, text)}
          onDelete={() => deleteItem(item.id)}
        />
      ))}
      {!connectMode && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            addItem();
          }}
          className="mt-0.5 text-left text-[11px] text-black/40 hover:text-black/70"
        >
          + 項目を追加
        </button>
      )}
    </div>
  );
}

function ChecklistItemRow({
  item,
  connectMode,
  onFocus,
  onToggleDone,
  onCommitText,
  onDelete,
}: {
  item: MemoChecklistItem;
  connectMode: boolean;
  onFocus: () => void;
  onToggleDone: () => void;
  onCommitText: (text: string) => void;
  onDelete: () => void;
}) {
  // ノート本文と同じ理由(IME保護)で、テキストはローカル下書き経由でコミットする
  const [text, setText] = useState(item.text);
  const idRef = useRef(item.id);
  useEffect(() => {
    if (idRef.current !== item.id) {
      idRef.current = item.id;
      setText(item.text);
    }
  }, [item.id, item.text]);

  return (
    <div className="flex items-center gap-1">
      <input
        type="checkbox"
        checked={item.done}
        onChange={(e) => {
          e.stopPropagation();
          onToggleDone();
        }}
        onClick={(e) => e.stopPropagation()}
        className="h-3 w-3 shrink-0"
      />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={onFocus}
        onBlur={() => onCommitText(text)}
        placeholder="項目..."
        readOnly={connectMode}
        className={`min-w-0 flex-1 bg-transparent text-xs text-black/80 outline-none ${item.done ? "line-through opacity-50" : ""}`}
      />
      {!connectMode && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="shrink-0 text-[10px] leading-none text-black/30 hover:text-red-600"
          aria-label="項目を削除"
        >
          ✕
        </button>
      )}
    </div>
  );
}
