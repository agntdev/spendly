import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  registerMainMenuItem,
} from "../toolkit/index.js";
import {
  getUser,
  saveUser,
  getNotificationRules,
  saveNotificationRules,
  ensureUser,
} from "../store.js";

registerMainMenuItem({ label: "⚙ Settings", data: "settings:menu", order: 90 });

const composer = new Composer<Ctx>();

composer.callbackQuery("settings:menu", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ensureUser(ctx.from!.id);
  const userId = ctx.from!.id;
  const user = await getUser(userId);
  const rules = await getNotificationRules(userId);

  const sym = user?.currency ?? "USD";
  const tz = user?.timezone ?? "UTC";

  await ctx.editMessageText(
    `⚙ Settings\nCurrency: ${sym}\nTimezone: ${tz}\nWarning threshold: ${rules.warning_percent}%\nOver-budget threshold: ${rules.overbudget_percent}%`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("💱 Change Currency", "settings:currency")],
        [inlineButton("🔔 Thresholds", "settings:thresholds")],
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    },
  );
});

composer.callbackQuery("settings:currency", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("Select your currency:", {
    reply_markup: inlineKeyboard([
      [inlineButton("💵 USD", "settings:set_currency:USD")],
      [inlineButton("💶 EUR", "settings:set_currency:EUR")],
      [inlineButton("💷 GBP", "settings:set_currency:GBP")],
      [inlineButton("⬅️ Back", "settings:menu")],
    ]),
  });
});

composer.callbackQuery(/^settings:set_currency:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const currency = ctx.match[1];
  const userId = ctx.from!.id;
  let user = await getUser(userId);
  if (!user) {
    user = { id: userId, currency, timezone: "UTC" };
  } else {
    user.currency = currency;
  }
  await saveUser(user);
  await ctx.editMessageText(`Currency set to ${currency}.`, {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
  });
});

composer.callbackQuery("settings:thresholds", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from!.id;
  const rules = await getNotificationRules(userId);

  await ctx.editMessageText(
    `🔔 Budget Thresholds\nWarning: ${rules.warning_percent}%\nOver-budget: ${rules.overbudget_percent}%`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton(`Set Warning (${rules.warning_percent}%)`, "settings:set_warning")],
        [inlineButton(`Set Over-budget (${rules.overbudget_percent}%)`, "settings:set_overbudget")],
        [inlineButton("⬅️ Back", "settings:menu")],
      ]),
    },
  );
});

composer.callbackQuery("settings:set_warning", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "awaiting_threshold_warning";
  await ctx.editMessageText("Enter warning threshold percentage (1-99):", {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Cancel", "settings:thresholds")]]),
  });
});

composer.callbackQuery("settings:set_overbudget", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "awaiting_threshold_over";
  await ctx.editMessageText("Enter over-budget threshold percentage (1-100):", {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Cancel", "settings:thresholds")]]),
  });
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step === "awaiting_threshold_warning" || ctx.session.step === "awaiting_threshold_over") {
    const text = ctx.message!.text.trim();
    const val = parseInt(text, 10);
    if (isNaN(val) || val < 1 || val > 100) {
      await ctx.reply("Please enter a number between 1 and 100.");
      return;
    }

    const userId = ctx.from!.id;
    const rules = await getNotificationRules(userId);

    if (ctx.session.step === "awaiting_threshold_warning") {
      if (val >= rules.overbudget_percent) {
        await ctx.reply("Warning threshold must be less than over-budget threshold.");
        return;
      }
      rules.warning_percent = val;
    } else {
      if (val <= rules.warning_percent) {
        await ctx.reply("Over-budget threshold must be greater than warning threshold.");
        return;
      }
      rules.overbudget_percent = val;
    }

    await saveNotificationRules(rules);
    ctx.session.step = undefined;

    await ctx.reply("Threshold updated.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to Settings", "settings:menu")]]),
    });
    return;
  }

  return next();
});

export default composer;
