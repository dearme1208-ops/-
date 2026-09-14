import MsgReader from "@kenjiuno/msgreader";

// Outlookの.msgファイル(メールをファイルとして保存した際の既定形式)を読み込み、
// 付箋の本文として使える形に整形する。件名を見出しとして先頭に置くことで、
// このアプリには無いAIによる要約の代わりに「開かなくても件名で概要が分かる」形にする
export interface ParsedMailFile {
  subject: string;
  from: string;
  date: string;
  body: string;
}

function formatMailDate(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function parseMsgFile(file: File): Promise<ParsedMailFile> {
  const buffer = await file.arrayBuffer();
  const reader = new MsgReader(buffer);
  const data = reader.getFileData();
  if (data.error) {
    throw new Error(data.error);
  }
  const subject = data.subject?.trim() || "(件名なし)";
  const from = data.senderName?.trim() || data.senderEmail?.trim() || "";
  const date = formatMailDate(data.messageDeliveryTime ?? data.clientSubmitTime);
  const body = (data.body ?? "").trim();
  return { subject, from, date, body };
}

// 付箋の本文欄にそのまま入れる1つのテキストにまとめる。件名を先頭行にすることで、
// 付箋を開かず一覧を見ただけでも(あるいは折りたたんだ状態でも)何のメールか分かるようにする
export function formatMailNoteText(mail: ParsedMailFile): string {
  const headerLines = [mail.subject, [mail.from, mail.date].filter(Boolean).join("　")].filter(Boolean);
  return [...headerLines, "", mail.body].join("\n").trim();
}

// 元の.msgファイル本体をdata URLとして読み込む。付箋に「元のメールを開く」リンクを
// 添えるために保持しておく(このアプリ内でメールを解釈して開くことはできないため、
// クリックでファイルをダウンロード/OS側の既定アプリ(Outlook等)に渡す形になる)
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("ファイルの読み込みに失敗しました"));
    reader.readAsDataURL(file);
  });
}

export interface MailAttachmentFields {
  mailFileDataUrl: string;
  mailFileName: string;
  mailSubject: string;
}

// ToDo・サブタスク・案件・段階など、付箋以外の項目に「メールを添付してクリックで開く」を
// 追加する際にまとめて使う。件名を抽出しておくことで、開かなくても一覧上で
// 「どのメールか」が分かるようにする(付箋の取り込みと同じ考え方)
export async function attachMailFile(file: File): Promise<MailAttachmentFields> {
  const mail = await parseMsgFile(file);
  const mailFileDataUrl = await readFileAsDataUrl(file);
  return { mailFileDataUrl, mailFileName: file.name, mailSubject: mail.subject };
}

// 「元のメールを開く」の実体。data:URLをそのまま<a href download>のhrefに使うと、
// 環境によってはdownload属性が効かずクリックしても何も起きないことがある
// (モバイルのブラウザ・PWAとして起動している場合など)。ダウンロード自体は
// このアプリの他の書き出し(downloadTextFile)と同じくBlob URLを都度作って
// トリガーする方式にすることで確実性を上げる
export function openMailAttachment(dataUrl: string, fileName: string): void {
  const commaIdx = dataUrl.indexOf(",");
  const header = commaIdx === -1 ? "" : dataUrl.slice(0, commaIdx);
  const base64 = commaIdx === -1 ? dataUrl : dataUrl.slice(commaIdx + 1);
  const mimeMatch = /^data:([^;]+);base64$/.exec(header);
  const mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // ダウンロード開始には一瞬かかるため、すぐには失効させない
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
