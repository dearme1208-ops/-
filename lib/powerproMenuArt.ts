// 育成選手モードのメインメニュー用アイコン。
//
// 家庭用野球ゲームのモード選択画面は「角丸正方形のタイル+白い記号+下にラベル」で
// 統一されていて、色相だけでモードの系統が分かるようになっている。ここでもその作法に倣う。
// タイルは ①下地のグラデーション ②上半分のガラス光沢 ③内側の締め線 ④外の落ち影
// の4枚重ねで、平らな色にならないようにしている。
// 記号はすべてCanvasのパスで描く(絵文字だと端末ごとに形が変わってしまうため)。

export type Rgb = [number, number, number];

const rgb = (c: Rgb, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

export function squircle(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** タイルの輪郭。モードごとに手触りを変えるため、形を差し替えられるようにしてある */
export type TileShape = "squircle" | "card" | "slant" | "screen";

export function tilePath(
  ctx: CanvasRenderingContext2D,
  shape: TileShape,
  x: number,
  y: number,
  w: number,
  h: number
) {
  if (shape === "squircle") {
    squircle(ctx, x, y, w, h, w * 0.24);
    return;
  }
  if (shape === "card") {
    // 名刺や蔵書票のような、角のわずかに落ちた矩形
    squircle(ctx, x, y, w, h, w * 0.08);
    return;
  }
  if (shape === "slant") {
    // 上辺を右へずらした平行四辺形。走っているような傾きを出す
    const lean = w * 0.12;
    ctx.beginPath();
    ctx.moveTo(x + lean, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w - lean, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
    return;
  }
  // screen: 右上の角を切り落とした、計器や端末の画面のような形
  const cut = w * 0.2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w - cut, y);
  ctx.lineTo(x + w, y + cut);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
}

// ============================================================
// 記号(グリフ)
// ============================================================
// どれも 100×100 の座標系に描く。呼び出し側でタイルの大きさに合わせて拡大する。
// 線は太めの丸端で、小さく表示しても潰れないようにしている。
export type GlyphKey =
  | "today"
  | "todo"
  | "projects"
  | "master"
  | "template"
  | "gantt"
  | "aggregation"
  | "charts"
  | "heatmap"
  | "attention"
  | "overtime"
  | "yearlyChart"
  | "mandala"
  | "memo"
  | "board"
  | "report"
  | "records"
  | "settings";

function stroke(ctx: CanvasRenderingContext2D, width = 7) {
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
}

function fill(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#ffffff";
  ctx.fill();
}

/** ボール(縫い目つき)。野球ゲームの記号の基本形 */
function ball(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  fill(ctx);
  ctx.beginPath();
  ctx.arc(cx - r * 0.62, cy, r * 0.95, -Math.PI / 3, Math.PI / 3);
  ctx.arc(cx + r * 0.62, cy, r * 0.95, Math.PI - Math.PI / 3, Math.PI + Math.PI / 3);
  ctx.strokeStyle = "rgba(0,0,0,0.28)";
  ctx.lineWidth = r * 0.22;
  ctx.lineCap = "round";
  ctx.stroke();
}

const GLYPHS: Record<GlyphKey, (ctx: CanvasRenderingContext2D) => void> = {
  // 練習メニュー: バットとボール
  today: (ctx) => {
    ctx.save();
    ctx.translate(54, 52);
    ctx.rotate(-0.62);
    ctx.beginPath();
    ctx.moveTo(-4, 28);
    ctx.lineTo(-4, -14);
    ctx.quadraticCurveTo(-9, -22, -9, -32);
    ctx.quadraticCurveTo(0, -38, 9, -32);
    ctx.quadraticCurveTo(9, -22, 4, -14);
    ctx.lineTo(4, 28);
    ctx.quadraticCurveTo(0, 32, -4, 28);
    ctx.closePath();
    fill(ctx);
    ctx.restore();
    ball(ctx, 30, 72, 13);
  },
  // スカウトリスト: 名簿(クリップボード)
  todo: (ctx) => {
    ctx.beginPath();
    squircle(ctx, 24, 18, 52, 66, 8);
    stroke(ctx, 6);
    ctx.beginPath();
    squircle(ctx, 39, 10, 22, 15, 5);
    fill(ctx);
    for (let i = 0; i < 3; i++) {
      const y = 40 + i * 15;
      ctx.beginPath();
      ctx.arc(37, y, 3.4, 0, Math.PI * 2);
      fill(ctx);
      ctx.beginPath();
      ctx.moveTo(47, y);
      ctx.lineTo(66, y);
      stroke(ctx, 5);
    }
  },
  // 契約案件: 契約書と判子
  projects: (ctx) => {
    ctx.beginPath();
    ctx.moveTo(22, 14);
    ctx.lineTo(58, 14);
    ctx.lineTo(74, 30);
    ctx.lineTo(74, 84);
    ctx.lineTo(22, 84);
    ctx.closePath();
    stroke(ctx, 6);
    ctx.beginPath();
    ctx.moveTo(56, 14);
    ctx.lineTo(56, 32);
    ctx.lineTo(74, 32);
    stroke(ctx, 5);
    ctx.beginPath();
    ctx.moveTo(33, 46); ctx.lineTo(60, 46);
    ctx.moveTo(33, 58); ctx.lineTo(60, 58);
    stroke(ctx, 5);
    ctx.beginPath();
    ctx.arc(58, 72, 12, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = 5;
    ctx.stroke();
  },
  // 選手名鑑: 本と人物
  master: (ctx) => {
    ctx.beginPath();
    ctx.moveTo(18, 22);
    ctx.quadraticCurveTo(34, 14, 50, 22);
    ctx.quadraticCurveTo(66, 14, 82, 22);
    ctx.lineTo(82, 80);
    ctx.quadraticCurveTo(66, 72, 50, 80);
    ctx.quadraticCurveTo(34, 72, 18, 80);
    ctx.closePath();
    stroke(ctx, 6);
    ctx.beginPath();
    ctx.moveTo(50, 22);
    ctx.lineTo(50, 80);
    stroke(ctx, 5);
    ctx.beginPath();
    ctx.arc(66, 42, 7, 0, Math.PI * 2);
    fill(ctx);
    ctx.beginPath();
    ctx.moveTo(56, 62);
    ctx.quadraticCurveTo(66, 50, 76, 62);
    ctx.closePath();
    fill(ctx);
  },
  // 曜日別練習計画: カレンダー(週)
  template: (ctx) => {
    ctx.beginPath();
    squircle(ctx, 16, 24, 68, 58, 8);
    stroke(ctx, 6);
    ctx.beginPath();
    ctx.moveTo(16, 42); ctx.lineTo(84, 42);
    stroke(ctx, 5);
    ctx.beginPath();
    ctx.moveTo(32, 14); ctx.lineTo(32, 30);
    ctx.moveTo(68, 14); ctx.lineTo(68, 30);
    stroke(ctx, 6);
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      squircle(ctx, 24 + i * 11.5, 54, 8, 8, 2);
      fill(ctx);
    }
  },
  // 練習日誌: 横棒の工程表
  gantt: (ctx) => {
    // 左に時間軸の縦線を引き、そこから右へ伸びる棒を等間隔に並べる。
    // 棒同士が縦に近すぎると塊に見えるので、間隔を棒の高さと同じだけ空けている
    ctx.beginPath();
    ctx.moveTo(18, 18); ctx.lineTo(18, 84);
    stroke(ctx, 5);
    const bars = [[26, 26, 44], [44, 38, 34], [62, 30, 50]];
    bars.forEach(([y, x, w]) => {
      ctx.beginPath();
      squircle(ctx, x, y, w, 12, 6);
      fill(ctx);
    });
    // 「今」を示す縦の点線
    ctx.beginPath();
    ctx.moveTo(66, 16); ctx.lineTo(66, 86);
    ctx.strokeStyle = "rgba(255,255,255,0.65)";
    ctx.lineWidth = 4;
    ctx.setLineDash([6, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
  },
  // 成績ランキング: 表彰台
  aggregation: (ctx) => {
    ctx.beginPath();
    squircle(ctx, 38, 26, 24, 52, 3);
    fill(ctx);
    ctx.beginPath();
    squircle(ctx, 14, 44, 24, 34, 3);
    ctx.fillStyle = "rgba(255,255,255,0.82)";
    ctx.fill();
    ctx.beginPath();
    squircle(ctx, 62, 52, 24, 26, 3);
    ctx.fillStyle = "rgba(255,255,255,0.66)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(50, 14, 8, 0, Math.PI * 2);
    fill(ctx);
  },
  // 成績グラフ: 折れ線
  charts: (ctx) => {
    ctx.beginPath();
    ctx.moveTo(18, 78); ctx.lineTo(84, 78);
    ctx.moveTo(18, 78); ctx.lineTo(18, 18);
    stroke(ctx, 6);
    ctx.beginPath();
    ctx.moveTo(26, 62);
    ctx.lineTo(42, 44);
    ctx.lineTo(56, 54);
    ctx.lineTo(78, 26);
    stroke(ctx, 7);
    [[26, 62], [42, 44], [56, 54], [78, 26]].forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      fill(ctx);
    });
  },
  // 疲労分布図: 格子
  heatmap: (ctx) => {
    // 濃淡そのものが記号なので、いちばん薄いマスでも輪郭が見える濃さから始める
    const a = [0.42, 1, 0.62, 0.85, 0.5, 1, 0.38, 0.72, 0.95];
    for (let i = 0; i < 9; i++) {
      const x = 16 + (i % 3) * 25;
      const y = 16 + Math.floor(i / 3) * 25;
      ctx.beginPath();
      squircle(ctx, x, y, 21, 21, 5);
      ctx.fillStyle = `rgba(255,255,255,${a[i]})`;
      ctx.fill();
    }
  },
  // 要注意選手リスト: 警告
  attention: (ctx) => {
    ctx.beginPath();
    ctx.moveTo(50, 16);
    ctx.lineTo(86, 80);
    ctx.lineTo(14, 80);
    ctx.closePath();
    stroke(ctx, 7);
    ctx.beginPath();
    ctx.moveTo(50, 40); ctx.lineTo(50, 60);
    stroke(ctx, 7);
    ctx.beginPath();
    ctx.arc(50, 70, 4.2, 0, Math.PI * 2);
    fill(ctx);
  },
  // 夜間自主練分析: 月と照明塔
  overtime: (ctx) => {
    // 三日月。抜く円を大きくずらして、小さく表示しても三日月と分かる太さを残す
    ctx.save();
    ctx.beginPath();
    ctx.arc(42, 40, 28, 0, Math.PI * 2);
    ctx.arc(58, 28, 26, 0, Math.PI * 2, true);
    ctx.fillStyle = "#ffffff";
    ctx.fill("evenodd");
    ctx.restore();
    // 星は月から離した位置に1つだけ。数を増やすと月と混ざって塊に見える
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = (Math.PI / 2) * i;
      ctx.lineTo(78 + Math.cos(a) * 11, 22 + Math.sin(a) * 11);
      ctx.lineTo(78 + Math.cos(a + Math.PI / 4) * 3.5, 22 + Math.sin(a + Math.PI / 4) * 3.5);
    }
    ctx.closePath();
    fill(ctx);
    // 夜の時間帯を表す帯。月とは離した下端に置く
    ctx.beginPath();
    squircle(ctx, 20, 76, 60, 9, 4.5);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fill();
    ctx.beginPath();
    squircle(ctx, 54, 76, 26, 9, 4.5);
    fill(ctx);
  },
  // 選手年鑑: 年表(積み上げ)
  yearlyChart: (ctx) => {
    const hs = [26, 40, 30, 52, 36];
    hs.forEach((hh, i) => {
      ctx.beginPath();
      squircle(ctx, 18 + i * 14, 76 - hh, 10, hh, 4);
      ctx.fillStyle = `rgba(255,255,255,${0.55 + i * 0.1})`;
      ctx.fill();
    });
    ctx.beginPath();
    ctx.moveTo(12, 80); ctx.lineTo(88, 80);
    stroke(ctx, 5);
  },
  // 目標設定シート: 3x3のマンダラ
  mandala: (ctx) => {
    for (let i = 0; i < 9; i++) {
      const x = 20 + (i % 3) * 21;
      const y = 20 + Math.floor(i / 3) * 21;
      const center = i === 4;
      ctx.beginPath();
      squircle(ctx, x, y, 17, 17, 3);
      if (center) {
        fill(ctx);
      } else {
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 4;
        ctx.stroke();
      }
    }
  },
  // メモ帳: 付箋と鉛筆
  memo: (ctx) => {
    ctx.beginPath();
    ctx.moveTo(18, 20);
    ctx.lineTo(64, 20);
    ctx.lineTo(64, 66);
    ctx.lineTo(46, 84);
    ctx.lineTo(18, 84);
    ctx.closePath();
    stroke(ctx, 6);
    ctx.beginPath();
    ctx.moveTo(64, 66);
    ctx.lineTo(46, 66);
    ctx.lineTo(46, 84);
    stroke(ctx, 5);
    ctx.beginPath();
    ctx.moveTo(28, 38); ctx.lineTo(54, 38);
    ctx.moveTo(28, 50); ctx.lineTo(54, 50);
    stroke(ctx, 5);
    ctx.save();
    ctx.translate(74, 34);
    ctx.rotate(0.72);
    ctx.beginPath();
    squircle(ctx, -5, -14, 10, 34, 2);
    fill(ctx);
    ctx.beginPath();
    ctx.moveTo(-5, 20); ctx.lineTo(0, 30); ctx.lineTo(5, 20);
    ctx.closePath();
    fill(ctx);
    ctx.restore();
  },
  // 作戦ボード: グラウンドと矢印
  board: (ctx) => {
    ctx.beginPath();
    squircle(ctx, 12, 20, 76, 60, 8);
    stroke(ctx, 6);
    // 盤上の駒。これがないと枠だけの空箱に見えてしまう
    [[28, 62], [50, 44], [72, 64]].forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      fill(ctx);
    });
    // 動きの矢印
    ctx.beginPath();
    ctx.moveTo(30, 54);
    ctx.quadraticCurveTo(40, 32, 62, 36);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 5;
    ctx.setLineDash([8, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(70, 38); ctx.lineTo(56, 30); ctx.lineTo(58, 44);
    ctx.closePath();
    fill(ctx);
  },
  // 日誌・週間・月間成績: 新聞
  report: (ctx) => {
    ctx.beginPath();
    squircle(ctx, 16, 22, 60, 58, 5);
    stroke(ctx, 6);
    ctx.beginPath();
    ctx.moveTo(76, 34);
    ctx.lineTo(86, 34);
    ctx.lineTo(86, 74);
    ctx.quadraticCurveTo(86, 80, 80, 80);
    stroke(ctx, 5);
    ctx.beginPath();
    squircle(ctx, 26, 32, 40, 12, 2);
    fill(ctx);
    ctx.beginPath();
    squircle(ctx, 26, 52, 16, 18, 2);
    fill(ctx);
    ctx.beginPath();
    ctx.moveTo(48, 54); ctx.lineTo(66, 54);
    ctx.moveTo(48, 62); ctx.lineTo(66, 62);
    ctx.moveTo(48, 70); ctx.lineTo(66, 70);
    stroke(ctx, 4);
  },
  // 成績の訂正: 表と鉛筆
  records: (ctx) => {
    ctx.beginPath();
    squircle(ctx, 16, 24, 54, 56, 6);
    stroke(ctx, 6);
    ctx.beginPath();
    ctx.moveTo(16, 42); ctx.lineTo(70, 42);
    ctx.moveTo(38, 42); ctx.lineTo(38, 80);
    stroke(ctx, 4);
    ctx.save();
    ctx.translate(70, 56);
    ctx.rotate(-0.7);
    ctx.beginPath();
    squircle(ctx, -6, -26, 12, 40, 2);
    fill(ctx);
    ctx.beginPath();
    ctx.moveTo(-6, 14); ctx.lineTo(0, 26); ctx.lineTo(6, 14);
    ctx.closePath();
    fill(ctx);
    ctx.restore();
  },
  // 監督設定: 歯車
  settings: (ctx) => {
    // 歯は「本体の円から外へ出る短い台形」として描く。放射状の三角形にすると
    // 星形に見えてしまうため、歯の付け根と先端の幅の差を小さくしてある
    const cx = 50, cy = 50, body = 27, tooth = 38, teeth = 8;
    ctx.beginPath();
    for (let i = 0; i < teeth; i++) {
      const c = (Math.PI * 2 * i) / teeth;
      const halfRoot = 0.19;
      const halfTip = 0.13;
      ctx.moveTo(cx + Math.cos(c - halfRoot) * body, cy + Math.sin(c - halfRoot) * body);
      ctx.lineTo(cx + Math.cos(c - halfTip) * tooth, cy + Math.sin(c - halfTip) * tooth);
      ctx.lineTo(cx + Math.cos(c + halfTip) * tooth, cy + Math.sin(c + halfTip) * tooth);
      ctx.lineTo(cx + Math.cos(c + halfRoot) * body, cy + Math.sin(c + halfRoot) * body);
      ctx.closePath();
    }
    fill(ctx);
    // 本体のリング(中を抜いて歯車らしくする)
    ctx.beginPath();
    ctx.arc(cx, cy, body, 0, Math.PI * 2);
    ctx.arc(cx, cy, 13, 0, Math.PI * 2, true);
    ctx.fillStyle = "#ffffff";
    ctx.fill("evenodd");
  },
};

// ============================================================
// タイル
// ============================================================
export interface ModeIconOptions {
  size: number;
  glyph: GlyphKey;
  /** タイルの基調色 */
  color: Rgb;
  selected: boolean;
  /** 右上の小さな光。実データ上「今見るべきものがある」項目にだけ付ける */
  spark: boolean;
  /** 下端の帯に出す数値(未完了件数など)。nullなら帯を出さない */
  badge: { label: string; value: string; ratio: number } | null;
  /** タイルの輪郭。既定は角丸(パワプロ) */
  shape?: TileShape;
  /** 表面の質感。gloss=ガラスの照り、matte=艶を消して走査線を薄く重ねる */
  chrome?: "gloss" | "matte";
}

export function paintModeIcon(ctx: CanvasRenderingContext2D, o: ModeIconOptions) {
  const s = o.size;
  ctx.clearRect(0, 0, s, s);
  const pad = 3;
  const w = s - pad * 2;
  const r = w * 0.24;
  const shape = o.shape ?? "squircle";
  const matte = o.chrome === "matte";

  // ---- 落ち影 ----
  ctx.save();
  ctx.shadowColor = "rgba(12,20,40,0.42)";
  ctx.shadowBlur = s * 0.1;
  ctx.shadowOffsetY = s * 0.045;
  tilePath(ctx, shape, pad, pad, w, w);
  ctx.fillStyle = rgb(o.color);
  ctx.fill();
  ctx.restore();

  // ---- 下地のグラデーション(上が明るく、下が沈む) ----
  const g = ctx.createLinearGradient(0, pad, 0, pad + w);
  g.addColorStop(0, rgb(mix(o.color, [255, 255, 255], matte ? 0.16 : 0.34)));
  g.addColorStop(0.5, rgb(o.color));
  g.addColorStop(1, rgb(mix(o.color, [0, 0, 0], matte ? 0.2 : 0.3)));
  tilePath(ctx, shape, pad, pad, w, w);
  ctx.fillStyle = g;
  ctx.fill();

  ctx.save();
  tilePath(ctx, shape, pad, pad, w, w);
  ctx.clip();
  if (matte) {
    // ---- 走査線(艶消し) ----
    // 端末や計器の画面らしさを、照りではなく細い横線で出す
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    for (let y = pad; y < pad + w; y += Math.max(2, w * 0.055)) {
      ctx.fillRect(pad, y, w, Math.max(0.7, w * 0.014));
    }
  } else {
    // ---- 上半分のガラス光沢 ----
    const gl = ctx.createLinearGradient(0, pad, 0, pad + w * 0.52);
    gl.addColorStop(0, "rgba(255,255,255,0.42)");
    gl.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gl;
    ctx.beginPath();
    ctx.moveTo(pad, pad);
    ctx.lineTo(pad + w, pad);
    ctx.lineTo(pad + w, pad + w * 0.46);
    ctx.quadraticCurveTo(pad + w * 0.5, pad + w * 0.62, pad, pad + w * 0.42);
    ctx.closePath();
    ctx.fill();
  }

  // ---- 記号 ----
  ctx.save();
  const inset = w * 0.19;
  const gs = (w - inset * 2) / 100;
  ctx.translate(pad + inset, pad + inset - (o.badge ? w * 0.08 : 0));
  ctx.scale(gs, gs);
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 2;
  GLYPHS[o.glyph](ctx);
  ctx.restore();

  // ---- 下端の帯(件数) ----
  // 帯はタイルの角丸に切り抜かれるので、下端に近いほど左右が内側へ湾曲する。
  // 以前は帯が角丸半径より低く、文字も端から6%しか離していなかったため、
  // 「計測中」「進行中」などの下側が角の曲線に削られていた。
  // 帯を角丸半径より高くし、文字を曲線に当たらない位置・幅へ収める
  if (o.badge) {
    const bh = Math.max(w * 0.27, r + w * 0.05);
    const by = pad + w - bh;
    ctx.fillStyle = "rgba(10,16,32,0.66)";
    ctx.fillRect(pad, by, w, bh);
    // 中の進み具合
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.fillRect(pad, by, w * Math.max(0, Math.min(1, o.badge.ratio)), bh);
    // 帯の上端に細い区切り線を入れて、記号と数字の領域を分ける
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fillRect(pad, by, w, 1);

    // 文字は帯の上寄り(全幅が使える高さ)に置き、左右は角の曲線より内側から始める
    const textY = by + bh * 0.44;
    const sideInset = w * 0.12;
    const avail = w - sideInset * 2;
    let fontSize = Math.max(8, Math.round(bh * 0.44));
    const setFont = () => (ctx.font = `bold ${fontSize}px ui-sans-serif, system-ui, sans-serif`);
    setFont();
    // ラベルと数字が重なるなら、まず字を詰め、それでも入らなければラベルを落として
    // 数字だけにする(数字のほうが情報として重い)
    let label = o.badge.label;
    while (fontSize > 7 && ctx.measureText(label + o.badge.value).width > avail - w * 0.06) {
      fontSize -= 1;
      setFont();
    }
    if (ctx.measureText(label + o.badge.value).width > avail - w * 0.06) label = "";

    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    if (label) {
      ctx.textAlign = "left";
      ctx.fillText(label, pad + sideInset, textY);
      ctx.textAlign = "right";
      ctx.fillText(o.badge.value, pad + w - sideInset, textY);
    } else {
      ctx.textAlign = "center";
      ctx.fillText(o.badge.value, pad + w / 2, textY);
    }
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
  }
  ctx.restore();

  // ---- 内側の締め線 ----
  tilePath(ctx, shape, pad + 1.5, pad + 1.5, w - 3, w - 3);
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // ---- 選択中の縁取り ----
  if (o.selected) {
    tilePath(ctx, shape, pad - 1, pad - 1, w + 2, w + 2);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // ---- 右上の光(注目してほしい項目) ----
  if (o.spark) {
    const sx = pad + w * 0.86;
    const sy = pad + w * 0.14;
    const rr = w * 0.075;
    ctx.save();
    ctx.translate(sx, sy);
    const gs2 = ctx.createRadialGradient(0, 0, 0, 0, 0, rr * 2);
    gs2.addColorStop(0, "rgba(255,255,255,0.95)");
    gs2.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gs2;
    ctx.beginPath();
    ctx.arc(0, 0, rr * 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = (Math.PI / 2) * i;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      ctx.lineTo(Math.cos(a + Math.PI / 4) * rr * 0.34, Math.sin(a + Math.PI / 4) * rr * 0.34);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
