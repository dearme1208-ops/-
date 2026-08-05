"use client";

import { useState } from "react";

// ブラウザ標準のWeb Speech API（非標準・実験的機能のためTS標準の型定義には含まれずanyで扱う）
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

export default function VoiceInputButton({ onResult }: { onResult: (text: string) => void }) {
  const [listening, setListening] = useState(false);

  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const SpeechRecognitionCtor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!SpeechRecognitionCtor) return null;

  function toggle() {
    if (listening) return;
    const recognition = new SpeechRecognitionCtor!();
    recognition.lang = "ja-JP";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      if (transcript) onResult(transcript);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognition.start();
    setListening(true);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={listening ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
      title="音声入力"
      aria-label="音声入力"
    >
      {listening ? "🎙 聞き取り中…" : "🎤 音声入力"}
    </button>
  );
}
