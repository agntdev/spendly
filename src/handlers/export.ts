import { Composer } from "grammy";
import { InputFile } from "grammy";
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
  getUser,
  ensureUser,
  formatMoney,
} from "../store.js";

registerMainMenuItem({ label: "📤 Export", data: "export:show", order: 80 });

const composer = new Composer<Ctx>();

async function buildCsv(userId: number): Promise<{ csv: string; count: number }> {
  const user = await getUser(userId);
  const sym = user?.currency ?? "USD";
  const expenses = await getExpenses(userId);
  const cats = await getCategories(userId);
  const budget = await getBudget(userId);

  const catMap = new Map(cats.map((c) => [c.id, c.name]));
  const sorted = [...expenses].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

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
  return { csv, count: sorted.length };
}

composer.command("export", async (ctx) => {
  const userId = ctx.from!.id;
  await ensureUser(userId);
  const { csv, count } = await buildCsv(userId);
  await ctx.replyWithDocument(
    new InputFile(new TextEncoder().encode(csv), "expenses.csv"),
    { caption: `Exported ${count} expenses.` },
  );
});

composer.callbackQuery("export:show", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from!.id;
  await ensureUser(userId);
  const expenses = await getExpenses(userId);
  const count = expenses.length;

  const msg = count > 0
    ? `You have ${count} expense${count === 1 ? "" : "s"}. Download your data as a CSV file.`
    : "No expenses recorded yet. Start logging to build up your data.";

  await ctx.editMessageText(msg, {
    reply_markup: inlineKeyboard([
      [inlineButton("⬇ Download CSV", "export:download")],
      [inlineButton("⬅️ Back to menu", "menu:main")],
    ]),
  });
});

composer.callbackQuery("export:download", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from!.id;
  await ensureUser(userId);
  const { csv, count } = await buildCsv(userId);
  await ctx.replyWithDocument(
    new InputFile(new TextEncoder().encode(csv), "expenses.csv"),
    { caption: `Exported ${count} expenses.` },
  );
});

export default composer;
