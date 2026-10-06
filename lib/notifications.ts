export function isNotificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function getNotificationPermission(): NotificationPermission | "unsupported" {
  if (!isNotificationSupported()) return "unsupported";
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!isNotificationSupported()) return "unsupported";
  return Notification.requestPermission();
}

export function notify(title: string, body: string, tag?: string): void {
  if (!isNotificationSupported()) return;
  if (Notification.permission !== "granted") return;
  // AndroidのChromeは new Notification() を受け付けず(「Service Worker経由で出すこと」というエラー)、
  // 予定の時刻・超過などの通知がスマホでは一度も出ていなかった。Service Workerがあればそちらから出す
  void (async () => {
    try {
      const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
      if (reg) {
        await reg.showNotification(title, { body, icon: "/icon-192.png", badge: "/icon-192.png", tag });
        return;
      }
    } catch {
      // Service Worker経由で出せなければ、下の方法を試す
    }
    try {
      new Notification(title, { body, icon: "/icon-192.png", tag });
    } catch {
      // no-op: どちらでも出せない環境
    }
  })();
}

export const RUNNING_NOTIFICATION_TAG = "koutei-running";

/**
 * 計測中の作業を通知に出す(同じtagで置き換えるので1件だけ)。音・振動は鳴らさない。
 * 通知のボタンは対応する端末(AndroidのChromeなど)だけに出る
 */
export async function showRunningNotification(task: { id: string; name: string; category: string }, startedLabel: string): Promise<void> {
  if (!isNotificationSupported() || Notification.permission !== "granted" || !("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return;
  await reg.showNotification(`計測中：${task.name}`, {
    body: `${task.category}・${startedLabel}から`,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: RUNNING_NOTIFICATION_TAG,
    silent: true,
    data: { taskId: task.id },
    // 対応する端末では通知の下にボタンが並ぶ
    actions: [
      { action: "pause", title: "⏸ 一時停止" },
      { action: "finish", title: "✓ 完了" },
    ],
  } as NotificationOptions);
}

export async function closeRunningNotification(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return;
  for (const n of await reg.getNotifications({ tag: RUNNING_NOTIFICATION_TAG })) n.close();
}
