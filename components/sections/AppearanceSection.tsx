"use client";

import { useRef, useState } from "react";
import { useSetting } from "@/lib/settings";
import {
  DEFAULT_CUSTOM_CREAM_RGB,
  DEFAULT_CUSTOM_INK_RGB,
  DEFAULT_CUSTOM_PANEL_RGB,
  hexToRgbSpace,
  rgbSpaceToHex,
} from "@/lib/theme";

// 演出テーマ(モード)の選択画面。以前は設定タブの中の1パネルだったが、
// アプリの見た目を丸ごと変える操作なので、押せばすぐそこへ行ける独立したタブに格上げした。
// 中身(モードの一覧・文言ON/OFF・ヘッダー画像・カスタム配色)は以前とまったく同じで、
// 置き場所だけを変えている。アクセントカラー・文字サイズ等の汎用UI設定は
// 「モード選択」というより全体設定なので、引き続き設定タブ側に残してある

export default function AppearanceSection() {
  const [visualMode, setVisualMode] = useSetting("theme.visualMode", "off");
  const [customInkRgb, setCustomInkRgb] = useSetting("theme.custom.inkRgb", DEFAULT_CUSTOM_INK_RGB);
  const [customCreamRgb, setCustomCreamRgb] = useSetting("theme.custom.creamRgb", DEFAULT_CUSTOM_CREAM_RGB);
  const [customPanelRgb, setCustomPanelRgb] = useSetting("theme.custom.panelRgb", DEFAULT_CUSTOM_PANEL_RGB);
  const [applyWordingStr, setApplyWordingStr] = useSetting("theme.applyWording", "true");
  const applyWording = applyWordingStr !== "false";

  return (
    <div className="space-y-4">
      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">🎭 演出テーマ</h3>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            className={visualMode === "off" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setVisualMode("off")}
          >
            オフ
          </button>
          <button
            className={visualMode === "lobotomy" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setVisualMode("lobotomy")}
          >
            🩸 ロボトミーコーポレーション風
          </button>
          <button
            className={visualMode === "va11halla" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setVisualMode("va11halla")}
          >
            🍸 VA-11 HALL-A風
          </button>
          <button
            className={visualMode === "persona5" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setVisualMode("persona5")}
          >
            ★ ペルソナ5風
          </button>
          <button
            className={visualMode === "natsuyasumi" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setVisualMode("natsuyasumi")}
          >
            🌻 ぼくのなつやすみ風
          </button>
          <button
            className={visualMode === "claude" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setVisualMode("claude")}
          >
            ✳ Claudeモード
          </button>
          <button
            className={visualMode === "zen" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setVisualMode("zen")}
          >
            ☯ 禅モード
          </button>
          <button
            className={visualMode === "terminal" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setVisualMode("terminal")}
          >
            📟 ターミナルモード
          </button>
          <button
            className={visualMode === "adventurer" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setVisualMode("adventurer")}
          >
            🗡️ 冒険者モード
          </button>
          <button
            className={visualMode === "hub" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setVisualMode("hub")}
          >
            🗂️ ハブモード
          </button>
          <button
            className={visualMode === "library" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setVisualMode("library")}
          >
            📚 図書館モード
          </button>
          <button
            className={visualMode === "powerpro" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setVisualMode("powerpro")}
          >
            ⚾ 育成選手モード
          </button>
          <button
            className={visualMode === "hayarigami" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setVisualMode("hayarigami")}
          >
            🩸 怪異調査モード
          </button>
          <button
            className={visualMode === "mountain" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setVisualMode("mountain")}
          >
            ⛰️ 登山モード
          </button>
          <button
            className={visualMode === "origin" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setVisualMode("origin")}
          >
            📗 原点モード
          </button>
          <button
            className={visualMode === "custom" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setVisualMode("custom")}
          >
            🎨 カスタム
          </button>
        </div>
        <p className="text-xs text-cream/50">
          演出テーマを選ぶと、色や装飾だけでなくアプリ名・タブの呼び名までテーマの世界観のものに総入れ替えされます（例: ぼくのなつやすみ風では「ToDo」が「しゅくだい」に、アプリ名も「なつやすみの しゅくだい」になります）。カスタムは背景・文字・パネルの色だけを自由に選べるモードです（形・アニメーション・文言は変わりません）。
        </p>
        {visualMode !== "off" && visualMode !== "custom" && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-ink/40 px-3 py-2">
            <div>
              <p className="text-xs font-bold text-cream/80">テーマに合わせた文言を使う</p>
              <p className="text-[11px] text-cream/50">
                オフにすると、色・形・アニメーションはテーマのまま、アプリ名・タブ名・バッジや通知の文言だけ通常表記に戻ります。
              </p>
            </div>
            <button
              className={applyWording ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
              onClick={() => setApplyWordingStr(applyWording ? "false" : "true")}
            >
              文言の変更: {applyWording ? "ON" : "OFF"}
            </button>
          </div>
        )}
        {visualMode === "lobotomy" && (
          <>
            <p className="text-xs text-cream/50">
              画面全体にCRT風の走査線・ノイズ、アプリタイトルの色収差グリッチ、パネル四隅のリベット、見出しの走査ブロック装飾が有効になります。予測を大幅に超過した作業には「収容の不安定化」警戒表示（画面端のビネット・横スクロールする警告ティッカー・危険階級バッジ ZAYIN〜ALEPH）が出ます。
            </p>
            <p className="text-xs text-cream/50">
              さらに「本日の作業」タブが管理局の監視画面に置き換わります。収容区画の断面図（作業1件＝1区画）、個体の肖像と危険度、キリパス・カウンタ、エネルギー目標のメーター、警報段階（ラッパ）、作業種別（本能／洞察／愛着／抑制）の4択、職員能力値の図が表示されます。数値はすべて実データから算出され、作業種別を選ぶとその作業の想定時間が実際に書き換わります。
            </p>
            <HeaderImageSetting mode="lobotomy" themeLabel="ロボトミーコーポレーション風" />
          </>
        )}
        {visualMode === "va11halla" && (
          <>
            <p className="text-xs text-cream/50">
              画面全体にネオンのシンセウェイブグリッド・VHS風走査線、パネル枠のネオングロー、アプリタイトルのネオン色収差が有効になります。予測を大幅に超過した作業には「システムオーバーロード」警戒表示（ネオンビネット・横スクロールする警告ティッカー・注文階級バッジ REGULAR〜BAD TOUCH）が出ます。
            </p>
            <HeaderImageSetting mode="va11halla" themeLabel="VA-11 HALL-A風" />
          </>
        )}
        {visualMode === "persona5" && (
          <>
            <p className="text-xs text-cream/50">
              画面全体が黒地に赤・白を基調にした切り絵風の配色に丸ごと変わり、パネル左上の斜め切り取りリボン・見出しの斜体強調・角を落とした鋭いボタンが有効になります。予測を大幅に超過した作業には「予告状」警戒表示（高速ストロボのビネット・横スクロールする警告ティッカー・階級バッジ 順調〜予告状）が出ます。
            </p>
            <HeaderImageSetting mode="persona5" themeLabel="ペルソナ5風" />
          </>
        )}
        {visualMode === "natsuyasumi" && (
          <>
            <p className="text-xs text-cream/50">
              画面全体が暖色の紙焼き写真風ライトテーマに丸ごと反転し、「本日の作業」タブが夏休みの一日そのものに総入れ替えされます。見出しには田舎の風景の一枚絵が入り、原作と同じように<b>朝・昼・夕方・夜で絵が描き替わります</b>（入道雲・棚田とあぜ道・電線・縁側のある家、夜は星空と天の川、そして田んぼの上を舞うホタル）。空模様は本日の想定超過の度合いに対応していて、予定どおりなら快晴、はみ出すほど曇り、大きくはみ出すと夕立になります。
            </p>
            <p className="text-xs text-cream/50">
              画面の中身も夏休みの道具立てに置き換わります。<b>ラジオ体操カード</b>には連続記録の日数だけ判子が押され（10マスで1枚）、<b>縁側の朝顔</b>は本日の実働時間でつるが伸び、完了した数だけ花が咲きます。<b>むしかご</b>には一度でも実績のある作業が虫になって並び、大きさは想定時間、めずらしさは実施回数の少なさで決まります（カブトムシ・クワガタ・セミ・トンボ・チョウ・バッタ・テントウムシ・コガネムシの8種を、作業の性質から決定的に割り当てています）。そして一日の終わりには<b>絵日記</b>——その日いちばん時間を使った作業がクレヨン画と本文になり、一言を書き足せます。カレンダーには今月の記録が日ごとの濃さで並びます。
            </p>
            <HeaderImageSetting mode="natsuyasumi" themeLabel="ぼくのなつやすみ風" />
            <NatsuyasumiWeatherSetting />
            <NatsuyasumiTimeSetting />
          </>
        )}
        {visualMode === "claude" && (
          <p className="text-xs text-cream/50">
            他の演出テーマが実データを別の言葉で言い換えるのに対し、このモードだけは<b>実データを実際に分析する</b>ところまで踏み込みます。画面全体が温かみのある紙のようなテーマ（このモードのみOSのライト/ダーク設定に追従します）に変わり、タブは「ワークスペース・インサイト・レポート・設定」の4つに絞られます。ワークスペースでは本日の作業・ToDo・案件が1画面に統合され、どの項目からもその場で計測を開始できます。
          </p>
        )}
        {visualMode === "claude" && (
          <p className="text-xs text-cream/50">
            「インサイト」タブが、このモードの中心です。直近90日の実績を、見積もりの偏り・時間帯・曜日・作業の細切れ・突発対応の集中・ToDoの滞留・案件の到達見込み・稼働のばらつきという8つの観点で調べ、根拠が足りたものだけを気づきとして提示します。それぞれの気づきには<b>結論・根拠の数字・確信度・次の一手・その結論が覆る条件</b>が付きます。確信度は演出ではなく標本数と効果量から計算しているため、記録が少ないうちは低く出ます（言えることが無ければ、無理に何も言いません）。あわせて、想定と実績を対数軸で並べた散布図と、時間帯ごとの着手件数も表示されます。分析の手順そのものも画面に開示されます。
          </p>
        )}
        {visualMode === "zen" && (
          <p className="text-xs text-cream/50">
            見た目も機能も他のモードとは逆方向に振り切った、引き算のモードです。「本日の作業」タブは、Claudeが選んだ(あるいは既に進行中の)ただ1件だけを円相(禅画で描かれる、書き切らない一筆書きの円)とともに全画面で見せる専用画面に総入れ替えされます。タブも「今・設定」の2つだけに絞り込まれ、ToDo一覧・案件一覧・レポート等は意図的に見せません。新しいことを加えたい時だけ、画面下の小さな「+」から一言だけ書き足せます。
          </p>
        )}
        {visualMode === "terminal" && (
          <p className="text-xs text-cream/50">
            Claudeモード・禅モードとは正反対の「足し算」のモードです。画面全体が黒地に燐光グリーンとアンバーを効かせたモノスペース端末風に変わり、「本日の作業」タブはマルチモニターのトレーディングフロアを思わせる情報密度の高い管制室ダッシュボードに総入れ替えされます(現在時刻・システム負荷・育成ステージ・継続日数・カテゴリ別内訳・時間帯アクティビティ・クイックスタート・完了タスクのティッカーテープを1画面に集約)。タブは削らず全て表示したまま、中身だけを情報過多にするのがこのモードの狙いです。
          </p>
        )}
        {visualMode === "adventurer" && (
          <p className="text-xs text-cream/50">
            画面全体がRPGの羊皮紙の書物のような、金の装飾が効いた明るいライトテーマに丸ごと変わります。作業は「クエスト」、作業マスタは「モンスター図鑑」、想定超過は「ぜんめつの危機」など、アプリ名(「ぼうけんの書」)からタブの呼び名まで冒険の世界観に総入れ替えされます。危機感を煽るというより、クエストを攻略していくワクワク感を出す方向の言い回しです。
          </p>
        )}
        {visualMode === "hub" && (
          <p className="text-xs text-cream/50">
            落ち着いたスレートブルーの配色に変わり、「本日の作業」タブの中身が、<b>メモ・ToDo・案件・本日の作業を1枚に広げた「統合ボード」</b>に差し替わります。タブを行き来せず、この1画面を見ながら考えをまとめるためのモードです。ボードの上では、付箋をその場で足す・カードの周りに<b>手書きで書きなぐる</b>・ToDoを完了にする・<b>案件の段階をその場で通過にする</b>・作業の計測を始める、までができます。マイデイのToDoは自動で並び、それ以外のToDoと案件は「一覧から置く」から選んで置きます（カードの✕でいつでも下げられます。項目自体は消えません）。付箋と手書きはメモタブと同じものなので、どちらで書いても両方に出ます。全件一覧やサブタスク編集のためにToDoタブ、案件の新規作成や段階の追加のために案件タブ、連結線やチェックリスト付箋のためにメモタブは残しています。
          </p>
        )}
        {visualMode === "library" && (
          <p className="text-xs text-cream/50">
            画面全体が古い紙・革表紙を思わせるセピア/羊皮紙のライトテーマに変わり、「本日の作業」タブが図書館の閲覧室に総入れ替えされます。見出しには時間帯で採光が変わる閲覧室の一枚絵が入り、借りている冊数だけ机の灯りがともります。書見台には今開いている本が見開きで描かれ、栞の位置が進み具合、紙面からはみ出せば延滞です。本日の作業は背表紙として棚に並び、厚みは想定時間、擦り切れ具合は貸出回数から決まります。背表紙を押すと請求記号つきの目録カードが開き、巻末には過去の実績日が判子で押された「返却期限票」が付きます。作業は「貸出」、想定超過は「延滞」など、呼び名も図書館の用語に総入れ替えされます。
          </p>
        )}
        {visualMode === "powerpro" && (
          <p className="text-xs text-cream/50">
            画面全体が白背景に鮮やかなブルーを効かせたライトテーマに変わり、「本日の作業」タブが野球育成ゲームの育成画面（サクセス）そのものに総入れ替えされます。見出しには時間帯で空の色が変わる球場の一枚絵が入り、2頭身の選手が中央に立ちます（やる気で表情が、計測中かどうかで構えが、超過の度合いで汗が変わります）。その上に体力・やる気・熱血の光沢ゲージが重なり、電光掲示板には本日の消化件数が出ます。本日の作業ひとつひとつは5色に色分けされた「練習コマンド」の盤になり、押すとその作業の計測が始まります。「選手データ」を開くと、ミート・パワー・走力・肩力・守備力・捕球の6能力が六角形とG〜Sランクで並び、筋力/敏捷/技術/変化球/精神の5色の経験点と、実データの閾値だけで付く特殊能力（金・青・赤）が表示されます。どの数値も押すと算出根拠が実データで出ます。
          </p>
        )}
        {visualMode === "powerpro" && (
          <p className="text-xs text-cream/50">
            「育成」タブは、シーズン成績（直近30日の比率）とは別の考え方で動きます。<b>1日の働きを「その日の練習で得た成長ポイント」に換算し、記録初日からの合計を能力値にします</b>。過去の記録は変わらないので値は下がらず、働いた日だけ確実に伸びます。ミートは想定内に収めて完了した件数、パワーは実働30分ごと、走力は片付けたToDo・案件の段階の数、肩力は完了した作業の数、守備力はやり切った突発対応の数、捕球は期日までに片付けたToDoの数から入ります。どの伸びも「何をしたから何ポイント入ったか」が内訳として出ます。体力は設定の<b>所定労働時間</b>を満タンとして実働で減り、<b>休憩時間帯に登録したチェック項目</b>を消化するごとに戻ります（消化状況は日付ごとに保存され、翌日には空に戻ります）。
          </p>
        )}
        {visualMode === "powerpro" && (
          <p className="text-xs text-cream/50">
            「ToDo」タブと「案件」タブにも同じ演出が及びます。ToDoの一覧の先頭には<b>スカウト部のドラフトボード</b>が出て、最優先の1件を評価の盾つきで大きく掲げ、S〜Cの階級ごとの人数を横棒で並べ、交渉中（未完了）と契約済（完了）の数を出します。各項目は候補選手の胸像として描かれ（期日が迫るほど背景が熱を帯び、集中線が入ります）、期日までの余裕と重要度から付いたS〜Cの評価が器の枠の色と右下の盾章になります。案件の一覧の先頭には<b>ペナントレースの順位表</b>が出て、段階（マイルストーン）を1試合ずつに見立てた勝（完了）・敗（期日超過）・残（未消化）と勝率を順位順に並べ、首位は金で示されます。各案件にはさらに電光掲示板風の勝敗表が付き、完了＝○、期日超過＝●、未消化＝空きマスとして1試合ずつ並びます。
          </p>
        )}
        {visualMode === "hayarigami" && (
          <p className="text-xs text-cream/50">
            流行り神風のホラーサウンドノベルモードです。ほぼ真っ黒な画面に血の色の差し色、全面に薄いノイズとヴィネットがかかり、「本日の作業」タブが一枚絵＋下部メッセージウィンドウ＋選択肢というノベルゲームの画面そのものに総入れ替えされます。文章は1文字ずつ表示され（タップで全文表示）、内容は実際の作業状況から組み立てられます。最大の特徴は、想定時間を超えた作業に対して出る「オカルト / 科学」の二択です。オカルト＝怪異の仕業として<b>トラブル対応</b>に記録、科学＝見積もりが甘かったとして<b>作業マスタの想定時間を実測値に書き換え</b>と、どちらも実データを変更する本物の判断になっており、以後の集計・レポートに反映されます。作業は「調査」、完了は「怪異、解決」など呼び名も捜査用語に変わります。
          </p>
        )}
        {visualMode === "hayarigami" && (
          <p className="text-xs text-cream/50">
            「ToDo」タブと「案件」タブにも同じ演出が及びます。ToDoの各項目にはその場で生成した現場写真（放置日数や期限切れの度合いに応じて、荒れ具合が変わります）と、原作の「F.O.A.F.データベース」を模した通し番号（並び替えても同じ項目には同じ番号が付きます）が付きます。案件には表紙写真に加えて、段階（マイルストーン）の並びを原作の「分岐ツリー」に見立てた図が表示され、済んだ段階・現在地・延滞中の段階が線と印の色でひと目でわかります。
          </p>
        )}
        {visualMode === "mountain" && (
          <p className="text-xs text-cream/50">
            早朝の山の空気を写した、青みの強い岩色に朝日のオレンジを差した配色に変わり、「本日の作業」タブが<b>一日を1回の山行として見る画面</b>に総入れ替えされます。見出しは時間帯で空の色が変わる山のパノラマの一枚絵で、空・遠景の連山（大気遠近で霞ませています）・主峰・雪渓・岩肌・樹林帯・ルート・現在地の登山者をその場で描いています。ルートの実線は本日の進み具合そのもので、歩いた分だけ伸びます。天候は気分ではなく実データで決まり、トラブル対応2件以上か想定の2倍超で<b>荒天</b>（雨と稲妻が降ります）、トラブル1件か超過が半数以上で<b>雨</b>、超過が1件以上で<b>曇り</b>、超過なしで<b>快晴</b>です。
          </p>
        )}
        {visualMode === "mountain" && (
          <p className="text-xs text-cream/50">
            言い換えは全編にわたります。<b>案件＝一座の山</b>（段階の数がそのまま標高になり、1段階＝300m）、<b>案件の段階＝通過点</b>（完了＝通過、期日を過ぎた未通過＝ルートの崩落で×印）、<b>本日の作業＝区間</b>、<b>想定時間＝コースタイム</b>、<b>実績時間＝行動時間</b>（実働10分＝獲得標高50m）、<b>所定労働時間の残り＝日没までの時間</b>、<b>未完了のToDo＝ザックの中身</b>（期日を過ぎたものほど重い）です。「登攀中の山」を開くと案件ごとに木の山名板と<b>高度断面図</b>が出て、どの通過点まで登れていて、どこが崩れているかが横から見た形で分かります。
          </p>
        )}
        {visualMode === "origin" && (
          <p className="text-xs text-cream/50">
            このアプリの原型である<b>1枚のExcelブック「工程表.xlsm」</b>の使い勝手を、いまのデータの上でそのまま動かすモードです。画面全体がExcelの作業ウィンドウ（薄いグレーの地に真っ白なシート、緑のシート見出し）になり、タブも当時のブックと同じ<b>工程表 / やることリスト / 作業項目 / 集計 / 時間外集計 / メモ</b>の並びに絞られます。「本日の作業」タブは工程表シートそのもので、B列＝作業（業務区分）・C列＝内容・E列＝開始時間・F列＝終了時間・J列＝想定時間・K列＝完了フラグが並び、7行目から<b>「奇数行＝予定／偶数行＝実績」の2行ペア</b>で積み上がります。右側にはL列〜CI列の<b>08:00〜20:30を10分刻みで並べた時間軸</b>が伸び、CK列の「やることリスト」も当時と同じ位置にあります。
          </p>
        )}
        {visualMode === "origin" && (
          <p className="text-xs text-cream/50">
            シートに貼ってあった<b>3つのマクロボタン</b>も同じ名前で動きます。<b>作業完了</b>は現在時刻を<b>10分単位に丸めて</b>打刻したうえで「予定通りの作業を実行しましたか？」を必ず聞き（キーボードの 1／2 でも答えられます）、はいなら次の予定へ、いいえなら<b>予定外差し込み</b>——元のブックと同じ<span className="font-mono"> RGB(255,210,215) </span>の赤で行を差し込み、以降の予定を後ろへ送ります。予定内は同じく<span className="font-mono"> RGB(255,242,204) </span>の黄です。<b>予定を下に</b>は、当時35行ぶんを手で押し下げていた作業を、先頭の未着手行の時刻を書き換えるだけで以降まとめてずらす形にしました。<b>作業項目…</b>は当時のユーザーフォーム（業務区分→作業名→詳細の2段選択）で、想定時間には元のブックと同じ<span className="font-mono"> TRIMMEAN(範囲, 0.5) </span>の<b>刈り込み平均</b>（上下25%ずつを捨てた平均。止め忘れのような極端な記録に引っ張られません）を使います。上部には当時ボタンで出していた<b>予定内／予定外の集計</b>が常に出ます。
          </p>
        )}
        {visualMode === "origin" && (
          <p className="text-xs text-cream/50">
            ただし<b>そのまま復活させただけではありません</b>。元のブックには「メモ」シートがあり、当時の不満がそのまま書き残されていました。それぞれに手を入れてあります——「予定時間をずらさないといけない」→<b>予定を下にが1回で済む</b>／「行が狭い」→<b>行高と目盛り幅を画面上で変えられる</b>／「予定と実績の縦並びわかりにくい」→<b>ペアを縦線で括り実績行に「実」の印</b>／「バーがどれがどれか」「バーに文字」→<b>帯の中に作業名を書き込み</b>／「時間超過を赤文字に」→<b>超過分を赤字で併記</b>／「途中の場合何か出したい」→<b>計測中は帯が伸び続け、現在時刻の線が走る</b>／「新しい項目が出来た際に取り入れれるようにしたい」→<b>作業項目からその場で新規登録</b>／「予定内外の合計がおかしい」→<b>実データから毎回数え直し</b>。当時17:00固定だった時間外の区切りは設定タブの定時に、10:00・12:00・15:00の休憩の目印は設定タブの休憩時間帯に繋いであります（未登録なら当時の時刻を使います）。
          </p>
        )}
        {visualMode === "off" && (
          <p className="text-xs text-cream/50">
            通常表示です。計測中・予測超過の強調表示自体は演出テーマに関わらず常に有効です。
          </p>
        )}
        {visualMode === "custom" && (
          <div className="space-y-3 border-t border-cream/10 pt-3">
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-cream/70">
                背景
                <input
                  type="color"
                  value={rgbSpaceToHex(customInkRgb)}
                  onChange={(e) => setCustomInkRgb(hexToRgbSpace(e.target.value))}
                  className="h-8 w-12 cursor-pointer rounded border border-cream/20 bg-ink"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-cream/70">
                文字
                <input
                  type="color"
                  value={rgbSpaceToHex(customCreamRgb)}
                  onChange={(e) => setCustomCreamRgb(hexToRgbSpace(e.target.value))}
                  className="h-8 w-12 cursor-pointer rounded border border-cream/20 bg-ink"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-cream/70">
                パネル
                <input
                  type="color"
                  value={rgbSpaceToHex(customPanelRgb)}
                  onChange={(e) => setCustomPanelRgb(hexToRgbSpace(e.target.value))}
                  className="h-8 w-12 cursor-pointer rounded border border-cream/20 bg-ink"
                />
              </label>
              <button
                className="btn-pill-outline text-xs"
                onClick={() => {
                  setCustomInkRgb(DEFAULT_CUSTOM_INK_RGB);
                  setCustomCreamRgb(DEFAULT_CUSTOM_CREAM_RGB);
                  setCustomPanelRgb(DEFAULT_CUSTOM_PANEL_RGB);
                }}
              >
                初期値に戻す
              </button>
            </div>
            <p className="text-xs text-cream/50">
              背景・文字・パネルの色を自由に選べます。アクセントカラーは設定タブの「アクセントカラー」と共通です。
            </p>
          </div>
        )}
      </div>

    </div>
  );
}

// 選ばれた画像ファイルを、ヘッダーの帯に収まる程度の幅まで縮小してからJPEGの
// data URLに変換する。端末内(IndexedDB)に丸ごと保存するため、元画像のままだと
// 容量を圧迫しやすいことへの対策
function resizeImageToDataUrl(file: File, maxWidth: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      URL.revokeObjectURL(objectUrl);
      if (!ctx) {
        reject(new Error("canvas unavailable"));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("画像の読み込みに失敗しました"));
    };
    img.src = objectUrl;
  });
}

// 演出テーマのヘッダー画像を、端末内の画像ファイルに差し替える設定。
// 「今のヘッダーをオリジナルとし、それ以外も自分で画像設定できるように」という
// 要望に対応したもので、未設定(空文字)ならHeaderArt.tsxが従来どおりテーマ専用の
// イラストを描画し、設定済みならそちらの画像がヘッダーの帯にそのまま使われる
// ヘッダーの帯はもとの画像よりかなり横長になることが多く、object-fit:coverで
// 収める際にどうしても上下(または左右)が切り落とされる。切り取られる位置を
// 3x3の基準点(CSSのobject-position相当)から選べるようにする
const HEADER_IMAGE_POSITIONS: { key: string; label: string }[] = [
  { key: "0% 0%", label: "左上" },
  { key: "50% 0%", label: "上" },
  { key: "100% 0%", label: "右上" },
  { key: "0% 50%", label: "左" },
  { key: "50% 50%", label: "中央" },
  { key: "100% 50%", label: "右" },
  { key: "0% 100%", label: "左下" },
  { key: "50% 100%", label: "下" },
  { key: "100% 100%", label: "右下" },
];

function HeaderImageSetting({ mode, themeLabel }: { mode: string; themeLabel: string }) {
  const [image, setImage] = useSetting(`theme.headerImage.${mode}`, "");
  const [position, setPosition] = useSetting(`theme.headerImagePosition.${mode}`, "50% 50%");
  const [zoomStr, setZoomStr] = useSetting(`theme.headerImageZoom.${mode}`, "100");
  const zoom = Number(zoomStr) || 100;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const dataUrl = await resizeImageToDataUrl(file, 1600);
      await setImage(dataUrl);
    } catch {
      setError("画像の読み込みに失敗しました。別の画像でお試しください。");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2 rounded-lg bg-ink/40 px-3 py-2">
      {image && (
        // 実際のヘッダーの帯(h-24/h-28・幅いっぱい)と同じ比率のプレビュー。
        // 端末幅によって帯の縦横比が変わるため、固定サイズのサムネイルだと
        // 「設定画面では良く見えたのに実機だと切れ方が違う」というズレが起きる。
        // ここを実物と同じクラスにすることで、この設定パネルの表示幅なりに
        // 実際の見え方に近い形で確認できるようにする
        <div className="w-full overflow-hidden rounded">
          <img
            src={image}
            alt=""
            style={{ objectPosition: position, transform: `scale(${zoom / 100})`, transformOrigin: position }}
            className="h-24 w-full object-cover sm:h-28"
          />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {!image && (
          <div className="flex h-10 w-20 shrink-0 items-center justify-center rounded border border-dashed border-cream/25 text-[10px] text-cream/40">
            オリジナル
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-cream/80">{themeLabel}のヘッダー画像</p>
          <p className="text-[11px] text-cream/50">{image ? "自分の画像を使用中です。" : "テーマ専用のイラスト(オリジナル)を使用中です。"}</p>
          {error && <p className="text-[11px] text-alert">{error}</p>}
        </div>
        <div className="flex shrink-0 gap-2">
          <button className="btn-pill-outline text-xs" onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? "読み込み中…" : "画像を選ぶ"}
          </button>
          {image && (
            <button
              className="btn-pill-outline text-xs"
              onClick={() => {
                setImage("");
                setPosition("50% 50%");
                setZoomStr("100");
              }}
            >
              オリジナルに戻す
            </button>
          )}
        </div>
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      </div>
      {image && (
        <div className="space-y-2 border-t border-cream/10 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-cream/50">帯に収まらない分をどこで切り取るか:</span>
            <div className="grid grid-cols-3 gap-1">
              {HEADER_IMAGE_POSITIONS.map((p) => (
                <button
                  key={p.key}
                  className={position === p.key ? "btn-pill px-2 py-1 text-[10px]" : "btn-pill-outline px-2 py-1 text-[10px]"}
                  onClick={() => setPosition(p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-[11px] text-cream/50">拡大率: {zoom}%</span>
            <input
              type="range"
              min={50}
              max={300}
              step={5}
              value={zoom}
              onChange={(e) => setZoomStr(e.target.value)}
              className="h-1 flex-1 accent-highlight"
              aria-label={`${themeLabel}のヘッダー画像の拡大率`}
            />
            {zoom !== 100 && (
              <button className="btn-pill-outline shrink-0 px-2 py-1 text-[10px]" onClick={() => setZoomStr("100")}>
                リセット
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NatsuyasumiWeatherSetting() {
  const [image] = useSetting("theme.headerImage.natsuyasumi", "");
  const [syncStr, setSyncStr] = useSetting("theme.natsuyasumiWeatherSync", "true");
  const sync = syncStr === "true";
  return (
    <div className="space-y-2 rounded-lg bg-ink/40 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold text-cream/80">ヘッダーの空模様を実際の天気に連動</p>
        <button className={sync ? "btn-pill text-xs" : "btn-pill-outline text-xs"} onClick={() => setSyncStr(sync ? "false" : "true")}>
          天気連動: {sync ? "ON" : "OFF"}
        </button>
      </div>
      <p className="text-[11px] text-cream/50">
        ONにすると、ヘッダーの空模様（晴れ・くもり・夕立・雷雨・雪）が実際の天気に合わせて変わります。位置は「天気変化の通知」に登録済みの地点があればそれを優先し、無ければ端末の位置情報（未許可・失敗時は東京）を使い、約30分ごとに再取得します。
        {image && " 現在はオリジナルの代わりに自分の画像を使用中のため、この設定は反映されません。"}
      </p>
    </div>
  );
}

function NatsuyasumiTimeSetting() {
  const [image] = useSetting("theme.headerImage.natsuyasumi", "");
  const [syncStr, setSyncStr] = useSetting("theme.natsuyasumiTimeSync", "true");
  const sync = syncStr === "true";
  return (
    <div className="space-y-2 rounded-lg bg-ink/40 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold text-cream/80">ヘッダーの明るさを実際の時刻に連動</p>
        <button className={sync ? "btn-pill text-xs" : "btn-pill-outline text-xs"} onClick={() => setSyncStr(sync ? "false" : "true")}>
          時間帯連動: {sync ? "ON" : "OFF"}
        </button>
      </div>
      <p className="text-[11px] text-cream/50">
        ONにすると、ヘッダーが端末の現在時刻に合わせて昼(5-16時)・夕方(17-18時)・夜(19-4時)を描き分けます。夜は太陽の代わりに月と星、蝶の代わりに蛍が現れます。天気連動と組み合わせて使えます（例: 夜の夕立、夜のくもり）。
        {image && " 現在はオリジナルの代わりに自分の画像を使用中のため、この設定は反映されません。"}
      </p>
    </div>
  );
}
