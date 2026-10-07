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

// 出す・消すを順番に1つずつ行う。出す処理(非同期)の途中で消す合図が来て、消した後に出す処理が
// 終わると「計測中」の通知だけが残ってしまうため、合図ごとに番号を振り、古い「出す」は
// 出し終えてもすぐ消す
let generation = 0;
let queue: Promise<void> = Promise.resolve();

async function registration(): Promise<ServiceWorkerRegistration | undefined> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return undefined;
  return navigator.serviceWorker.getRegistration();
}

async function closeAllRunning(reg: ServiceWorkerRegistration): Promise<void> {
  for (const n of await reg.getNotifications({ tag: RUNNING_NOTIFICATION_TAG })) n.close();
}

/**
 * 計測中の作業を通知に出す(同じtagで置き換えるので1件だけ)。音・振動は鳴らさない。
 * 通知のボタンは対応する端末(AndroidのChromeなど)だけに出る
 */
export function showRunningNotification(task: { id: string; name: string; category: string }, startedLabel: string): Promise<void> {
  const my = ++generation;
  queue = queue
    .then(async () => {
      if (my !== generation) return;
      if (!isNotificationSupported() || Notification.permission !== "granted") return;
      const reg = await registration();
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
      // 出している間に消す合図が来ていたら、出したものをすぐ消す
      if (my !== generation) await closeAllRunning(reg);
    })
    .catch(() => {});
  return queue;
}

export function closeRunningNotification(): Promise<void> {
  ++generation;
  queue = queue
    .then(async () => {
      const reg = await registration();
      if (reg) await closeAllRunning(reg);
    })
    .catch(() => {});
  return queue;
}
