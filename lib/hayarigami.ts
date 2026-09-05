import type { MasterTask, WorkRecord } from "./types";

// 流行り神風モード(怪異調査モード)の判定ロジック。
// このファイルには乱数も演出専用の数値も一切置かない。すべて実績(WorkRecord)と
// 作業マスタ(MasterTask)から決定的に導出し、「同じデータなら常に同じ怪異になる」ことを保証する。
// 演出のためだけの飾りを作らず、実データの言い換えに徹する方針は他モードと共通

// ---- 怪異名鑑(図鑑) ----

export type KaiiStatus = "目撃情報のみ" | "調査中" | "解明済み" | "鎮められた";

export interface KaiiEntry {
  key: string;
  displayName: string; // 怪異としての呼び名(実績の傾向から決定的に生成)
  realName: string; // 元の作業名
  category: string;
  encounterCount: number; // 遭遇回数 = 実績件数
  totalSeconds: number;
  avgSeconds: number;
  maxSeconds: number;
  estimatedSeconds: number;
  avgRatio: number; // 平均実績 ÷ 想定(想定が無ければ0)
  troubleCount: number;
  lastSeenDate: string;
  status: KaiiStatus;
  dangerLevel: number; // 0〜4。怪異名鑑の並び順と危険度表示に使う
}

// 実績の傾向から怪異の呼び名を決める。「いつも長引く」「突然湧く」といった
// その作業の"性質"がそのまま名前になるため、名前を見ただけで傾向が分かる
export function kaiiName(realName: string, e: { avgRatio: number; troubleRate: number; encounterCount: number; avgSeconds: number }): string {
  if (e.troubleRate >= 0.34) return `突然現れる${realName}`;
  if (e.avgRatio >= 2) return `終わらない${realName}`;
  if (e.avgRatio >= 1.4) return `長引く${realName}`;
  if (e.encounterCount >= 20) return `何度も現れる${realName}`;
  if (e.avgSeconds > 0 && e.avgSeconds <= 600) return `一瞬の${realName}`;
  if (e.avgRatio > 0 && e.avgRatio <= 0.7) return `逃げ足の速い${realName}`;
  return `${realName}の怪`;
}

function kaiiStatus(encounterCount: number, avgRatio: number): KaiiStatus {
  if (encounterCount <= 2) return "目撃情報のみ";
  if (encounterCount < 10) return "調査中";
  // 十分な回数を重ねた上で想定と実績が噛み合っている = その怪異は「鎮められた」
  if (avgRatio > 0 && Math.abs(avgRatio - 1) <= 0.2) return "鎮められた";
  return "解明済み";
}

function dangerLevelOf(avgRatio: number, troubleRate: number): number {
  if (avgRatio >= 4 || troubleRate >= 0.6) return 4;
  if (avgRatio >= 2.5 || troubleRate >= 0.4) return 3;
  if (avgRatio >= 1.8) return 2;
  if (avgRatio >= 1.3) return 1;
  return 0;
}

// 実績を作業ごとにまとめ、怪異名鑑の1行として組み立てる。
// 作業マスタに紐づかない実績も「区分::作業名」で1件の怪異として扱う(取りこぼさない)
export function buildKaiiIndex(masters: MasterTask[], records: WorkRecord[]): KaiiEntry[] {
  const estimateByMaster = new Map(masters.map((m) => [m.id, m]));
  const groups = new Map<
    string,
    { realName: string; category: string; masterId?: string; seconds: number[]; troubles: number; lastSeen: string }
  >();

  for (const r of records) {
    if (r.excludedFromStats) continue;
    const key = r.masterTaskId ?? `${r.category}::${r.name}`;
    if (!groups.has(key)) {
      groups.set(key, {
        realName: r.name,
        category: r.category,
        masterId: r.masterTaskId,
        seconds: [],
        troubles: 0,
        lastSeen: r.date,
      });
    }
    const g = groups.get(key)!;
    g.seconds.push(r.seconds);
    if (r.isTrouble) g.troubles += 1;
    if (r.date > g.lastSeen) g.lastSeen = r.date;
  }

  const entries: KaiiEntry[] = [];
  for (const [key, g] of groups) {
    const encounterCount = g.seconds.length;
    if (encounterCount === 0) continue;
    const totalSeconds = g.seconds.reduce((s, v) => s + v, 0);
    const avgSeconds = totalSeconds / encounterCount;
    const maxSeconds = Math.max(...g.seconds);
    const estimatedSeconds = g.masterId ? (estimateByMaster.get(g.masterId)?.estimatedSeconds ?? 0) : 0;
    const avgRatio = estimatedSeconds > 0 ? avgSeconds / estimatedSeconds : 0;
    const troubleRate = g.troubles / encounterCount;
    entries.push({
      key,
      displayName: kaiiName(g.realName, { avgRatio, troubleRate, encounterCount, avgSeconds }),
      realName: g.realName,
      category: g.category,
      encounterCount,
      totalSeconds,
      avgSeconds,
      maxSeconds,
      estimatedSeconds,
      avgRatio,
      troubleCount: g.troubles,
      lastSeenDate: g.lastSeen,
      status: kaiiStatus(encounterCount, avgRatio),
      dangerLevel: dangerLevelOf(avgRatio, troubleRate),
    });
  }

  // 危険度が高い順 → 遭遇回数が多い順。名鑑を開いた時に「今いちばん厄介な怪異」が先頭に来る
  return entries.sort((a, b) => b.dangerLevel - a.dangerLevel || b.encounterCount - a.encounterCount);
}

// ---- ルート(オカルト / 科学) ----
// 元ネタの「どちらの説を採るかでエンディングが分岐する」構造を、
// これまでの判定の蓄積として持つ。判定は実際にデータを書き換える操作でもあるため、
// このルートは「あなたがこれまで超過をどう処理してきたか」の要約そのものになっている

export type RouteKey = "occult" | "science" | "neutral" | "unknown";

export interface RouteJudgement {
  route: RouteKey;
  label: string;
  description: string;
}

export function judgeRoute(occultCount: number, scienceCount: number, wordingEnabled = true): RouteJudgement {
  const total = occultCount + scienceCount;
  if (total === 0) {
    return wordingEnabled
      ? {
          route: "unknown",
          label: "未分岐",
          description: "まだ一度も判定していない。この先の分岐は、あなたの選択で決まる。",
        }
      : { route: "unknown", label: "記録なし", description: "まだ超過の判定を行っていません。" };
  }
  if (occultCount >= scienceCount * 2) {
    return wordingEnabled
      ? {
          route: "occult",
          label: "オカルトルート",
          description:
            "超過のほとんどを「突発的な怪異」として処理してきた。想定は据え置かれ、トラブル対応の記録だけが積み上がっている。",
        }
      : {
          route: "occult",
          label: "トラブル計上が中心",
          description: "超過の多くをトラブル対応として記録しています。想定時間は据え置かれたままです。",
        };
  }
  if (scienceCount >= occultCount * 2) {
    return wordingEnabled
      ? {
          route: "science",
          label: "科学ルート",
          description:
            "超過のほとんどを「見積もりの誤り」として処理してきた。想定時間は実測に合わせて更新され、怪異は少しずつ姿を消していく。",
        }
      : {
          route: "science",
          label: "見積もり更新が中心",
          description: "超過の多くを見積もりの誤差として処理し、想定時間を実測に合わせて更新しています。",
        };
  }
  return wordingEnabled
    ? {
        route: "neutral",
        label: "中庸ルート",
        description: "怪異と見積もり誤差を、その都度見極めて処理している。最も現実的で、最も疲れる道だ。",
      }
    : {
        route: "neutral",
        label: "使い分けている",
        description: "トラブル対応と見積もり更新を、その都度使い分けています。",
      };
}

// ---- 時間帯による空気の変化 ----
// 「深夜に働いているかどうか」は残業分析でも使っている実データ的に意味のある軸。
// ここではそれを演出の濃さと語りの温度に反映する

export type NightPhase = "day" | "evening" | "night" | "witching";

export interface PhaseInfo {
  phase: NightPhase;
  label: string;
  flavor: string;
  corrupt: boolean; // trueの時、画面のノイズ演出を強める
}

export function phaseOf(date: Date = new Date(), wordingEnabled = true): PhaseInfo {
  const h = date.getHours();
  // 画面の暗さ(corrupt)は演出であり文言設定とは独立なので、labelとflavorだけ切り替える
  if (h >= 2 && h < 5) {
    return {
      phase: "witching",
      label: wordingEnabled ? "丑三つ時" : "深夜",
      flavor: wordingEnabled ? "午前2時から4時。人が最も怪異に近づく時間帯だ。……まだ起きているのか。" : "",
      corrupt: true,
    };
  }
  if (h >= 22 || h < 2) {
    return {
      phase: "night",
      label: "深夜",
      flavor: wordingEnabled ? "日付が変わる頃。仕事の輪郭が、少しずつ曖昧になっていく。" : "",
      corrupt: true,
    };
  }
  if (h >= 17) {
    return {
      phase: "evening",
      label: wordingEnabled ? "宵" : "夕方",
      flavor: wordingEnabled ? "陽が落ちた。ここから先は、時間の進み方が変わる。" : "",
      corrupt: false,
    };
  }
  return {
    phase: "day",
    label: wordingEnabled ? "白昼" : "日中",
    flavor: wordingEnabled ? "陽のあるうちは、たいていのものは説明がつく。" : "",
    corrupt: false,
  };
}

// ---- 侵蝕度 ----
// 本日の「想定を超えた分の時間」が全体に占める割合。0〜100で返す。
// 単なる稼働率ではなく「予定からどれだけはみ出したか」を見るため、
// 予定通りに長時間働いた日は侵蝕されず、短時間でも超過が多い日は侵蝕される
export function erosionPercent(tasks: { estimatedSeconds: number; elapsedSeconds: number }[]): number {
  let over = 0;
  let base = 0;
  for (const t of tasks) {
    if (t.estimatedSeconds <= 0) continue;
    base += t.estimatedSeconds;
    over += Math.max(0, t.elapsedSeconds - t.estimatedSeconds);
  }
  if (base <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((over / base) * 100)));
}

// ---- F.O.A.F.データベース風の通し番号 ----
// 原作では物語中に登場した警察用語・都市伝説・事件が自動的にデータベースへ登録され、
// No.001から通し番号が振られていく。ここではToDo・案件のようなアプリ内の対象に同じ体裁を
// 与えるため、対象のID(並び替えやフィルタでも変わらない)から決定的な3桁番号を割り当てる。
// 一覧の表示順が変わっても、同じ対象には常に同じ番号が付く
// 数字だけを返す。呼び出し側でW.fileNoPrefix(「FILE No.」/「No.」)と組み合わせて使うため、
// ここで独自に「No.」を付けると呼び出し側のプレフィックスと二重になってしまう
export function foafNumberOf(id: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const n = (h % 899) + 100;
  return String(n);
}
