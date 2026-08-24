"use client";

import { useEffect, useRef, useState } from "react";
import Modal from "@/components/ui/Modal";
import { renderLifeArt, type LifeArtData } from "@/lib/lifeArt";

export default function LifeArtModal({ data, onClose }: { data: LifeArtData; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (canvasRef.current) renderLifeArt(canvasRef.current, data);
  }, [data]);

  function save() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = "life-art.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <Modal title="✨ 全期間の軌跡" onClose={onClose}>
      <div className="space-y-3">
        {data.records.length === 0 ? (
          <p className="text-sm text-cream/50">まだ実績がありません。作業を記録すると、ここに軌跡が描かれます。</p>
        ) : (
          <>
            <canvas ref={canvasRef} className="w-full rounded-xl border border-cream/10" style={{ aspectRatio: "1 / 1" }} />
            <p className="text-[10px] text-cream/40">
              1つの星が1件の実績です。角度は開始時刻(0時が真上、時計回り)、中心からの距離は最初の記録からの経過時間、大きさは作業時間、色は大項目を表します。同じ時間帯に働く習慣があるほど、渦の腕がはっきり見えてきます。
            </p>
            <button className="btn-pill w-full text-sm" onClick={save}>
              {saved ? "保存しました！" : "画像として保存"}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
