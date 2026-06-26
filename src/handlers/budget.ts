import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  registerMainMenuItem,
  inlineButton,
  inlineKeyboard,
} from "../toolkit/index.js";
import {
  getBudget,
  saveBudget,
  getCategories,
  getCategoryById,
  getUser,
  ensureUser,
  formatMoney,
} from "../store.js";

registerMainMenuItem({ label: "🎯 Budget", data: "budget:menu", order: 50 });

const composer = new Composer<Ctx>();

function centsFromText(text: string): number | null {
  const cleaned = text.replace(/[^-0-9.]/g, "");
  const num = Number(cleaned);
  if (isNaN(num) || num < 0) return null;
  return Math.round(num * 100);
}

composer.callbackQuery("budget:menu", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ensureUser(ctx.from!.id);
  const userId = ctx.from!.id;
  const budget = await getBudget(userId);
  const cats = await getCategories(userId);
  const user = await getUser(userId);
  const sym = user?.currency ?? "USD";

  const lines = ["🎯 Budget Settings"];
  if (budget.overall_cents !== null) {
    lines.push(`Overall: ${formatMoney(budget.overall_cents, sym)}`);
  } else {
    lines.push("Overall: not set");
  }

  for (const [catId, amount] of Object.entries(budget.per_category)) {
    const cat = cats.find((c) => c.id === catId);
    lines.push(`${cat?.name ?? catId}: ${formatMoney(amount, sym)}`);
  }

  await ctx.editMessageText(lines.join("\n"), {
    reply_markup: inlineKeyboard([
      [inlineButton("💰 Set Overall", "budget:set_overall")],
      [inlineButton("📂 Set per Category", "budget:set_category_select")],
      [inlineButton("⬅️ Back to menu", "menu:main")],
    ]),
  });
});

composer.callbackQuery("budget:set_overall", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "awaiting_budget_amount";
  ctx.session.pendingBudgetType = "overall";
  await ctx.editMessageText("Enter your overall monthly budget amount (e.g. 1000):", {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Cancel", "budget:menu")]]),
  });
});

composer.callbackQuery("budget:set_category_select", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from!.id;
  const cats = await getCategories(userId);

  if (cats.length === 0) {
    await ctx.editMessageText("No categories yet. Add one first.", {
      reply_markup: inlineKeyboard([
        [inlineButton("➕ Add Category", "cat:add_prompt")],
        [inlineButton("⬅️ Back", "budget:menu")],
      ]),
    });
    return;
  }

  const rows = cats.map((c) => [inlineButton(c.name, `budget:set_category:${c.id}`)]);
  rows.push([inlineButton("⬅️ Back", "budget:menu")]);
  await ctx.editMessageText("Pick a category to set budget for:", {
    reply_markup: inlineKeyboard(rows),
  });
});

composer.callbackQuery(/^budget:set_category:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const catId = ctx.match[1];
  const userId = ctx.from!.id;
  const cat = await getCategoryById(userId, catId);
  if (!cat) {
    await ctx.editMessageText("Category not found.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back", "budget:menu")]]),
    });
    return;
  }
  ctx.session.step = "awaiting_budget_amount";
  ctx.session.pendingBudgetType = "category";
  ctx.session.pendingBudgetCategoryId = catId;
  await ctx.editMessageText(`Enter monthly budget for "${cat.name}" (e.g. 300):`, {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Cancel", "budget:menu")]]),
  });
});

composer.command("setbudget", async (ctx) => {
  const text = ctx.message?.text?.replace(/^\/setbudget\s*/, "") ?? "";
  const userId = ctx.from!.id;
  await ensureUser(userId);

  if (!text.trim()) {
    const budget = await getBudget(userId);
    const user = await getUser(userId);
    const sym = user?.currency ?? "USD";
    const lines = ["🎯 Budget Settings"];
    if (budget.overall_cents !== null) {
      lines.push(`Overall: ${formatMoney(budget.overall_cents, sym)}`);
    } else {
      lines.push("Overall: not set");
    }
    lines.push("Tap a button to set or update a budget:");
    await ctx.reply(lines.join("\n"), {
      reply_markup: inlineKeyboard([
        [inlineButton("💰 Set Overall", "budget:set_overall")],
        [inlineButton("📂 Set per Category", "budget:set_category_select")],
      ]),
    });
    return;
  }

  const parts = text.split(/\s+/);
  const amountStr = parts[0];
  const cents = centsFromText(amountStr);
  if (cents === null) {
    await ctx.reply("Please enter a valid non-negative amount, like:\n/setbudget 1000 or /setbudget 300 Food");
    return;
  }

  const categoryName = parts.slice(1).join(" ").trim();

  if (categoryName) {
    const cats = await getCategories(userId);
    const cat = cats.find((c) => c.name.toLowerCase() === categoryName.toLowerCase());
    if (!cat) {
      await ctx.reply(`Category "${categoryName}" not found. Create it first via the Categories menu.`);
      return;
    }

    const budget = await getBudget(userId);
    budget.per_category[cat.id] = cents;
    await saveBudget(budget);

    const user = await getUser(userId);
    const sym = user?.currency ?? "USD";
    await ctx.reply(`Budget for "${cat.name}" set to ${formatMoney(cents, sym)}.`);
    return;
  }

  const budget = await getBudget(userId);
  budget.overall_cents = cents;
  await saveBudget(budget);

  const user = await getUser(userId);
  const sym = user?.currency ?? "USD";
  await ctx.reply(`Overall monthly budget set to ${formatMoney(cents, sym)}.`);
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step === "awaiting_budget_amount") {
    const cents = centsFromText(ctx.message!.text);
    if (cents === null) {
      await ctx.reply("Please enter a valid non-negative amount (e.g. 500).");
      return;
    }

    const userId = ctx.from!.id;
    const budget = await getBudget(userId);
    const user = await getUser(userId);
    const sym = user?.currency ?? "USD";

    if (ctx.session.pendingBudgetType === "overall") {
      budget.overall_cents = cents;
      await saveBudget(budget);
      ctx.session.step = undefined;
      ctx.session.pendingBudgetType = undefined;
      await ctx.reply(`Overall monthly budget set to ${formatMoney(cents, sym)}.`, {
        reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
      });
      return;
    }

    if (ctx.session.pendingBudgetType === "category" && ctx.session.pendingBudgetCategoryId) {
      const catId = ctx.session.pendingBudgetCategoryId;
      const cat = await getCategoryById(userId, catId);
      if (!cat) {
        ctx.session.step = undefined;
        ctx.session.pendingBudgetType = undefined;
        ctx.session.pendingBudgetCategoryId = undefined;
        await ctx.reply("Category not found.", {
          reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
        });
        return;
      }

      budget.per_category[catId] = cents;
      await saveBudget(budget);
      ctx.session.step = undefined;
      ctx.session.pendingBudgetType = undefined;
      ctx.session.pendingBudgetCategoryId = undefined;
      await ctx.reply(
        `Budget for "${cat.name}" set to ${formatMoney(cents, sym)}.`,
        {
          reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
        },
      );
      return;
    }

    ctx.session.step = undefined;
    return next();
  }

  return next();
});

export default composer;
