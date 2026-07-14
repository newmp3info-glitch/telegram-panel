const { Telegraf, Markup } = require("telegraf");
const { BOT_TOKEN, ADMIN_ID } = require("./config");

const bot = new Telegraf(BOT_TOKEN);

// শুধু Admin এবং Private Chat-এ কাজ করবে
bot.use(async (ctx, next) => {
  if (!ctx.from) return;

  // চ্যানেল বা গ্রুপে কোনো উত্তর দেবে না
  if (ctx.chat.type !== "private") {
    return;
  }

  // Admin ছাড়া কেউ ব্যবহার করতে পারবে না
  if (ctx.from.id != ADMIN_ID) {
    return ctx.reply("⛔ Access Denied");
  }

  return next();
});

// /start
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
