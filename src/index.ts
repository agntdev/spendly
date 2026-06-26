import { buildBot } from "./bot.js";
import { setDefaultCommands } from "./toolkit/index.js";
import { startRecapCheck } from "./handlers/monthly-recap.js";

async function main() {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    console.error("BOT_TOKEN is required");
    process.exit(1);
  }
  const bot = await buildBot(token);
  // Publish the "/" command list to Telegram (discoverability). A button-first
  // bot exposes only /start + /help; everything else is reached via menu buttons.
  await setDefaultCommands(bot, [
    { command: "add", description: "Quick log an expense (amount + category)" },
    { command: "recent", description: "View and edit recent expenses" },
    { command: "summary", description: "Monthly expense summary" },
    { command: "setbudget", description: "Set monthly budgets" },
    { command: "export", description: "Download your data as CSV" },
  ]);
  startRecapCheck(bot);
  bot.start();
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
