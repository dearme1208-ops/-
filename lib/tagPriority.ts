// ===== 対応状況(tag)の優先度 =====
//
// 対応状況の選択肢(todo.tagPresets)は、設定タブで並び替えられるようになっており、
// その並び順自体を優先度として使う(先頭ほど優先度が高い)。サブタスク・案件の段階を
// 複数抱えるタスク/案件の対応状況を「その中で一番優先度が高いもの」に自動で揃えるために使う

/**
 * 候補の対応状況の中から、優先度順(先頭ほど高い)に照らして最も優先度の高いものを1つ選ぶ。
 * 優先度リストに載っていない対応状況(自由入力されたもの)は最も優先度が低い扱いにする。
 * 候補が空、または全て未設定ならundefined
 */
export function highestPriorityTag(
  candidateTags: (string | undefined)[],
  priorityOrder: string[]
): string | undefined {
  const present = candidateTags.filter((t): t is string => !!t);
  if (present.length === 0) return undefined;
  const rank = (t: string) => {
    const i = priorityOrder.indexOf(t);
    return i === -1 ? priorityOrder.length : i;
  };
  return present.reduce((best, t) => (rank(t) < rank(best) ? t : best));
}
