// 森モード専用の線画アイコン。絵文字は端末ごとに絵柄が違い、森の絵の横で浮くため、
// 森モードでだけ線画に差し替える。元の絵文字は常にDOMに残す(森では見た目だけ隠す)ので、
// ボタンの読み上げ名・文字列はどのモードでも今と同じ。ほかのモードでは線画を出さず絵文字のまま
export type IconName =
  | "bolt" | "plus" | "pencil" | "search" | "compass" | "calendar" | "timer" | "moon" | "history"
  | "clipboard" | "play" | "pause" | "check" | "board" | "pin" | "mountain" | "hourglass" | "sun"
  | "star" | "tag" | "folder" | "journal" | "toolbox" | "clock" | "leaf" | "flame" | "warning"
  | "sprout" | "chart" | "sliders" | "dice"
  | "robot" | "folderOpen" | "checkbox" | "archive" | "ruler" | "zzz" | "save" | "box" | "bell"
  | "building" | "telescope" | "wrench" | "broom" | "lock" | "unlock" | "sparkle" | "trophy"
  | "grip" | "chevronDown" | "briefcase" | "home";

const PATHS: Record<IconName, string> = {
  bolt: "M11.5 2.5 4.5 11h5l-1 6.5 7-8.5h-5z",
  plus: "M10 4.5v11M4.5 10h11",
  pencil: "M13.25 3.75l3 3L7 16H4v-3zM11.25 5.75l3 3",
  search: "M8.75 3.5a5.25 5.25 0 1 0 0 10.5a5.25 5.25 0 1 0 0-10.5zM12.6 12.6 16.5 16.5",
  compass: "M10 3a7 7 0 1 0 0 14a7 7 0 1 0 0-14zM12.9 7.1l-1.6 4.2-4.2 1.6 1.6-4.2z",
  calendar: "M4 5.5h12v11H4zM4 9h12M7.5 3.5v3M12.5 3.5v3",
  timer: "M10 6.5a5.25 5.25 0 1 0 0 10.5a5.25 5.25 0 1 0 0-10.5zM10 9.5v2.5l1.5 1M8.25 3h3.5M10 3v3.5",
  moon: "M15.8 12.6A6.5 6.5 0 0 1 7.4 4.2a6.5 6.5 0 1 0 8.4 8.4z",
  history: "M4.2 10a5.8 5.8 0 1 0 1.7-4.1M4 3.6v3h3M10 7v3.2l2.2 1.4",
  clipboard: "M7 4H5.5v13h9V4H13M7.5 2.75h5v2.5h-5zM8 9.5h4M8 12.5h3",
  play: "M7 4.5v11l8.5-5.5z",
  pause: "M7.5 5v10M12.5 5v10",
  check: "M4.5 10.5l3.5 3.5 7.5-8",
  board: "M3.5 4h3.75v12H3.5zM8.75 4h3.75v8H8.75zM14 4h2.5v10H14z",
  pin: "M10 17.5s5-4.9 5-9a5 5 0 0 0-10 0c0 4.1 5 9 5 9zM10 6.5a2 2 0 1 0 0 4a2 2 0 1 0 0-4z",
  mountain: "M2.5 16 8 7l3.2 5 2.3-3.2L17.5 16zM6.4 9.6 8 10.8l1.4-1.2",
  hourglass: "M5.5 2.75h9M5.5 17.25h9M6.5 2.75v1.5c0 2.6 7 3.1 7 5.75s-7 3.15-7 5.75v1.5M13.5 2.75v1.5c0 2.6-7 3.1-7 5.75s7 3.15 7 5.75v1.5",
  sun: "M10 7a3 3 0 1 0 0 6a3 3 0 1 0 0-6zM10 2.5v1.75M10 15.75v1.75M2.5 10h1.75M15.75 10h1.75M4.7 4.7l1.25 1.25M14.05 14.05l1.25 1.25M4.7 15.3l1.25-1.25M14.05 5.95l1.25-1.25",
  star: "M10 2.8l2.2 4.6 5 .6-3.7 3.4 1 5-4.5-2.5-4.5 2.5 1-5L2.8 8l5-.6z",
  tag: "M3.5 3.5h6.25l6.75 6.75-6.25 6.25-6.75-6.75zM7 7h.01",
  folder: "M2.75 5.25h5l1.5 1.75h8v8.75H2.75z",
  journal: "M5 3h10v14H5zM7.75 3v14M10 7h3M10 10h3",
  toolbox: "M3 8h14v8H3zM7 8V5.5h6V8M3 11.5h14",
  clock: "M10 4.75a6 6 0 1 0 0 12a6 6 0 1 0 0-12zM10 7.75v3l2 1.5M3.5 5.25 5.5 3.25M16.5 5.25l-2-2",
  leaf: "M4 16c0-7.5 4.5-12 12.5-12.5C16 11.5 11.5 16 4 16zM4 16l6.5-6.5",
  flame: "M10 17.25c-2.9 0-5-2-5-4.75 0-3 2.4-4.4 3-7.75 2.6 1.4 7 3.9 7 7.75 0 2.75-2.1 4.75-5 4.75zM10 17.25c-1.2 0-2-.85-2-1.95 0-1.4 1.1-2 2-3.3.9 1.3 2 1.9 2 3.3 0 1.1-.8 1.95-2 1.95z",
  warning: "M10 3.25 17.25 16H2.75zM10 8.25v3.5M10 14h.01",
  sprout: "M10 17v-6M10 11c0-3.4-2.4-5.5-6-5.5 0 3.4 2.4 5.5 6 5.5zM10 11c0-3 2.1-5 5.5-5 0 3-2.1 5-5.5 5z",
  chart: "M3.5 16.5h13M6 14v-3.5M10 14V6M14 14V9",
  sliders: "M3.5 6.5h13M3.5 13.5h13M7.5 4.5v4M12.5 11.5v4",
  dice: "M4 4h12v12H4zM7.25 7.25h.01M10 10h.01M12.75 12.75h.01",
  robot: "M4.5 7h11v8.5h-11zM10 4v3M7.75 10.5h.01M12.25 10.5h.01M8 13h4M2.75 10v2.5M17.25 10v2.5",
  folderOpen: "M2.75 15.5V5.25h5l1.5 1.75h6v2.5M2.75 15.5l2.5-6h12.25l-2.5 6z",
  checkbox: "M4 4h12v12H4zM7 10.25l2.25 2.25 4-4.5",
  archive: "M4.5 3h11v14h-11zM4.5 10h11M8.5 6.5h3M8.5 13.5h3",
  ruler: "M3.5 3.5v13h13zM6.5 10.75v3.25h3.25zM3.5 7h1.5M3.5 10h1.5M3.5 13h1.5",
  zzz: "M3.5 9h4l-4 4.5h4M10 6.5h3l-3 3.5h3M14.5 3h2.5l-2.5 3h2.5",
  save: "M3.5 3.5h10l3 3v10h-13zM6.5 3.5V7h6V3.5M6.5 16.5v-5h7v5",
  box: "M10 2.75l6.5 3.5v7.5L10 17.25l-6.5-3.5v-7.5zM3.5 6.25 10 9.75l6.5-3.5M10 9.75v7.5",
  bell: "M5.5 13.5V9a4.5 4.5 0 0 1 9 0v4.5l1.5 1.5H4zM8.5 17.25h3",
  building: "M4.5 17V3.5h8V17M12.5 7.5h3V17M3 17h14M7 6.5h3M7 9.5h3M7 12.5h3",
  telescope: "M3.25 10.75l9.5-4.25 1.25 2.75-9.5 4.25zM12.75 6.5l2.75-1.25 1.25 2.75L14 9.25M9 11.25l-2.5 5.5M9 11.25l2.5 5.5",
  wrench: "M13.5 3.25a3.75 3.75 0 0 0-3.4 5.3L3.75 14.9l1.35 1.35 6.35-6.35a3.75 3.75 0 0 0 5.3-3.4l-2.25 2.25-2-.75-.75-2z",
  broom: "M16.5 3.5 11 9M8.5 7.5l4 4M8.5 7.5C6 8.5 4 11.5 3.5 16.5c5-.5 8-2.5 9-5M6.5 14l1.75-1.75",
  lock: "M5 9h10v8H5zM7 9V6.5a3 3 0 0 1 6 0V9M10 12v2",
  unlock: "M5 9h10v8H5zM7 9V6.5a3 3 0 0 1 5.8-1.1M10 12v2",
  sparkle: "M9 2.5c.6 3.9 1.6 4.9 5.5 5.5-3.9.6-4.9 1.6-5.5 5.5-.6-3.9-1.6-4.9-5.5-5.5 3.9-.6 4.9-1.6 5.5-5.5zM15.5 13v3.5M13.75 14.75h3.5",
  trophy: "M6 3.5h8v4a4 4 0 0 1-8 0zM6 5H3.5c0 2.5 1.2 3.75 3 3.9M14 5h2.5c0 2.5-1.2 3.75-3 3.9M10 11.5v5M7 16.5h6",
  grip: "M7.5 5h.01M12.5 5h.01M7.5 10h.01M12.5 10h.01M7.5 15h.01M12.5 15h.01",
  chevronDown: "M5.5 8l4.5 4.5L14.5 8",
  briefcase: "M3 6.5h14v9.5H3zM7.25 6.5V4.5h5.5v2M3 10.5h14",
  home: "M3.5 9 10 3.5 16.5 9M5 7.75v8.75h3.5V12h3v4.5H15V7.75",
};
// 塗りで描くもの(線だけだと細く見える)
const FILLED: Partial<Record<IconName, true>> = { play: true };

// 絵文字 → アイコン。異体字セレクタ(U+FE0F)は外してから引く
const EMOJI: Record<string, IconName> = {
  "⚡": "bolt", "➕": "plus", "+": "plus", "＋": "plus", "✏": "pencil", "✎": "pencil", "🔍": "search",
  "🧭": "compass", "🗓": "calendar", "📅": "calendar", "⏱": "timer", "🌙": "moon", "🕘": "history",
  "📋": "clipboard", "▶": "play", "⏸": "pause", "✅": "check", "✓": "check", "🗂": "board",
  "📍": "pin", "📌": "pin", "🏔": "mountain", "⛰": "mountain", "⏳": "hourglass", "☀": "sun",
  "★": "star", "☆": "star", "⭐": "star", "🏷": "tag", "📁": "folder", "📓": "journal", "📝": "journal",
  "🧰": "toolbox", "⏰": "clock", "🕰": "clock", "🌿": "leaf", "🍃": "leaf", "🔥": "flame",
  "⚠": "warning", "🌱": "sprout", "📊": "chart", "⚙": "sliders", "🎲": "dice",
  "🤖": "robot", "📂": "folderOpen", "☑": "checkbox", "🗄": "archive", "📐": "ruler", "😴": "zzz",
  "💤": "zzz", "💾": "save", "📦": "box", "🔔": "bell", "🏢": "building", "🔭": "telescope",
  "🛠": "wrench", "🔧": "wrench", "🧹": "broom", "🔒": "lock", "🔓": "unlock", "✨": "sparkle",
  "🏆": "trophy", "💼": "briefcase", "🏠": "home",
};
export function iconForEmoji(emoji: string): IconName | undefined {
  return EMOJI[emoji.replace(/\uFE0F/g, "")];
}

export default function Icon({
  name,
  emoji,
  filled,
  className = "",
}: {
  /** 線画の名前。省略時は emoji から引く */
  name?: IconName;
  /** 元の絵文字。森以外ではこれをそのまま出し、森では読み上げ用に残して見た目だけ隠す */
  emoji?: string;
  /** ★(お気に入り済み)のように塗りで描く */
  filled?: boolean;
  className?: string;
}) {
  const n = name ?? (emoji ? iconForEmoji(emoji) : undefined);
  // 対応する線画が無い絵文字は、どのモードでも絵文字のまま出す
  if (!n) return emoji ? <span className={className}>{emoji}</span> : null;
  return (
    <span className={`ico ${className}`} data-forest-only={emoji ? undefined : "true"}>
      <svg
        className="ico-svg"
        viewBox="0 0 20 20"
        aria-hidden="true"
        focusable="false"
        fill={filled || FILLED[n] ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={PATHS[n]} />
      </svg>
      {emoji && <span className="ico-emoji">{emoji}</span>}
    </span>
  );
}

/** 「⚡ トラブル発生」のような、先頭が絵文字+空白の文言。文字列はそのまま(textContentは同じ)、先頭だけ Icon にする */
export function IconLabel({ text }: { text: string }) {
  const m = /^(\S+) ([\s\S]*)$/.exec(text);
  if (!m || !iconForEmoji(m[1])) return <>{text}</>;
  return (
    <>
      <Icon emoji={m[1]} /> {m[2]}
    </>
  );
}
