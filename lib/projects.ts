import { db, uid } from "./db";
import type { ProjectItem, ProjectStage, WorkRecord } from "./types";
import type { ParsedProjectRow, ParsedProjectStage } from "./projectsCsv";

// 実績がこの案件に属するか。主案件(projectId)だけでなく、兼務・並行作業向けの
// 追加の案件タグ(secondaryProjectIds)も一致とみなす(集計・レポート用)
export function recordBelongsToProject(record: WorkRecord, projectId: string): boolean {
  return record.projectId === projectId || (record.secondaryProjectIds?.includes(projectId) ?? false);
}

// 案件のマッチングキー。期日は先方で動くことがあるためキーに含めず、
// 件名・詳細作業名の組み合わせで同一案件とみなす
function matchKey(title: string, workName: string): string {
  return `${title}::${workName}`;
}

// CSVで指定された段階リストを既存の段階とタイトルでマッチングし、タイトル・期日・目標件数だけを
// 更新する。既存に無いタイトルは新規段階として追加する。CSVの段階リストが未定義の行は
// この関数を呼ばず、既存の段階に一切触れない。
//
// CSVに載らない情報(完了状態・完了時刻・添付画像・添付メール・対応状況・参考時間など)は
// 既存の段階をそのまま土台にして引き継ぐ。以前は引き継ぐ項目を1つずつ並べていたため、
// 後から増えた項目(添付メール・参考時間・対応状況の変更時刻)が取り込みのたびに消えていた。
//
// CSVに書かれていない既存の段階も消さない(CSVに書かれた段階の後ろに、元の並びのまま残す)。
// CSVは「この段階をこう直す」という指定であって、書かなかった段階を消す指定ではない。
// Excelで一部の段階だけ書き直して取り込むと、残りの段階が完了記録・添付ごと消えていた
function mergeStages(existingStages: ProjectStage[] | undefined, csvStages: ParsedProjectStage[]): ProjectStage[] {
  const existingList = existingStages ?? [];
  const usedIds = new Set<string>();
  const merged = csvStages.map((s): ProjectStage => {
    // 同じタイトルの段階が複数ある場合は、まだ対応付けていないものを上から順に当てる
    const existing = existingList.find((e) => e.title === s.title && !usedIds.has(e.id));
    if (existing) usedIds.add(existing.id);
    return {
      ...(existing ?? { id: uid(), completed: false }),
      title: s.title,
      dueDate: s.dueDate,
      targetCount: s.targetCount,
    };
  });
  return [...merged, ...existingList.filter((e) => !usedIds.has(e.id))];
}

export async function upsertProjectsFromCsv(
  rows: ParsedProjectRow[]
): Promise<{ created: number; updated: number; autoCompleted: number; autoCompletedTitles: string[] }> {
  let created = 0;
  let updated = 0;
  let autoCompleted = 0;
  // 自動で完了にした案件の件名。件数だけでは「どれが勝手に完了になったか」が分からず、
  // 気付かないまま一覧から消えていたため、呼び出し側で名前を出せるように返す
  const autoCompletedTitles: string[] = [];
  const now = Date.now();
  const touchedKeys = new Set<string>();

  await db.transaction("rw", db.projects, async () => {
    for (const row of rows) {
      touchedKeys.add(matchKey(row.title, row.workName));

      let existingById: ProjectItem | undefined;
      if (row.id) {
        existingById = await db.projects.get(row.id);
      }
      const existingByKey = existingById
        ? undefined
        : await db.projects
            .filter((p) => p.title === row.title && p.workName === row.workName)
            .first();
      const existing = existingById ?? existingByKey;

      const createdAt = row.createdDate
        ? new Date(row.createdDate + "T00:00:00").getTime()
        : (existing?.createdAt ?? now);
      // completedがfalseの行でも、こちら側で既に完了扱いにしているものを未完了へ巻き戻しはしない
      const completedAt = row.completed ? (existing?.completedAt ?? now) : existing?.completedAt;

      if (existing) {
        await db.projects.update(existing.id, {
          title: row.title,
          category: row.category,
          workName: row.workName,
          dueDate: row.dueDate,
          createdAt,
          completedAt,
          // idで一致した行は、このアプリが書き出したCSVを取り込み直したもの。手動で作った案件に
          // までfromImportを立てると、次に一部の行だけのCSVを取り込んだとき「取り込みに無い」と
          // みなされて勝手に完了にされてしまうため、元から立っていた場合だけそのままにする。
          // 件名・詳細作業名で一致した行(別アプリのCSV)は従来どおりインポート由来として扱う
          ...(existingById ? {} : { fromImport: true }),
          // groupNameが未定義(CSVにgroup列自体が無い)の行では、既存のグループ名に触れない
          ...(row.groupName !== undefined ? { groupName: row.groupName || undefined } : {}),
          ...(row.stages ? { stages: mergeStages(existing.stages, row.stages) } : {}),
        });
        updated++;
      } else {
        const item: ProjectItem = {
          id: row.id || uid(),
          title: row.title,
          groupName: row.groupName || undefined,
          category: row.category,
          workName: row.workName,
          dueDate: row.dueDate,
          createdAt,
          completedAt,
          fromImport: true,
          ...(row.stages && row.stages.length > 0 ? { stages: mergeStages(undefined, row.stages) } : {}),
        };
        await db.projects.add(item);
        created++;
      }
    }

    // インポート由来（fromImport）で、かつ今回のインポートに件名・詳細作業名の組み合わせが
    // 見当たらなかった未完了案件は、元アプリ側で完了・削除されたとみなし自動的に完了にする。
    // 手動登録やToDoタブから反映した案件（fromImportが立っていない）はここでは一切触らない
    const importOriginOpen = await db.projects.filter((p) => !!p.fromImport && !p.completedAt).toArray();
    for (const p of importOriginOpen) {
      if (!touchedKeys.has(matchKey(p.title, p.workName))) {
        await db.projects.update(p.id, { completedAt: now, autoCompletedByImport: true });
        autoCompleted++;
        autoCompletedTitles.push(p.title);
      }
    }
  });

  return { created, updated, autoCompleted, autoCompletedTitles };
}
