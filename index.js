const { Telegraf, Markup } = require("telegraf");
const { BOT_TOKEN, ADMIN_ID } = require("./config");
const http = require("http");
const fs = require("fs");

const bot = new Telegraf(BOT_TOKEN);

let channels = [];
let scheduledPosts = [];

// Load channel data
if (fs.existsSync("channels.json")) {
  try {
    channels = JSON.parse(fs.readFileSync("channels.json", "utf8"));
  } catch (e) {
    channels = [];
  }
}

// Load schedule data
if (fs.existsSync("schedule.json")) {
  try {
    scheduledPosts = JSON.parse(fs.readFileSync("schedule.json", "utf8"));
  } catch (e) {
    scheduledPosts = [];
  }
}

// State management variables
let waitingChannel = {};
let waitingRemove = {};
let postStep = {};
let editStep = {};
let editData = {};
let scheduleStep = {};
let scheduleData = {};

// Main Menu Keyboard Layout
const mainKeyboard = Markup.keyboard([
  ["📝 Create Post", "⏰ Schedule Post"],
  ["📋 Channel List", "✏️ Edit Post"],
  ["➕ Add Channel", "❌ Remove Channel"],
  ["🏠 Home", "⚙️ Settings"]
]).resize();

function saveChannels() {
  fs.writeFileSync("channels.json", JSON.stringify(channels, null, 2));
}

function saveSchedule() {
  fs.writeFileSync("schedule.json", JSON.stringify(scheduledPosts, null, 2));
}

function resetStates(id) {
  waitingChannel[id] = false;
  waitingRemove[id] = false;
  postStep[id] = null;
  editStep[id] = null;
  editData[id] = null;
  scheduleStep[id] = null;
  scheduleData[id] = null;
}

// 🤖 AUTOMATIC HARDCODED BUTTON PARSER (Top: Blue, Bottom: Green)
function processPost(caption) {
  if (!caption) return { text: "", replyMarkup: null };
  
  let cleanedText = caption;
  
  // Clean raw URLs if pasted by mistake
  const rawUrlRegex = /(?<!href=['"=\s])(https?:\/\/[^\s<>'"\)]+)/g;
  const urls = caption.match(rawUrlRegex) || [];
  
  if (urls.length > 0) {
    const uniqueUrls = [...new Set(urls)];
    uniqueUrls.forEach((url) => {
      const sampleUrl = url.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const removeLineRegex = new RegExp(`^.*${sampleUrl}.*$`, 'gm');
      cleanedText = cleanedText.replace(removeLineRegex, '');
    });
  }
  
  // Clean up excessive blank lines
  cleanedText = cleanedText.replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
  
  // 🎨 BUTTON COLORS: style "primary" (Blue like screenshot), style "success" (Green like screenshot)
  const inlineKeyboard = [
    [
      { text: "🎰 𝗡𝗲𝘄 𝗚𝗮𝗺𝗲 𝟰𝟱", url: "https://t.me/VipYonoFreeCode/3783", style: "primary" },
      { text: "𝗧𝗼𝘁𝗮𝗹 𝗚𝗮𝗺𝗲 𝟳𝟬 🎰", url: "https://t.me/AllYonoRummyCode/138", style: "primary" }
    ],
    [
      { text: "👆𝗔𝗟𝗟 𝗚𝗔𝗠𝗘𝗦👆", url: "https://t.me/TotalYonoCode/3", style: "success" }
    ]
  ];
  
  const replyMarkup = { inline_keyboard: inlineKeyboard };
  return { text: cleanedText, replyMarkup };
}

// Admin verification middleware
bot.use(async (ctx, next) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return;
  if (ctx.from.id != ADMIN_ID) return ctx.reply("⛔ Access Denied");
  return next();
});

bot.start((ctx) => {
  resetStates(ctx.from.id);
  ctx.reply("🏠 Telegram Control Panel", mainKeyboard);
});

bot.hears("🏠 Home", (ctx) => {
  resetStates(ctx.from.id);
  ctx.reply("🏠 Telegram Control Panel", mainKeyboard);
});

bot.hears("➕ Add Channel", (ctx) => {
  const id = ctx.from.id;
  resetStates(id);
  waitingChannel[id] = true;
  ctx.reply("📢 Send Channel Username\n\nExample:\n@yourchannel");
});

bot.hears("📋 Channel List", (ctx) => {
  resetStates(ctx.from.id);
  if (channels.length === 0) return ctx.reply("❌ No Channel Added");
  let text = "📋 Channel List\n\n";
  channels.forEach((ch, i) => { text += `${i + 1}. ${ch}\n`; });
  ctx.reply(text);
});

bot.hears("❌ Remove Channel", (ctx) => {
  const id = ctx.from.id;
  resetStates(id);
  waitingRemove[id] = true;
  if (channels.length === 0) {
    waitingRemove[id] = false;
    return ctx.reply("❌ No Channel Found");
  }
  let text = "Send Channel Username to Remove:\n\n";
  channels.forEach((ch) => { text += `${ch}\n`; });
  ctx.reply(text);
});

bot.hears("📝 Create Post", (ctx) => {
  const id = ctx.from.id;
  resetStates(id);
  postStep[id] = "waiting_post";
  ctx.reply("📷 **Send Photo with HTML Caption (Instant Post)**");
});

bot.hears("⏰ Schedule Post", (ctx) => {
  const id = ctx.from.id;
  resetStates(id);
  scheduleStep[id] = "waiting_post";
  ctx.reply("⏰ **Send Photo with HTML Caption (Schedule Post)**");
});

bot.hears("✏️ Edit Post", (ctx) => {
  const id = ctx.from.id;
  resetStates(id);
  editStep[id] = "waiting_channel";
  ctx.reply("✏️ Send the Username of the channel to edit post:");
});

bot.hears("⚙️ Settings", (ctx) => {
  resetStates(ctx.from.id);
  ctx.reply(`⚙️ Control Panel\n\n📢 Total Channels: ${channels.length}\n⏰ Scheduled Posts: ${scheduledPosts.length}`);
});

bot.on("photo", async (ctx) => {
  const id = ctx.from.id;

  if (postStep[id] === "waiting_post") {
    const photos = ctx.message.photo;
    const file = photos[photos.length - 1]; 
    const caption = ctx.message.caption || "";

    postStep[id] = null;
    if (channels.length === 0) return ctx.reply("❌ No channels found.");

    const { text: cleanedCaption, replyMarkup } = processPost(caption);
    let success = 0, failed = 0;

    for (const channel of channels) {
      try {
        await bot.telegram.sendPhoto(channel, file.file_id, {
          caption: cleanedCaption,
          parse_mode: "HTML",
          reply_markup: replyMarkup
        });
        success++;
      } catch (err) { failed++; }
    }
    return ctx.reply(`✅ Post Completed\n\nSuccess: ${success}\nFailed: ${failed}`);
  }

  if (scheduleStep[id] === "waiting_post") {
    const photos = ctx.message.photo;
    scheduleData[id] = { file_id: photos[photos.length - 1].file_id, caption: ctx.message.caption || "" };
    scheduleStep[id] = "waiting_time";
    return ctx.reply("📷 Photo Received! Send schedule duration in minutes or YYYY-MM-DD HH:MM:");
  }
});

bot.on("text", async (ctx) => {
  const id = ctx.from.id;
  const text = ctx.message.text.trim();

  if (waitingChannel[id]) {
    waitingChannel[id] = false;
    if (!text.startsWith("@")) return ctx.reply("❌ Invalid Username");
    if (channels.includes(text)) return ctx.reply("⚠️ Already Added");
    channels.push(text);
    saveChannels();
    return ctx.reply("✅ Channel Added");
  }

  if (waitingRemove[id]) {
    waitingRemove[id] = false;
    const index = channels.indexOf(text);
    if (index === -1) return ctx.reply("❌ Channel Not Found");
    channels.splice(index, 1);
    saveChannels();
    return ctx.reply("✅ Channel Removed");
  }

  if (editStep[id] === "waiting_channel") {
    if (!text.startsWith("@")) return ctx.reply("❌ Invalid Username.");
    editData[id] = { channel: text };
    editStep[id] = "waiting_msg_id";
    return ctx.reply("Send the Message ID:");
  }

  if (editStep[id] === "waiting_msg_id") {
    let msgId = text.includes("/") ? text.split("/").pop() : text;
    msgId = parseInt(msgId);
    if (isNaN(msgId)) return ctx.reply("❌ Invalid ID.");
    editData[id].messageId = msgId;
    editStep[id] = "waiting_new_text";
    return ctx.reply("Send the new HTML Caption:");
  }

  if (editStep[id] === "waiting_new_text") {
    const { channel, messageId } = editData[id];
    editStep[id] = null;
    try {
      await bot.telegram.editMessageCaption(channel, messageId, null, text, { parse_mode: "HTML" });
      ctx.reply("✅ Post Edited!");
    } catch (err) {
      ctx.reply(`❌ Failed to edit: ${err.message}`);
    }
    editData[id] = null;
    return;
  }

  if (scheduleStep[id] === "waiting_time") {
    let targetTime;
    if (/^\d+$/.test(text)) {
      targetTime = new Date(Date.now() + parseInt(text) * 60 * 1000);
    } else {
      const match = text.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
      if (match) {
        targetTime = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00+06:00`);
      }
    }

    if (!targetTime || isNaN(targetTime.getTime())) return ctx.reply("❌ Invalid time format!");

    scheduledPosts.push({ file_id: scheduleData[id].file_id, caption: scheduleData[id].caption, time: targetTime.toISOString() });
    saveSchedule();
    scheduleStep[id] = null;
    scheduleData[id] = null;
    return ctx.reply(`✅ Post Scheduled for: ${targetTime.toLocaleString()}`);
  }
});

// Background Scheduler
setInterval(async () => {
  if (scheduledPosts.length === 0) return;
  const now = new Date();
  let hasChanges = false;

  for (let i = scheduledPosts.length - 1; i >= 0; i--) {
    const post = scheduledPosts[i];
    if (new Date(post.time) <= now) {
      const { text: cleanedCaption, replyMarkup } = processPost(post.caption);
      for (const channel of channels) {
        try {
          await bot.telegram.sendPhoto(channel, post.file_id, { caption: cleanedCaption, parse_mode: "HTML", reply_markup: replyMarkup });
        } catch (e) {}
      }
      scheduledPosts.splice(i, 1);
      hasChanges = true;
    }
  }
  if (hasChanges) saveSchedule();
}, 30000);

bot.launch().then(() => {
  console.log("✅ Bot launched with Blue & Green Custom Grid successfully.");
});

const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Bot Engine Online");
}).listen(PORT);
