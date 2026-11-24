"use client";

import { useEffect, useState, type ReactNode } from "react";
import Modal from "./Modal";

// 確認の窓(confirm()/alert()の代わり)。スマホのPWAではブラウザの confirm()/prompt() が
// 出ないことがあるため、アプリ内の窓で聞く。ConfirmHost を画面に1つだけ置き(app/page.tsx)、
// どこからでも confirmDialog()/choiceDialog() を await して答えを受け取る。

export type ConfirmChoice = "ok" | "alt" | "cancel";

export type ConfirmOptions = {
  title: string;
  body?: ReactNode;
  // 決定のボタン(既定「OK」)
  okLabel?: string;
  // 取り消しのボタン(既定「キャンセル」)。Esc・✕もこれと同じ扱い
  cancelLabel?: string;
  // 削除など取り返しのつかない操作。決定のボタンを警告色にし、最初のフォーカスは取り消し側に置く
  danger?: boolean;
  // 3つ目のボタン(例:「破棄」)。指定した時だけ出す
  altLabel?: string;
  altDanger?: boolean;
  // 知らせるだけの窓(alert()の代わり)。取り消しのボタンを出さない
  notice?: boolean;
};

type Request = ConfirmOptions & { id: number; resolve: (c: ConfirmChoice) => void };

let queue: Request[] = [];
let seq = 0;
const listeners = new Set<(q: Request[]) => void>();

function emit() {
  for (const l of listeners) l(queue);
}

/** 3択まで聞ける確認。決定="ok"・3つ目="alt"・取り消し/Esc/✕="cancel" */
export function choiceDialog(opts: ConfirmOptions): Promise<ConfirmChoice> {
  // 窓の置き場所(ConfirmHost)が無い時(単体テスト等)だけ、ブラウザの確認に頼る
  if (listeners.size === 0) {
    if (typeof window === "undefined" || typeof window.confirm !== "function") return Promise.resolve("cancel");
    const text = [opts.title, typeof opts.body === "string" ? opts.body : ""].filter(Boolean).join("\n\n");
    if (opts.notice) {
      window.alert(text);
      return Promise.resolve("ok");
    }
    return Promise.resolve(window.confirm(text) ? "ok" : "cancel");
  }
  return new Promise((resolve) => {
    queue = [...queue, { ...opts, id: ++seq, resolve }];
    emit();
  });
}

/** はい/いいえの確認。決定なら true */
export async function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return (await choiceDialog(opts)) === "ok";
}

/** 知らせるだけの窓(alert()の代わり)。閉じたら解決する */
export async function noticeDialog(opts: Omit<ConfirmOptions, "notice" | "altLabel" | "cancelLabel">): Promise<void> {
  await choiceDialog({ okLabel: "OK", ...opts, notice: true });
}

function answer(id: number, choice: ConfirmChoice) {
  const req = queue.find((r) => r.id === id);
  if (!req) return;
  queue = queue.filter((r) => r.id !== id);
  emit();
  req.resolve(choice);
}

export function ConfirmHost() {
  const [items, setItems] = useState<Request[]>(queue);
  useEffect(() => {
    listeners.add(setItems);
    setItems(queue);
    return () => {
      listeners.delete(setItems);
      // 窓の置き場所が無くなったら、答えを待っている呼び出し元を取り消し扱いで終わらせる(待ったままにしない)
      if (listeners.size === 0) {
        const pending = queue;
        queue = [];
        for (const r of pending) r.resolve(r.notice ? "ok" : "cancel");
      }
    };
  }, []);
  // 一度に出すのは先頭の1つだけ(答えたら次を出す)
  const req = items[0];
  if (!req) return null;
  return <ConfirmDialogView key={req.id} req={req} />;
}

function ConfirmDialogView({ req }: { req: Request }) {
  const cancel = () => answer(req.id, req.notice ? "ok" : "cancel");
  const okClass = req.danger ? "btn-pill text-sm text-alert" : "btn-pill text-sm";
  return (
    <Modal title={req.title} onClose={cancel}>
      {req.body != null && req.body !== "" && (
        <div className="whitespace-pre-wrap text-sm text-cream/80">{req.body}</div>
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {!req.notice && (
          <button className="btn-pill-outline text-sm" onClick={cancel} autoFocus={req.danger}>
            {req.cancelLabel ?? "キャンセル"}
          </button>
        )}
        {req.altLabel && (
          <button
            className={`btn-pill-outline text-sm ${req.altDanger ? "text-alert" : ""}`}
            onClick={() => answer(req.id, "alt")}
          >
            {req.altLabel}
          </button>
        )}
        <button className={okClass} onClick={() => answer(req.id, "ok")} autoFocus={!req.danger}>
          {req.okLabel ?? "OK"}
        </button>
      </div>
    </Modal>
  );
}

export default ConfirmHost;
