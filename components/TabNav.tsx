"use client";

import { useEffect, useRef } from "react";

export interface TabDef {
  key: string;
  label: string;
  /** タブを開かなくても件数が分かるよう、ラベル横に出す小さな数字バッジ(0/未指定なら出さない) */
  badge?: number;
  /** アイコン。指定するとラベルと別の要素にし、狭い画面の分類タブで「アイコンを上・名前を下」に積める */
  icon?: string;
  /** 狭い画面で使う短い名前(例:「記録・マスタ」→「記録」)。見た目だけを差し替え、読み上げ等は正式名のまま */
  shortLabel?: string;
}

export default function TabNav({
  tabs,
  active,
  onChange,
  className = "",
  ariaLabel,
}: {
  tabs: TabDef[];
  active: string;
  onChange: (key: string) => void;
  /** 2段表示(GroupedTabNav)で上段・下段を見分けるための追加クラス */
  className?: string;
  ariaLabel?: string;
}) {
  const navRef = useRef<HTMLElement>(null);
  // スマホではタブ列が横にスクロールするが、右端で切れているだけでは続きのタブに気づけない。
  // 右端を透けさせる合図(globals.css の .scroll-fade-right)を、最後までスクロールしたら消す。
  // スクロールのたびに再描画しないよう、state ではなく要素の data 属性を直接書き換える(TodayToolbar と同じ作り)
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const update = () => {
      const atEnd = el.scrollWidth - el.clientWidth - el.scrollLeft <= 4;
      el.dataset.atEnd = atEnd ? "true" : "false";
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    // タブの増減(モードの切り替え・茂みへ隠す)や画面の回転でも、はみ出すかどうかが変わる
    const ro = new ResizeObserver(update);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);
  // 選んだタブを列の中央へ寄せる。画面の外のタブ(例: 検索から開いた設定)を選んでも、
  // どのタブにいるのかが見えるように。scrollIntoView はページ全体も縦に動かしてしまうので使わず、
  // タブ列だけを横にスクロールする。offsetLeft は位置の基準になる祖先が列とは限らないため、画面上の位置の差で測る
  const centeredOnce = useRef(false);
  useEffect(() => {
    const nav = navRef.current;
    // 開いた直後(初回)は動きを見せずにその場で合わせる。読み込みのたびにタブ列が流れると落ち着かないため
    const first = !centeredOnce.current;
    centeredOnce.current = true;
    if (!nav || nav.scrollWidth <= nav.clientWidth) return;
    const chip = nav.querySelector<HTMLElement>('[data-active="true"]');
    if (!chip) return;
    const navRect = nav.getBoundingClientRect();
    const chipRect = chip.getBoundingClientRect();
    const left = nav.scrollLeft + (chipRect.left - navRect.left) - (nav.clientWidth - chipRect.width) / 2;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    nav.scrollTo({ left: Math.max(0, left), behavior: reduce || first ? "auto" : "smooth" });
  }, [active]);
  return (
    // tab-nav / tab-chip は演出テーマ側がタブ列だけを狙い撃ちするための目印。
    // 素の見た目は他のボタンと同じ(btn-pill系)なので、テーマを当てない限り変化はない
    // scroll-fade-right: スマホで横にはみ出す間だけ右端を透けさせる、続きの合図
    <nav
      ref={navRef}
      className={`tab-nav scroll-fade-right -mx-4 mb-4 overflow-x-auto px-4 sm:mx-0 sm:px-0 ${className}`}
      aria-label={ariaLabel}
    >
      <div className="flex w-max gap-2 sm:w-full sm:flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            data-active={active === t.key ? "true" : "false"}
            className={
              active === t.key
                ? "tab-chip btn-pill whitespace-nowrap text-sm"
                : "tab-chip btn-pill-outline whitespace-nowrap text-sm"
            }
          >
            {t.icon ? (
              <>
                <span className="tab-chip-icon">{t.icon}</span>{" "}
                <span className="tab-chip-label" data-short={t.shortLabel}>
                  {t.label}
                </span>
              </>
            ) : (
              t.label
            )}
            {!!t.badge && (
              <span className="tab-chip-badge ml-1.5 rounded-full bg-alert px-1.5 py-0.5 text-[10px] font-bold leading-none text-ink">
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>
    </nav>
  );
}
