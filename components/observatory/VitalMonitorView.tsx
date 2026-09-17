"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useSetting } from "@/lib/settings";
import { baseAccumulatedMs, segmentsAccumulatedMs } from "@/lib/tasks";
import { formatHms, parseHourStr, todayStr } from "@/lib/time";

// 工程表の「今」を生体モニタとして出す観測法。数値は全部その場の実データから引く:
// 心拍=今日の負荷、血圧=予定に対する進み具合、SpO2=記録した体調、体温=定時外の時間。
// 期限切れがあると警報状態になり、波形も乱れる
const SAMPLE_RATE = 200; // 1秒あたりに描く点の数

// PQRST波形。1拍(0〜1)の中の位置tに対する振幅を返す
function ecgAmplitude(t: number): number {
  const gauss = (center: number, width: number, amp: number) => amp * Math.exp(-((t - center) ** 2) / (2 * width ** 2));
  return (
    gauss(0.14, 0.025, 0.14) + // P波
    gauss(0.24, 0.008, -0.2) + // Q
    gauss(0.26, 0.007, 1) + // R(鋭いピーク)
    gauss(0.285, 0.009, -0.32) + // S
    gauss(0.45, 0.04, 0.28) // T波
  );
}

export default function VitalMonitorView() {
  const today = todayStr();
  const tasks = useLiveQuery(() => db.dailyTasks.where("date").equals(today).toArray(), [today]);
  const todos = useLiveQuery(() => db.todoTasks.toArray(), []);
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const conditionLogs = useLiveQuery(() => db.conditionLogs.where("date").equals(today).toArray(), [today]);
  const [standardWorkStart] = useSetting("today.standardWorkStart", "08:00");
  const [standardWorkEnd] = useSetting("today.standardWorkEnd", "17:00");
  const [soundOn, setSoundOn] = useState(false);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const vitals = useMemo(() => {
    const list = (tasks ?? []).filter((t) => !t.isProvisional);
    const workedMs = list.reduce((sum, t) => sum + (t.status === "running" ? segmentsAccumulatedMs(t, now) : baseAccumulatedMs(t)), 0);
    const workedSeconds = Math.round(workedMs / 1000);
    const plannedSeconds = list.reduce((sum, t) => sum + (t.hasPlan === false ? 0 : t.estimatedSeconds), 0);
    const doneCount = list.filter((t) => t.status === "done").length;
    const runningCount = list.filter((t) => t.status === "running").length;
    const overdueTodos = (todos ?? []).filter((t) => !t.completed && !t.parentTaskId && !!t.dueDate && t.dueDate < today).length;
    const overdueProjects = (projects ?? []).filter((p) => !p.completedAt && p.dueDate < today).length;
    const overdue = overdueTodos + overdueProjects;

    const standardSeconds = Math.max(
      3600,
      (parseHourStr(standardWorkEnd, 17) - parseHourStr(standardWorkStart, 8)) * 3600
    );
    const loadRatio = workedSeconds / standardSeconds;

    // 心拍: 何もしていなければ安静時、働くほど・期限切れが多いほど速くなる
    const bpm = Math.round(Math.max(48, Math.min(168, 54 + loadRatio * 46 + overdue * 6 + runningCount * 8)));
    // 血圧: 上は負荷、下は残っている予定の重さから作る
    const remainingSeconds = Math.max(0, plannedSeconds - workedSeconds);
    const systolic = Math.round(Math.max(96, Math.min(196, 108 + loadRatio * 34 + overdue * 5)));
    const diastolic = Math.round(Math.max(56, Math.min(120, 66 + (remainingSeconds / standardSeconds) * 26)));
    // SpO2: 記録した体調(1〜5)をそのまま酸素飽和度に見立てる。未記録は測定不能
    const latestCondition = (conditionLogs ?? []).slice().sort((a, b) => b.loggedAt - a.loggedAt)[0];
    const conditionLevel = latestCondition ? Number(latestCondition.level) : null;
    const spo2 = conditionLevel != null && Number.isFinite(conditionLevel) ? 90 + conditionLevel * 1.8 : null;
    // 体温: 定時を過ぎてからの作業時間で上がっていく
    const endHour = parseHourStr(standardWorkEnd, 17);
    const afterHoursSeconds = (tasks ?? []).reduce((sum, t) => {
      if (!t.endedAt) return sum;
      const h = new Date(t.endedAt).getHours() + new Date(t.endedAt).getMinutes() / 60;
      return h > endHour ? sum + Math.round(baseAccumulatedMs(t) / 1000) : sum;
    }, 0);
    const temperature = 36.2 + Math.min(2.8, (afterHoursSeconds / 3600) * 0.45);

    const flatline = workedSeconds === 0 && runningCount === 0;
    const alarm = overdue > 0 || loadRatio > 1.25;
    return {
      workedSeconds,
      plannedSeconds,
      doneCount,
      runningCount,
      overdue,
      overdueTodos,
      overdueProjects,
      bpm,
      systolic,
      diastolic,
      spo2,
      temperature,
      afterHoursSeconds,
      flatline,
      alarm,
      loadRatio,
    };
  }, [tasks, todos, projects, conditionLogs, now, today, standardWorkStart, standardWorkEnd]);

  // 波形の描画。bpmとalarm状態はrefで渡して、アニメーションループを作り直さずに済むようにする
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({ bpm: vitals.bpm, alarm: vitals.alarm, flatline: vitals.flatline });
  stateRef.current = { bpm: vitals.bpm, alarm: vitals.alarm, flatline: vitals.flatline };
  const beepRef = useRef<{ ctx: AudioContext } | null>(null);
  const soundOnRef = useRef(soundOn);
  soundOnRef.current = soundOn;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const samples: number[] = new Array(canvas.width).fill(0);
    let phase = 0;
    let last = performance.now();
    let raf = 0;

    function beep() {
      if (!soundOnRef.current) return;
      try {
        if (!beepRef.current) {
          const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (!AudioCtor) return;
          beepRef.current = { ctx: new AudioCtor() };
        }
        const { ctx: audio } = beepRef.current;
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.frequency.value = stateRef.current.alarm ? 1180 : 880;
        gain.gain.setValueAtTime(0.06, audio.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.08);
        osc.connect(gain).connect(audio.destination);
        osc.start();
        osc.stop(audio.currentTime + 0.09);
      } catch {
        // 音が出せない環境では黙って諦める(波形の表示には影響しない)
      }
    }

    function frame(t: number) {
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      const { bpm, alarm, flatline } = stateRef.current;
      const beatsPerSecond = bpm / 60;
      const count = Math.max(1, Math.round(SAMPLE_RATE * dt));
      for (let i = 0; i < count; i++) {
        phase += beatsPerSecond / SAMPLE_RATE;
        if (phase >= 1) {
          phase -= 1;
          beep();
        }
        let value = flatline ? 0 : ecgAmplitude(phase);
        // 警報状態では波形そのものが少し暴れる
        if (alarm && !flatline) value += (Math.random() - 0.5) * 0.06;
        samples.push(value);
        samples.shift();
      }

      const w = canvas!.width;
      const h = canvas!.height;
      ctx!.clearRect(0, 0, w, h);
      // 方眼(医療モニタの目盛り)
      ctx!.strokeStyle = "rgba(255,255,255,0.05)";
      ctx!.lineWidth = 1;
      for (let x = 0; x < w; x += 20) {
        ctx!.beginPath();
        ctx!.moveTo(x, 0);
        ctx!.lineTo(x, h);
        ctx!.stroke();
      }
      for (let y = 0; y < h; y += 20) {
        ctx!.beginPath();
        ctx!.moveTo(0, y);
        ctx!.lineTo(w, y);
        ctx!.stroke();
      }
      // 波形
      ctx!.strokeStyle = stateRef.current.alarm ? "#ff5f5f" : "#5fff9f";
      ctx!.lineWidth = 2;
      ctx!.beginPath();
      const mid = h * 0.62;
      const scale = h * 0.42;
      for (let x = 0; x < samples.length; x++) {
        const y = mid - samples[x] * scale;
        if (x === 0) ctx!.moveTo(x, y);
        else ctx!.lineTo(x, y);
      }
      ctx!.stroke();
      raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    return () => {
      beepRef.current?.ctx.close().catch(() => {});
      beepRef.current = null;
    };
  }, []);

  const statusLabel = vitals.flatline
    ? "計測なし（本日まだ稼働していません）"
    : vitals.alarm
      ? "警報：負荷超過／期限切れあり"
      : "安定";

  return (
    <div className="panel p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-base font-bold">💓 生体モニタ</h3>
        <div className="flex items-center gap-2">
          <span
            className={`rounded px-2 py-0.5 text-xs font-bold ${
              vitals.alarm ? "bg-alert text-ink" : vitals.flatline ? "bg-cream/20 text-cream/70" : "bg-cream/15 text-cream"
            }`}
          >
            {statusLabel}
          </span>
          <button className={soundOn ? "btn-pill text-xs" : "btn-pill-outline text-xs"} onClick={() => setSoundOn((v) => !v)}>
            {soundOn ? "🔊 拍動音: ON" : "🔇 拍動音: OFF"}
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-cream/15 bg-black">
        <canvas ref={canvasRef} width={900} height={220} className="h-[220px] w-full" />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <VitalTile label="心拍" unit="bpm" value={vitals.flatline ? "--" : String(vitals.bpm)} tone={vitals.bpm > 120 ? "alert" : "normal"} hint="今日の負荷と期限切れ件数から" />
        <VitalTile
          label="血圧"
          unit="mmHg"
          value={vitals.flatline ? "--" : `${vitals.systolic}/${vitals.diastolic}`}
          tone={vitals.systolic > 160 ? "alert" : "normal"}
          hint="上=負荷、下=残っている予定"
        />
        <VitalTile
          label="SpO₂"
          unit="%"
          value={vitals.spo2 == null ? "--" : vitals.spo2.toFixed(1)}
          tone={vitals.spo2 != null && vitals.spo2 < 94 ? "alert" : "normal"}
          hint="記録した体調から"
        />
        <VitalTile
          label="体温"
          unit="℃"
          value={vitals.temperature.toFixed(1)}
          tone={vitals.temperature >= 37.5 ? "alert" : "normal"}
          hint="定時を過ぎてからの作業時間"
        />
      </div>

      <div className="mt-3 grid gap-2 text-xs text-cream/60 sm:grid-cols-2">
        <p>
          本日の実績 {formatHms(vitals.workedSeconds)} / 予定 {formatHms(vitals.plannedSeconds)}（完了 {vitals.doneCount}件・計測中 {vitals.runningCount}件）
        </p>
        <p className={vitals.overdue > 0 ? "font-bold text-alert" : ""}>
          期限切れ ToDo {vitals.overdueTodos}件 ・ 案件 {vitals.overdueProjects}件
          {vitals.afterHoursSeconds > 0 && `　定時外 ${formatHms(vitals.afterHoursSeconds)}`}
        </p>
      </div>
    </div>
  );
}

function VitalTile({
  label,
  unit,
  value,
  tone,
  hint,
}: {
  label: string;
  unit: string;
  value: string;
  tone: "normal" | "alert";
  hint: string;
}) {
  return (
    <div className="rounded-lg border border-cream/15 bg-ink/50 px-3 py-2" title={hint}>
      <div className="text-[10px] text-cream/50">{label}</div>
      <div className={`font-display text-2xl font-bold tabular-nums ${tone === "alert" ? "text-alert" : "text-cream"}`}>
        {value}
        <span className="ml-1 text-[10px] font-normal text-cream/40">{unit}</span>
      </div>
    </div>
  );
}
