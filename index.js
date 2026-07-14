const { Telegraf, Markup } = require("telegraf");
const { BOT_TOKEN, ADMIN_ID } = require("./config");
const http = require("http");

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

// Bot চালু
bot.launch();

console.log("✅ Bot Started");

// Render-এর জন্য Web Server
const PORT = process.env.PORT || 10000;

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Bot is running!");
}).listen(PORT, () => {
  console.log(`Web server running on port ${PORT}`);
});
