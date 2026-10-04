"use client";

import { Component, type ReactNode } from "react";

// タブ1つ分の画面で起きた失敗を、その画面の中だけで受け止める。
// これが無いと、電波の弱い所で初めて開いたタブの読み込み(ChunkLoadError)に失敗した時や、
// 1つの画面の不具合で、アプリ全体がエラー画面(app/error.tsx)に切り替わり、裏で動いている
// 本日の作業(予定の時刻の自動開始・時間割・通知など)まで止まってしまっていた
export default class SectionBoundary extends Component<{ children: ReactNode; label?: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("画面の表示に失敗しました", error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const chunk = error.name === "ChunkLoadError" || /Loading chunk|Failed to fetch dynamically imported module/i.test(error.message);
    return (
      <div className="panel space-y-3 border border-alert/50 p-5" role="alert" data-testid="section-error">
        <p className="font-bold text-cream">
          {chunk ? `${this.props.label ?? "この画面"}を読み込めませんでした` : `${this.props.label ?? "この画面"}の表示中に問題が起きました`}
        </p>
        <p className="text-sm text-cream/75">
          {chunk
            ? "電波の弱い所では、初めて開く画面の読み込みに失敗することがあります。通信を確かめて、もう一度読み込んでください。"
            : "記録したデータは消えていません。ほかのタブや、計測・予定の自動開始はそのまま動いています。"}
        </p>
        <div className="flex flex-wrap gap-2">
          <button className="btn-pill text-sm" onClick={() => (chunk ? window.location.reload() : this.setState({ error: null }))}>
            {chunk ? "もう一度読み込む" : "再試行"}
          </button>
        </div>
      </div>
    );
  }
}
