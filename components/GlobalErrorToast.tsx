"use client";

import { useEffect } from "react";
import { createErrorDeduper, describeGlobalError } from "@/lib/globalErrors";
import { showUndoToast } from "@/lib/toast";

// どの画面でも拾われなかったエラーを知らせる受け皿(app/page.tsxに1つだけ置く)。
// 保存の失敗などが黙って消え、「保存したつもり」になるのを防ぐ
export default function GlobalErrorToast() {
  useEffect(() => {
    const shouldShow = createErrorDeduper();
    function notify(err: unknown) {
      const message = describeGlobalError(err);
      if (!message || !shouldShow(message)) return;
      showUndoToast(message, undefined, 10000);
    }
    const onRejection = (e: PromiseRejectionEvent) => notify(e.reason);
    const onError = (e: ErrorEvent) => notify(e.error ?? e.message);
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, []);
  return null;
}
