import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  registerMainMenuItem,
  inlineButton,
  inlineKeyboard,
  paginate,
} from "../toolkit/index.js";
import {
  getExpenses,
  getExpenseById,
  removeExpense,
  updateExpense,
  getCategoryById,
  getUser,
  ensureUser,
  formatMoney,
} from "../store.js";
import type { InlineButton } from "../toolkit/index.js";

registerMainMenuItem({ label: "📋 Recent", data: "recent:list:0", order: 30 });

const PER_PAGE = 5;

const composer = new Composer<Ctx>();

async function renderRecentList(ctx: Ctx, page: number) {
  const userId = ctx.from!.id;
  await ensureUser(userId);
  const expenses = await getExpenses(userId);
  const sorted = [...expenses].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  if (sorted.length === 0) {
    await ctx.editMessageText("No expenses yet — tap 💵 Log Expense to add one.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    });
    return;
  }

  const result = paginate(sorted, {
    page,
    perPage: PER_PAGE,
    callbackPrefix: "recent:list",
  });

  const user = await getUser(userId);
  const sym = user?.currency ?? "USD";

  const lines = result.pageItems.map((e, i) => {
    const date = new Date(e.timestamp).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    return `${i + 1}. ${formatMoney(e.amount_cents, sym)} — ${date}`;
  });

  const text = `Recent expenses (page ${result.page + 1}/${result.totalPages}):\n\n${lines.join("\n")}`;

  const actionRows = result.pageItems.map((e) => [
    inlineButton(`✏️ ${formatMoney(e.amount_cents, sym)}`, `recent:edit:${e.id}`),
    inlineButton("🗑", `recent:delete_confirm:${e.id}`),
  ]);

  const allRows: InlineButton[][] = [...actionRows];
  if (result.controls.inline_keyboard.length > 0) {
    allRows.push(result.controls.inline_keyboard[0] as InlineButton[]);
  }
  allRows.push([inlineButton("⬅️ Back to menu", "menu:main")]);

  await ctx.editMessageText(text, { reply_markup: inlineKeyboard(allRows) });
}

composer.callbackQuery(/^recent:list:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const page = parseInt(ctx.match[1], 10);
  await renderRecentList(ctx, page);
});

composer.command("recent", async (ctx) => {
  ctx.session.step = undefined;
  await ensureUser(ctx.from!.id);
  await ctx.reply("Loading recent expenses...");
  // re-render via callback
  const userId = ctx.from!.id;
  const expenses = await getExpenses(userId);
  const sorted = [...expenses].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  if (sorted.length === 0) {
    await ctx.reply("No expenses yet — tap 💵 Log Expense to add one.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    });
    return;
  }

  const result = paginate(sorted, {
    page: 0,
    perPage: PER_PAGE,
    callbackPrefix: "recent:list",
  });

  const user = await getUser(userId);
  const sym = user?.currency ?? "USD";

  const lines = result.pageItems.map((e, i) => {
    const date = new Date(e.timestamp).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    return `${i + 1}. ${formatMoney(e.amount_cents, sym)} — ${date}`;
  });

  const text = `Recent expenses (page ${result.page + 1}/${result.totalPages}):\n\n${lines.join("\n")}`;

  const actionRows = result.pageItems.map((e) => [
    inlineButton(`✏️ ${formatMoney(e.amount_cents, sym)}`, `recent:edit:${e.id}`),
    inlineButton("🗑", `recent:delete_confirm:${e.id}`),
  ]);

  const allRows: InlineButton[][] = [...actionRows];
  if (result.controls.inline_keyboard.length > 0) {
    allRows.push(result.controls.inline_keyboard[0] as InlineButton[]);
  }
  allRows.push([inlineButton("⬅️ Back to menu", "menu:main")]);

  await ctx.reply(text, { reply_markup: inlineKeyboard(allRows) });
});

composer.callbackQuery(/^recent:delete_confirm:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const expId = ctx.match[1];
  await ctx.editMessageText("Delete this expense?", {
    reply_markup: inlineKeyboard([
      [
        inlineButton("✅ Yes", `recent:delete:${expId}`),
        inlineButton("❌ No", "recent:list:0"),
      ],
    ]),
  });
});

composer.callbackQuery(/^recent:delete:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const expId = ctx.match[1];
  const userId = ctx.from!.id;
  await removeExpense(userId, expId);
  await ctx.editMessageText("Expense deleted.", {
    reply_markup: inlineKeyboard([
      [inlineButton("📋 Back to Recent", "recent:list:0")],
      [inlineButton("⬅️ Back to menu", "menu:main")],
    ]),
  });
});

composer.callbackQuery(/^recent:edit:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const expId = ctx.match[1];
  const userId = ctx.from!.id;
  const exp = await getExpenseById(userId, expId);
  if (!exp) {
    await ctx.editMessageText("Expense not found.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    });
    return;
  }

  const cat = await getCategoryById(userId, exp.category_id);
  const user = await getUser(userId);
  const sym = user?.currency ?? "USD";
  const catName = cat?.name ?? "unknown";

  ctx.session.pendingExpenseId = expId;
  ctx.session.step = "awaiting_edit_amount";

  await ctx.editMessageText(
    `Editing: ${formatMoney(exp.amount_cents, sym)} in ${catName}\n\nEnter new amount:`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Cancel", "recent:list:0")],
      ]),
    },
  );
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step === "awaiting_edit_amount") {
    const expId = ctx.session.pendingExpenseId;
    if (!expId) {
      ctx.session.step = undefined;
      return next();
    }

    const userId = ctx.from!.id;
    const text = ctx.message!.text.replace(/[^-0-9.]/g, "");
    const num = Number(text);
    if (isNaN(num) || num <= 0) {
      await ctx.reply("Please enter a valid positive amount.");
      return;
    }

    const cents = Math.round(num * 100);
    const exp = await getExpenseById(userId, expId);
    if (!exp) {
      ctx.session.step = undefined;
      ctx.session.pendingExpenseId = undefined;
      await ctx.reply("Expense not found — it may have been deleted.", {
        reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
      });
      return;
    }

    exp.amount_cents = cents;
    await updateExpense(userId, exp);

    ctx.session.step = undefined;
    ctx.session.pendingExpenseId = undefined;

    const cat = await getCategoryById(userId, exp.category_id);
    const user = await getUser(userId);
    const sym = user?.currency ?? "USD";
    const catName = cat?.name ?? "unknown";

    await ctx.reply(
      `Expense updated: ${formatMoney(cents, sym)} in ${catName}`,
      {
        reply_markup: inlineKeyboard([
          [inlineButton("📋 Back to Recent", "recent:list:0")],
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
    return;
  }

  return next();
});

export default composer;
