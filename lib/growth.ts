import type { ThemedMode } from "./theme";

export interface GrowthStage {
  icon: string;
  label: string;
}

// 本日の作業時間に応じて「育つ」ビジュアルの段階。演出テーマの世界観ごとに
// 見た目・呼び名だけを出し分け、色相を増やさず既存のテーマ資産を流用する
const DEFAULT_STAGES: GrowthStage[] = [
  { icon: "🌰", label: "種" },
  { icon: "🌱", label: "発芽" },
  { icon: "🌿", label: "若葉" },
  { icon: "🪴", label: "生長中" },
  { icon: "🌳", label: "大樹" },
  { icon: "🌲✨", label: "満開の大樹" },
];

const NATSUYASUMI_STAGES: GrowthStage[] = [
  { icon: "🌰", label: "種まき" },
  { icon: "🌱", label: "芽" },
  { icon: "🌿", label: "つる" },
  { icon: "🌼", label: "つぼみ" },
  { icon: "🌻", label: "満開" },
  { icon: "🌻✨", label: "大輪" },
];

const LOBOTOMY_STAGES: GrowthStage[] = [
  { icon: "🌀", label: "不安定" },
  { icon: "🌀", label: "やや不安定" },
  { icon: "🔒", label: "収容中" },
  { icon: "🔒", label: "安定" },
  { icon: "⚙️", label: "高度安定" },
  { icon: "✨", label: "完全収容" },
];

const VA11HALLA_STAGES: GrowthStage[] = [
  { icon: "🥃", label: "OPEN" },
  { icon: "🍸", label: "軌道に乗る" },
  { icon: "🍹", label: "盛況" },
  { icon: "💫", label: "ネオンフル点灯" },
  { icon: "🌃", label: "絶好調" },
  { icon: "✨", label: "伝説のバーテンダー" },
];

const PERSONA5_STAGES: GrowthStage[] = [
  { icon: "🎭", label: "潜入開始" },
  { icon: "🗝️", label: "捜索中" },
  { icon: "💎", label: "お宝発見" },
  { icon: "🔥", label: "覚醒" },
  { icon: "⭐", label: "変身" },
  { icon: "👑", label: "完全犯罪" },
];

// Claudeモード: 考えごとが少しずつまとまり、形になっていく過程になぞらえた段階
const CLAUDE_STAGES: GrowthStage[] = [
  { icon: "💭", label: "着想" },
  { icon: "✳️", label: "思考中" },
  { icon: "🧩", label: "整理中" },
  { icon: "🧠", label: "深く思考中" },
  { icon: "💡", label: "閃き" },
  { icon: "✨", label: "まとまった成果" },
];

// 禅モード: 落ち着きが少しずつ深まっていく過程になぞらえた段階
const ZEN_STAGES: GrowthStage[] = [
  { icon: "🕯️", label: "灯火" },
  { icon: "🌫️", label: "静まる" },
  { icon: "🍃", label: "凪" },
  { icon: "💧", label: "澄む" },
  { icon: "🌙", label: "静寂" },
  { icon: "☯️", label: "無心" },
];

// ターミナルモード: 回線がつながり、負荷が上がっていく管制室のステータス表示になぞらえた段階
export const TERMINAL_STAGES: GrowthStage[] = [
  { icon: "🔴", label: "OFFLINE" },
  { icon: "🟡", label: "STANDBY" },
  { icon: "🟢", label: "LIVE" },
  { icon: "📡", label: "STREAMING" },
  { icon: "⚡", label: "PEAK LOAD" },
  { icon: "🚀", label: "MAX THROUGHPUT" },
];

// 冒険者風: 駆け出しから伝説の英雄へと至る、RPGの定番の成長段階になぞらえた段階。
// AdventurerQuestSection側で「現在のランク・次のランクまでの必要けいけんち」を
// 表示するために外部から参照できるようexportする(TERMINAL_STAGESと同じ理由)
export const ADVENTURER_STAGES: GrowthStage[] = [
  { icon: "🗡️", label: "かけだし冒険者" },
  { icon: "🛡️", label: "見習い" },
  { icon: "⚔️", label: "一人前" },
  { icon: "🏆", label: "熟練" },
  { icon: "👑", label: "英雄" },
  { icon: "✨", label: "伝説" },
];

// ハブモード: 盤面がだんだん整い、見渡しやすくなっていく過程になぞらえた段階
const HUB_STAGES: GrowthStage[] = [
  { icon: "📍", label: "配置中" },
  { icon: "🗂️", label: "整理中" },
  { icon: "🧭", label: "見通し良好" },
  { icon: "📊", label: "把握できている" },
  { icon: "🎯", label: "掌握" },
  { icon: "✨", label: "完全掌握" },
];

const STAGES_BY_MODE: Record<ThemedMode, GrowthStage[]> = {
  natsuyasumi: NATSUYASUMI_STAGES,
  lobotomy: LOBOTOMY_STAGES,
  va11halla: VA11HALLA_STAGES,
  persona5: PERSONA5_STAGES,
  claude: CLAUDE_STAGES,
  zen: ZEN_STAGES,
  terminal: TERMINAL_STAGES,
  adventurer: ADVENTURER_STAGES,
  hub: HUB_STAGES,
};

// 6段階(0h/1h/2h/4h/6h/8h以上)。所要時間の感覚に合わせた区切り
export function computeGrowthStage(themedMode: ThemedMode | null, totalSeconds: number): { stage: GrowthStage; index: number } {
  const hours = totalSeconds / 3600;
  const index = hours >= 8 ? 5 : hours >= 6 ? 4 : hours >= 4 ? 3 : hours >= 2 ? 2 : hours >= 1 ? 1 : 0;
  const stages = themedMode ? STAGES_BY_MODE[themedMode] : DEFAULT_STAGES;
  return { stage: stages[index], index };
}
