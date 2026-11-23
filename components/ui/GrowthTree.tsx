"use client";

import { useEffect, useRef, type CSSProperties } from "react";

// 「今日の木」: 本日の作業時間で5段階に育つ木の絵(森モード用)。
// 絵は public/art/tree-N.webp のアルファを型抜き(mask)に使い、色はテーマの変数で塗る。
// basePath を使っていないので、manifest やアイコンと同じく "/" から書く

export type TreeStage = 1 | 2 | 3 | 4 | 5;

// 段階の区切りは lib/growth.ts の computeGrowthStage(6段階 0〜5)を正とし、ここでは木の絵に当てはめるだけ。
// 種(〜1h)と発芽(1h〜)はどちらも一番小さい木、満開の大樹(8h〜)だけ灯りの付いた老木
const TREE_BY_GROWTH_INDEX: TreeStage[] = [1, 1, 2, 3, 4, 5];
export function treeStageFromGrowthIndex(index: number): TreeStage {
  return TREE_BY_GROWTH_INDEX[Math.max(0, Math.min(TREE_BY_GROWTH_INDEX.length - 1, Math.floor(index)))];
}

// 元画像の大きさ(同じ縮尺)。縦横比を保つために使う
const TREE_SIZES: Record<TreeStage, [number, number]> = {
  1: [92, 63],
  2: [102, 101],
  3: [119, 170],
  4: [182, 233],
  5: [308, 320],
};
// 枠の高さに対する木の高さ。同じ縮尺のままだと1段目が小さすぎるので、育つ感じだけ残して詰める
const TREE_HEIGHT_RATIO: Record<TreeStage, number> = { 1: 0.5, 2: 0.62, 3: 0.76, 4: 0.88, 5: 1 };
// 5段目の吊り灯の位置(tree-5.webp 上の割合)
const LANTERN = { left: 75.6, top: 71.6 };
const STAGES: TreeStage[] = [1, 2, 3, 4, 5];

// 根元は深い苔色、梢へ向かって明るい若葉〜生成り色
const TREE_FILL =
  "linear-gradient(to top, color-mix(in srgb, rgb(var(--accent-rgb)) 58%, black) 0%, rgb(var(--accent-rgb)) 55%, color-mix(in srgb, rgb(var(--accent-rgb)) 55%, rgb(var(--cream-rgb))) 100%)";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function GrowthTree({
  stage,
  size = 40,
  label,
  className,
}: {
  stage: TreeStage;
  /** 枠の高さ(px)。幅はその0.8倍 */
  size?: number;
  /** 段階の呼び名(読み上げ用。例: 若葉) */
  label?: string;
  className?: string;
}) {
  const width = Math.round(size * 0.8);
  const swayRef = useRef<HTMLSpanElement>(null);
  const bloomRef = useRef<HTMLSpanElement>(null);
  const haloRef = useRef<HTMLSpanElement>(null);
  const prevStageRef = useRef<TreeStage | null>(null);

  // ゆっくり揺れる(根元を軸に±0.6度)。動きを減らす設定なら止める
  useEffect(() => {
    const el = swayRef.current;
    if (!el || typeof el.animate !== "function" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let anim: Animation | null = null;
    const sync = () => {
      if (mq.matches) {
        anim?.cancel();
        anim = null;
      } else if (!anim) {
        anim = el.animate(
          [{ transform: "rotate(-0.6deg)" }, { transform: "rotate(0.6deg)" }, { transform: "rotate(-0.6deg)" }],
          { duration: 6000, iterations: Infinity, easing: "ease-in-out" },
        );
      }
    };
    sync();
    mq.addEventListener?.("change", sync);
    return () => {
      mq.removeEventListener?.("change", sync);
      anim?.cancel();
    };
  }, []);

  // 開いている間に段階が上がった時だけ、一度ふわっと咲く(最初の表示・動きを減らす設定では出さない)
  useEffect(() => {
    const prev = prevStageRef.current;
    prevStageRef.current = stage;
    if (prev === null || stage <= prev || prefersReducedMotion()) return;
    bloomRef.current?.animate?.([{ transform: "scale(0.96)" }, { transform: "scale(1)" }], { duration: 700, easing: "cubic-bezier(.2,.8,.2,1)" });
    haloRef.current?.animate?.([{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }], { duration: 1400, easing: "ease-out" });
  }, [stage]);

  const boxStyle: CSSProperties = { position: "relative", display: "inline-block", width, height: size, flexShrink: 0 };
  const fill: CSSProperties = { position: "absolute", inset: 0, transformOrigin: "50% 100%" };

  return (
    <span role="img" aria-label={`今日の木 ${stage}/5${label ? `（${label}）` : ""}`} className={className} style={boxStyle}>
      {/* 足元の淡い光 */}
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "50%",
          bottom: 0,
          width: width * 1.15,
          height: size * 0.4,
          transform: "translate(-50%, 35%)",
          background: "radial-gradient(ellipse at center, rgb(var(--accent-rgb) / 0.3) 0%, rgb(var(--accent-rgb) / 0.08) 45%, transparent 70%)",
          pointerEvents: "none",
        }}
      />
      {/* 段階が上がった時の光(普段は見えない) */}
      <span
        ref={haloRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: width * 1.4,
          height: size * 1.1,
          transform: "translate(-50%, -50%)",
          background: "radial-gradient(ellipse at center 60%, rgb(var(--accent-rgb) / 0.35) 0%, transparent 65%)",
          opacity: 0,
          pointerEvents: "none",
        }}
      />
      <span ref={bloomRef} aria-hidden="true" style={fill}>
        <span ref={swayRef} style={fill}>
          {STAGES.map((s) => {
            const [w, h] = TREE_SIZES[s];
            const th = size * TREE_HEIGHT_RATIO[s];
            const tw = (th * w) / h;
            const url = `url(/art/tree-${s}.webp)`;
            return (
              <span
                key={s}
                style={{
                  position: "absolute",
                  left: "50%",
                  bottom: 0,
                  width: tw,
                  height: th,
                  transform: "translateX(-50%)",
                  opacity: s === stage ? 1 : 0,
                  transition: "opacity 600ms ease",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: TREE_FILL,
                    maskImage: url,
                    WebkitMaskImage: url,
                    maskSize: "contain",
                    WebkitMaskSize: "contain",
                    maskRepeat: "no-repeat",
                    WebkitMaskRepeat: "no-repeat",
                    maskPosition: "bottom center",
                    WebkitMaskPosition: "bottom center",
                  }}
                />
                {s === 5 && (
                  // 吊り灯のあたたかい灯り
                  <span
                    style={{
                      position: "absolute",
                      left: `${LANTERN.left}%`,
                      top: `${LANTERN.top}%`,
                      width: Math.max(2.5, tw * 0.07),
                      height: Math.max(2.5, tw * 0.07),
                      transform: "translate(-50%, -50%)",
                      borderRadius: "9999px",
                      background: "rgb(var(--forest-amber-rgb, 208 162 84))",
                      boxShadow: "0 0 3px 1px rgb(var(--forest-amber-rgb, 208 162 84) / 0.7), 0 0 8px 3px rgb(var(--forest-amber-rgb, 208 162 84) / 0.3)",
                    }}
                  />
                )}
              </span>
            );
          })}
        </span>
      </span>
    </span>
  );
}
