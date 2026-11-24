import { expect, test, type Page } from "@playwright/test";
import { jstAt, jstDate, readAll, readOne, seed } from "./helpers";

// ToDoの親子の付け替え: 登録時に親を選べる・既存のタスクをサブタスクにできる・
// 通常のタスクに戻せる・どれも「元に戻す」で戻せる(付け替えの決まり自体は lib/todo.test.ts で固定)

type Todo = { id: string; title: string; listId: string; parentTaskId?: string; myDayDate?: string; recurrence?: unknown };

const lists = [
  { id: "l1", title: "仕事", order: 0, createdAt: 0 },
  { id: "l2", title: "私用", order: 1, createdAt: 0 },
];
const base = { important: false, completed: false, createdAt: 0 };

const openList = async (page: Page, name: string) => {
  await page.locator(".tab-chip", { hasText: "ToDo" }).first().click();
  await page.getByRole("button", { name, exact: true }).first().click();
};
const toast = (page: Page, text: string) => page.locator(".toast", { hasText: text });
const findByTitle = async (page: Page, title: string) => (await readAll<Todo>(page, "todoTasks")).find((t) => t.title === title);

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
});

test("タスクを追加: 親タスクを選ぶとそのサブタスクとして入り、ほかのリストの親ならそのリストへ入る", async ({ page }) => {
  await seed(page, {
    stores: {
      todoLists: lists,
      todoTasks: [
        { ...base, id: "p", listId: "l1", title: "A社見積", order: 0 },
        { ...base, id: "q", listId: "l2", title: "引っ越し準備", order: 0 },
        { ...base, id: "done", listId: "l1", title: "A社見積(済)", order: 1, completed: true, completedAt: 1 },
      ],
    },
  });
  await openList(page, "仕事");

  await page.locator("button", { hasText: "+ タスクを追加" }).first().click();
  const form = page.locator(".modal-scrim").last();
  await form.getByPlaceholder("やることを一言で").fill("見積書を作る");
  await form.getByRole("button", { name: "親タスクを選ぶ…" }).click();

  const picker = page.getByTestId("parent-task-picker");
  await picker.getByLabel("親タスクを検索").fill("A社");
  // 完了済みは親の候補に出ない
  await expect(picker.getByRole("button", { name: /A社見積\(済\)/ })).toHaveCount(0);
  await picker.getByRole("button", { name: /A社見積/ }).click();
  await expect(picker).toHaveCount(0);

  await expect(page.getByTestId("new-task-parent")).toContainText("A社見積");
  // 親を選んでいる間は、サブタスクの下書き欄を出さない(1段まで)
  await expect(form.getByPlaceholder("手順を1行ずつ（Enterで次の行）")).toBeHidden();
  await form.locator("button", { hasText: /^追加して続ける$/ }).click();
  await expect.poll(async () => (await findByTitle(page, "見積書を作る"))?.parentTaskId).toBe("p");
  expect((await findByTitle(page, "見積書を作る"))?.listId).toBe("l1");

  // 続けて、ほかのリストの親を「全リスト」から選ぶ
  await form.getByPlaceholder("やることを一言で").fill("段ボールを買う");
  await page.getByTestId("new-task-parent").getByRole("button", { name: "変更" }).click();
  await picker.getByRole("button", { name: "全リスト", exact: true }).click();
  await picker.getByRole("button", { name: /引っ越し準備/ }).click();
  await form.locator("button", { hasText: /^追加$/ }).click();
  await expect.poll(async () => await findByTitle(page, "段ボールを買う")).toMatchObject({ parentTaskId: "q", listId: "l2" });
  // 今の画面(仕事)には出ないので、どこへ入ったかを知らせる
  await expect(toast(page, "リスト「私用」に追加しました")).toBeVisible();
});

test("既存のタスクをサブタスクにし、通常のタスクに戻し、どちらも「元に戻す」で戻せる", async ({ page }) => {
  await seed(page, {
    stores: {
      todoLists: lists,
      todoTasks: [
        { ...base, id: "p", listId: "l2", title: "A社見積", order: 0 },
        {
          ...base,
          id: "t",
          listId: "l1",
          title: "単価の確認",
          order: 0,
          myDayDate: jstDate(),
          recurrence: { type: "weekly", interval: 1, weekdays: [1] },
        },
      ],
    },
  });
  await openList(page, "仕事");
  await page.getByText("単価の確認").first().click();
  await expect(page.getByRole("heading", { name: "タスクの詳細" })).toBeVisible();

  // サブタスクにする(ほかのリストの親)
  await page.getByRole("button", { name: "サブタスクにする…" }).click();
  const picker = page.getByTestId("parent-task-picker");
  await picker.getByRole("button", { name: "全リスト", exact: true }).click();
  await picker.getByRole("button", { name: /A社見積/ }).click();
  await expect.poll(async () => await readOne<Todo>(page, "todoTasks", "t")).toMatchObject({ parentTaskId: "p", listId: "l2" });
  const asSub = await readOne<Todo>(page, "todoTasks", "t");
  expect(asSub?.recurrence).toBeUndefined();
  expect(asSub?.myDayDate).toBeUndefined();
  await expect(toast(page, "「単価の確認」を「A社見積」のサブタスクにしました")).toBeVisible();

  // 詳細は開き直され、親が出る。サブタスクの詳細では「+ サブタスクを追加」「コピーして追加」を出さない
  const parentRow = page.getByTestId("todo-detail-parent");
  await expect(parentRow).toContainText("A社見積");
  await expect(page.getByPlaceholder("+ サブタスクを追加")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "コピーして追加" })).toHaveCount(0);

  // 通常のタスクに戻す
  await parentRow.getByRole("button", { name: "通常のタスクに戻す" }).click();
  await expect.poll(async () => (await readOne<Todo>(page, "todoTasks", "t"))?.parentTaskId).toBeUndefined();
  await expect(toast(page, "「単価の確認」を通常のタスクに戻しました")).toBeVisible();
  await expect(page.getByTestId("todo-detail-parent")).toHaveCount(0);

  // 戻したのを取り消すと、またサブタスクになる
  await toast(page, "「単価の確認」を通常のタスクに戻しました").getByRole("button", { name: "元に戻す" }).click();
  await expect.poll(async () => (await readOne<Todo>(page, "todoTasks", "t"))?.parentTaskId).toBe("p");

  // サブタスクにしたのも取り消すと、元のリスト・繰り返し・マイデイに戻る
  await toast(page, "「単価の確認」を「A社見積」のサブタスクにしました").getByRole("button", { name: "元に戻す" }).click();
  await expect.poll(async () => await readOne<Todo>(page, "todoTasks", "t")).toMatchObject({
    listId: "l1",
    myDayDate: jstDate(),
    recurrence: { type: "weekly", interval: 1, weekdays: [1] },
  });
  expect((await readOne<Todo>(page, "todoTasks", "t"))?.parentTaskId).toBeUndefined();
});

test("サブタスクを持つタスクは「サブタスクにする」が押せず、理由が出る", async ({ page }) => {
  await seed(page, {
    stores: {
      todoLists: lists,
      todoTasks: [
        { ...base, id: "p", listId: "l1", title: "A社見積", order: 0 },
        { ...base, id: "s", listId: "l1", parentTaskId: "p", title: "金額の確認", order: 0 },
        { ...base, id: "o", listId: "l1", title: "B社見積", order: 1 },
      ],
    },
  });
  await openList(page, "仕事");
  await page.getByText("A社見積").first().click();
  await expect(page.getByRole("button", { name: "サブタスクにする…" })).toBeDisabled();
  await expect(page.getByText("サブタスクを持つため「サブタスクにする」は使えません")).toBeVisible();
});

test("すぐ追加の「＞親の名前の一部 件名」で、その親のサブタスクになる", async ({ page }) => {
  await seed(page, {
    stores: {
      todoLists: lists,
      todoTasks: [{ ...base, id: "p", listId: "l1", title: "A社見積", order: 0 }],
    },
  });
  await openList(page, "仕事");
  const quick = page.getByLabel("すばやく追加");
  await quick.fill("＞A社 金額を確認");
  await quick.press("Enter");
  await expect.poll(async () => (await findByTitle(page, "金額を確認"))?.parentTaskId).toBe("p");

  // 当たる親が無ければ通常のタスクとして入れ、そう知らせる
  await quick.fill("＞Z社 電話する");
  await quick.press("Enter");
  await expect(toast(page, "「Z社」に当たる親タスクがこのリストに無いため、通常のタスクとして追加しました")).toBeVisible();
  await expect.poll(async () => (await findByTitle(page, "＞Z社 電話する"))?.parentTaskId).toBeUndefined();
});
