import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  registerMainMenuItem,
  inlineButton,
  inlineKeyboard,
} from "../toolkit/index.js";
import {
  getCategories,
  getCategoryById,
  addCategory,
  removeCategory,
  saveCategories,
  getExpenses,
  generateId,
  ensureUser,
} from "../store.js";

registerMainMenuItem({ label: "📂 Categories", data: "cat:menu", order: 20 });

const composer = new Composer<Ctx>();

async function renderCategories(ctx: Ctx) {
  const userId = ctx.from!.id;
  const cats = await getCategories(userId);
  const sorted = [...cats].sort((a, b) => b.usage_count - a.usage_count);

  if (sorted.length === 0) {
    await ctx.editMessageText("No categories yet — tap ➕ to add one.", {
      reply_markup: inlineKeyboard([
        [inlineButton("➕ Add Category", "cat:add_prompt")],
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    });
    return;
  }

  const rows = sorted.map((c) => [
    inlineButton(`${c.name} (${c.usage_count})`, `cat:edit_menu:${c.id}`),
    inlineButton("🗑", `cat:delete_confirm:${c.id}`),
  ]);
  rows.push([inlineButton("➕ Add Category", "cat:add_prompt")]);
  rows.push([inlineButton("⬅️ Back to menu", "menu:main")]);

  await ctx.editMessageText("Your categories:\n(tap name to rename, 🗑 to delete)", {
    reply_markup: inlineKeyboard(rows),
  });
}

composer.callbackQuery("cat:menu", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ensureUser(ctx.from!.id);
  await renderCategories(ctx);
});

composer.callbackQuery("cat:add_prompt", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "awaiting_category_name";
  await ctx.editMessageText("Enter the new category name:", {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Cancel", "cat:menu")]]),
  });
});

composer.callbackQuery(/^cat:edit_menu:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const catId = ctx.match[1];
  const userId = ctx.from!.id;
  const cat = await getCategoryById(userId, catId);
  if (!cat) {
    await ctx.editMessageText("Category not found.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back", "cat:menu")]]),
    });
    return;
  }

  await ctx.editMessageText(`Category: "${cat.name}"\nUse count: ${cat.usage_count}`, {
    reply_markup: inlineKeyboard([
      [inlineButton("✏️ Rename", `cat:rename_prompt:${catId}`)],
      [inlineButton("🗑 Delete", `cat:delete_confirm:${catId}`)],
      [inlineButton("⬅️ Back", "cat:menu")],
    ]),
  });
});

composer.callbackQuery(/^cat:rename_prompt:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const catId = ctx.match[1];
  ctx.session.step = "awaiting_category_rename";
  ctx.session.pendingCategoryId = catId;
  await ctx.editMessageText("Enter the new name:", {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Cancel", `cat:edit_menu:${catId}`)]]),
  });
});

composer.callbackQuery(/^cat:delete_confirm:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const catId = ctx.match[1];
  const userId = ctx.from!.id;
  const cat = await getCategoryById(userId, catId);
  if (!cat) {
    await ctx.editMessageText("Category not found.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back", "cat:menu")]]),
    });
    return;
  }

  await ctx.editMessageText(`Delete category "${cat.name}"?\nExpenses in this category will lose their label.`, {
    reply_markup: inlineKeyboard([
      [
        inlineButton("✅ Yes", `cat:delete:${catId}`),
        inlineButton("❌ No", "cat:menu"),
      ],
    ]),
  });
});

composer.callbackQuery(/^cat:delete:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const catId = ctx.match[1];
  const userId = ctx.from!.id;
  await removeCategory(userId, catId);
  await ctx.editMessageText("Category deleted.", {
    reply_markup: inlineKeyboard([
      [inlineButton("📂 Back to Categories", "cat:menu")],
      [inlineButton("⬅️ Back to menu", "menu:main")],
    ]),
  });
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step === "awaiting_category_name") {
    const name = ctx.message!.text.trim();
    if (!name) {
      await ctx.reply("Please enter a category name.");
      return;
    }

    const userId = ctx.from!.id;
    const cats = await getCategories(userId);
    if (cats.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      await ctx.reply("A category with that name already exists.", {
        reply_markup: inlineKeyboard([[inlineButton("⬅️ Back", "cat:menu")]]),
      });
      ctx.session.step = undefined;
      return;
    }

    const cat = {
      id: generateId(),
      user_id: userId,
      name,
      created_at: new Date().toISOString(),
      usage_count: 0,
    };
    await addCategory(userId, cat);
    ctx.session.step = undefined;
    await ctx.reply(`Category "${name}" added.`, {
      reply_markup: inlineKeyboard([
        [inlineButton("📂 View Categories", "cat:menu")],
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    });
    return;
  }

  if (ctx.session.step === "awaiting_category_rename") {
    const name = ctx.message!.text.trim();
    if (!name) {
      await ctx.reply("Please enter a new name.");
      return;
    }

    const userId = ctx.from!.id;
    const catId = ctx.session.pendingCategoryId;
    ctx.session.step = undefined;
    ctx.session.pendingCategoryId = undefined;

    if (!catId) return next();

    const cat = await getCategoryById(userId, catId);
    if (!cat) {
      await ctx.reply("Category not found.", {
        reply_markup: inlineKeyboard([[inlineButton("⬅️ Back", "cat:menu")]]),
      });
      return;
    }

    cat.name = name;
    const cats = await getCategories(userId);
    const idx = cats.findIndex((c) => c.id === catId);
    if (idx >= 0) cats[idx] = cat;
    await saveCategories(userId, cats);

    await ctx.reply(`Category renamed to "${name}".`, {
      reply_markup: inlineKeyboard([
        [inlineButton("📂 View Categories", "cat:menu")],
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    });
    return;
  }

  return next();
});

export default composer;
