// 森モードの「空の知らせ」に添える小さな線画。色は currentColor(CSS の .empty-art で淡い若葉色)。
// 読み上げには出さない(文言の方が意味を持つ)。森以外のモードでは CSS で隠す
export type EmptyArtName = "today" | "todo" | "projects" | "records" | "done" | "rings";

const DOT = { fill: "currentColor", stroke: "none" } as const;

// 奥行きは動かさずに出す: 奥(back)は淡く細く、手前(front)は濃く太く。月のある絵は月の周りに淡い暈を敷く。
// sky は月と暈の層で、森モードかつ動きを減らす設定でない時だけ CSS(.ea-drift)でごくゆっくり左右に漂う
type Art = { sky?: JSX.Element; back?: JSX.Element; front: JSX.Element };

/** 月の暈(グラデーションの id を使わず、淡い円を重ねるだけ。隠れたタブの中でも崩れない) */
function MoonGlow({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g fill="currentColor" stroke="none">
      <circle cx={cx} cy={cy} r={17} opacity={0.035} />
      <circle cx={cx} cy={cy} r={12.5} opacity={0.045} />
      <circle cx={cx} cy={cy} r={9} opacity={0.06} />
    </g>
  );
}

const ART: Record<EmptyArtName, Art> = {
  // 林の空き地: 二本の樅と月、下草、漂う蛍(何も計っていない、静かな時間)
  today: {
    sky: (
      <>
        <MoonGlow cx={69} cy={16.5} />
        <path d="M66 10a8 8 0 1 0 9.5 10.5A6.5 6.5 0 0 1 66 10z" />
      </>
    ),
    back: (
      <>
        <path d="M90 30l-6 9h4l-6 8h4l-7 9h22l-7-9h4l-6-8h4z" />
        <path d="M90 56v6" />
        <circle cx="58" cy="33" r="1" {...DOT} />
      </>
    ),
    front: (
      <>
        <path d="M6 62h108" />
        <path d="M30 16 22 29h5l-8 11h6l-9 12h28l-9-12h6l-8-11h5z" />
        <path d="M30 52v10" />
        <path d="M50 62c.5-3 1.5-4.5 3-5.5M55 62c0-2 .6-3.2 1.8-4M70 62c-.5-2.5-1.5-4-3-5" />
        <circle cx="47" cy="40" r="1.2" {...DOT} />
        <circle cx="74" cy="44" r="1.2" {...DOT} />
      </>
    ),
  },
  // 切り株から双葉(やることは片付いた。次が芽吹くのを待つ)
  todo: {
    back: (
      <>
        <path d="M8 62h104" />
        <path d="M44 62c-3 0-5 .5-6 0M76 62c3 0 5 .5 6 0" />
      </>
    ),
    front: (
      <>
        <path d="M44 62V49M76 62V49" />
        <ellipse cx="60" cy="49" rx="16" ry="4" />
        <path d="M53 49.2c0 1.2 14 1.2 14 0M57 49c0 .5 6 .5 6 0" />
        <path d="M60 45V34" />
        <path d="M60 38c-6 0-9.5-3.5-9.5-8 5.5 0 9.5 3 9.5 8z" />
        <path d="M60 35c5 0 8.5-3 8.5-7.5-5 0-8.5 2.8-8.5 7.5z" />
      </>
    ),
  },
  // 山と頂の旗、点線の山道(まだ登る山がない)
  projects: {
    back: (
      <>
        <path d="M6 62h108" />
        <path d="M24 62c8-5 18-7 26-12s12-10 17-16" strokeDasharray="2 4" />
      </>
    ),
    front: (
      <>
        <path d="M10 62 42 22l13 16 9-10 46 34" />
        <path d="M42 22V9l9 3-9 3" />
        <path d="M36 29.5 42 32l4-3" />
      </>
    ),
  },
  // 開いた手帳と一枚の葉(まだ何も書かれていない)
  records: {
    back: (
      <>
        <path d="M25 31c8-2 17-2 25 1M25 39c8-2 17-2 25 1M25 47c6-1.5 12-1.5 18 .5" />
        <path d="M70 32c8-3 17-3 25-1M70 40c6-2 12-2 18-1" />
      </>
    ),
    front: (
      <>
        <path d="M16 20c14-5 30-4 44 3 14-7 30-8 44-3v40c-14-5-30-4-44 3-14-7-30-8-44-3z" />
        <path d="M60 23v40" />
        <path d="M78 54c0-6 4-9.5 11-9.5 0 6-4 9.5-11 9.5zM78 54l6.5-5.5" />
      </>
    ),
  },
  // 土の中の種と、月(まだ収穫はない。完了タブが空)
  done: {
    sky: (
      <>
        <MoonGlow cx={87} cy={21} />
        <path d="M84 16a6 6 0 1 0 7 7.5A5 5 0 0 1 84 16z" />
      </>
    ),
    back: (
      <>
        <path d="M30 50c0 6 8 10 30 10s30-4 30-10" strokeDasharray="1.5 3.5" />
        <circle cx="40" cy="30" r="1.1" {...DOT} />
        <circle cx="50" cy="22" r="0.9" {...DOT} />
        <circle cx="72" cy="34" r="1.1" {...DOT} />
      </>
    ),
    front: (
      <>
        <path d="M8 50h104" />
        <path d="M60 58c-3.5 0-5.5-1.8-5.5-3.8s2.6-3.7 5.5-3.7 5.5 1.7 5.5 3.7-2 3.8-5.5 3.8z" />
        <path d="M60 50.5c0-4 1.2-7 3.5-9" />
      </>
    ),
  },
  // 途切れない年輪(今日の記録はつながっている)。外の輪ほど奥=淡く
  rings: {
    back: (
      <>
        <ellipse cx="60" cy="38" rx="28" ry="24" />
        <ellipse cx="59" cy="38.5" rx="21" ry="18" />
      </>
    ),
    front: (
      <>
        <ellipse cx="60.5" cy="37.5" rx="14" ry="12" />
        <ellipse cx="59.5" cy="38" rx="7" ry="6" />
        <circle cx="60" cy="38" r="1.2" {...DOT} />
      </>
    ),
  },
};

export default function EmptyArt({ name }: { name: EmptyArtName }) {
  const art = ART[name];
  return (
    <svg
      className="empty-art"
      viewBox="0 0 120 72"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {art.sky && (
        <g className="ea-drift" opacity={0.7} strokeWidth={1.2}>
          {art.sky}
        </g>
      )}
      {art.back && (
        <g opacity={0.45} strokeWidth={1.1}>
          {art.back}
        </g>
      )}
      <g strokeWidth={1.75}>{art.front}</g>
    </svg>
  );
}
