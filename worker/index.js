// next-pwa が sw.js に取り込む自前の処理(customWorkerSrc の既定 "worker")。
// 計測中の作業の通知(components/RunningNotifier.tsx)に付けた「一時停止」「完了」ボタンを押した時、
// アプリの画面を前に出して(無ければ開いて)、その操作をアプリへ渡す。
// 操作そのもの(記録の書き換え)はアプリ側で行う(計算の仕組みを1か所にまとめておくため)
self.addEventListener("notificationclick", (event) => {
  const data = event.notification.data || {};
  const action = event.action || "open";
  event.notification.close();
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const msg = { type: "koutei-notification-action", action, taskId: data.taskId };
      if (all.length > 0) {
        const client = all[0];
        client.postMessage(msg);
        if ("focus" in client) await client.focus();
        return;
      }
      const params = action === "open" ? "" : `?nact=${encodeURIComponent(action)}&task=${encodeURIComponent(data.taskId || "")}`;
      await self.clients.openWindow(`/${params}`);
    })()
  );
});
