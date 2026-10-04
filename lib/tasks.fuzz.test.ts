import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { finishDailyTask, pauseDailyTask, segmentsAccumulatedMs } from "./tasks";
import type { DailyTask } from "./types";

// 計測の基本操作(開始・一時停止・再開・完了・時間を加算・完了後に続きから再開)を乱数で長く繰り返し、
// どの順で操作しても次の2つが崩れないことを確かめる。
//   1. 作業カードに出る合計時間 = 実際に計測した区間の長さ + 加算した時間
//   2. 実績(WorkRecord)の合計 = 完了の時点までに計測・加算した時間の合計
// 手で試すだけでは見つけにくい操作の組み合わせの不具合を探すための検査

const DATE = "2026-09-29";
const T0 = new Date(`${DATE}T08:00:00`).getTime();
const MIN = 60_000;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

beforeEach(async () => {
  await Promise.all([db.dailyTasks.clear(), db.records.clear(), db.masterTasks.clear()]);
  for (const id of ["m1", "m2"]) {
    await db.masterTasks.put({ id, category: "業務", name: id, estimatedSeconds: 0, isFavorite: false, sampleCount: 0, createdAt: 0, updatedAt: 0 });
  }
});

describe("計測のランダム操作", () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`種${seed}: 合計時間と実績が食い違わない`, async () => {
      const rand = rng(seed);
      let now = T0;
      // 作業ごとの「本当に働いた時間」(区間+加算)と、そのうち完了で実績に送った分
      const worked = new Map<string, number>();
      const sent = new Map<string, number>();
      let n = 0;

      const closedMs = (t: DailyTask) => t.segments.reduce((s, sg) => s + ((sg.end ?? now) - sg.start), 0);

      for (let step = 0; step < 120; step++) {
        now += Math.floor(rand() * 20 + 1) * MIN;
        const tasks = await db.dailyTasks.toArray();
        const op = Math.floor(rand() * 6);
        const pick = (pred: (t: DailyTask) => boolean) => {
          const c = tasks.filter(pred);
          return c.length ? c[Math.floor(rand() * c.length)] : undefined;
        };
        if (op === 0 || tasks.length === 0) {
          const id = `t${n++}`;
          await db.dailyTasks.add({
            id, date: DATE, order: n, masterTaskId: rand() < 0.5 ? "m1" : "m2", category: "業務", name: "x",
            estimatedSeconds: 0, status: "running", segments: [{ start: now }], accumulatedMs: 0, startedAt: now, isSpontaneous: true,
          } as DailyTask);
          worked.set(id, 0);
        } else if (op === 1) {
          const t = pick((t) => t.status === "running");
          if (t) await pauseDailyTask(t, now);
        } else if (op === 2) {
          const t = pick((t) => t.status === "paused");
          if (t) await db.dailyTasks.update(t.id, { status: "running", segments: [...t.segments, { start: now }] });
        } else if (op === 3) {
          const t = pick((t) => t.status === "running" || t.status === "paused");
          if (t) await finishDailyTask(t, now);
        } else if (op === 4) {
          const t = pick((t) => t.status !== "done");
          if (t) {
            const add = Math.floor(rand() * 10 + 1) * MIN;
            await db.dailyTasks.update(t.id, { manualAdjustmentMs: (t.manualAdjustmentMs ?? 0) + add });
            worked.set(t.id, (worked.get(t.id) ?? 0) + add);
          }
        } else {
          // 完了した作業を「続きから」再開(本日の作業の continueCompletedTaskDirect と同じ書き換え)
          const t = pick((t) => t.status === "done");
          if (t) {
            await db.dailyTasks.update(t.id, {
              segments: [...t.segments, { start: now }],
              status: "running",
              endedAt: undefined,
              stoppedAt: undefined,
              recordedMs: t.recordedMs ?? t.accumulatedMs,
              recordedSegmentCount: t.recordedSegmentCount ?? t.segments.length,
            });
          }
        }

        // 不変条件1: カードの合計 = 区間の長さ + 加算
        for (const t of await db.dailyTasks.toArray()) {
          const segTotal = closedMs(t);
          // worked には加算の分だけを積んでいるので、区間の長さを足して比べる
          const expected = segTotal + (worked.get(t.id) ?? 0);
          expect(segmentsAccumulatedMs(t, now), `step ${step} task ${t.id} op ${op}`).toBe(expected);
          if (t.status === "done") sent.set(t.id, expected);
        }
        // 不変条件2: 実績の合計 = 完了済み(続きから再開中を含む)の作業が実績に送った分の合計
        const recordSec = (await db.records.toArray()).reduce((s, r) => s + r.seconds, 0);
        const sentMs = [...(await db.dailyTasks.toArray())].reduce((s, t) => s + (t.recordedMs ?? 0), 0);
        expect(Math.abs(recordSec - sentMs / 1000), `step ${step} op ${op}`).toBeLessThanOrEqual(2);
      }
    });
  }
});
