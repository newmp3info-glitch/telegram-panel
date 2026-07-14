const { Telegraf, Markup } = require("telegraf");
const { BOT_TOKEN, ADMIN_ID } = require("./config");

const bot = new Telegraf(BOT_TOKEN);

bot.use(async (ctx, next) => {
  if (!ctx.from || ctx.from.id != ADMIN_ID) {
    return ctx.reply("⛔ Access Denied");
  }
  return next();
});

bot.start((ctx) => {
  ctx.reply(
    "🏠 Telegram Control Panel",
    Markup.keyboard([
      ["➕ Add Channel", "📋 Channel List"],
      ["📝 Create Post", "❌ Remove Channel"],
      ["⚙️ Settings"]
    ]).resize()
  );
});

bot.launch();

console.log("✅ Bot Started");
