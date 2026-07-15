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

// New feature state variables
let editStep = {};
let editData = {};
let scheduleStep = {};
let scheduleData = {};

// Reusable Main Menu Keyboard Layout (With Home Button)
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

// 🤖 FIX & GRID PARSER: Extracts raw URLs safely and places buttons side-by-side
function processPost(caption) {
  if (!caption) return { text: "", replyMarkup: null };
  
  // Regex to match raw text URLs only (ignores URLs inside href='...' or href="...")
  const rawUrlRegex = /(?<!href=['"=\s])(https?:\/\/[^\s<>'"\)]+)/g;
  const urls = caption.match(rawUrlRegex) || [];
  
  if (urls.length === 0) {
    return { text: caption, replyMarkup: null };
  }
  
  const uniqueUrls = [...new Set(urls)];
  const inlineKeyboard = [];
  let currentRow = [];
  let cleanedText = caption;
  
  uniqueUrls.forEach((url, index) => {
    let label = "🔗 Open Link";
    
    // Custom premium labels matching your patterns
    if (url.includes("allyonorummycode")) {
      label = "📲 Download All";
    } else if (url.includes("jaiho91")) {
      label = "🔥 Jaiho91 App";
    } else if (url.includes("VipYonoFreeCode/3")) {
      label = "🎰 Total Game 60";
    } else if (url.includes("VipYonoFreeCode")) {
      label = "👑 VIP Yono Code";
    } else if (url.includes("TotalYonoCode")) {
      label = "💗 New Apps List";
    } else {
      label = `🔗 Link ${index + 1}`;
    }
    
    // Push button to the current row array
    currentRow.push({ text: label, url: url });
    
    // Keep 2 buttons per row (Side-by-side grid)
    if (currentRow.length === 2) {
      inlineKeyboard.push(currentRow);
      currentRow = [];
    }
    
    // Remove the raw text URL safely from caption body
    const sampleUrl = url.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const removeRegex = new RegExp(`(?:\\s*[-\\s☞]+\\s*|\\s*&&\\s*|\\s*☞\\s*𝘿𝙤𝙬𝙣𝙡𝙤𝙖𝙙\\s*|\\s+-\\s+)?${sampleUrl}`, 'g');
    cleanedText = cleanedText.replace(removeRegex, '');
  });
  
  // Push any trailing single button
  if (currentRow.length > 0) {
    inlineKeyboard.push(currentRow);
  }
  
  // Final caption string polishing
  cleanedText = cleanedText
    .replace(/\s*&&\s*$/gm, '')
    .replace(/\s*[-☞]\s*$/gm, '')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();
  
  const replyMarkup = inlineKeyboard.length > 0 ? { inline_keyboard: inlineKeyboard } : null;
  return { text: cleanedText, replyMarkup };
}

// Admin verification middleware
bot.use(async (ctx, next) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return;
  if (ctx.from.id != ADMIN_ID) return ctx.reply("⛔ Access Denied");
  return next();
});

// Start command & Control Panel
bot.start((ctx) => {
  resetStates(ctx.from.id);
  ctx.reply("🏠 Telegram Control Panel", mainKeyboard);
});

// Home Button Handler
bot.hears("🏠 Home", (ctx) => {
  resetStates(ctx.from.id);
  ctx.reply("🏠 Telegram Control Panel", mainKeyboard);
});

// Add channel button
bot.hears("➕ Add Channel", (ctx) => {
  const id = ctx.from.id;
  resetStates(id);
  waitingChannel[id] = true;
  ctx.reply("📢 Send Channel Username\n\nExample:\n@yourchannel");
});

// View channel list button
bot.hears("📋 Channel List", (ctx) => {
  resetStates(ctx.from.id);
  if (channels.length === 0) return ctx.reply("❌ No Channel Added");
  let text = "📋 Channel List\n\n";
  channels.forEach((ch, i) => { text += `${i + 1}. ${ch}\n`; });
  ctx.reply(text);
});

// Remove channel button
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

// Regular post creation button
bot.hears("📝 Create Post", (ctx) => {
  const id = ctx.from.id;
  resetStates(id);
  postStep[id] = "waiting_post";
  ctx.reply(
    "📷 **Send Photo with HTML Caption (Instant Post)**\n\n" +
    "1. First, select a photo from your gallery.\n" +
    "2. Write your HTML caption in the 'Add a caption' box.\n" +
    "3. Press the send button."
  );
});

// Schedule post button
bot.hears("⏰ Schedule Post", (ctx) => {
  const id = ctx.from.id;
  resetStates(id);
  scheduleStep[id] = "waiting_post";
  ctx.reply(
    "⏰ **Schedule Post**\n\n" +
    "1. First, select a photo from your gallery.\n" +
    "2. Write your HTML caption in the 'Add a caption' box.\n" +
    "3. Press the send button."
  );
});

// Edit post button
bot.hears("✏️ Edit Post", (ctx) => {
  const id = ctx.from.id;
  resetStates(id);
  editStep[id] = "waiting_channel";
  ctx.reply(
    "✏️ **Edit Post**\n\n" +
    "Send the Username of the channel where you want to edit the post:\n\n" +
    "Example:\n@yourchannel"
  );
});

// Settings button
bot.hears("⚙️ Settings", (ctx) => {
  resetStates(ctx.from.id);
  ctx.reply(
    "⚙️ Telegram Control Panel\n\n" +
    "👤 Admin : " + ADMIN_ID + "\n" +
    "📢 Total Channels : " + channels.length + "\n" +
    "⏰ Scheduled Posts : " + scheduledPosts.length
  );
});

// Photo handler
bot.on("photo", async (ctx) => {
  const id = ctx.from.id;

  if (postStep[id] === "waiting_post") {
    const photos = ctx.message.photo;
    const file = photos[photos.length - 1]; 
    const file_id = file.file_id;
    const caption = ctx.message.caption || "";

    postStep[id] = null;
    if (channels.length === 0) return ctx.reply("❌ No channels found to send the post.");

    const { text: cleanedCaption, replyMarkup } = processPost(caption);
    let success = 0;
    let failed = 0;
    ctx.reply("⏳ Sending clean post with side-by-side buttons...");

    for (const channel of channels) {
      try {
        await bot.telegram.sendPhoto(channel, file_id, {
          caption: cleanedCaption,
          parse_mode: "HTML",
          reply_markup: replyMarkup
        });
        success++;
      } catch (err) {
        failed++;
        console.error("Post error for channel " + channel + ":", err.message);
      }
    }
    return ctx.reply(`✅ Post Completed\n\nSuccess : ${success}\nFailed : ${failed}`);
  }

  if (scheduleStep[id] === "waiting_post") {
    const photos = ctx.message.photo;
    const file = photos[photos.length - 1];
    const scheduleDataObj = { file_id: file.file_id, caption: ctx.message.caption || "" };

    scheduleData[id] = scheduleDataObj;
    scheduleStep[id] = "waiting_time";

    return ctx.reply(
      "📷 **Photo and Caption Received!**\n\n" +
      "Please send your scheduled time (Duration in minutes or YYYY-MM-DD HH:MM BD Time):"
    );
  }
});

// Text inputs handler
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
    if (!text.startsWith("@")) return ctx.reply("❌ Invalid Channel Username.");
    editData[id] = { channel: text };
    editStep[id] = "waiting_msg_id";
    return ctx.reply("Send the **Message ID** or copy-paste the **Post Link**:");
  }

  if (editStep[id] === "waiting_msg_id") {
    let msgId = text;
    if (text.includes("/")) {
      const parts = text.split("/");
      msgId = parts[parts.length - 1];
    }
    msgId = parseInt(msgId);
    if (isNaN(msgId)) return ctx.reply("❌ Invalid Message ID.");
    editData[id].messageId = msgId;
    editStep[id] = "waiting_new_text";
    return ctx.reply("Now, send the new **HTML Caption**:");
  }

  if (editStep[id] === "waiting_new_text") {
    const channel = editData[id].channel;
    const messageId = editData[id].messageId;
    editStep[id] = null;
    ctx.reply("⏳ Editing post...");

    try {
      await bot.telegram.editMessageCaption(channel, messageId, null, text, { parse_mode: "HTML" });
      ctx.reply("✅ Post Caption Edited Successfully!");
    } catch (err) {
      try {
        await bot.telegram.editMessageText(channel, messageId, null, text, { parse_mode: "HTML" });
        ctx.reply("✅ Post Text Edited Successfully!");
      } catch (err2) {
        ctx.reply(`❌ Failed to edit.\nError: ${err2.message}`);
      }
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
      } else {
        targetTime = new Date(text);
      }
    }

    if (!targetTime || isNaN(targetTime.getTime()) || targetTime <= new Date()) {
      return ctx.reply("❌ Invalid time or past time!");
    }

    scheduledPosts.push({
      file_id: scheduleData[id].file_id,
      caption: scheduleData[id].caption,
      time: targetTime.toISOString()
    });
    saveSchedule();

    scheduleStep[id] = null;
    scheduleData[id] = null;
    return ctx.reply(`✅ **Post Scheduled Successfully!**\n📅 \`${targetTime.toLocaleString('en-US', { timeZone: 'Asia/Dhaka' })}\``);
  }
});

// Background scheduler
setInterval(async () => {
  if (scheduledPosts.length === 0) return;
  const now = new Date();
  let hasChanges = false;

  for (let i = scheduledPosts.length - 1; i >= 0; i--) {
    const post = scheduledPosts[i];
    if (new Date(post.time) <= now) {
      let success = 0;
      let failed = 0;
      const { text: cleanedCaption, replyMarkup } = processPost(post.caption);

      for (const channel of channels) {
        try {
          await bot.telegram.sendPhoto(channel, post.file_id, {
            caption: cleanedCaption,
            parse_mode: "HTML",
            reply_markup: replyMarkup
          });
          success++;
        } catch (err) { failed++; }
      }
      try {
        await bot.telegram.sendMessage(ADMIN_ID, `⏰ **Scheduled Post Update:**\n\n✅ Success: ${success}\n❌ Failed: ${failed}`);
      } catch (e) {}
      scheduledPosts.splice(i, 1);
      hasChanges = true;
    }
  }
  if (hasChanges) saveSchedule();
}, 30000);

bot.catch((err, ctx) => {
  console.error("BOT ERROR:", err);
  if (ctx) try { ctx.reply("❌ An error occurred!"); } catch (e) {}
});

bot.launch().then(() => {
  console.log("✅ Bot running with HTML Fix and Side-by-Side Grid Buttons.");
  bot.telegram.setMyCommands([{ command: "start", description: "Open Control Panel" }]).catch(() => {});
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Telegram Panel Bot Running");
}).listen(PORT);
