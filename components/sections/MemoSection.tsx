"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import { useSetting } from "@/lib/settings";
import { downloadTextFile } from "@/lib/report";
import { createSpeechRecognition } from "@/lib/voice";
import {
  clampMemoZoom,
  DEFAULT_MEMO_NOTE_COLOR,
  DEFAULT_MEMO_PEN_COLOR,
  DEFAULT_MEMO_PEN_WIDTH,
  MEMO_BOARD_HEIGHT,
  MEMO_BOARD_WIDTH,
  MEMO_NOTE_COLORS,
  MEMO_NOTE_MIN_HEIGHT,
  MEMO_NOTE_MIN_WIDTH,
  MEMO_PEN_COLORS,
  parseMemoBoardImport,
  serializeMemoBoard,
} from "@/lib/memo";
import type { MemoConnector, MemoNote, MemoStroke } from "@/lib/types";
import { todayStr } from "@/lib/time";

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
  function togglePenMode() {
    setPenMode((v) => !v);
    setConnectMode(false);
    setConnectFromId(null);
  }
  function toggleConnectMode() {
    setConnectMode((v) => !v);
    setPenMode(false);
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
    await db.memoConnectors.delete(id);
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
  // 描画中のストローク座標。React stateにせず、pointermoveのたびに再レンダーが
  // 走らないようにする(タッチペンでの手書きが重くならないようにするための要)
  const drawingRef = useRef<{ x: number; y: number }[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
    await db.memoStrokes.where("boardId").equals(selectedBoardId).delete();
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
    await db.transaction("rw", db.memoNotes, db.memoConnectors, async () => {
      await db.memoNotes.delete(id);
      await db.memoConnectors.where("fromNoteId").equals(id).delete();
      await db.memoConnectors.where("toNoteId").equals(id).delete();
    });
  }
  async function setNoteColor(id: string, color: string) {
    await db.memoNotes.update(id, { color });
  }

  // 付箋のテキストを、そのままToDoの新規タスクとして追加する。既存のリストが
  // あればその先頭に、無ければ「タスク」という名前のリストを作って追加する
  async function convertNoteToTodo(note: MemoNote) {
    const title = note.text.trim();
    if (!title) return;
    let list = await db.todoLists.orderBy("order").first();
    if (!list) {
      list = { id: uid(), title: "タスク", order: 0, createdAt: Date.now() };
      await db.todoLists.add(list);
    }
    const count = await db.todoTasks.where("listId").equals(list.id).count();
    await db.todoTasks.add({
      id: uid(),
      listId: list.id,
      title,
      important: false,
      completed: false,
      order: count,
      createdAt: Date.now(),
    });
    setStatusMessage(`ToDo「${title}」を追加しました`);
  }

  // 付箋のテキストを、そのまま案件の新規項目として追加する。期日は未定のため
  // ひとまず今日にしておき、案件タブで後から調整してもらう想定
  async function convertNoteToProject(note: MemoNote) {
    const title = note.text.trim();
    if (!title) return;
    await db.projects.add({
      id: uid(),
      title,
      category: "メモ",
      workName: title,
      dueDate: todayStr(),
      createdAt: Date.now(),
    });
    setStatusMessage(`案件「${title}」を追加しました`);
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
        <button className={penMode ? "btn-pill text-sm" : "btn-pill-outline text-sm"} onClick={togglePenMode}>
          ✏️ 手書き: {penMode ? "ON" : "OFF"}
        </button>
        <button className={connectMode ? "btn-pill text-sm" : "btn-pill-outline text-sm"} onClick={toggleConnectMode}>
          🔗 連結: {connectMode ? "ON" : "OFF"}
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
      </div>

      {connectMode && (
        <p className="text-xs text-cream/50">
          {connectFromId ? "つなげる相手の付箋をタップしてください(同じ付箋をもう一度タップで取り消し)" : "つなげたい付箋を1つ目タップしてください"}
        </p>
      )}
      {statusMessage && <p className="text-xs text-cream/50">{statusMessage}</p>}

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

      <div
        ref={scrollContainerRef}
        className="panel overflow-auto p-0"
        style={{ maxHeight: "70vh", touchAction: "pan-x pan-y" }}
        onWheel={handleWheelZoom}
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
              style={{ touchAction: "none", pointerEvents: penMode ? "auto" : "none" }}
              onPointerDown={handlePenPointerDown}
              onPointerMove={handlePenPointerMove}
              onPointerUp={handlePenPointerUp}
              onPointerCancel={handlePenPointerUp}
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
                const mx = (x1 + x2) / 2;
                const my = (y1 + y2) / 2;
                return (
                  <g key={c.id} style={{ pointerEvents: penMode ? "none" : "auto" }}>
                    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(253,230,138,0.75)" strokeWidth={2} />
                    <circle
                      cx={mx}
                      cy={my}
                      r={8}
                      fill="rgba(0,0,0,0.55)"
                      className="cursor-pointer"
                      onClick={() => deleteConnector(c.id)}
                    >
                      <title>クリックでこの連結を削除</title>
                    </circle>
                    <text x={mx} y={my + 3} fontSize={9} textAnchor="middle" fill="#fff" style={{ pointerEvents: "none" }}>
                      ✕
                    </text>
                  </g>
                );
              })}
            </svg>
            {(notes ?? []).map((note) => (
              <StickyNoteCard
                key={note.id}
                note={note}
                penMode={penMode}
                connectMode={connectMode}
                isConnectSource={connectFromId === note.id}
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
              />
            ))}
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
  isConnectSource,
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
}: {
  note: MemoNote;
  penMode: boolean;
  connectMode: boolean;
  isConnectSource: boolean;
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
        pointerEvents: penMode ? "none" : "auto",
        backgroundColor: colors.bg,
        borderColor: isConnectSource ? "#fff" : colors.border,
        boxShadow: isConnectSource ? "0 0 0 2px #fff" : undefined,
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
      <div className="flex shrink-0 items-center justify-between gap-1 px-1.5 pb-1">
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
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={onFocusNote}
        onBlur={() => onCommitText(note.id, text)}
        placeholder="メモ..."
        readOnly={connectMode}
        className="min-h-0 flex-1 resize-none bg-transparent px-2 py-1 text-sm text-black/80 outline-none"
      />
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
