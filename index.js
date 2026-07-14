const { Telegraf, Markup } = require("telegraf");
const { BOT_TOKEN, ADMIN_ID } = require("./config");
const http = require("http");
const fs = require("fs");

const bot = new Telegraf(BOT_TOKEN);

let channels = [];

if (fs.existsSync("channels.json")) {
  try {
    channels = JSON.parse(fs.readFileSync("channels.json", "utf8"));
  } catch (e) {
    channels = [];
  }
}

let waitingChannel = {};
let waitingRemove = {};

function saveChannels() {
  fs.writeFileSync(
    "channels.json",
    JSON.stringify(channels, null, 2)
  );
}

bot.use(async (ctx, next) => {

  if (!ctx.from) return;

  if (ctx.chat.type !== "private") {
    return;
  }

  if (ctx.from.id != ADMIN_ID) {
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

});bot.hears("➕ Add Channel", (ctx) => {
  waitingChannel[ctx.from.id] = true;
  ctx.reply("📢 Send Channel Username\n\nExample:\n@yourchannel");
});

bot.hears("📋 Channel List", (ctx) => {

  if (channels.length === 0) {
    return ctx.reply("❌ No Channel Added");
  }

  let text = "📋 Channel List\n\n";

  channels.forEach((ch, i) => {
    text += `${i + 1}. ${ch}\n`;
  });

  ctx.reply(text);

});

bot.hears("❌ Remove Channel", (ctx) => {

  waitingRemove[ctx.from.id] = true;

  if (channels.length === 0) {
    waitingRemove[ctx.from.id] = false;
    return ctx.reply("❌ No Channel Found");
  }

  let text = "Send Channel Username\n\n";

  channels.forEach((ch) => {
    text += `${ch}\n`;
  });

  ctx.reply(text);

});

bot.on("text", (ctx) => {

  const id = ctx.from.id;
  const text = ctx.message.text.trim();

  if (waitingChannel[id]) {

    waitingChannel[id] = false;

    if (!text.startsWith("@")) {
      return ctx.reply("❌ Invalid Username");
    }

    if (channels.includes(text)) {
      return ctx.reply("⚠️ Already Added");
    }

    channels.push(text);

    saveChannels();

    return ctx.reply("✅ Channel Added");

  }

  if (waitingRemove[id]) {

    waitingRemove[id] = false;

    const index = channels.indexOf(text);

    if (index === -1) {
      return ctx.reply("❌ Channel Not Found");
    }

    channels.splice(index, 1);

    saveChannels();

    return ctx.reply("✅ Channel Removed");

  }

});bot.hears("📝 Create Post", (ctx) => {
  ctx.reply("🚧 Create Post feature coming in Part 4");
});

bot.hears("⚙️ Settings", (ctx) => {
  ctx.reply(
    "⚙️ Telegram Control Panel\n\n" +
    "👤 Admin : " + ADMIN_ID + "\n" +
    "📢 Total Channels : " + channels.length
  );
});

// Bot Start
bot.launch();

console.log("✅ Bot Started");

// Graceful Stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

// Render Web Server
const PORT = process.env.PORT || 10000;

http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/plain"
  });
  res.end("Telegram Panel Bot Running");
}).listen(PORT, () => {
  console.log("🌐 Web Server Running : " + PORT);
});
