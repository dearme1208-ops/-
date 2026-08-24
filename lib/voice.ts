// TypeScriptの標準libにSpeechRecognition型が無いため、必要な範囲だけ簡易的に宣言する
interface MinimalSpeechRecognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export function createSpeechRecognition(lang = "ja-JP"): MinimalSpeechRecognition | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => MinimalSpeechRecognition;
    webkitSpeechRecognition?: new () => MinimalSpeechRecognition;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const recognition = new Ctor();
  recognition.lang = lang;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  return recognition;
}

export interface VoiceCommand {
  action: "start" | "finish" | "pause" | "status";
  target?: string; // 開始/終了対象の作業名（推定。文字列の一致で近い作業を探す）
}

// 発話テキストを簡単なコマンドとして解釈する。「○○を開始」「○○開始」で開始、
// 「終了」「一時停止」単体で今計測中の作業を対象にする、「○○を終了」で名前を
// 指定した終了、「今何してる」「状況は」等で現在の状況を聞き返す、といった単純な
// パターンマッチ（本格的な自然言語理解は行わない）
export function parseVoiceCommand(transcript: string): VoiceCommand | null {
  const text = transcript.trim();
  if (!text) return null;

  if (/^(終了|おわり|ストップ|止めて|やめる)$/.test(text)) return { action: "finish" };
  if (/^(一時停止|停止|ポーズ|中断)$/.test(text)) return { action: "pause" };
  if (/(今何|なにして|何してる|状況は?|進捗は?|残り時間は?|あとどれくらい|状況を?教えて)/.test(text)) {
    return { action: "status" };
  }

  const finishMatch = text.match(/^(.+?)を?終了$/);
  if (finishMatch) return { action: "finish", target: finishMatch[1].trim() };

  const startMatch = text.match(/^(.+?)を?(開始|はじめる|スタート)$/);
  if (startMatch) return { action: "start", target: startMatch[1].trim() };

  // どのパターンにも当てはまらなければ、発話全体を開始対象の作業名として扱う
  return { action: "start", target: text };
}

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

// ハンズフリーモード用: 画面を見なくても操作結果が分かるよう、ブラウザ標準の音声合成で
// 読み上げる。認識中に自分の声を拾ってしまわないよう、呼び出し側で読み上げ中は
// 一時的にマイクを止める運用を想定している
export function speak(text: string, lang = "ja-JP"): void {
  if (!isSpeechSynthesisSupported() || !text) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  window.speechSynthesis.cancel(); // 前の読み上げが残っていたら打ち切ってから話す
  window.speechSynthesis.speak(utterance);
}
