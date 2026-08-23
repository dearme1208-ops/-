"use client";

import { useEffect, useRef, useState } from "react";
import Modal from "@/components/ui/Modal";
import { renderDayCard, type DayCardData } from "@/lib/dayCard";

export default function DayCardModal({ data, onClose }: { data: DayCardData; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (canvasRef.current) renderDayCard(canvasRef.current, data);
  }, [data]);

  function save() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `today-${data.date}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <Modal title="🖼 今日の一枚" onClose={onClose}>
      <div className="space-y-3">
        <canvas ref={canvasRef} className="w-full rounded-xl border border-cream/10" style={{ aspectRatio: "720 / 960" }} />
        <button className="btn-pill w-full text-sm" onClick={save}>
          {saved ? "保存しました！" : "画像として保存"}
        </button>
      </div>
    </Modal>
  );
}
