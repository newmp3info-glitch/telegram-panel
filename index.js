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

// Load schedule data (prevents data loss on restart)
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

// Function to save channels
function saveChannels() {
  fs.writeFileSync(
    "channels.json",
    JSON.stringify(channels, null, 2)
  );
}

// Function to save schedules
function saveSchedule() {
  fs.writeFileSync(
    "schedule.json",
    JSON.stringify(scheduledPosts, null, 2)
  );
}

// Function to reset all states to avoid conflicts
function resetStates(id) {
  waitingChannel[id] = false;
  waitingRemove[id] = false;
  postStep[id] = null;
  editStep[id] = null;
  editData[id] = null;
  scheduleStep[id] = null;
  scheduleData[id] = null;
}

// 🤖 SMART POST PROCESSOR (Generates buttons and cleanly deletes links from caption)
function processPost(caption) {
  if (!caption) return { text: "", replyMarkup: null };
  
  // Extract all http/https links from the text
  const urlRegex = /(https?:\/\/[^\s<>]+)/g;
  const urls = caption.match(urlRegex) || [];
  
  if (urls.length === 0) {
    return { text: caption, replyMarkup: null };
  }
  
  // Get unique URLs
  const uniqueUrls = [...new Set(urls)];
  const inlineKeyboard = [];
  let cleanedText = caption;
  
  uniqueUrls.forEach((url, index) => {
    let label = "🔗 Open Link";
    
    // Dynamically assign beautiful labels based on your link patterns
    if (url.includes("allyonorummycode")) {
      label = "📲 Download All Apps";
    } else if (url.includes("jaiho91")) {
      label = "🔥 Jaiho91 New App";
    } else if (url.includes("VipYonoFreeCode/3")) {
      label = "🎰 Total Game 60";
    } else if (url.includes("VipYonoFreeCode")) {
      label = "👑 VIP Yono Code";
    } else if (url.includes("TotalYonoCode")) {
      label = "💗 New Apps List";
    } else {
      label = `🔗 Link ${index + 1}`;
    }
    
    // Add to button list
    inlineKeyboard.push([{ text: label, url: url }]);
    
    // Escape URL characters for safe regex replacement
    const escapedUrl = url.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    
    // Remove the URL and any preceding hyphens, arrows (☞), download texts, or spacing
    const removeRegex = new RegExp(`(?:\\s*[-\\s☞]+\\s*|\\s*&&\\s*|\\s*☞\\s*𝘿𝙤𝙬𝙣𝙡𝙤𝙖𝙙\\s*|\\s+-\\s+)?${escapedUrl}`, 'g');
    cleanedText = cleanedText.replace(removeRegex, '');
  });
  
  // Final text cleanup (removes trailing hyphens, leftover && symbols, and redundant empty lines)
  cleanedText = cleanedText
    .replace(/\s*&&\s*$/gm, '') // Remove trailing && at end of lines
    .replace(/\s*[-☞]\s*$/gm, '') // Remove trailing - or ☞ at end of lines
    .replace(/\n\s*\n\s*\n/g, '\n\n') // Max 2 consecutive newlines
    .trim();
  
  const replyMarkup = inlineKeyboard.length > 0 ? { inline_keyboard: inlineKeyboard } : null;
  
  return { text: cleanedText, replyMarkup };
}

// Admin verification middleware
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
  if (channels.length === 0) {
    return ctx.reply("❌ No Channel Added");
  }

  let text = "📋 Channel List\n\n";
  channels.forEach((ch, i) => {
    text += `${i + 1}. ${ch}\n`;
  });

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
  channels.forEach((ch) => {
    text += `${ch}\n`;
  });

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
    "3. Press the send button (it will be posted instantly with auto-buttons)."
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

// Handler to receive photos along with captions (Auto-Button & Auto-Cleaner Integrated)
bot.on("photo", async (ctx) => {
  const id = ctx.from.id;

  // A. For regular instant posts
  if (postStep[id] === "waiting_post") {
    const photos = ctx.message.photo;
    const file = photos[photos.length - 1]; 
    const file_id = file.file_id;
    const caption = ctx.message.caption || "";

    postStep[id] = null;

    if (channels.length === 0) {
      return ctx.reply("❌ No channels found to send the post.");
    }

    // Process post text and generate buttons (This automatically removes raw links)
    const { text: cleanedCaption, replyMarkup } = processPost(caption);

    let success = 0;
    let failed = 0;
    ctx.reply("⏳ Sending clean post with buttons to channels...");

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
      }
    }
    return ctx.reply(`✅ Post Completed\n\nSuccess : ${success}\nFailed : ${failed}`);
  }

  // B. First step for schedule posts
  if (scheduleStep[id] === "waiting_post") {
    const photos = ctx.message.photo;
    const file = photos[photos.length - 1];
    const file_id = file.file_id;
    const caption = ctx.message.caption || "";

    scheduleData[id] = { file_id, caption };
    scheduleStep[id] = "waiting_time";

    return ctx.reply(
      "📷 **Photo and Caption Received!**\n\n" +
      "Now, tell me when you want to schedule this post.\n" +
      "You can provide the time in 2 ways:\n\n" +
      "👉 **1. In Minutes (Easiest):**\n" +
      "Just enter the number of minutes after which you want to post. For example, enter `30` to post in 30 minutes.\n\n" +
      "👉 **2. Specific Date & Time (BD local format):**\n" +
      "Send in this format: `YYYY-MM-DD HH:MM`\n" +
      "Example: `2026-07-15 18:30` (BD Time).\n\n" +
      "Please send your scheduled time:"
    );
  }
});

// Single handler to process all text inputs
bot.on("text", async (ctx) => {
  const id = ctx.from.id;
  const text = ctx.message.text.trim();

  // 1. Add channel
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

  // 2. Remove channel
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

  // 3. Edit post - Receive channel name
  if (editStep[id] === "waiting_channel") {
    if (!text.startsWith("@")) {
      return ctx.reply("❌ Invalid Channel Username. Please include '@'.");
    }
    editData[id] = { channel: text };
    editStep[id] = "waiting_msg_id";
    return ctx.reply(
      "Channel found. Now, send the **Message ID** or copy-paste the **Post Link**:\n\n" +
      "*(Tip: If you send the message link, the bot will automatically extract the ID)*"
    );
  }

  // 4. Edit post - Receive message ID
  if (editStep[id] === "waiting_msg_id") {
    let msgId = text;
    if (text.includes("/")) {
      const parts = text.split("/");
      msgId = parts[parts.length - 1];
    }
    msgId = parseInt(msgId);

    if (isNaN(msgId)) {
      return ctx.reply("❌ Invalid Message ID or link. Please send a valid number or link.");
    }

    editData[id].messageId = msgId;
    editStep[id] = "waiting_new_text";
    return ctx.reply("Now, send the new **HTML Caption** that you want to replace the old text with:");
  }

  // 5. Edit post - Complete editing
  if (editStep[id] === "waiting_new_text") {
    const channel = editData[id].channel;
    const messageId = editData[id].messageId;
    
    editStep[id] = null;
    ctx.reply("⏳ Editing post in channel...");

    try {
      await bot.telegram.editMessageCaption(channel, messageId, null, text, {
        parse_mode: "HTML"
      });
      ctx.reply("✅ Post Caption Edited Successfully!");
    } catch (err) {
      try {
        await bot.telegram.editMessageText(channel, messageId, null, text, {
          parse_mode: "HTML"
        });
        ctx.reply("✅ Post Text Edited Successfully!");
      } catch (err2) {
        ctx.reply(`❌ Failed to edit post.\nError: ${err2.message}`);
      }
    }
    editData[id] = null;
    return;
  }

  // 6. Schedule post - Define scheduling time
  if (scheduleStep[id] === "waiting_time") {
    let targetTime;

    if (/^\d+$/.test(text)) {
      const minutes = parseInt(text);
      targetTime = new Date(Date.now() + minutes * 60 * 1000);
    } else {
      const match = text.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
      if (match) {
        const [_, year, month, day, hour, minute] = match;
        const isoString = `${year}-${month}-${day}T${hour}:${minute}:00+06:00`;
        targetTime = new Date(isoString);
      } else {
        targetTime = new Date(text);
      }
    }

    if (!targetTime || isNaN(targetTime.getTime()) || targetTime <= new Date()) {
      return ctx.reply("❌ Invalid time or past time provided! Please send a valid time or duration in minutes.");
    }

    scheduledPosts.push({
      file_id: scheduleData[id].file_id,
      caption: scheduleData[id].caption,
      time: targetTime.toISOString()
    });
    saveSchedule();

    scheduleStep[id] = null;
    scheduleData[id] = null;

    const timeShow = targetTime.toLocaleString('en-US', { timeZone: 'Asia/Dhaka' });

    return ctx.reply(
      `✅ **Post Scheduled Successfully!**\n\n` +
      `📅 Scheduled Time: \`${timeShow}\`\n\n` +
      `The bot will automatically publish the post to all your channels at this exact time.`
    );
  }
});

// Background scheduler (Auto-Cleaner Integrated for scheduled posts too)
setInterval(async () => {
  if (scheduledPosts.length === 0) return;

  const now = new Date();
  let hasChanges = false;

  for (let i = scheduledPosts.length - 1; i >= 0; i--) {
    const post = scheduledPosts[i];
    const postTime = new Date(post.time);

    if (postTime <= now) {
      let success = 0;
      let failed = 0;

      // Clean post text and get buttons for scheduled posts
      const { text: cleanedCaption, replyMarkup } = processPost(post.caption);

      for (const channel of channels) {
        try {
          await bot.telegram.sendPhoto(channel, post.file_id, {
            caption: cleanedCaption,
            parse_mode: "HTML",
            reply_markup: replyMarkup
          });
          success++;
        } catch (err) {
          failed++;
          console.error(`Failed scheduled post to ${channel}:`, err);
        }
      }

      try {
        await bot.telegram.sendMessage(
          ADMIN_ID,
          `⏰ **Scheduled Post Update:**\n\n` +
          `One of your scheduled posts has been successfully sent with auto-buttons.\n` +
          `✅ Success: ${success}\n` +
          `❌ Failed: ${failed}`
        );
      } catch (e) {}

      scheduledPosts.splice(i, 1);
      hasChanges = true;
    }
  }

  if (hasChanges) {
    saveSchedule();
  }
}, 30000);

// Global error handling
bot.catch((err, ctx) => {
  console.error("BOT ERROR :", err);
  if (ctx) {
    try {
      ctx.reply("❌ An error occurred! Please try again.");
    } catch (e) {}
  }
});

// Start the bot & Set Menu Button
bot.launch().then(() => {
  console.log("✅ Bot Started Successfully with Link Cleaner & Auto-Buttons!");
  bot.telegram.setMyCommands([
    { command: "start", description: "Open Main Control Panel" }
  ]).catch((err) => console.error("Failed to set menu command:", err));
});

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
