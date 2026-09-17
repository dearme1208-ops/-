"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { computeProjectProgress } from "@/lib/projectStage";
import { daysBetweenDateStrs, todayStr } from "@/lib/time";

// 案件を惑星、その案件に紐づくToDoを衛星として公転させる観測法。
// 期日が近いものほど内側を速く回り、期限切れのものは軌道が崩れて中心へ落ちていく。
// 「締切に引き寄せられている」という感覚を、そのまま重力として絵にしている
const MAX_PLANETS = 28;
const MAX_MOONS_PER_PLANET = 6;

interface Planet {
  id: string;
  label: string;
  radius: number; // 軌道半径(px)
  size: number; // 惑星の大きさ(px)
  hue: number;
  daysLeft: number;
  overdue: boolean;
  progress: number; // 0〜1
  phase: number; // 初期角度(idから決まる固定値。毎回同じ配置になる)
  moons: { id: string; label: string; hue: number; overdue: boolean }[];
}

function hashHue(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
  return h;
}

export default function OrbitView() {
  const today = todayStr();
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const todos = useLiveQuery(() => db.todoTasks.toArray(), []);
  const runningTasks = useLiveQuery(() => db.dailyTasks.where("date").equals(today).toArray(), [today]);
  const [paused, setPaused] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const planets = useMemo<Planet[]>(() => {
    const active = (projects ?? []).filter((p) => !p.completedAt).slice(0, MAX_PLANETS);
    return active.map((p) => {
      const daysLeft = daysBetweenDateStrs(today, p.dueDate);
      const overdue = daysLeft < 0;
      // 期日までの日数が軌道半径。遠い未来ほど外周をゆっくり回る
      const radius = overdue ? 42 + Math.max(-30, daysLeft) * -1.2 : 70 + Math.min(240, daysLeft * 3.4);
      const stageCount = (p.stages ?? []).length;
      const progress = computeProjectProgress(p.stages) ?? 0;
      const moons = (todos ?? [])
        .filter((t) => !t.completed && !t.parentTaskId && t.projectId === p.id)
        .slice(0, MAX_MOONS_PER_PLANET)
        .map((t) => ({
          id: t.id,
          label: t.title,
          hue: hashHue(t.title),
          overdue: !!t.dueDate && t.dueDate < today,
        }));
      return {
        id: p.id,
        label: p.groupName || p.title,
        radius: Math.max(38, radius),
        size: 5 + Math.min(11, stageCount * 1.6),
        hue: hashHue(p.groupName || p.title),
        daysLeft,
        overdue,
        progress,
        phase: (hashHue(p.id) / 360) * Math.PI * 2,
        moons,
      };
    });
  }, [projects, todos, today]);

  // 案件に紐づかない未完了ToDoは、恒星のまわりを漂う小惑星帯として描く
  const asteroids = useMemo(() => {
    return (todos ?? [])
      .filter((t) => !t.completed && !t.parentTaskId && !t.projectId)
      .slice(0, 60)
      .map((t) => ({
        id: t.id,
        overdue: !!t.dueDate && t.dueDate < today,
        phase: (hashHue(t.id) / 360) * Math.PI * 2,
        radius: 300 + (hashHue(t.id) % 40),
      }));
  }, [todos, today]);

  const runningCount = (runningTasks ?? []).filter((t) => t.status === "running").length;

  const stateRef = useRef({ planets, asteroids, runningCount, paused });
  stateRef.current = { planets, asteroids, runningCount, paused };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let t = 0;
    let last = performance.now();

    function frame(now: number) {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = stateRef.current;
      if (!s.paused) t += dt;

      const w = canvas!.width;
      const h = canvas!.height;
      const cx = w / 2;
      const cy = h / 2;
      ctx!.clearRect(0, 0, w, h);
      ctx!.fillStyle = "#05060a";
      ctx!.fillRect(0, 0, w, h);

      // 背景の星。idではなく座標から決めるので毎フレーム同じ位置に瞬く
      for (let i = 0; i < 90; i++) {
        const sx = (i * 137.5) % w;
        const sy = (i * 71.3) % h;
        const twinkle = 0.25 + 0.2 * Math.sin(t * 1.4 + i);
        ctx!.fillStyle = `rgba(255,255,255,${twinkle.toFixed(2)})`;
        ctx!.fillRect(sx, sy, 1.2, 1.2);
      }

      // 中心の恒星 = 今日。計測中の作業があるほど強く燃える
      const flare = 16 + s.runningCount * 6 + Math.sin(t * 3) * 2;
      const grad = ctx!.createRadialGradient(cx, cy, 2, cx, cy, flare * 2.4);
      grad.addColorStop(0, "rgba(255,238,180,0.95)");
      grad.addColorStop(0.4, "rgba(255,190,90,0.5)");
      grad.addColorStop(1, "rgba(255,150,40,0)");
      ctx!.fillStyle = grad;
      ctx!.beginPath();
      ctx!.arc(cx, cy, flare * 2.4, 0, Math.PI * 2);
      ctx!.fill();
      ctx!.fillStyle = "#ffe9a8";
      ctx!.beginPath();
      ctx!.arc(cx, cy, flare * 0.42, 0, Math.PI * 2);
      ctx!.fill();

      // 小惑星帯
      for (const a of s.asteroids) {
        const angle = a.phase + t * 0.06;
        const x = cx + Math.cos(angle) * a.radius;
        const y = cy + Math.sin(angle) * a.radius * 0.42;
        ctx!.fillStyle = a.overdue ? "rgba(255,110,110,0.8)" : "rgba(220,220,220,0.45)";
        ctx!.fillRect(x, y, 2, 2);
      }

      for (const p of s.planets) {
        // 期日が近いほど速い。期限切れは軌道が崩れて中心へ落ちながら回る
        const speed = p.overdue ? 1.4 : 0.55 / Math.max(0.35, p.radius / 120);
        const angle = p.phase + t * speed;
        const decay = p.overdue ? 1 - Math.min(0.45, (Math.sin(t * 0.5 + p.phase) + 1) * 0.12) : 1;
        const r = p.radius * decay;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r * 0.5; // 少し傾けて見下ろす角度にする

        // 軌道
        ctx!.strokeStyle = p.overdue ? "rgba(255,90,90,0.35)" : `hsla(${p.hue}, 55%, 70%, 0.16)`;
        ctx!.setLineDash(p.overdue ? [3, 4] : []);
        ctx!.lineWidth = 1;
        ctx!.beginPath();
        ctx!.ellipse(cx, cy, r, r * 0.5, 0, 0, Math.PI * 2);
        ctx!.stroke();
        ctx!.setLineDash([]);

        // 惑星本体。進捗の分だけ明るい面が広がる
        ctx!.beginPath();
        ctx!.arc(x, y, p.size, 0, Math.PI * 2);
        ctx!.fillStyle = p.overdue ? "#ff6b6b" : `hsl(${p.hue}, 58%, 62%)`;
        ctx!.fill();
        if (p.progress > 0) {
          ctx!.beginPath();
          ctx!.arc(x, y, p.size, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.progress);
          ctx!.lineTo(x, y);
          ctx!.fillStyle = "rgba(255,255,255,0.45)";
          ctx!.fill();
        }

        // 衛星(その案件のToDo)
        p.moons.forEach((m, i) => {
          const mr = p.size + 7 + i * 5;
          const ma = angle * 2.6 + (i * Math.PI * 2) / Math.max(1, p.moons.length);
          const mx = x + Math.cos(ma) * mr;
          const my = y + Math.sin(ma) * mr * 0.6;
          ctx!.beginPath();
          ctx!.arc(mx, my, 2.2, 0, Math.PI * 2);
          ctx!.fillStyle = m.overdue ? "#ff9d9d" : "rgba(235,235,235,0.85)";
          ctx!.fill();
        });

        // 名前
        ctx!.font = "10px sans-serif";
        ctx!.fillStyle = p.overdue ? "rgba(255,150,150,0.95)" : "rgba(235,235,225,0.7)";
        const label = p.label.length > 12 ? `${p.label.slice(0, 12)}…` : p.label;
        ctx!.fillText(label, x + p.size + 4, y + 3);
      }

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const overdueCount = planets.filter((p) => p.overdue).length;

  return (
    <div className="panel p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-base font-bold">🪐 軌道</h3>
        <div className="flex items-center gap-2">
          <p className="text-xs text-cream/50">
            惑星(案件) {planets.length} ・ 小惑星(単独ToDo) {asteroids.length}
            {overdueCount > 0 && <span className="ml-1 font-bold text-alert">軌道崩壊 {overdueCount}</span>}
          </p>
          <button className={paused ? "btn-pill text-xs" : "btn-pill-outline text-xs"} onClick={() => setPaused((v) => !v)}>
            {paused ? "▶ 再開" : "⏸ 停止"}
          </button>
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-cream/15">
        <canvas ref={canvasRef} width={900} height={460} className="block h-[460px] w-full" />
      </div>
      <ul className="mt-2 space-y-0.5 text-[10px] leading-relaxed text-cream/40">
        <li>・中心の恒星 = 今日。計測中の作業があるほど強く燃えます</li>
        <li>・惑星 = 未完了の案件。軌道半径 = 期日までの日数、大きさ = 段階の数、白い扇 = 進捗</li>
        <li>・衛星 = その案件に紐づく未完了ToDo　小さな点 = どこにも紐づかないToDo</li>
        <li>・赤い破線の軌道 = 期限切れ。中心に向かって落ちていきます</li>
      </ul>
    </div>
  );
}
