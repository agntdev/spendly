import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { mainMenuKeyboard, inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { getUser, saveUser, getCategories, addCategory, generateId } from "../store.js";

// The /start handler renders the bot's MAIN MENU — the primary way users operate
// a button-first bot. A feature adds its own button by calling
// `registerMainMenuItem(...)` in its own `src/handlers/<slug>.ts`; this handler
// renders whatever is registered (plus a Help button), so you do NOT edit this
// file to add a feature. Send ONE message — no placeholder line above the menu.
const composer = new Composer<Ctx>();

const WELCOME = "👋 Welcome! Tap a button below to get started.";

async function ensureOnboarded(ctx: Ctx): Promise<boolean> {
  const userId = ctx.from!.id;
  const user = await getUser(userId);
  if (user) return true;
  return false;
}

composer.command("start", async (ctx) => {
  const onboarded = await ensureOnboarded(ctx);
  if (onboarded) {
    await ctx.reply(WELCOME, { reply_markup: mainMenuKeyboard() });
  } else {
    ctx.session.step = "awaiting_currency";
    await ctx.reply("👋 Welcome to Expense Tracker!\n\nFirst, select your currency:", {
      reply_markup: inlineKeyboard([
        [inlineButton("💵 USD", "onboard:currency:USD")],
        [inlineButton("💶 EUR", "onboard:currency:EUR")],
        [inlineButton("💷 GBP", "onboard:currency:GBP")],
      ]),
    });
  }
});

composer.callbackQuery(/^onboard:currency:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const currency = ctx.match[1];
  const userId = ctx.from!.id;

  await saveUser({
    id: userId,
    currency,
    timezone: "UTC",
  });

  const existing = await getCategories(userId);
  if (existing.length === 0) {
    for (const name of ["Food", "Transport", "Housing", "Entertainment", "Shopping", "Utilities", "Health", "Other"]) {
      await addCategory(userId, {
        id: generateId(),
        user_id: userId,
        name,
        created_at: new Date().toISOString(),
        usage_count: 0,
      });
    }
  }

  ctx.session.step = undefined;
  await ctx.editMessageText(
    `Currency set to ${currency}.\n\nDefault categories added: Food, Transport, Housing, Entertainment, Shopping, Utilities, Health, Other\n\n${WELCOME}`,
    { reply_markup: mainMenuKeyboard() },
  );
});

// "Back to menu" — re-render the main menu in place from any sub-view.
composer.callbackQuery("menu:main", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(WELCOME, { reply_markup: mainMenuKeyboard() });
});

export default composer;