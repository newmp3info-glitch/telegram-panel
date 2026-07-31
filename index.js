const { Telegraf, Markup } = require("telegraf");
const { BOT_TOKEN, ADMIN_ID } = require("./config");
const http = require("http");
const fs = require("fs");

const bot = new Telegraf(BOT_TOKEN);

let channels = [];
let scheduledPosts = [];
let sentPostsHistory = [];
let lastSentPosts = {};

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
    // Ensure every scheduled post has a unique ID
    scheduledPosts = scheduledPosts.map(p => ({
      id: p.id || (Date.now().toString() + Math.random().toString(36).substr(2, 9)),
      file_id: p.file_id,
      caption: p.caption,
      time: p.time
    }));
  } catch (e) {
    scheduledPosts = [];
  }
}

// Load sent posts history for smart delete
if (fs.existsSync("sent_history.json")) {
  try {
    sentPostsHistory = JSON.parse(fs.readFileSync("sent_history.json", "utf8"));
  } catch (e) {
    sentPostsHistory = [];
  }
}

// Load last sent post IDs for quick edit
if (fs.existsSync("last_posts.json")) {
  try {
    lastSentPosts = JSON.parse(fs.readFileSync("last_posts.json", "utf8"));
  } catch (e) {
    lastSentPosts = {};
  }
}

// State management variables
let waitingChannel = {};
let waitingRemove = {};
let postStep = {};
let editStep = {};
let deleteStep = {};
let scheduleStep = {};
let scheduleData = {};

// 📱 Bot Main Menu Keyboard Layout (Bottom button added for Scheduled Posts)
const mainKeyboard = Markup.keyboard([
  ["📝 Create Post", "⏰ Schedule Post"],
  ["📋 Channel List", "✏️ Edit Post"],
  ["🗑️ Delete Post", "➕ Add Channel"],
  ["❌ Remove Channel"],
  ["⏳ Scheduled Posts"]
]).resize();

function saveChannels() {
  fs.writeFileSync("channels.json", JSON.stringify(channels, null, 2));
}

function saveSchedule() {
  fs.writeFileSync("schedule.json", JSON.stringify(scheduledPosts, null, 2));
}

function saveSentHistory() {
  fs.writeFileSync("sent_history.json", JSON.stringify(sentPostsHistory, null, 2));
}

function saveLastPosts() {
  fs.writeFileSync("last_posts.json", JSON.stringify(lastSentPosts, null, 2));
}

function resetStates(id) {
  waitingChannel[id] = false;
  waitingRemove[id] = false;
  postStep[id] = null;
  editStep[id] = null;
  deleteStep[id] = null;
  scheduleStep[id] = null;
  scheduleData[id] = null;
}

// 🤖 AUTOMATIC 5-BUTTON PARSER FOR CHANNEL POSTS
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
  
  // 🎨 5 Inline Buttons Layout for Channel Posts
  const inlineKeyboard = [
    [
      { text: "🎰 𝗡𝗲𝘄 𝗚𝗮𝗺𝗲 𝟰𝟱", url: "https://t.me/VipYonoFreeCode/3783", style: "primary" },
      { text: "𝗧𝗼𝘁𝗮𝗹 𝗚𝗮𝗺𝗲 𝟳𝟬 🎰", url: "https://t.me/AllYonoRummyCode/138", style: "primary" }
    ],
    [
      { text: "👆 𝗔𝗟𝗟 𝗚𝗔𝗠𝗘𝗦 👆", url: "https://t.me/TotalYonoCode/3", style: "success" },
      { text: "​🤖 𝗣𝗿𝗼𝗺𝗼 𝗖𝗼𝗱𝗲 𝗕𝗼𝘁 🤖", url: "https://t.me/spin_crush_bot", style: "success" }
    ],
    [
      { text: "🔥 𝗬𝗼𝗻𝗼 𝗠𝗮𝘀𝘁𝗮𝗿 𝗔𝗽𝗽 🔥", url: "https://www.fastyonoapp.online", style: "primary" }
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

bot.hears("➕ Add Channel", (ctx) => {
  const id = ctx.from.id;
  resetStates(id);
  waitingChannel[id] = true;
  ctx.reply("📢 Send all channel usernames together (one per line or space separated):");
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

// ⏳ Scheduled Posts Button Handler (Compact List View with Cross Delete Buttons)
bot.hears("⏳ Scheduled Posts", async (ctx) => {
  resetStates(ctx.from.id);
  if (scheduledPosts.length === 0) {
    return ctx.reply("❌ No scheduled posts found.");
  }
  
  let text = `⏳ **Scheduled Posts List (${scheduledPosts.length}):**\n\n`;
  let inlineKeyboard = [];

  scheduledPosts.forEach((post, i) => {
    const postTime = new Date(post.time).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const shortCaption = post.caption ? (post.caption.length > 40 ? post.caption.substring(0, 40) + "..." : post.caption) : "Photo Post";
    
    text += `${i + 1}. 🕒 **Time:** ${postTime}\n📝 <i>${shortCaption}</i>\n\n`;
    
    inlineKeyboard.push([
      { text: `❌ Delete Post #${i + 1}`, callback_data: `del_sched_${post.id}` }
    ]);
  });

  await ctx.reply(text, {
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: inlineKeyboard }
  });
});

// Handle deletion of specific scheduled post via ❌ inline button (Updates list instantly)
bot.action(/^del_sched_(.+)$/, async (ctx) => {
  const scheduleId = ctx.match[1];
  const index = scheduledPosts.findIndex(p => p.id === scheduleId);
  
  if (index === -1) {
    return ctx.answerCbQuery("❌ Scheduled post already deleted or not found!");
  }

  scheduledPosts.splice(index, 1);
  saveSchedule();

  await ctx.answerCbQuery("✅ Scheduled post deleted successfully!");

  if (scheduledPosts.length === 0) {
    try {
      await ctx.editMessageText("❌ **All scheduled posts have been deleted. List is now empty.**", { parse_mode: "HTML" });
    } catch (e) {}
  } else {
    let text = `⏳ **Scheduled Posts List (${scheduledPosts.length}):**\n\n`;
    let inlineKeyboard = [];

    scheduledPosts.forEach((post, i) => {
      const postTime = new Date(post.time).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
      const shortCaption = post.caption ? (post.caption.length > 40 ? post.caption.substring(0, 40) + "..." : post.caption) : "Photo Post";
      
      text += `${i + 1}. 🕒 **Time:** ${postTime}\n📝 <i>${shortCaption}</i>\n\n`;
      
      inlineKeyboard.push([
        { text: `❌ Delete Post #${i + 1}`, callback_data: `del_sched_${post.id}` }
      ]);
    });

    try {
      await ctx.editMessageText(text, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: inlineKeyboard }
      });
    } catch (e) {}
  }
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
  if (channels.length === 0) return ctx.reply("❌ No channels found.");
  editStep[id] = "waiting_new_text";
  ctx.reply("✏️ **Send the new text/caption.**\nIt will instantly update the latest broadcasted post across all your channels!");
});

// 🗑️ Delete Post Handler (Prompt for post text)
bot.hears("🗑️ Delete Post", (ctx) => {
  const id = ctx.from.id;
  resetStates(id);
  if (channels.length === 0) return ctx.reply("❌ No channels found.");
  deleteStep[id] = "waiting_delete_text";
  ctx.reply("🗑️ **Send the text (or caption) of the post you want to delete from all channels:**");
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
    let channelMessages = {};

    for (const channel of channels) {
      try {
        const sentMsg = await bot.telegram.sendPhoto(channel, file.file_id, {
          caption: cleanedCaption,
          parse_mode: "HTML",
          reply_markup: replyMarkup
        });
        lastSentPosts[channel] = sentMsg.message_id;
        channelMessages[channel] = sentMsg.message_id;
        success++;
      } catch (err) { failed++; }
    }
    
    sentPostsHistory.unshift({ text: caption, channelMessages, time: Date.now() });
    if (sentPostsHistory.length > 50) sentPostsHistory.pop();
    saveSentHistory();
    saveLastPosts();

    return ctx.reply(`✅ Post Completed & Saved for Quick Edit/Delete\n\nSuccess: ${success}\nFailed: ${failed}`);
  }

  if (scheduleStep[id] === "waiting_post") {
    const photos = ctx.message.photo;
    scheduleData[id] = { file_id: photos[photos.length - 1].file_id, caption: ctx.message.caption || "" };
    scheduleStep[id] = "waiting_time";
    return ctx.reply("📷 Photo Received! Send schedule duration in minutes OR Date & Time with AM/PM (e.g., **01/08/2026, 09:00 am** or **30 09:00 AM**):");
  }
});

bot.on("text", async (ctx) => {
  const id = ctx.from.id;
  const text = ctx.message.text.trim();

  if (waitingChannel[id]) {
    waitingChannel[id] = false;
    
    const foundChannels = text.match(/@[^\s]+/g);
    if (!foundChannels || foundChannels.length === 0) {
      return ctx.reply("❌ No valid channel usernames found starting with '@'.");
    }

    let addedCount = 0;
    let alreadyCount = 0;

    foundChannels.forEach(ch => {
      const cleanCh = ch.trim();
      if (!channels.includes(cleanCh)) {
        channels.push(cleanCh);
        addedCount++;
      } else {
        alreadyCount++;
      }
    });

    saveChannels();
    return ctx.reply(`✅ **Channels Added Successfully!**\n\n➕ Newly Added: ${addedCount}\n⚠️ Already Exists: ${alreadyCount}\n📢 Total Channels Now: ${channels.length}`);
  }

  if (waitingRemove[id]) {
    waitingRemove[id] = false;
    const index = channels.indexOf(text);
    if (index === -1) return ctx.reply("❌ Channel Not Found");
    channels.splice(index, 1);
    saveChannels();
    return ctx.reply("✅ Channel Removed");
  }

  if (editStep[id] === "waiting_new_text") {
    editStep[id] = null;
    const { text: cleanedCaption, replyMarkup } = processPost(text);
    let success = 0, failed = 0;

    for (const channel of channels) {
      if (lastSentPosts[channel]) {
        try {
          await bot.telegram.editMessageCaption(channel, lastSentPosts[channel], null, cleanedCaption, {
            parse_mode: "HTML",
            reply_markup: replyMarkup
          });
          success++;
        } catch (err) {
          failed++;
        }
      } else {
        failed++;
      }
    }
    return ctx.reply(`✅ **All Channel Posts Edited Successfully!**\n\nSuccess: ${success}\nFailed: ${failed}`);
  }

  if (deleteStep[id] === "waiting_delete_text") {
    deleteStep[id] = null;
    const targetPostIndex = sentPostsHistory.findIndex(p => p.text.includes(text) || text.includes(p.text.substring(0, 15)));
    if (targetPostIndex === -1) {
      return ctx.reply("❌ No matching sent post found with this text! Please make sure you paste the correct caption text.");
    }

    const postToDelete = sentPostsHistory[targetPostIndex];
    let success = 0, failed = 0;
    for (const [channel, msgId] of Object.entries(postToDelete.channelMessages)) {
      try {
        await bot.telegram.deleteMessage(channel, msgId);
        success++;
      } catch (err) {
        failed++;
      }
    }

    sentPostsHistory.splice(targetPostIndex, 1);
    saveSentHistory();
    return ctx.reply(`🗑️ **Post Deleted Successfully from Channels!**\n\nSuccess: ${success}\nFailed: ${failed}`);
  }

  if (scheduleStep[id] === "waiting_time") {
    let targetTime;
    if (/^\d+$/.test(text)) {
      targetTime = new Date(Date.now() + parseInt(text) * 60 * 1000);
    } else {
      const matchSimple = text.match(/^(\d{1,2})[,\s]+(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)$/i);
      const matchFull = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})[,\s]+(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)$/i);

      let day, month, year, hour, minute, period;
      const now = new Date();

      if (matchSimple) {
        day = parseInt(matchSimple[1]);
        month = now.getMonth() + 1;
        year = now.getFullYear();
        hour = parseInt(matchSimple[2]);
        minute = parseInt(matchSimple[3]);
        period = matchSimple[4].toUpperCase();
      } else if (matchFull) {
        day = parseInt(matchFull[1]);
        month = parseInt(matchFull[2]);
        year = parseInt(matchFull[3]);
        hour = parseInt(matchFull[4]);
        minute = parseInt(matchFull[5]);
        period = matchFull[6].toUpperCase();
      }

      if (period === "PM" && hour < 12) hour += 12;
      if (period === "AM" && hour === 12) hour = 0;

      if (day && month && year && !isNaN(hour)) {
        const fMonth = String(month).padStart(2, '0');
        const fDay = String(day).padStart(2, '0');
        const fHour = String(hour).padStart(2, '0');
        const fMin = String(minute).padStart(2, '0');

        // Indian Standard Time (+05:30) offset applied
        targetTime = new Date(`${year}-${fMonth}-${fDay}T${fHour}:${fMin}:00+05:30`);
      }
    }

    if (!targetTime || isNaN(targetTime.getTime())) return ctx.reply("❌ Invalid time format! Use minutes (e.g., `30`) or Date & Time (e.g., `01/08/2026, 09:00 am`).");

    const scheduleId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    scheduledPosts.push({ id: scheduleId, file_id: scheduleData[id].file_id, caption: scheduleData[id].caption, time: targetTime.toISOString() });
    saveSchedule();
    scheduleStep[id] = null;
    scheduleData[id] = null;
    return ctx.reply(`✅ Post Scheduled for (IST): ${targetTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
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
      let channelMessages = {};
      for (const channel of channels) {
        try {
          const sentMsg = await bot.telegram.sendPhoto(channel, post.file_id, { 
            caption: cleanedCaption, 
            parse_mode: "HTML", 
            reply_markup: replyMarkup 
          });
          lastSentPosts[channel] = sentMsg.message_id;
          channelMessages[channel] = sentMsg.message_id;
        } catch (e) {}
      }
      sentPostsHistory.unshift({ text: post.caption, channelMessages, time: Date.now() });
      if (sentPostsHistory.length > 50) sentPostsHistory.pop();
      saveSentHistory();
      saveLastPosts();
      
      scheduledPosts.splice(i, 1);
      hasChanges = true;
    }
  }
  if (hasChanges) saveSchedule();
}, 30000);

bot.launch().then(() => {
  console.log("✅ Bot launched successfully.");
});

const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Bot Engine Online");
}).listen(PORT);
