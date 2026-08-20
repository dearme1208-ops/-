"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import { useSetting } from "@/lib/settings";
import { downloadTextFile } from "@/lib/report";
import { createSpeechRecognition } from "@/lib/voice";
import {
  DEFAULT_MEMO_NOTE_COLOR,
  DEFAULT_MEMO_PEN_COLOR,
  DEFAULT_MEMO_PEN_WIDTH,
  MEMO_BOARD_HEIGHT,
  MEMO_BOARD_WIDTH,
  MEMO_NOTE_COLORS,
  MEMO_PEN_COLORS,
  parseMemoBoardImport,
  serializeMemoBoard,
} from "@/lib/memo";
import type { MemoNote, MemoStroke } from "@/lib/types";
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

  const [penMode, setPenMode] = useState(false);
  const [penColor, setPenColor] = useState(DEFAULT_MEMO_PEN_COLOR);
  const [penWidth, setPenWidth] = useState(DEFAULT_MEMO_PEN_WIDTH);
  const canvasRef = useRef<HTMLCanvasElement>(null);
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

  function handlePenPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!penMode) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const point = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };
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
    const point = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };
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
      width: 180,
      height: 140,
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
  async function commitNoteText(id: string, text: string) {
    await db.memoNotes.update(id, { text, updatedAt: Date.now() });
  }
  async function deleteNote(id: string) {
    await db.memoNotes.delete(id);
  }
  async function setNoteColor(id: string, color: string) {
    await db.memoNotes.update(id, { color });
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
      serializeMemoBoard(currentBoard.title, notes ?? [], strokes ?? [])
    );
  }

  async function importBoard(file: File) {
    const text = await file.text();
    const data = parseMemoBoardImport(text);
    if (!data || !selectedBoardId) {
      setStatusMessage("このファイルは読み込めませんでした(メモのエクスポート形式ではありません)");
      return;
    }
    await db.transaction("rw", db.memoNotes, db.memoStrokes, async () => {
      let order = maxOrderRef.current;
      for (const n of data.notes) {
        order += 1;
        await db.memoNotes.add({ ...n, id: uid(), boardId: selectedBoardId, order });
      }
      for (const s of data.strokes) {
        await db.memoStrokes.add({ ...s, id: uid(), boardId: selectedBoardId });
      }
    });
    maxOrderRef.current += data.notes.length;
    setStatusMessage(`付箋${data.notes.length}件・手書き${data.strokes.length}件を読み込みました`);
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
    await db.transaction("rw", db.memoBoards, db.memoNotes, db.memoStrokes, async () => {
      await db.memoNotes.where("boardId").equals(boardId).delete();
      await db.memoStrokes.where("boardId").equals(boardId).delete();
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
        <button className={penMode ? "btn-pill text-sm" : "btn-pill-outline text-sm"} onClick={() => setPenMode((v) => !v)}>
          ✏️ 手書き: {penMode ? "ON" : "OFF"}
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

      {statusMessage && <p className="text-xs text-cream/50">{statusMessage}</p>}

      <div className="panel overflow-auto p-0" style={{ maxHeight: "70vh" }}>
        <div className="relative bg-[#0f0f10]" style={{ width: MEMO_BOARD_WIDTH, height: MEMO_BOARD_HEIGHT }}>
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
          {(notes ?? []).map((note) => (
            <StickyNoteCard
              key={note.id}
              note={note}
              penMode={penMode}
              onDragEnd={moveNote}
              onCommitText={commitNoteText}
              onDelete={deleteNote}
              onColorChange={setNoteColor}
              onFocusNote={() => bringToFront(note.id)}
            />
          ))}
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
  onDragEnd,
  onCommitText,
  onDelete,
  onColorChange,
  onFocusNote,
}: {
  note: MemoNote;
  penMode: boolean;
  onDragEnd: (id: string, x: number, y: number) => void;
  onCommitText: (id: string, text: string) => void;
  onDelete: (id: string) => void;
  onColorChange: (id: string, color: string) => void;
  onFocusNote: () => void;
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
    if (penMode) return;
    onFocusNote();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    setDragOffset({ dx: 0, dy: 0 });
  }
  function handleHeaderPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragStartRef.current) return;
    setDragOffset({ dx: e.clientX - dragStartRef.current.x, dy: e.clientY - dragStartRef.current.y });
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

  const colors = MEMO_NOTE_COLORS[note.color] ?? MEMO_NOTE_COLORS[DEFAULT_MEMO_NOTE_COLOR];
  const left = note.x + (dragOffset?.dx ?? 0);
  const top = note.y + (dragOffset?.dy ?? 0);

  return (
    <div
      className="absolute flex flex-col rounded-md border-2 shadow-md"
      style={{
        left,
        top,
        width: note.width,
        height: note.height,
        zIndex: note.order,
        pointerEvents: penMode ? "none" : "auto",
        backgroundColor: colors.bg,
        borderColor: colors.border,
      }}
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
        <div className="flex items-center gap-1">
          {Object.keys(MEMO_NOTE_COLORS).map((c) => (
            <button
              key={c}
              onClick={() => onColorChange(note.id, c)}
              className="h-3 w-3 shrink-0 rounded-full border border-black/20"
              style={{ backgroundColor: MEMO_NOTE_COLORS[c].bg }}
              aria-label={`付箋の色を${c}にする`}
            />
          ))}
          <button
            onClick={() => onDelete(note.id)}
            className="text-[10px] leading-none text-black/40 hover:text-red-600"
            aria-label="付箋を削除"
          >
            ✕
          </button>
        </div>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={onFocusNote}
        onBlur={() => onCommitText(note.id, text)}
        placeholder="メモ..."
        className="min-h-0 flex-1 resize-none bg-transparent px-2 py-1 text-sm text-black/80 outline-none"
      />
    </div>
  );
}
