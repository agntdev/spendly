import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import type { Bot } from "grammy";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import {
  getUser,
  getExpenses,
  getCategories,
  getBudget,
  getNotificationRules,
  ensureUser,
  getBackend,
  formatMoney,
} from "../store.js";

const composer = new Composer<Ctx>();

function getMonthKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function getMonthBounds(now: Date, offset: number): { start: string; end: string; key: string } {
  const y = now.getFullYear();
  const m = now.getMonth() - offset;
  const d = new Date(y, m, 1);
  const sy = d.getFullYear();
  const sm = d.getMonth();
  const start = new Date(sy, sm, 1).toISOString();
  const end = new Date(sy, sm + 1, 1).toISOString();
  const key = getMonthKey(sy, sm);
  return { start, end, key };
}

async function buildRecap(userId: number): Promise<string | null> {
  const user = await getUser(userId);
  if (!user) return null;
  const sym = user.currency;
  const expenses = await getExpenses(userId);
  const cats = await getCategories(userId);
  const budget = await getBudget(userId);
  const rules = await getNotificationRules(userId);

  const now = new Date();
  const prev = getMonthBounds(now, 1);
  const beforePrev = getMonthBounds(now, 2);

  const prevExpenses = expenses.filter(
    (e) => e.timestamp >= prev.start && e.timestamp < prev.end,
  );
  const beforePrevExpenses = expenses.filter(
    (e) => e.timestamp >= beforePrev.start && e.timestamp < beforePrev.end,
  );

  const prevTotal = prevExpenses.reduce((sum, e) => sum + e.amount_cents, 0);
  const beforePrevTotal = beforePrevExpenses.reduce((sum, e) => sum + e.amount_cents, 0);

  const monthName = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const lines: string[] = [
    `\u{1F4C5} Recap: ${monthName}`,
    `Total spent: ${formatMoney(prevTotal, sym)}`,
  ];

  if (budget.overall_cents !== null && budget.overall_cents > 0) {
    const pct = Math.round((prevTotal / budget.overall_cents) * 100);
    const status =
      pct >= rules.overbudget_percent ? "\u{1F6A8}" : pct >= rules.warning_percent ? "\u26A0\uFE0F" : "\u2705";
    lines.push(`Overall budget: ${status} ${pct}% (${formatMoney(prevTotal, sym)} of ${formatMoney(budget.overall_cents, sym)})`);
  }

  if (beforePrevTotal > 0) {
    const diff = prevTotal - beforePrevTotal;
    const pctChange = ((diff / beforePrevTotal) * 100).toFixed(1);
    const arrow = diff > 0 ? "\u2191" : diff < 0 ? "\u2193" : "\u2194";
    if (diff !== 0) {
      lines.push(`${arrow} ${Math.abs(Number(pctChange))}% vs previous month (${formatMoney(beforePrevTotal, sym)})`);
    }
  }

  const byCategory: Record<string, number> = {};
  for (const e of prevExpenses) {
    byCategory[e.category_id] = (byCategory[e.category_id] || 0) + e.amount_cents;
  }

  if (Object.keys(byCategory).length > 0) {
    lines.push("");
    lines.push("By category:");
    const entries = Object.entries(byCategory).sort(([, a], [, b]) => b - a);
    for (const [catId, catTotal] of entries) {
      const cat = cats.find((c) => c.id === catId);
      const catName = cat?.name ?? "unknown";
      const catBudget = budget.per_category[catId];
      if (catBudget && catBudget > 0) {
        const pct = Math.round((catTotal / catBudget) * 100);
        const status =
          pct >= rules.overbudget_percent ? "\u{1F6A8}" : pct >= rules.warning_percent ? "\u26A0\uFE0F" : "\u2705";
        lines.push(`${status} ${catName}: ${formatMoney(catTotal, sym)} / ${formatMoney(catBudget, sym)} (${pct}%)`);
      } else {
        lines.push(`\u2022 ${catName}: ${formatMoney(catTotal, sym)}`);
      }
    }
  } else {
    lines.push("No expenses last month.");
  }

  return lines.join("\n");
}

async function getLastRecapMonth(userId: number): Promise<string | null> {
  const raw = await getBackend().get(`recap:${userId}`);
  return raw ?? null;
}

async function setLastRecapMonth(userId: number, key: string): Promise<void> {
  await getBackend().set(`recap:${userId}`, key);
}

async function checkAndSendRecap(bot: Bot<Ctx>, userId: number, force = false): Promise<void> {
  try {
    const user = await getUser(userId);
    if (!user) return;

    const now = new Date();
    const key = getMonthKey(now.getFullYear(), now.getMonth() - 1);

    if (!force) {
      const lastKey = await getLastRecapMonth(userId);
      if (lastKey === key) return;
    }

    const text = await buildRecap(userId);
    if (!text) return;

    await setLastRecapMonth(userId, key);

    await bot.api.sendMessage(userId, text, {
      reply_markup: inlineKeyboard([
        [inlineButton("\u{1F4CA} View Summary", "summary:show")],
      ]),
    });
  } catch {
    // Non-fatal: don't crash the recap loop
  }
}

async function getAllUserIds(): Promise<number[]> {
  const bk = getBackend();
  const keys = await bk.keys("user:*");
  return keys
    .map((k: string) => {
      const id = parseInt(k.replace("user:", ""), 10);
      return isNaN(id) ? null : id;
    })
    .filter((id: number | null): id is number => id !== null);
}

export function startRecapCheck(bot: Bot<Ctx>): void {
  const CHECK_INTERVAL_MS = 60 * 60 * 1000;

  setInterval(async () => {
    const userIds = await getAllUserIds();
    for (const userId of userIds) {
      await checkAndSendRecap(bot, userId);
    }
  }, CHECK_INTERVAL_MS);

  // Also run once shortly after startup
  setTimeout(async () => {
    const userIds = await getAllUserIds();
    for (const userId of userIds) {
      await checkAndSendRecap(bot, userId);
    }
  }, 10_000);
}

// Test trigger — manual recap invocation
composer.callbackQuery("recap:trigger", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from!.id;
  await ensureUser(userId);

  const text = await buildRecap(userId);
  if (!text) {
    await ctx.editMessageText("No data available for a recap yet.", {
      reply_markup: inlineKeyboard([[inlineButton("\u2B05\uFE0F Back to menu", "menu:main")]]),
    });
    return;
  }

  await ctx.editMessageText(text, {
    reply_markup: inlineKeyboard([[inlineButton("\u2B05\uFE0F Back to menu", "menu:main")]]),
  });
});

export default composer;
