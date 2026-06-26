import { Composer } from "grammy";
import { InputFile } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
} from "../toolkit/index.js";
import {
  getExpenses,
  getCategories,
  getBudget,
  getUser,
  getNotificationRules,
  ensureUser,
} from "../store.js";

const composer = new Composer<Ctx>();

function formatMoney(cents: number, currency: string): string {
  const sym = currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : currency + " ";
  return `${sym}${(cents / 100).toFixed(2)}`;
}

composer.command("export", async (ctx) => {
  const userId = ctx.from!.id;
  await ensureUser(userId);
  const user = await getUser(userId);
  const sym = user?.currency ?? "USD";
  const expenses = await getExpenses(userId);
  const cats = await getCategories(userId);
  const budget = await getBudget(userId);
  const rules = await getNotificationRules(userId);

  const catMap = new Map(cats.map((c) => [c.id, c.name]));
  const sorted = [...expenses].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  if (sorted.length === 0) {
    await ctx.reply("No expenses to export.");
    return;
  }

  const lines = [
    "Expense Report",
    `Currency: ${sym}`,
    `Generated: ${new Date().toISOString()}`,
    `Total entries: ${sorted.length}`,
    "",
    "Date,Amount,Category,Note",
  ];

  for (const e of sorted) {
    const catName = catMap.get(e.category_id) ?? "unknown";
    const note = e.note ? `"${e.note.replace(/"/g, '""')}"` : "";
    const amount = (e.amount_cents / 100).toFixed(2);
    const date = new Date(e.timestamp).toISOString();
    lines.push(`${date},${amount},${catName},${note}`);
  }

  lines.push("");

  if (budget.overall_cents !== null) {
    lines.push(`Overall monthly budget: ${formatMoney(budget.overall_cents, sym)}`);
  }

  for (const [catId, amount] of Object.entries(budget.per_category)) {
    const catName = catMap.get(catId) ?? catId;
    lines.push(`Budget for ${catName}: ${formatMoney(amount, sym)}`);
  }

  const csv = lines.join("\n");

  await ctx.replyWithDocument(
    new InputFile(new TextEncoder().encode(csv), "expenses.csv"),
    { caption: `Exported ${sorted.length} expenses.` },
  );
});

composer.callbackQuery("export:show", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("Use /export to download your expense data as a CSV file.");
});

export default composer;
