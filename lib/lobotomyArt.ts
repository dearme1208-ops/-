import type { RiskLevel, WorkType } from "./lobotomy";

// 管理局モードの図版をブラウザのCanvasでその場で描く。
//
// 元ゲームの画面は「暗い施設の断面図に、明るい細線で区画と個体が描かれている」という
// 一貫した絵作りをしている。写真素材を持ってくるとオフライン動作・容量・権利のどれもが
// 問題になるため、ここでも実データを種にして毎回その場で生成する方針を取っている。
//
// 種は作業名など実データなので、同じ作業には毎回同じ個体の姿が出る。
// 乱数は見た目のばらつきのためだけに使い、業務上の数値には一切関与しない。

export function makeRng(seed: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return () => {
    h ^= h << 13;
    h >>>= 0;
    h ^= h >>> 17;
    h ^= h << 5;
    h >>>= 0;
    return h / 4294967296;
  };
}

export type Rgb = [number, number, number];

function rgba(c: Rgb, a: number): string {
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
}

export function readCssRgb(name: string, fallback: Rgb): Rgb {
  if (typeof window === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const parts = raw.split(/\s+/).map(Number);
  if (parts.length === 3 && parts.every((v) => Number.isFinite(v))) return [parts[0], parts[1], parts[2]];
  return fallback;
}

export function readAccentRgb(): Rgb {
  return readCssRgb("--accent-rgb", [194, 59, 59]);
}
export function readCreamRgb(): Rgb {
  return readCssRgb("--cream-rgb", [233, 230, 189]);
}

// 危険度ごとの明度。元ゲームは危険度が上がるほど印が禍々しくなるので、
// ここでは同じアクセント色の濃さと発光量で段階を作る
const RISK_GLOW: Record<RiskLevel, number> = {
  ZAYIN: 0.18,
  TETH: 0.34,
  HE: 0.52,
  WAW: 0.72,
  ALEPH: 1,
};

// ============================================================
// 危険度の印(ZAYIN / TETH / HE / WAW / ALEPH)
// ============================================================
// 元ゲームでは危険度ごとに固有の記章が付く。ここでは段階が一目でわかるよう、
// 「囲いの数」と「内側の図形の辺の数」を危険度に連動させた記章を描く

export function paintRiskSeal(
  ctx: CanvasRenderingContext2D,
  o: { level: RiskLevel; size: number; accent: Rgb; cream: Rgb }
): void {
  const { size, accent, cream } = o;
  const cx = size / 2;
  const cy = size / 2;
  const glow = RISK_GLOW[o.level];
  const rank = ["ZAYIN", "TETH", "HE", "WAW", "ALEPH"].indexOf(o.level);

  ctx.clearRect(0, 0, size, size);

  // 外の囲い: 危険度が上がるほど輪が増える
  for (let ring = 0; ring <= Math.floor(rank / 2); ring++) {
    ctx.beginPath();
    ctx.arc(cx, cy, size * (0.44 - ring * 0.06), 0, Math.PI * 2);
    ctx.strokeStyle = rgba(cream, 0.2 + glow * 0.3);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // 内側の図形: ZAYIN=円 TETH=三角 HE=四角 WAW=五角 ALEPH=六芒
  const r = size * 0.26;
  ctx.beginPath();
  if (rank === 0) {
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  } else {
    const sides = rank + 2; // 3,4,5,6
    for (let i = 0; i < sides; i++) {
      const a = -Math.PI / 2 + (i / sides) * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  ctx.fillStyle = rgba(accent, 0.1 + glow * 0.3);
  ctx.fill();
  ctx.strokeStyle = rgba(accent, 0.5 + glow * 0.5);
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // ALEPHだけは重ねた逆三角で六芒星にし、明確に別格に見せる
  if (rank === 4) {
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = Math.PI / 2 + (i / 3) * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = rgba(accent, 0.9);
    ctx.stroke();
  }

  // 危険度に応じた放射線
  for (let i = 0; i < rank * 4; i++) {
    const a = (i / (rank * 4)) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * size * 0.36, cy + Math.sin(a) * size * 0.36);
    ctx.lineTo(cx + Math.cos(a) * size * 0.45, cy + Math.sin(a) * size * 0.45);
    ctx.strokeStyle = rgba(accent, 0.25 + glow * 0.4);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

// ============================================================
// 個体の姿(アブノーマリティの肖像)
// ============================================================
// 作業名を種にした決定的な生成。同じ作業には毎回同じ姿が出る

export type CreatureKind = "eye" | "figure" | "beast" | "machine" | "plant" | "mask" | "swarm" | "vessel";

const CREATURES: CreatureKind[] = ["eye", "figure", "beast", "machine", "plant", "mask", "swarm", "vessel"];

export function creatureKindOf(seed: string): CreatureKind {
  const rng = makeRng(`kind:${seed}`);
  return CREATURES[Math.floor(rng() * CREATURES.length)];
}

// ============================================================
// 業務アイコン(文言オフのときの図版)
// ============================================================
// 文言をオフにすると、絵のほうも「怪物」ではなく作業そのものを表す図に切り替える。
// どの図になるかは作業名とカテゴリの語から決まるので、
// 「メール返信」なら封筒、「打ち合わせ」なら会議卓、といった具合に中身と一致する。
// 該当する語が無いときだけ、汎用の作業板(クリップボード)になる。

export type BusinessIcon =
  | "mail"
  | "meeting"
  | "document"
  | "phone"
  | "travel"
  | "code"
  | "design"
  | "review"
  | "research"
  | "invoice"
  | "support"
  | "plan"
  | "test"
  | "clean"
  | "generic";

// 語 → 図。上から順に照合するので、より具体的な語を先に置く
const ICON_KEYWORDS: [BusinessIcon, string[]][] = [
  ["mail", ["メール", "mail", "返信", "送信", "連絡", "案内状"]],
  ["meeting", ["会議", "ミーティング", "打合", "打ち合", "商談", "mtg", "面談", "朝礼", "定例"]],
  ["invoice", ["請求", "見積", "精算", "経理", "伝票", "支払", "入金", "決済", "予算"]],
  ["design", ["設計", "図面", "作図", "cad", "デザイン", "レイアウト", "意匠"]],
  ["code", ["開発", "実装", "コーディング", "プログラム", "デバッグ", "改修", "リリース", "ビルド"]],
  ["review", ["レビュー", "確認", "チェック", "校正", "承認", "査読"]],
  ["research", ["調査", "検討", "分析", "調べ", "リサーチ", "見学", "測量"]],
  ["document", ["資料", "書類", "報告", "レポート", "議事録", "日報", "仕様", "マニュアル", "文書", "作成"]],
  ["phone", ["電話", "tel", "コール", "架電", "問い合わせ"]],
  ["travel", ["移動", "出張", "訪問", "現地", "外出", "配送", "納品", "運搬"]],
  ["support", ["対応", "サポート", "クレーム", "トラブル", "保守", "問合"]],
  ["plan", ["計画", "企画", "段取", "準備", "立案", "スケジュール", "工程"]],
  ["test", ["試験", "テスト", "検査", "測定", "検証", "点検"]],
  ["clean", ["整理", "片付", "清掃", "整備", "棚卸", "掃除"]],
];

export function businessIconOf(category: string, name: string): BusinessIcon {
  const hay = `${category} ${name}`.toLowerCase();
  for (const [icon, words] of ICON_KEYWORDS) {
    if (words.some((w) => hay.includes(w))) return icon;
  }
  return "generic";
}

// 100x100の座標系で1つ描く。呼ぶ側でtranslate/scale済みであることを前提にする
function strokeBusinessIcon(ctx: CanvasRenderingContext2D, icon: BusinessIcon, line: string, hot: string) {
  ctx.strokeStyle = line;
  ctx.fillStyle = "rgba(0,0,0,0)";
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const rect = (x: number, y: number, w: number, h: number) => {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.stroke();
  };
  const line2 = (x1: number, y1: number, x2: number, y2: number) => {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };

  if (icon === "mail") {
    rect(-34, -22, 68, 44);
    ctx.beginPath();
    ctx.moveTo(-34, -22);
    ctx.lineTo(0, 6);
    ctx.lineTo(34, -22);
    ctx.stroke();
  } else if (icon === "meeting") {
    // 卓を囲む人影
    ctx.beginPath();
    ctx.ellipse(0, 8, 34, 14, 0, 0, Math.PI * 2);
    ctx.stroke();
    for (const [x, y] of [[-26, -14], [0, -22], [26, -14]] as const) {
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y + 20, 13, Math.PI, 0);
      ctx.stroke();
    }
  } else if (icon === "document") {
    ctx.beginPath();
    ctx.moveTo(-24, -34);
    ctx.lineTo(12, -34);
    ctx.lineTo(26, -20);
    ctx.lineTo(26, 34);
    ctx.lineTo(-24, 34);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(12, -34);
    ctx.lineTo(12, -20);
    ctx.lineTo(26, -20);
    ctx.stroke();
    for (let i = 0; i < 4; i++) line2(-14, -8 + i * 12, 16, -8 + i * 12);
  } else if (icon === "phone") {
    ctx.beginPath();
    ctx.moveTo(-26, -26);
    ctx.quadraticCurveTo(-34, -6, -14, 14);
    ctx.quadraticCurveTo(6, 34, 26, 26);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-24, -24, 9, 0, Math.PI * 2);
    ctx.strokeStyle = hot;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(24, 24, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = line;
  } else if (icon === "travel") {
    // 車
    ctx.beginPath();
    ctx.moveTo(-34, 10);
    ctx.lineTo(-26, -12);
    ctx.lineTo(24, -12);
    ctx.lineTo(34, 10);
    ctx.stroke();
    rect(-34, 10, 68, 14);
    ctx.beginPath();
    ctx.arc(-18, 26, 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(18, 26, 7, 0, Math.PI * 2);
    ctx.stroke();
  } else if (icon === "code") {
    ctx.beginPath();
    ctx.moveTo(-8, -26);
    ctx.lineTo(-30, 0);
    ctx.lineTo(-8, 26);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(8, -26);
    ctx.lineTo(30, 0);
    ctx.lineTo(8, 26);
    ctx.stroke();
    ctx.strokeStyle = hot;
    line2(4, 30, -4, -30);
    ctx.strokeStyle = line;
  } else if (icon === "design") {
    // 三角定規とコンパス
    ctx.beginPath();
    ctx.moveTo(-30, 26);
    ctx.lineTo(18, 26);
    ctx.lineTo(-30, -18);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(14, -30);
    ctx.lineTo(30, 10);
    ctx.moveTo(14, -30);
    ctx.lineTo(2, 10);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(14, -30, 4, 0, Math.PI * 2);
    ctx.strokeStyle = hot;
    ctx.stroke();
    ctx.strokeStyle = line;
  } else if (icon === "review") {
    // 書類とチェック
    rect(-30, -28, 46, 56);
    for (let i = 0; i < 3; i++) line2(-20, -14 + i * 12, 4, -14 + i * 12);
    ctx.strokeStyle = hot;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(2, 14);
    ctx.lineTo(16, 30);
    ctx.lineTo(36, -12);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = line;
  } else if (icon === "research") {
    ctx.beginPath();
    ctx.arc(-6, -8, 22, 0, Math.PI * 2);
    ctx.stroke();
    line2(10, 8, 30, 28);
    ctx.strokeStyle = hot;
    ctx.beginPath();
    ctx.arc(-6, -8, 12, Math.PI * 0.8, Math.PI * 1.5);
    ctx.stroke();
    ctx.strokeStyle = line;
  } else if (icon === "invoice") {
    // 伝票と通貨
    ctx.beginPath();
    ctx.moveTo(-26, -32);
    ctx.lineTo(26, -32);
    ctx.lineTo(26, 26);
    ctx.lineTo(16, 34);
    ctx.lineTo(6, 26);
    ctx.lineTo(-4, 34);
    ctx.lineTo(-14, 26);
    ctx.lineTo(-26, 34);
    ctx.closePath();
    ctx.stroke();
    for (let i = 0; i < 2; i++) line2(-16, -18 + i * 12, 16, -18 + i * 12);
    ctx.strokeStyle = hot;
    line2(-10, 8, 10, 8);
    line2(-10, 16, 10, 16);
    line2(0, 2, 0, 22);
    ctx.strokeStyle = line;
  } else if (icon === "support") {
    // ヘッドセット
    ctx.beginPath();
    ctx.arc(0, 0, 26, Math.PI, 0);
    ctx.stroke();
    rect(-32, 0, 12, 22);
    rect(20, 0, 12, 22);
    ctx.strokeStyle = hot;
    ctx.beginPath();
    ctx.moveTo(26, 22);
    ctx.quadraticCurveTo(26, 34, 8, 34);
    ctx.stroke();
    ctx.strokeStyle = line;
  } else if (icon === "plan") {
    // 予定表
    rect(-30, -24, 60, 54);
    line2(-30, -8, 30, -8);
    line2(-18, -34, -18, -18);
    line2(18, -34, 18, -18);
    ctx.strokeStyle = hot;
    ctx.fillStyle = hot;
    ctx.fillRect(-20, 2, 12, 10);
    ctx.fillRect(4, 14, 12, 10);
    ctx.strokeStyle = line;
  } else if (icon === "test") {
    // フラスコ
    ctx.beginPath();
    ctx.moveTo(-10, -30);
    ctx.lineTo(-10, -4);
    ctx.lineTo(-28, 28);
    ctx.lineTo(28, 28);
    ctx.lineTo(10, -4);
    ctx.lineTo(10, -30);
    ctx.stroke();
    line2(-16, -30, 16, -30);
    ctx.strokeStyle = hot;
    ctx.beginPath();
    ctx.moveTo(-20, 16);
    ctx.lineTo(20, 16);
    ctx.stroke();
    ctx.strokeStyle = line;
  } else if (icon === "clean") {
    // 箱の整理
    rect(-32, -4, 28, 28);
    rect(4, -4, 28, 28);
    rect(-14, -32, 28, 28);
    ctx.strokeStyle = hot;
    line2(-8, 10, 2, 10);
    ctx.strokeStyle = line;
  } else {
    // generic: 作業板
    rect(-26, -28, 52, 60);
    ctx.beginPath();
    ctx.rect(-12, -36, 24, 12);
    ctx.stroke();
    for (let i = 0; i < 3; i++) line2(-16, -10 + i * 12, 16, -10 + i * 12);
  }
}

export interface AbnormalityPaintOptions {
  seed: string;
  size: number;
  riskLevel: RiskLevel;
  accent: Rgb;
  cream: Rgb;
  breached: boolean; // 収容違反。輪郭が割れて赤が滲む
  // 文言オフのときに描く業務アイコン。指定があれば怪物ではなくこちらを描く
  businessIcon?: BusinessIcon | null;
}

export function paintAbnormality(ctx: CanvasRenderingContext2D, o: AbnormalityPaintOptions): void {
  const { size, accent, cream } = o;
  const rng = makeRng(o.seed);
  const glow = RISK_GLOW[o.riskLevel];
  const kind = creatureKindOf(o.seed);

  // 収容室の内側。奥ほど暗い縦のグラデーション
  const bg = ctx.createLinearGradient(0, 0, 0, size);
  bg.addColorStop(0, "rgba(14,14,17,1)");
  bg.addColorStop(0.55, "rgba(9,9,12,1)");
  bg.addColorStop(1, "rgba(4,4,6,1)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  // 床のグリッド(奥行きを出す)
  ctx.save();
  ctx.strokeStyle = rgba(cream, 0.06);
  ctx.lineWidth = 1;
  const horizon = size * 0.66;
  for (let i = 0; i <= 8; i++) {
    const x = (i / 8) * size;
    ctx.beginPath();
    ctx.moveTo(x, size);
    ctx.lineTo(size / 2 + (x - size / 2) * 0.28, horizon);
    ctx.stroke();
  }
  for (let i = 1; i <= 5; i++) {
    const t = i / 5;
    const y = horizon + (size - horizon) * t * t;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }
  ctx.restore();

  // 個体の後光。危険度が高いほど強い
  const halo = ctx.createRadialGradient(size / 2, size * 0.5, 0, size / 2, size * 0.5, size * 0.55);
  halo.addColorStop(0, rgba(accent, 0.05 + glow * 0.22));
  halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);

  ctx.save();
  ctx.translate(size / 2, size * 0.54);
  const s = size / 100; // 100基準で描いてから拡縮する
  ctx.scale(s, s);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const ink = rgba(cream, 0.9);
  const fill = rgba(cream, 0.07);
  const hot = rgba(accent, 0.55 + glow * 0.45);

  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.6;
  ctx.fillStyle = fill;

  if (o.businessIcon) {
    // 文言オフ: 怪物ではなく、その作業そのものを表す図を描く
    strokeBusinessIcon(ctx, o.businessIcon, ink, hot);
  } else if (kind === "eye") {
    // 巨大な単眼
    ctx.beginPath();
    ctx.ellipse(0, 0, 34, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 12 + rng() * 4, 0, Math.PI * 2);
    ctx.fillStyle = hot;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.85)";
    ctx.fill();
    // 睫毛のような放射
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const rr = 24 + rng() * 14;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 34, Math.sin(a) * 22);
      ctx.lineTo(Math.cos(a) * (34 + rr), Math.sin(a) * (22 + rr * 0.6));
      ctx.strokeStyle = rgba(cream, 0.28);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  } else if (kind === "figure") {
    // 立ち姿の人型
    ctx.beginPath();
    ctx.moveTo(-16, 42);
    ctx.lineTo(-11, -8);
    ctx.quadraticCurveTo(0, -22, 11, -8);
    ctx.lineTo(16, 42);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -26, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // 顔の位置に灯る二点
    for (const dx of [-4, 4]) {
      ctx.beginPath();
      ctx.arc(dx, -27, 1.8, 0, Math.PI * 2);
      ctx.fillStyle = hot;
      ctx.fill();
    }
    // 腕
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * 12, -4);
      ctx.quadraticCurveTo(side * (24 + rng() * 8), 12, side * (16 + rng() * 6), 34);
      ctx.strokeStyle = ink;
      ctx.stroke();
    }
  } else if (kind === "beast") {
    // 四足の獣
    ctx.beginPath();
    ctx.ellipse(0, 6, 34, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(-30, -10, 14, 11, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    for (let i = 0; i < 4; i++) {
      const x = -20 + i * 14;
      ctx.beginPath();
      ctx.moveTo(x, 20);
      ctx.lineTo(x + (rng() - 0.5) * 6, 42);
      ctx.stroke();
    }
    // 牙と目
    ctx.beginPath();
    ctx.arc(-33, -12, 2.4, 0, Math.PI * 2);
    ctx.fillStyle = hot;
    ctx.fill();
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(-40 + i * 3, -4);
      ctx.lineTo(-38.5 + i * 3, 2 + rng() * 3);
      ctx.strokeStyle = rgba(cream, 0.8);
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  } else if (kind === "machine") {
    // 機械仕掛け
    ctx.beginPath();
    ctx.rect(-28, -30, 56, 66);
    ctx.fill();
    ctx.stroke();
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.rect(-20, -22 + i * 15, 40, 8);
      ctx.strokeStyle = rgba(cream, 0.3);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, -2, 9, 0, Math.PI * 2);
    ctx.fillStyle = hot;
    ctx.fill();
    // 歯車の歯
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 11, -2 + Math.sin(a) * 11);
      ctx.lineTo(Math.cos(a) * 15, -2 + Math.sin(a) * 15);
      ctx.strokeStyle = rgba(cream, 0.55);
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  } else if (kind === "plant") {
    // 植物状
    ctx.beginPath();
    ctx.moveTo(0, 44);
    ctx.lineTo(0, -14);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2.4;
    ctx.stroke();
    const petals = 5 + Math.floor(rng() * 4);
    for (let i = 0; i < petals; i++) {
      const a = -Math.PI / 2 + ((i - (petals - 1) / 2) / petals) * Math.PI * 1.7;
      ctx.beginPath();
      ctx.moveTo(0, -14);
      ctx.quadraticCurveTo(Math.cos(a) * 26, -14 + Math.sin(a) * 26, Math.cos(a) * 34, -14 + Math.sin(a) * 30);
      ctx.strokeStyle = rgba(cream, 0.7);
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, -14, 8, 0, Math.PI * 2);
    ctx.fillStyle = hot;
    ctx.fill();
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(0, 10 + i * 5);
      ctx.lineTo((rng() - 0.5) * 40, 16 + i * 5);
      ctx.strokeStyle = rgba(cream, 0.2);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  } else if (kind === "mask") {
    // 面
    ctx.beginPath();
    ctx.moveTo(0, -38);
    ctx.quadraticCurveTo(30, -30, 26, 4);
    ctx.quadraticCurveTo(20, 40, 0, 44);
    ctx.quadraticCurveTo(-20, 40, -26, 4);
    ctx.quadraticCurveTo(-30, -30, 0, -38);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    for (const dx of [-11, 11]) {
      ctx.beginPath();
      ctx.ellipse(dx, -8, 6, 4, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.8)";
      ctx.fill();
      ctx.strokeStyle = hot;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-12, 20);
    ctx.quadraticCurveTo(0, 14 + rng() * 12, 12, 20);
    ctx.strokeStyle = rgba(cream, 0.75);
    ctx.lineWidth = 1.6;
    ctx.stroke();
  } else if (kind === "swarm") {
    // 群体
    for (let i = 0; i < 34; i++) {
      const a = rng() * Math.PI * 2;
      const r = 8 + rng() * 34;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r * 0.9;
      ctx.beginPath();
      ctx.arc(x, y, 1.4 + rng() * 3.4, 0, Math.PI * 2);
      ctx.fillStyle = rgba(cream, 0.18 + rng() * 0.45);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.fillStyle = hot;
    ctx.fill();
  } else {
    // vessel: 器
    ctx.beginPath();
    ctx.moveTo(-22, -28);
    ctx.lineTo(22, -28);
    ctx.lineTo(30, 30);
    ctx.quadraticCurveTo(0, 48, -30, 30);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // 中身が満ちている
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(-22, -28);
    ctx.lineTo(22, -28);
    ctx.lineTo(30, 30);
    ctx.quadraticCurveTo(0, 48, -30, 30);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = rgba(accent, 0.2 + glow * 0.35);
    ctx.fillRect(-32, 4 - glow * 26, 64, 60);
    ctx.restore();
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.arc((rng() - 0.5) * 34, 10 + rng() * 20, 1.4 + rng() * 2.6, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(cream, 0.4);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  ctx.restore();

  // 収容違反(文言オフでは要見直し)。怪物のときは画面が割れ、
  // 業務アイコンのときは書類に引く警告の斜線にする
  if (o.breached && o.businessIcon) {
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = rgba(accent, 1);
    for (let x = -size; x < size; x += 14) {
      ctx.beginPath();
      ctx.moveTo(x, size);
      ctx.lineTo(x + 6, size);
      ctx.lineTo(x + 6 + size, 0);
      ctx.lineTo(x + size, 0);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  } else if (o.breached) {
    const crack = makeRng(`crack:${o.seed}`);
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      let x = crack() * size;
      let y = 0;
      ctx.moveTo(x, y);
      while (y < size) {
        x += (crack() - 0.5) * size * 0.16;
        y += size * (0.1 + crack() * 0.14);
        ctx.lineTo(x, y);
      }
      ctx.strokeStyle = rgba(accent, 0.32);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.fillStyle = rgba(accent, 0.08);
    ctx.fillRect(0, 0, size, size);
  }

  // 走査線と枠
  ctx.fillStyle = "rgba(0,0,0,0.14)";
  for (let y = 0; y < size; y += 3) ctx.fillRect(0, y, size, 1);
  ctx.strokeStyle = rgba(cream, 0.22);
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
}

// ============================================================
// 施設の断面図(収容区画)
// ============================================================

export interface FacilityCell {
  id: string;
  label: string; // 個体番号
  name: string;
  riskLevel: RiskLevel;
  riskLabel: string; // 表示する呼び名。文言オフでは「想定内」等の平易な語になる
  businessIcon?: BusinessIcon | null; // 文言オフのとき観察窓に映す業務アイコン
  state: "running" | "paused" | "pending" | "done";
  progress: number; // 0〜1以上。1超で超過
  meltdown: boolean;
  selected: boolean;
}

export interface FacilityPaintOptions {
  cells: FacilityCell[];
  width: number;
  height: number;
  accent: Rgb;
  cream: Rgb;
  pulse: number; // 0〜1。警報の明滅位相
  trumpet: number; // 0〜3
}

// 区画1つあたりの当たり判定。クリック位置から区画を引くために外へも公開する
export interface CellRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const CELL_MIN_W = 96;
const CELL_H = 74;
const CELL_GAP = 8;
const SPINE_W = 26;

// 区画の並びを計算する。描画とクリック判定で同じ関数を使うことで、
// 「見えている場所」と「押せる場所」が必ず一致する
export function layoutCells(cells: FacilityCell[], width: number, height: number): CellRect[] {
  if (cells.length === 0) return [];
  const usable = width - SPINE_W - CELL_GAP * 2;
  const perRow = Math.max(1, Math.min(3, Math.floor(usable / CELL_MIN_W)));
  const cellW = (usable - CELL_GAP * (perRow - 1)) / perRow;
  const out: CellRect[] = [];
  for (let i = 0; i < cells.length; i++) {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    out.push({
      id: cells[i].id,
      x: SPINE_W + CELL_GAP + col * (cellW + CELL_GAP),
      y: CELL_GAP + row * (CELL_H + CELL_GAP),
      w: cellW,
      h: CELL_H,
    });
  }
  return out;
}

export function facilityHeightFor(count: number, width: number): number {
  if (count === 0) return 140;
  const usable = width - SPINE_W - CELL_GAP * 2;
  const perRow = Math.max(1, Math.min(3, Math.floor(usable / CELL_MIN_W)));
  const rows = Math.ceil(count / perRow);
  return CELL_GAP * 2 + rows * CELL_H + (rows - 1) * CELL_GAP;
}

export function paintFacility(ctx: CanvasRenderingContext2D, o: FacilityPaintOptions): void {
  const { width: w, height: h, accent, cream } = o;
  ctx.clearRect(0, 0, w, h);

  // 施設の地。奥に向かって落ちる暗さ
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "rgba(10,10,13,1)");
  bg.addColorStop(1, "rgba(5,5,7,1)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // 背景の方眼(設計図の紙)
  ctx.strokeStyle = rgba(cream, 0.045);
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 16) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += 16) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(w, y + 0.5);
    ctx.stroke();
  }

  // 左端の主廊下(施設の背骨)
  const spineX = SPINE_W / 2;
  ctx.strokeStyle = rgba(cream, 0.3);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(spineX, 4);
  ctx.lineTo(spineX, h - 4);
  ctx.stroke();
  // 廊下を流れる光(職員の移動を表す)
  const flow = (o.pulse * h * 1.4) % (h + 40);
  const grad = ctx.createLinearGradient(0, flow - 40, 0, flow);
  grad.addColorStop(0, rgba(accent, 0));
  grad.addColorStop(1, rgba(accent, 0.75));
  ctx.strokeStyle = grad;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(spineX, Math.max(4, flow - 40));
  ctx.lineTo(spineX, Math.min(h - 4, flow));
  ctx.stroke();

  const rects = layoutCells(o.cells, w, h);

  for (let i = 0; i < o.cells.length; i++) {
    const c = o.cells[i];
    const r = rects[i];
    if (!r) continue;

    // 主廊下から区画への連絡路
    ctx.strokeStyle = rgba(cream, 0.18);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(spineX, r.y + r.h / 2);
    ctx.lineTo(r.x, r.y + r.h / 2);
    ctx.stroke();

    const glow = RISK_GLOW[c.riskLevel];

    // 融解中の区画は赤く脈打つ
    if (c.meltdown) {
      const beat = 0.35 + Math.abs(Math.sin(o.pulse * Math.PI * 2)) * 0.45;
      ctx.save();
      ctx.shadowColor = rgba(accent, beat);
      ctx.shadowBlur = 16;
      ctx.fillStyle = rgba(accent, 0.1 + beat * 0.12);
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.restore();
    } else {
      ctx.fillStyle = c.state === "done" ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.4)";
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }

    // 区画の枠
    ctx.strokeStyle = c.selected
      ? rgba(accent, 0.95)
      : c.meltdown
        ? rgba(accent, 0.7)
        : rgba(cream, 0.3 + glow * 0.25);
    ctx.lineWidth = c.selected ? 2 : 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);

    // 四隅の見出し金具
    const k = 6;
    ctx.strokeStyle = c.selected ? rgba(accent, 0.95) : rgba(cream, 0.4);
    ctx.lineWidth = 1.4;
    for (const [ox, oy, dx, dy] of [
      [r.x, r.y, 1, 1],
      [r.x + r.w, r.y, -1, 1],
      [r.x, r.y + r.h, 1, -1],
      [r.x + r.w, r.y + r.h, -1, -1],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(ox + dx * k, oy);
      ctx.lineTo(ox, oy);
      ctx.lineTo(ox, oy + dy * k);
      ctx.stroke();
    }

    // 観察窓と、その中の個体の影
    const winSize = Math.min(r.h - 22, 34);
    const wx = r.x + 6;
    const wy = r.y + (r.h - winSize) / 2;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(wx, wy, winSize, winSize);
    ctx.strokeStyle = rgba(cream, 0.25);
    ctx.lineWidth = 1;
    ctx.strokeRect(wx + 0.5, wy + 0.5, winSize - 1, winSize - 1);
    drawSilhouette(ctx, c.name || c.label, wx, wy, winSize, accent, cream, glow, c.businessIcon ?? null);

    // 個体番号と名前
    const textX = wx + winSize + 6;
    const textW = r.x + r.w - textX - 6;
    ctx.fillStyle = rgba(cream, 0.5);
    ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textBaseline = "top";
    ctx.fillText(c.label, textX, r.y + 8);

    ctx.fillStyle = c.meltdown ? rgba(accent, 0.95) : rgba(cream, 0.88);
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillText(ellipsize(ctx, c.name, textW), textX, r.y + 20);

    // 危険度
    ctx.fillStyle = rgba(accent, 0.5 + glow * 0.45);
    ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(c.riskLabel, textX, r.y + 36);

    // 進捗ゲージ。1を超えた分は色を変えて右に伸びる
    const gx = textX;
    const gy = r.y + r.h - 14;
    const gw = textW;
    ctx.fillStyle = rgba(cream, 0.12);
    ctx.fillRect(gx, gy, gw, 4);
    const within = Math.min(1, c.progress);
    ctx.fillStyle = c.state === "done" ? rgba(cream, 0.55) : rgba(accent, 0.55 + glow * 0.3);
    ctx.fillRect(gx, gy, gw * within, 4);
    if (c.progress > 1) {
      const over = Math.min(1, c.progress - 1);
      ctx.fillStyle = rgba(accent, 0.95);
      ctx.fillRect(gx, gy - 2, gw * over, 8);
    }

    // 状態の点
    const dotX = r.x + r.w - 8;
    const dotY = r.y + 10;
    ctx.beginPath();
    ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
    ctx.fillStyle =
      c.state === "running"
        ? rgba(accent, 0.6 + Math.abs(Math.sin(o.pulse * Math.PI * 2)) * 0.4)
        : c.state === "done"
          ? rgba(cream, 0.7)
          : c.state === "paused"
            ? rgba(cream, 0.35)
            : rgba(cream, 0.16);
    ctx.fill();
  }

  // 第三のラッパ: 施設全体に走る警告の縞
  if (o.trumpet >= 3) {
    ctx.save();
    ctx.globalAlpha = 0.06 + Math.abs(Math.sin(o.pulse * Math.PI * 2)) * 0.06;
    ctx.fillStyle = rgba(accent, 1);
    for (let x = -h; x < w; x += 22) {
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x + 10, h);
      ctx.lineTo(x + 10 + h, 0);
      ctx.lineTo(x + h, 0);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

// 観察窓に映る影。個体の姿と同じ種を使うので、図鑑の肖像と同じ形が小さく映る
function drawSilhouette(
  ctx: CanvasRenderingContext2D,
  seed: string,
  x: number,
  y: number,
  size: number,
  accent: Rgb,
  cream: Rgb,
  glow: number,
  businessIcon: BusinessIcon | null
) {
  const kind = creatureKindOf(seed);
  const rng = makeRng(`sil:${seed}`);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();
  ctx.translate(x + size / 2, y + size * 0.58);
  const s = size / 100;
  ctx.scale(s, s);
  ctx.fillStyle = rgba(cream, 0.42);
  ctx.strokeStyle = rgba(cream, 0.5);
  ctx.lineWidth = 2;
  if (businessIcon) {
    // 業務アイコンは中心に置きたいので、影用の下寄せ分を戻してから描く
    ctx.translate(0, -size * 0.08 * (100 / size));
    ctx.scale(0.78, 0.78);
    strokeBusinessIcon(ctx, businessIcon, rgba(cream, 0.62), rgba(accent, 0.7 + glow * 0.3));
    ctx.restore();
    return;
  }
  if (kind === "eye") {
    ctx.beginPath();
    ctx.ellipse(0, -10, 30, 20, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, -10, 9, 0, Math.PI * 2);
    ctx.fillStyle = rgba(accent, 0.6 + glow * 0.4);
    ctx.fill();
  } else if (kind === "figure" || kind === "mask") {
    ctx.beginPath();
    ctx.arc(0, -34, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-14, 20);
    ctx.lineTo(-9, -20);
    ctx.lineTo(9, -20);
    ctx.lineTo(14, 20);
    ctx.closePath();
    ctx.fill();
  } else if (kind === "beast") {
    ctx.beginPath();
    ctx.ellipse(4, -8, 28, 15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-26, -20, 12, 10, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === "machine") {
    ctx.fillRect(-24, -44, 48, 60);
    ctx.beginPath();
    ctx.arc(0, -16, 8, 0, Math.PI * 2);
    ctx.fillStyle = rgba(accent, 0.65);
    ctx.fill();
  } else if (kind === "plant") {
    ctx.beginPath();
    ctx.moveTo(0, 20);
    ctx.lineTo(0, -24);
    ctx.stroke();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i - 2) * 0.5;
      ctx.beginPath();
      ctx.moveTo(0, -24);
      ctx.lineTo(Math.cos(a) * 26, -24 + Math.sin(a) * 26);
      ctx.stroke();
    }
  } else if (kind === "swarm") {
    for (let i = 0; i < 16; i++) {
      ctx.beginPath();
      ctx.arc((rng() - 0.5) * 56, -14 + (rng() - 0.5) * 46, 2 + rng() * 4, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.beginPath();
    ctx.moveTo(-18, -34);
    ctx.lineTo(18, -34);
    ctx.lineTo(24, 16);
    ctx.quadraticCurveTo(0, 30, -24, 16);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(out + "…").width > maxWidth) out = out.slice(0, -1);
  return out + "…";
}

// ============================================================
// エネルギー計(その日の目標)
// ============================================================

export function paintEnergyMeter(
  ctx: CanvasRenderingContext2D,
  o: { percent: number; width: number; height: number; accent: Rgb; cream: Rgb; pulse: number; segments: number }
): void {
  const { width: w, height: h, accent, cream } = o;
  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = rgba(cream, 0.28);
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

  const fillW = ((w - 4) * Math.max(0, Math.min(100, o.percent))) / 100;
  const grad = ctx.createLinearGradient(2, 0, 2 + fillW, 0);
  grad.addColorStop(0, rgba(accent, 0.35));
  grad.addColorStop(1, rgba(accent, 0.9));
  ctx.fillStyle = grad;
  ctx.fillRect(2, 2, fillW, h - 4);

  // 先端の明滅
  if (fillW > 2) {
    ctx.fillStyle = rgba(cream, 0.35 + Math.abs(Math.sin(o.pulse * Math.PI * 2)) * 0.5);
    ctx.fillRect(2 + fillW - 2, 2, 2, h - 4);
  }

  // 目盛り。箱の数だけ刻む
  const seg = Math.max(1, Math.min(40, o.segments));
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = 1;
  for (let i = 1; i < seg; i++) {
    const x = 2 + ((w - 4) * i) / seg;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 2);
    ctx.lineTo(x + 0.5, h - 2);
    ctx.stroke();
  }
}

// ============================================================
// 職員能力値の図(4つの徳)
// ============================================================

export function paintVirtueChart(
  ctx: CanvasRenderingContext2D,
  o: { values: number[]; size: number; accent: Rgb; cream: Rgb; labels: string[] }
): void {
  const { size, accent, cream } = o;
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.34;
  ctx.clearRect(0, 0, size, size);

  // 目盛りの輪(5段階)
  for (let ring = 1; ring <= 5; ring++) {
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = -Math.PI / 2 + (i / 4) * Math.PI * 2;
      const rr = (r * ring) / 5;
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = rgba(cream, ring === 5 ? 0.28 : 0.11);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // 軸
  for (let i = 0; i < 4; i++) {
    const a = -Math.PI / 2 + (i / 4) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.strokeStyle = rgba(cream, 0.14);
    ctx.stroke();
  }

  // 実測の四角形
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = -Math.PI / 2 + (i / 4) * Math.PI * 2;
    const rr = (r * Math.max(0.08, Math.min(1, o.values[i] ?? 0)) * 5) / 5;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = rgba(accent, 0.25);
  ctx.fill();
  ctx.strokeStyle = rgba(accent, 0.9);
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // 頂点
  for (let i = 0; i < 4; i++) {
    const a = -Math.PI / 2 + (i / 4) * Math.PI * 2;
    const rr = r * Math.max(0.08, Math.min(1, o.values[i] ?? 0));
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 2.4, 0, Math.PI * 2);
    ctx.fillStyle = rgba(accent, 1);
    ctx.fill();
  }

  // 軸名
  ctx.font = "9px system-ui, sans-serif";
  ctx.fillStyle = rgba(cream, 0.6);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < 4; i++) {
    const a = -Math.PI / 2 + (i / 4) * Math.PI * 2;
    ctx.fillText(o.labels[i] ?? "", cx + Math.cos(a) * (r + 12), cy + Math.sin(a) * (r + 12));
  }
  ctx.textAlign = "start";
}

// ============================================================
// 作業種別の記号(本能 / 洞察 / 愛着 / 抑制)
// ============================================================

export function paintWorkGlyph(
  ctx: CanvasRenderingContext2D,
  o: { type: WorkType; size: number; active: boolean; accent: Rgb; cream: Rgb }
): void {
  const { size, accent, cream } = o;
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.3;
  ctx.clearRect(0, 0, size, size);

  const line = o.active ? rgba(accent, 0.95) : rgba(cream, 0.55);
  ctx.strokeStyle = line;
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.42, 0, Math.PI * 2);
  ctx.strokeStyle = o.active ? rgba(accent, 0.6) : rgba(cream, 0.18);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.strokeStyle = line;
  ctx.lineWidth = 1.6;

  if (o.type === "instinct") {
    // 掌。手を動かす作業
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.6, cy + r * 0.8);
    ctx.lineTo(cx - r * 0.6, cy - r * 0.2);
    for (let i = 0; i < 4; i++) {
      const x = cx - r * 0.6 + (i * r * 1.2) / 3;
      ctx.moveTo(x, cy + r * 0.2);
      ctx.lineTo(x, cy - r * (0.5 + (i === 1 || i === 2 ? 0.35 : 0.1)));
    }
    ctx.moveTo(cx - r * 0.6, cy + r * 0.8);
    ctx.lineTo(cx + r * 0.6, cy + r * 0.8);
    ctx.lineTo(cx + r * 0.6, cy - r * 0.2);
    ctx.stroke();
  } else if (o.type === "insight") {
    // 目。実績を見て組み直す
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.quadraticCurveTo(cx, cy - r * 0.9, cx + r, cy);
    ctx.quadraticCurveTo(cx, cy + r * 0.9, cx - r, cy);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.34, 0, Math.PI * 2);
    ctx.fillStyle = line;
    ctx.fill();
  } else if (o.type === "attachment") {
    // 手をつなぐ形。丁寧に向き合う
    ctx.beginPath();
    ctx.arc(cx - r * 0.45, cy - r * 0.2, r * 0.42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + r * 0.45, cy - r * 0.2, r * 0.42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.45, cy + r * 0.25);
    ctx.quadraticCurveTo(cx, cy + r * 0.95, cx + r * 0.45, cy + r * 0.25);
    ctx.stroke();
  } else {
    // 下向きの押さえ。短時間で締める
    ctx.beginPath();
    ctx.moveTo(cx - r, cy - r * 0.55);
    ctx.lineTo(cx + r, cy - r * 0.55);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.3);
    ctx.lineTo(cx, cy + r * 0.5);
    ctx.moveTo(cx - r * 0.4, cy + r * 0.1);
    ctx.lineTo(cx, cy + r * 0.5);
    ctx.lineTo(cx + r * 0.4, cy + r * 0.1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.7, cy + r * 0.8);
    ctx.lineTo(cx + r * 0.7, cy + r * 0.8);
    ctx.stroke();
  }
}

// ============================================================
// 時間帯の記章(黎明 / 正午 / 黄昏 / 真夜中)
// ============================================================

export function paintOrdealSigil(
  ctx: CanvasRenderingContext2D,
  o: { kind: "dawn" | "noon" | "dusk" | "midnight" | "none"; size: number; accent: Rgb; cream: Rgb }
): void {
  const { size, accent, cream } = o;
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.3;
  ctx.clearRect(0, 0, size, size);

  ctx.strokeStyle = rgba(cream, 0.22);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.44, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = rgba(accent, 0.85);
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";

  if (o.kind === "dawn") {
    // 地平から昇る半円
    ctx.beginPath();
    ctx.arc(cx, cy + r * 0.4, r * 0.75, Math.PI, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - r, cy + r * 0.4);
    ctx.lineTo(cx + r, cy + r * 0.4);
    ctx.stroke();
  } else if (o.kind === "noon") {
    // 満ちた円と放射
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = rgba(accent, 0.3);
    ctx.fill();
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r * 0.72, cy + Math.sin(a) * r * 0.72);
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      ctx.stroke();
    }
  } else if (o.kind === "dusk") {
    // 沈む半円
    ctx.beginPath();
    ctx.arc(cx, cy - r * 0.1, r * 0.7, 0, Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - r, cy - r * 0.1);
    ctx.lineTo(cx + r, cy - r * 0.1);
    ctx.stroke();
  } else if (o.kind === "midnight") {
    // 欠けた月
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
    ctx.fillStyle = rgba(accent, 0.35);
    ctx.fill();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(cx + r * 0.42, cy - r * 0.2, r * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
    ctx.strokeStyle = rgba(cream, 0.4);
    ctx.stroke();
  }
}
