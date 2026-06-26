import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  registerMainMenuItem,
  inlineButton,
  inlineKeyboard,
} from "../toolkit/index.js";
import {
  getUser,
  getCategories,
  addCategory,
  addExpense,
  generateId,
  incrementCategoryUsage,
  getBudget,
  getNotificationRules,
  ensureUser,
  formatMoney,
} from "../store.js";

registerMainMenuItem({ label: "💵 Log Expense", data: "quick:log", order: 10 });

const composer = new Composer<Ctx>();

function amountInCents(text: string): number | null {
  const cleaned = text.replace(/[^-0-9.]/g, "");
  const num = Number(cleaned);
  if (isNaN(num) || num <= 0) return null;
  return Math.round(num * 100);
}

function getUserMonthBounds(timezone: string): { start: string } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
  });
  const [year, month] = fmt.format(now).split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1)).toISOString();
  return { start };
}

async function checkBudgetWarnings(ctx: Ctx, userId: number, addedAmountCents: number, addedCategoryId: string) {
  const budget = await getBudget(userId);
  const rules = await getNotificationRules(userId);
  const expenses = await import("../store.js").then((m) => m.getExpenses(userId));
  const user = await getUser(userId);
  if (!user) return;

  const { start: monthStart } = getUserMonthBounds(user.timezone ?? "UTC");
  const monthExpenses = expenses.filter((e) => e.timestamp >= monthStart);
  const monthTotal = monthExpenses.reduce((sum, e) => sum + e.amount_cents, 0);

  const msgs: string[] = [];

  if (budget.overall_cents !== null && budget.overall_cents > 0) {
    const ratio = monthTotal / budget.overall_cents;
    if (ratio >= rules.overbudget_percent / 100) {
      msgs.push(`🚨 Overall budget EXCEEDED: ${formatMoney(monthTotal, user.currency)} of ${formatMoney(budget.overall_cents, user.currency)}`);
    } else if (ratio >= rules.warning_percent / 100) {
      msgs.push(`⚠️ Overall budget at ${Math.round(ratio * 100)}%: ${formatMoney(monthTotal, user.currency)} of ${formatMoney(budget.overall_cents, user.currency)}`);
    }
  }

  if (addedCategoryId && budget.per_category[addedCategoryId]) {
    const catBudget = budget.per_category[addedCategoryId];
    if (catBudget > 0) {
      const catTotal = monthExpenses
        .filter((e) => e.category_id === addedCategoryId)
        .reduce((sum, e) => sum + e.amount_cents, 0);
      const ratio = catTotal / catBudget;
      const cat = await import("../store.js").then((m) => m.getCategoryById(userId, addedCategoryId));
      if (ratio >= rules.overbudget_percent / 100) {
        msgs.push(`🚨 Category "${cat?.name ?? "unknown"}" budget EXCEEDED: ${formatMoney(catTotal, user.currency)} of ${formatMoney(catBudget, user.currency)}`);
      } else if (ratio >= rules.warning_percent / 100) {
        msgs.push(`⚠️ Category "${cat?.name ?? "unknown"}" at ${Math.round(ratio * 100)}%: ${formatMoney(catTotal, user.currency)} of ${formatMoney(catBudget, user.currency)}`);
      }
    }
  }

  if (msgs.length > 0) {
    await ctx.reply(msgs.join("\n"), {
      reply_markup: inlineKeyboard([
        [inlineButton("📊 View Summary", "summary:show")],
      ]),
    });
  }
}

composer.callbackQuery("quick:log", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ensureUser(ctx.from!.id);
  ctx.session.step = "awaiting_amount";
  ctx.session.pendingCategoryId = undefined;
  ctx.session.pendingExpenseId = undefined;
  await ctx.editMessageText("Enter the expense amount:", {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
  });
});

const QUICK_CATEGORIES_BUTTONS = 6;
composer.callbackQuery(/^quick:category:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const categoryId = ctx.match[1];
  ctx.session.step = "awaiting_amount";
  ctx.session.pendingCategoryId = categoryId;
  ctx.session.pendingExpenseId = undefined;

  const cat = await import("../store.js").then((m) => m.getCategoryById(ctx.from!.id, categoryId));
  const catName = cat?.name ?? "unknown";
  await ctx.editMessageText(`Enter the amount for ${catName}:`, {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
  });
});

composer.callbackQuery("quick:categories", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ensureUser(ctx.from!.id);
  const userId = ctx.from!.id;
  const cats = await getCategories(userId);
  const sorted = [...cats].sort((a, b) => b.usage_count - a.usage_count);
  const top = sorted.slice(0, QUICK_CATEGORIES_BUTTONS);

  if (top.length === 0) {
    await ctx.editMessageText("No categories yet. Add one first.", {
      reply_markup: inlineKeyboard([
        [inlineButton("➕ Add Category", "cat:add_prompt")],
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    });
    return;
  }

  const rows = top.map((c) => [inlineButton(`${c.name}`, `quick:category:${c.id}`)]);
  rows.push([inlineButton("⬅️ Back to menu", "menu:main")]);
  await ctx.editMessageText("Pick a category:", {
    reply_markup: inlineKeyboard(rows),
  });
});

composer.command("add", async (ctx) => {
  const userId = ctx.from!.id;
  await ensureUser(userId);
  const text = ctx.message?.text?.replace(/^\/add\s*/, "") ?? "";

  if (!text.trim()) {
    const cats = await getCategories(userId);
    const sorted = [...cats].sort((a, b) => b.usage_count - a.usage_count);
    const top = sorted.slice(0, QUICK_CATEGORIES_BUTTONS);
    if (top.length === 0) {
      await ctx.reply("No categories yet. Add one first.", {
        reply_markup: inlineKeyboard([
          [inlineButton("➕ Add Category", "cat:add_prompt")],
        ]),
      });
      return;
    }
    const rows = top.map((c) => [inlineButton(`${c.name}`, `quick:category:${c.id}`)]);
    await ctx.reply("Pick a category:", { reply_markup: inlineKeyboard(rows) });
    return;
  }

  const parts = text.split(/\s+/);
  const amountStr = parts[0];
  const cents = amountInCents(amountStr);
  if (cents === null) {
    await ctx.reply("Please enter a valid positive amount, like:\n/add 12.50 Food");
    return;
  }

  const categoryName = parts.slice(1).join(" ");
  if (!categoryName) {
    const cats = await getCategories(userId);
    ctx.session.step = "awaiting_add_category_select";
    ctx.session.pendingExpenseId = undefined;
    ctx.session.lastExpenseAmount_cents = cents;
    const sorted = [...cats].sort((a, b) => b.usage_count - a.usage_count);
    const top = sorted.slice(0, QUICK_CATEGORIES_BUTTONS);
    if (top.length === 0) {
      await ctx.reply("No categories yet. Add one first.", {
        reply_markup: inlineKeyboard([
          [inlineButton("➕ Add Category", "cat:add_prompt")],
        ]),
      });
      return;
    }
    const rows = top.map((c) => [inlineButton(`${c.name}`, `quick:add_amount:${c.id}`)]);
    await ctx.reply("Pick a category:", { reply_markup: inlineKeyboard(rows) });
    return;
  }

  const cats = await getCategories(userId);
  const words = categoryName.split(/\s+/);
  let cat: typeof cats[0] | null = null;
  let note: string | undefined;

  for (let i = words.length; i >= 1; i--) {
    const candidate = words.slice(0, i).join(" ");
    const match = cats.find((c) => c.name.toLowerCase() === candidate.toLowerCase());
    if (match) {
      cat = match;
      const rest = words.slice(i).join(" ").trim();
      note = rest.length > 0 ? rest : undefined;
      break;
    }
  }

  if (!cat) {
    cat = {
      id: await generateId(),
      user_id: userId,
      name: categoryName,
      created_at: new Date().toISOString(),
      usage_count: 0,
    };
    await addCategory(userId, cat);
  }

  const expense = {
    id: await generateId(),
    user_id: userId,
    timestamp: new Date().toISOString(),
    amount_cents: cents,
    category_id: cat.id,
    note,
  };
  await addExpense(userId, expense);
  await incrementCategoryUsage(userId, cat.id);

  ctx.session.lastExpenseId = expense.id;
  ctx.session.lastExpenseAmount_cents = cents;

  const user = await getUser(userId);
  const sym = user?.currency ?? "USD";

  await ctx.reply(
    `Expense logged: ${formatMoney(cents, sym)} in ${cat.name}`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("↩ Undo", `quick:undo:${expense.id}`)],
      ]),
    },
  );

  await checkBudgetWarnings(ctx, userId, cents, cat.id);

  setTimeout(async () => {
    const exp = await import("../store.js").then((m) => m.getExpenseById(userId, expense.id));
    if (exp) {
      try {
        await ctx.reply("⏰ Undo time expired.", { reply_to_message_id: ctx.msg?.message_id });
      } catch { /* ignore */ }
    }
  }, 30_000);
});

composer.callbackQuery(/^quick:add_amount:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const catId = ctx.match[1];
  const userId = ctx.from!.id;
  const cents = ctx.session.lastExpenseAmount_cents;
  if (!cents) {
    await ctx.editMessageText("Session expired. Try /add again.");
    return;
  }

  const cat = await import("../store.js").then((m) => m.getCategoryById(userId, catId));
  if (!cat) {
    await ctx.editMessageText("Category not found.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    });
    return;
  }

  const note = ctx.session.pendingNote;
  ctx.session.pendingNote = undefined;

  const expense = {
    id: await generateId(),
    user_id: userId,
    timestamp: new Date().toISOString(),
    amount_cents: cents,
    category_id: cat.id,
    note,
  };
  await addExpense(userId, expense);
  await incrementCategoryUsage(userId, cat.id);

  ctx.session.lastExpenseId = expense.id;

  const user = await getUser(userId);
  const sym = user?.currency ?? "USD";

  await ctx.editMessageText(
    `Expense logged: ${formatMoney(cents, sym)} in ${cat.name}`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("↩ Undo", `quick:undo:${expense.id}`)],
      ]),
    },
  );

  await checkBudgetWarnings(ctx, userId, cents, cat.id);

  setTimeout(async () => {
    const exp = await import("../store.js").then((m) => m.getExpenseById(userId, expense.id));
    if (exp) {
      try {
        await ctx.reply("⏰ Undo time expired.", { reply_to_message_id: ctx.msg?.message_id });
      } catch { /* ignore */ }
    }
  }, 30_000);
});

composer.callbackQuery(/^quick:undo:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const expenseId = ctx.match[1];
  const userId = ctx.from!.id;
  const exp = await import("../store.js").then((m) => m.getExpenseById(userId, expenseId));
  if (!exp) {
    await ctx.editMessageText("Already undone or expense not found.");
    return;
  }
  await import("../store.js").then((m) => m.removeExpense(userId, expenseId));
  ctx.session.lastExpenseId = undefined;
  await ctx.editMessageText("Expense undone.");
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step === "awaiting_amount") {
    const userId = ctx.from!.id;
    const cents = amountInCents(ctx.message!.text);
    if (cents === null) {
      await ctx.reply("Please enter a valid positive amount (e.g. 12.50).");
      return;
    }

    ctx.session.lastExpenseAmount_cents = cents;
    ctx.session.step = "awaiting_note";

    await ctx.reply("Add a note? (send text or tap Skip)", {
      reply_markup: inlineKeyboard([[inlineButton("Skip", "quick:skip_note")]]),
    });
    return;
  }

  if (ctx.session.step === "awaiting_note") {
    const noteText = ctx.message!.text.trim();
    const note = noteText.length > 0 ? noteText : undefined;
    ctx.session.pendingNote = note;
    ctx.session.step = undefined;

    const userId = ctx.from!.id;
    const cents = ctx.session.lastExpenseAmount_cents;
    if (!cents) {
      ctx.session.pendingNote = undefined;
      await ctx.reply("Session expired. Try /add again.");
      return;
    }

    const categoryId = ctx.session.pendingCategoryId;
    if (categoryId) {
      const cat = await import("../store.js").then((m) => m.getCategoryById(userId, categoryId));
      if (!cat) {
        await ctx.reply("Category not found. Please start again.", {
          reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
        });
        ctx.session.step = undefined;
        ctx.session.pendingCategoryId = undefined;
        ctx.session.pendingNote = undefined;
        return;
      }

      const expense = {
        id: await generateId(),
        user_id: userId,
        timestamp: new Date().toISOString(),
        amount_cents: cents,
        category_id: cat.id,
        note: ctx.session.pendingNote,
      };
      await addExpense(userId, expense);
      await incrementCategoryUsage(userId, cat.id);
      ctx.session.lastExpenseId = expense.id;
      ctx.session.pendingCategoryId = undefined;
      ctx.session.pendingNote = undefined;

      const user = await getUser(userId);
      const sym = user?.currency ?? "USD";

      await ctx.reply(
        `Expense logged: ${formatMoney(cents, sym)} in ${cat.name}`,
        {
          reply_markup: inlineKeyboard([
            [inlineButton("↩ Undo", `quick:undo:${expense.id}`)],
          ]),
        },
      );

      await checkBudgetWarnings(ctx, userId, cents, cat.id);

      setTimeout(async () => {
        const exp2 = await import("../store.js").then((m) => m.getExpenseById(userId, expense.id));
        if (exp2) {
          try {
            await ctx.reply("⏰ Undo time expired.", { reply_to_message_id: ctx.msg?.message_id });
          } catch { /* ignore */ }
        }
      }, 30_000);

      return;
    }

    const cats = await getCategories(userId);
    const sorted = [...cats].sort((a, b) => b.usage_count - a.usage_count);
    const top = sorted.slice(0, QUICK_CATEGORIES_BUTTONS);

    if (top.length === 0) {
      await ctx.reply("No categories yet. Add one first.", {
        reply_markup: inlineKeyboard([
          [inlineButton("➕ Add Category", "cat:add_prompt")],
        ]),
      });
      ctx.session.step = undefined;
      ctx.session.pendingNote = undefined;
      return;
    }

    const rows = top.map((c) => [inlineButton(`${c.name}`, `quick:add_amount:${c.id}`)]);
    rows.push([inlineButton("⬅️ Cancel", "menu:main")]);
    const u = await getUser(ctx.from!.id);
    const sym = u?.currency ?? "USD";
    await ctx.reply(`Amount: ${formatMoney(cents, sym)}. Pick a category:`, {
      reply_markup: inlineKeyboard(rows),
    });
    return;
  }

  if (ctx.session.step === "awaiting_add_category_select") {
    const cats = await getCategories(ctx.from!.id);
    const name = ctx.message!.text.trim();
    let cat = cats.find((c) => c.name.toLowerCase() === name.toLowerCase());
    const cents = ctx.session.lastExpenseAmount_cents;
    if (!cents) {
      await ctx.reply("Session expired. Try /add again.");
      return;
    }
    const note = ctx.session.pendingNote;
    ctx.session.step = undefined;
    ctx.session.pendingNote = undefined;

    if (cat) {
      const expense = {
        id: await generateId(),
        user_id: ctx.from!.id,
        timestamp: new Date().toISOString(),
        amount_cents: cents,
        category_id: cat.id,
        note,
      };
      await addExpense(ctx.from!.id, expense);
      await incrementCategoryUsage(ctx.from!.id, cat.id);
      ctx.session.lastExpenseId = expense.id;
      const user = await getUser(ctx.from!.id);
      const sym = user?.currency ?? "USD";
      await ctx.reply(
        `Expense logged: ${formatMoney(cents, sym)} in ${cat.name}`,
        {
          reply_markup: inlineKeyboard([
            [inlineButton("↩ Undo", `quick:undo:${expense.id}`)],
          ]),
        },
      );
      await checkBudgetWarnings(ctx, ctx.from!.id, cents, cat.id);
      setTimeout(async () => {
        const exp2 = await import("../store.js").then((m) => m.getExpenseById(ctx.from!.id, expense.id));
        if (exp2) {
          try { await ctx.reply("⏰ Undo time expired.", { reply_to_message_id: ctx.msg?.message_id }); } catch { /* ignore */ }
        }
      }, 30_000);
      return;
    }

    cat = {
      id: await generateId(),
      user_id: ctx.from!.id,
      name: name,
      created_at: new Date().toISOString(),
      usage_count: 1,
    };
    await addCategory(ctx.from!.id, cat);
    const expense = {
      id: await generateId(),
      user_id: ctx.from!.id,
      timestamp: new Date().toISOString(),
      amount_cents: cents,
      category_id: cat.id,
      note,
    };
    await addExpense(ctx.from!.id, expense);
    ctx.session.lastExpenseId = expense.id;
    const user = await getUser(ctx.from!.id);
    const sym = user?.currency ?? "USD";
    await ctx.reply(
      `New category "${cat.name}" created.\nExpense logged: ${formatMoney(cents, sym)}`,
      {
        reply_markup: inlineKeyboard([
          [inlineButton("↩ Undo", `quick:undo:${expense.id}`)],
        ]),
      },
    );
    await checkBudgetWarnings(ctx, ctx.from!.id, cents, cat.id);
    setTimeout(async () => {
      const exp2 = await import("../store.js").then((m) => m.getExpenseById(ctx.from!.id, expense.id));
      if (exp2) {
        try { await ctx.reply("⏰ Undo time expired.", { reply_to_message_id: ctx.msg?.message_id }); } catch { /* ignore */ }
      }
    }, 30_000);
    return;
  }

  return next();
});

composer.callbackQuery("quick:skip_note", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.pendingNote = undefined;
  ctx.session.step = undefined;

  const userId = ctx.from!.id;
  const cents = ctx.session.lastExpenseAmount_cents;
  if (!cents) {
    await ctx.editMessageText("Session expired. Try /add again.");
    return;
  }

  const categoryId = ctx.session.pendingCategoryId;
  if (categoryId) {
    const cat = await import("../store.js").then((m) => m.getCategoryById(userId, categoryId));
    if (!cat) {
      await ctx.editMessageText("Category not found. Please start again.", {
        reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
      });
      ctx.session.pendingCategoryId = undefined;
      return;
    }

    const expense = {
      id: await generateId(),
      user_id: userId,
      timestamp: new Date().toISOString(),
      amount_cents: cents,
      category_id: cat.id,
    };
    await addExpense(userId, expense);
    await incrementCategoryUsage(userId, cat.id);
    ctx.session.lastExpenseId = expense.id;
    ctx.session.lastExpenseAmount_cents = cents;
    ctx.session.pendingCategoryId = undefined;

    const user = await getUser(userId);
    const sym = user?.currency ?? "USD";

    await ctx.editMessageText(
      `Expense logged: ${formatMoney(cents, sym)} in ${cat.name}`,
      {
        reply_markup: inlineKeyboard([
          [inlineButton("↩ Undo", `quick:undo:${expense.id}`)],
        ]),
      },
    );

    await checkBudgetWarnings(ctx, userId, cents, cat.id);

    setTimeout(async () => {
      const exp2 = await import("../store.js").then((m) => m.getExpenseById(userId, expense.id));
      if (exp2) {
        try {
          await ctx.reply("⏰ Undo time expired.", { reply_to_message_id: ctx.msg?.message_id });
        } catch { /* ignore */ }
      }
    }, 30_000);

    return;
  }

  const cats = await getCategories(userId);
  const sorted = [...cats].sort((a, b) => b.usage_count - a.usage_count);
  const top = sorted.slice(0, QUICK_CATEGORIES_BUTTONS);

  if (top.length === 0) {
    await ctx.editMessageText("No categories yet. Add one first.", {
      reply_markup: inlineKeyboard([
        [inlineButton("➕ Add Category", "cat:add_prompt")],
      ]),
    });
    return;
  }

  const rows = top.map((c) => [inlineButton(`${c.name}`, `quick:add_amount:${c.id}`)]);
  rows.push([inlineButton("⬅️ Cancel", "menu:main")]);
  const u = await getUser(userId);
  const sym = u?.currency ?? "USD";
  await ctx.editMessageText(`Amount: ${formatMoney(cents, sym)}. Pick a category:`, {
    reply_markup: inlineKeyboard(rows),
  });
});

export default composer;
