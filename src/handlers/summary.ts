import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  registerMainMenuItem,
  inlineButton,
  inlineKeyboard,
} from "../toolkit/index.js";
import {
  getExpenses,
  getCategories,
  getBudget,
  getNotificationRules,
  getUser,
  ensureUser,
} from "../store.js";

registerMainMenuItem({ label: "📊 Summary", data: "summary:show", order: 40 });

const composer = new Composer<Ctx>();

function formatMoney(cents: number, currency: string): string {
  const sym = currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : currency + " ";
  return `${sym}${(cents / 100).toFixed(2)}`;
}

async function buildSummary(userId: number, monthOffset = 0): Promise<string> {
  const user = await getUser(userId);
  const sym = user?.currency ?? "USD";
  const expenses = await getExpenses(userId);
  const budget = await getBudget(userId);
  const cats = await getCategories(userId);
  const rules = await getNotificationRules(userId);

  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
  const monthStart = new Date(target.getFullYear(), target.getMonth(), 1).toISOString();
  const monthEnd = new Date(target.getFullYear(), target.getMonth() + 1, 1).toISOString();

  const monthExpenses = expenses.filter(
    (e) => e.timestamp >= monthStart && e.timestamp < monthEnd,
  );

  const monthName = target.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const total = monthExpenses.reduce((sum, e) => sum + e.amount_cents, 0);

  const lines: string[] = [
    `📊 ${monthName} Summary`,
    `Total: ${formatMoney(total, sym)}`,
  ];

  if (budget.overall_cents !== null && budget.overall_cents > 0) {
    const pct = Math.round((total / budget.overall_cents) * 100);
    const status =
      pct >= rules.overbudget_percent ? "🚨" : pct >= rules.warning_percent ? "⚠️" : "✅";
    lines.push(`Overall budget: ${status} ${pct}% (${formatMoney(total, sym)} of ${formatMoney(budget.overall_cents, sym)})`);
    lines.push("");
  }

  const byCategory: Record<string, number> = {};
  for (const e of monthExpenses) {
    byCategory[e.category_id] = (byCategory[e.category_id] || 0) + e.amount_cents;
  }

  if (Object.keys(byCategory).length > 0) {
    lines.push("By category:");
    const entries = Object.entries(byCategory).sort(([, a], [, b]) => b - a);
    for (const [catId, catTotal] of entries) {
      const cat = cats.find((c) => c.id === catId);
      const catName = cat?.name ?? "unknown";
      const catBudget = budget.per_category[catId];
      if (catBudget && catBudget > 0) {
        const pct = Math.round((catTotal / catBudget) * 100);
        const status =
          pct >= rules.overbudget_percent ? "🚨" : pct >= rules.warning_percent ? "⚠️" : "✅";
        lines.push(`${status} ${catName}: ${formatMoney(catTotal, sym)} / ${formatMoney(catBudget, sym)} (${pct}%)`);
      } else {
        lines.push(`• ${catName}: ${formatMoney(catTotal, sym)}`);
      }
    }
  } else {
    lines.push("No expenses this month.");
  }

  return lines.join("\n");
}

composer.callbackQuery("summary:show", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ensureUser(ctx.from!.id);
  const text = await buildSummary(ctx.from!.id);
  await ctx.editMessageText(text, {
    reply_markup: inlineKeyboard([
      [inlineButton("⬅️ Back to menu", "menu:main")],
    ]),
  });
});

composer.command("summary", async (ctx) => {
  await ensureUser(ctx.from!.id);
  const text = await buildSummary(ctx.from!.id);
  await ctx.reply(text);
});

export default composer;
