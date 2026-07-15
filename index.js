const { Telegraf, Markup } = require("telegraf");
const { BOT_TOKEN, ADMIN_ID } = require("./config");
const http = require("http");
const fs = require("fs");

const bot = new Telegraf(BOT_TOKEN);

let channels = [];

// চ্যানেল ডাটা লোড করা
if (fs.existsSync("channels.json")) {
  try {
    channels = JSON.parse(fs.readFileSync("channels.json", "utf8"));
  } catch (e) {
    channels = [];
  }
}

// স্টেট ম্যানেজমেন্ট ভেরিয়েবল
let waitingChannel = {};
let waitingRemove = {};
let postStep = {};
let postData = {};

// চ্যানেল সেভ করার ফাংশন
function saveChannels() {
  fs.writeFileSync(
    "channels.json",
    JSON.stringify(channels, null, 2)
  );
}

// এডমিন ভেরিফিকেশন মিডলওয়্যার
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

// স্টার্ট কমান্ড ও কন্ট্রোল প্যানেল (বাটনগুলোর স্থান পরিবর্তন করা হয়েছে)
bot.start((ctx) => {
  ctx.reply(
    "🏠 Telegram Control Panel",
    Markup.keyboard([
      ["📝 Create Post", "📋 Channel List"],      // পোস্ট বাটনটি উপরে আনা হয়েছে
      ["➕ Add Channel", "❌ Remove Channel"],    // চ্যানেল অ্যাড বাটনটি নিচে নেওয়া হয়েছে
      ["⚙️ Settings"]
    ]).resize()
  );
});

// চ্যানেল যুক্ত করার বাটন
bot.hears("➕ Add Channel", (ctx) => {
  const id = ctx.from.id;
  waitingChannel[id] = true;
  waitingRemove[id] = false;
  postStep[id] = null; // অন্যান্য স্টেট বন্ধ করা

  ctx.reply("📢 Send Channel Username\n\nExample:\n@yourchannel");
});

// চ্যানেল লিস্ট দেখার বাটন
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

// চ্যানেল রিমুভ করার বাটন
bot.hears("❌ Remove Channel", (ctx) => {
  const id = ctx.from.id;
  waitingRemove[id] = true;
  waitingChannel[id] = false;
  postStep[id] = null;

  if (channels.length === 0) {
    waitingRemove[id] = false;
    return ctx.reply("❌ No Channel Found");
  }

  let text = "Send Channel Username to Remove:\n\n";
  channels.forEach((ch) => {
    text += `${ch}\n`;
  });

  ctx.reply(text);
});

// পোস্ট ক্রিয়েট করার বাটন
bot.hears("📝 Create Post", (ctx) => {
  const id = ctx.from.id;
  postStep[id] = "photo";
  postData[id] = {};
  waitingChannel[id] = false;
  waitingRemove[id] = false;

  ctx.reply("📷 Send Photo");
});

// সেটিংস বাটন
bot.hears("⚙️ Settings", (ctx) => {
  ctx.reply(
    "⚙️ Telegram Control Panel\n\n" +
    "👤 Admin : " + ADMIN_ID + "\n" +
    "📢 Total Channels : " + channels.length
  );
});

// ফটো রিসিভ করার হ্যান্ডলার
bot.on("photo", async (ctx) => {
  const id = ctx.from.id;

  if (postStep[id] !== "photo") return;

  const photos = ctx.message.photo;
  const file = photos[photos.length - 1]; // সর্বোচ্চ রেজোলিউশনের ফটো নেওয়া

  postData[id].file_id = file.file_id;
  postStep[id] = "caption";

  ctx.reply("📝 Now Send HTML Caption");
});

// সমস্ত টেক্সট ইনপুট প্রসেস করার একক হ্যান্ডলার
bot.on("text", async (ctx) => {
  const id = ctx.from.id;
  const text = ctx.message.text.trim();

  // ১. চ্যানেল অ্যাড করা
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

  // ২. চ্যানেল রিমুভ করা
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

  // ৩. পোস্টের ক্যাপশন নেওয়া এবং সব চ্যানেলে পাঠানো
  if (postStep[id] === "caption") {
    postStep[id] = null;
    const caption = text;

    if (channels.length === 0) {
      delete postData[id];
      return ctx.reply("❌ No channels found to send the post.");
    }

    let success = 0;
    let failed = 0;

    ctx.reply("⏳ Sending post to channels...");

    for (const channel of channels) {
      try {
        await bot.telegram.sendPhoto(channel, postData[id].file_id, {
          caption: caption,
          parse_mode: "HTML"
        });
        success++;
      } catch (err) {
        failed++;
      }
    }

    delete postData[id];

    return ctx.reply(
      `✅ Post Completed\n\nSuccess : ${success}\nFailed : ${failed}`
    );
  }
});

// গ্লোবাল এরর হ্যান্ডলিং
bot.catch((err, ctx) => {
  console.error("BOT ERROR :", err);
  if (ctx) {
    ctx.reply("❌ An error occurred!");
  }
});

// বট চালু করা
bot.launch().then(() => {
  console.log("✅ Bot Started Successfully");
});

// গ্রেসফুল স্টপ (বট বন্ধ করার জন্য)
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
