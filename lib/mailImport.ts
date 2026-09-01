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
