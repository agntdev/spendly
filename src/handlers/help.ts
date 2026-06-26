import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";

// /help — plain-language explanation for non-technical users. This bot is
// button-driven: tell the user to tap /start to open the menu rather than listing
// slash commands. The same text is shown when the user taps the Help button on the
// main menu (`menu:help`). Enhance the copy for your specific bot; keep it short.
const composer = new Composer<Ctx>();

const HELP =
  "ℹ️ Expense Tracker Bot\n\n" +
  "Track your spending in seconds.\n\n" +
  "• Tap /start to open the menu\n" +
  "• Tap 💵 Log Expense to add an expense\n" +
  "• Use 📊 Summary to see monthly totals vs budgets\n" +
  "• Set budgets with 🎯 Budget\n" +
  "• Manage categories with 📂 Categories\n" +
  "• /add — Quick log (amount + category in one message)\n" +
  "• /recent — View and edit recent expenses\n" +
  "• /summary — Monthly summary\n" +
  "• /setbudget — Set monthly budgets\n" +
  "• /export — Download your data as CSV\n\n" +
  "Everything is reachable by tapping — no commands to memorize.";

const backToMenu = inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]);

composer.command("help", async (ctx) => {
  await ctx.reply(HELP);
});

composer.callbackQuery("menu:help", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(HELP, { reply_markup: backToMenu });
});

export default composer;
