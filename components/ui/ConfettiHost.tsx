"use client";

import { useEffect, useRef, useState } from "react";
import { subscribeConfetti } from "@/lib/confetti";

interface Piece {
  id: number;
  left: number; // vw
  delay: number; // s
  duration: number; // s
  rotate: number; // deg
  size: number; // px
  accent: boolean;
}

const PIECE_COUNT = 28;
let nextBurstId = 0;

// 案件完了・目標達成などの節目で控えめな紙吹雪を表示する。色相は増やさず
// cream/accentの2色のみを使う。prefers-reduced-motionの場合は何も表示しない
export default function ConfettiHost() {
  const [pieces, setPieces] = useState<Piece[]>([]);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    return subscribeConfetti(() => {
      if (reducedMotionRef.current) return;
      const burst = Array.from({ length: PIECE_COUNT }, () => ({
        id: nextBurstId++,
        left: Math.random() * 100,
        delay: Math.random() * 0.3,
        duration: 1.6 + Math.random() * 1.2,
        rotate: Math.random() * 360,
        size: 6 + Math.random() * 6,
        accent: Math.random() < 0.4,
      }));
      setPieces(burst);
      setTimeout(() => setPieces([]), 3200);
    });
  }, []);

  if (pieces.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[70] overflow-hidden">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="confetti-piece absolute top-[-5vh]"
          style={{
            left: `${p.left}vw`,
            width: p.size,
            height: p.size * 0.4,
            backgroundColor: p.accent ? "rgb(var(--accent-rgb) / 0.9)" : "rgb(var(--cream-rgb) / 0.9)",
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            transform: `rotate(${p.rotate}deg)`,
          }}
        />
      ))}
    </div>
  );
}
