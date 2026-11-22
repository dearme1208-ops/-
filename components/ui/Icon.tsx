// 森モード専用の線画アイコン。絵文字は端末ごとに絵柄が違い、森の絵の横で浮くため、
// 森モードでだけ線画に差し替える。元の絵文字は常にDOMに残す(森では見た目だけ隠す)ので、
// ボタンの読み上げ名・文字列はどのモードでも今と同じ。ほかのモードでは線画を出さず絵文字のまま
export type IconName =
  | "bolt" | "plus" | "pencil" | "search" | "compass" | "calendar" | "timer" | "moon" | "history"
  | "clipboard" | "play" | "pause" | "check" | "board" | "pin" | "mountain" | "hourglass" | "sun"
  | "star" | "tag" | "folder" | "journal" | "toolbox" | "clock" | "leaf" | "flame" | "warning"
  | "sprout" | "chart" | "sliders" | "dice";

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
