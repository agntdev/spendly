import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { mainMenuKeyboard, inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { getUser, saveUser, getCategories, addCategory, generateId } from "../store.js";

function localeToCurrency(langCode: string | undefined): string {
  if (langCode === "ru") return "RUB";
  if (langCode === "en-GB" || langCode === "en-IE") return "GBP";
  if (langCode === "de" || langCode === "fr" || langCode === "it" || langCode === "es" || langCode === "nl" || langCode === "pt" || langCode === "fi" || langCode === "el") return "EUR";
  if (langCode === "ja") return "JPY";
  if (langCode === "zh") return "CNY";
  if (langCode === "ko") return "KRW";
  if (langCode === "pt-BR") return "BRL";
  if (langCode === "in" || langCode === "hi") return "INR";
  if (langCode === "uk") return "UAH";
  return "USD";
}

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
    const langCode = ctx.from?.language_code;
    const defaultCur = localeToCurrency(langCode);
    const buttons: { text: string; callback_data: string }[] = [
      { text: "\uD83D\uDCB5 USD", callback_data: "onboard:currency:USD" },
      { text: "\uD83D\uDCB6 EUR", callback_data: "onboard:currency:EUR" },
      { text: "\uD83D\uDCB7 GBP", callback_data: "onboard:currency:GBP" },
    ];
    if (defaultCur === "RUB") buttons.push({ text: "\u20BD RUB", callback_data: "onboard:currency:RUB" });
    if (defaultCur === "JPY") buttons.push({ text: "\u00A5 JPY", callback_data: "onboard:currency:JPY" });
    if (defaultCur === "INR") buttons.push({ text: "\u20B9 INR", callback_data: "onboard:currency:INR" });
    if (defaultCur === "CNY") buttons.push({ text: "\u00A5 CNY", callback_data: "onboard:currency:CNY" });
    if (defaultCur === "BRL") buttons.push({ text: "R$ BRL", callback_data: "onboard:currency:BRL" });
    if (defaultCur === "KRW") buttons.push({ text: "\u20A9 KRW", callback_data: "onboard:currency:KRW" });
    if (defaultCur === "UAH") buttons.push({ text: "\u20B4 UAH", callback_data: "onboard:currency:UAH" });
    const defaultLabel = buttons.find((b) => b.callback_data.includes(defaultCur));
    const hint = defaultLabel
      ? `\n\nFirst, select your currency (default ${defaultLabel.text} suggested for your region):`
      : "\n\nFirst, select your currency:";
    await ctx.reply(`\uD83D\uDC4B Welcome to Expense Tracker!${hint}`, {
      reply_markup: inlineKeyboard(buttons.map((b) => [inlineButton(b.text, b.callback_data)])),
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
        id: await generateId(),
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