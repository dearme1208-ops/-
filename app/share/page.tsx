"use client";

import { useEffect } from "react";

// 他のアプリの「共有」から送られてきた文を受け取る入口(manifest.json の share_target)。
// 共有の送り先は問い合わせ文字列を丸ごと付け替えるので、ここで受けてから
// 「ひとこと入力」を開く印(share=1)を付けてアプリ本体へ渡す
export default function SharePage() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("share", "1");
    window.location.replace(`/?${params.toString()}`);
  }, []);
  return <p style={{ padding: 24 }}>受け取っています…</p>;
}
