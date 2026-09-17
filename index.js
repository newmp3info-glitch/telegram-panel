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
    scheduledPosts = scheduledPosts.map(p => ({
      id: p.id || (Date.now().toString() + Math.random().toString(36).substr(2, 9)),
      file_id: p.file_id,
      imageUrl: p.imageUrl,
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

// 📱 Bot Main Menu Keyboard Layout
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
  
  cleanedText = cleanedText.replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
  
  const inlineKeyboard = [
    [
      { text: "🎰 𝗡𝗲𝘄 𝗚𝗮𝗺𝗲 𝟰𝟱", url: "https://t.me/VipYonoFreeCode/3783", style: "primary" },
      { text: "𝗧𝗼𝘁𝗮𝗹 𝗚𝗮𝗺𝗲 𝟳𝟬 🎰", url: "https://t.me/AllYonoRummyCode/138", style: "primary" }
    ],
    [
      { text: " 🤖 𝗬𝗼𝗻𝗼 𝗔𝗜 𝗕𝗼𝘁 🤖", url: "https://t.me/YonoGamingHeadAIBot", style: "success" },
      { text: "​🤖 𝗣𝗿𝗼𝗺𝗼 𝗖𝗼𝗱𝗲 𝗕𝗼𝘁 🤖", url: "https://t.me/spin_crush_bot", style: "success" }
    ],
    [
      { text: "🔥 𝗬𝗼𝗻𝗼 𝗠𝗮𝘀𝘁𝗲𝗿 𝗔𝗽𝗽 🔥", url: "https://www.fastyonoapp.online", style: "primary" }
    ]
  ];
  
  const replyMarkup = { inline_keyboard: inlineKeyboard };
  return { text: cleanedText, replyMarkup };
}

// 🔍 Smart Dynamic Image Mapper from GitHub Photo Folder
function getImageUrlFromText(postText) {
  const textLower = postText.toLowerCase();
  
  const repoOwner = "newmp3info-glitch"; 
  const repoName = "telegram-panel";
  const branch = "main";

  // HTML ট্যাগ রিমুভ করে প্রথম লাইন বা গেমের নাম বের করা
  let cleanText = textLower.replace(/<[^>]*>/g, '');
  let firstPart = cleanText.split('➝')[0] || cleanText.split('\n')[0] || '';
  
  let imageName = firstPart
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-') + '.jpg';
    
  // বিশেষ কিছু ফাইলের নাম হ্যান্ডেল করার জন্য
  if (imageName.includes('101z')) imageName = '101-z.jpg';
  else if (imageName.includes('567slots')) imageName = '567-slots.jpg';
  else if (imageName.includes('789jackpots')) imageName = '789-jackpots.jpg';
  else if (imageName.includes('777game')) imageName = '777-game.jpg';

  return `https://raw.githubusercontent.com/${repoOwner}/${repoName}/${branch}/Photo/${imageName}`;
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

// ⏳ Scheduled Posts Button Handler
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
  postStep[id] = "waiting_post_text";
  ctx.reply("📝 **Send your post text/HTML code now:**\n(একাধিক পোস্ট পাঠাতে চাইলে প্রতিটির মাঝে `✅✅✅✅✅` দিন)");
});

bot.hears("⏰ Schedule Post", (ctx) => {
  const id = ctx.from.id;
  resetStates(id);
  scheduleStep[id] = "waiting_post_text";
  ctx.reply("⏰ **Send your post text/HTML code for schedule:**");
});

bot.hears("✏️ Edit Post", (ctx) => {
  const id = ctx.from.id;
  resetStates(id);
  if (channels.length === 0) return ctx.reply("❌ No channels found.");
  editStep[id] = "waiting_new_text";
  ctx.reply("✏️ **Send the new text/caption.**\nIt will instantly update the latest broadcasted post across all your channels!");
});

bot.hears("🗑️ Delete Post", (ctx) => {
  const id = ctx.from.id;
  resetStates(id);
  if (channels.length === 0) return ctx.reply("❌ No channels found.");
  deleteStep[id] = "waiting_delete_text";
  ctx.reply("🗑️ **Send the text (or caption) of the post you want to delete from all channels:**");
});

bot.on("text", async (ctx) => {
  const id = ctx.from.id;
  const text = ctx.message.text.trim();

  if (waitingChannel[id]) {
    waitingChannel[id] = false;
    
    const foundChannels = text.match(/@[^\s]+/g);
    if (!foundChannels || foundChannels.length === 0) {
      return ctx.reply("❌ No valid channel usernames found starting '@'.");
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
      return ctx.reply("❌ No matching sent post found with this text!");
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

  // 🚀 CREATE POST HANDLER
  if (postStep[id] === "waiting_post_text") {
    postStep[id] = null;
    if (channels.length === 0) return ctx.reply("❌ No channels found. Please add a channel first.");

    const rawPosts = text.includes("✅✅✅✅✅") 
      ? text.split("✅✅✅✅✅").map(p => p.trim()).filter(p => p.length > 0)
      : [text];

    await ctx.reply(`🚀 **Processing Started!**\nFound **${rawPosts.length}** post(s). Sending to channels...`);

    let totalSentCount = 0;

    for (let i = 0; i < rawPosts.length; i++) {
      const singlePostText = rawPosts[i];
      const imageUrl = getImageUrlFromText(singlePostText);
      const { text: cleanedCaption, replyMarkup } = processPost(singlePostText);

      let channelMessages = {};

      for (const channel of channels) {
        let sent = false;
        let retries = 3;
        while (!sent && retries > 0) {
          try {
            const sentMsg = await bot.telegram.sendPhoto(channel, imageUrl, {
              caption: cleanedCaption,
              parse_mode: "HTML",
              reply_markup: replyMarkup
            });
            lastSentPosts[channel] = sentMsg.message_id;
            channelMessages[channel] = sentMsg.message_id;
            sent = true;
          } catch (err) {
            console.error(`Error sending to ${channel}:`, err.message);
            if (err.response && err.response.parameters && err.response.parameters.retry_after) {
              const waitSec = err.response.parameters.retry_after + 2;
              await new Promise(r => setTimeout(r, waitSec * 1000));
              retries--;
            } else {
              break;
            }
          }
        }
        await new Promise(r => setTimeout(r, 1500));
      }

      if (Object.keys(channelMessages).length > 0) {
        sentPostsHistory.unshift({ text: singlePostText, channelMessages, time: Date.now() });
        totalSentCount++;
      }

      if (sentPostsHistory.length > 100) sentPostsHistory.pop();
      saveSentHistory();
      saveLastPosts();

      if (i < rawPosts.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    return ctx.reply(`✅ **Finished! Successfully sent ${totalSentCount} out of ${rawPosts.length} post(s) to your channels.**`);
  }

  if (scheduleStep[id] === "waiting_post_text") {
    scheduleData[id] = { caption: text };
    scheduleStep[id] = "waiting_time";
    return ctx.reply("📝 Post Text Saved! Send schedule duration in minutes OR Date & Time with AM/PM:");
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

        targetTime = new Date(`${year}-${fMonth}-${fDay}T${fHour}:${fMin}:00+05:30`);
      }
    }

    if (!targetTime || isNaN(targetTime.getTime())) return ctx.reply("❌ Invalid time format!");

    const scheduleId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const imageUrl = getImageUrlFromText(scheduleData[id].caption);
    
    scheduledPosts.push({ 
      id: scheduleId, 
      imageUrl: imageUrl, 
      caption: scheduleData[id].caption, 
      time: targetTime.toISOString() 
    });
    
    saveSchedule();
    scheduleStep[id] = null;
    scheduleData[id] = null;
    return ctx.reply(`✅ Post Scheduled for (IST): ${targetTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
  }

  // 🚀 AUTO-DETECT BULK POST
  if (text.includes("✅✅✅✅✅")) {
    if (channels.length === 0) return ctx.reply("❌ No channels found. Please add a channel first.");

    const rawPosts = text.split("✅✅✅✅✅").map(p => p.trim()).filter(p => p.length > 0);

    if (rawPosts.length === 0) {
      return ctx.reply("❌ No valid posts found separated by `✅✅✅✅✅`.");
    }

    await ctx.reply(`🚀 **Bulk Processing Started!**\nFound **${rawPosts.length}** posts. Sending...`);

    let totalSentCount = 0;

    for (let i = 0; i < rawPosts.length; i++) {
      const singlePostText = rawPosts[i];
      const imageUrl = getImageUrlFromText(singlePostText);
      const { text: cleanedCaption, replyMarkup } = processPost(singlePostText);

      let channelMessages = {};

      for (const channel of channels) {
        let sent = false;
        let retries = 3;
        while (!sent && retries > 0) {
          try {
            const sentMsg = await bot.telegram.sendPhoto(channel, imageUrl, {
              caption: cleanedCaption,
              parse_mode: "HTML",
              reply_markup: replyMarkup
            });
            lastSentPosts[channel] = sentMsg.message_id;
            channelMessages[channel] = sentMsg.message_id;
            sent = true;
          } catch (err) {
            console.error(`Error sending to ${channel}:`, err.message);
            if (err.response && err.response.parameters && err.response.parameters.retry_after) {
              const waitSec = err.response.parameters.retry_after + 2;
              await new Promise(r => setTimeout(r, waitSec * 1000));
              retries--;
            } else {
              break;
            }
          }
        }
        await new Promise(r => setTimeout(r, 1500));
      }

      if (Object.keys(channelMessages).length > 0) {
        sentPostsHistory.unshift({ text: singlePostText, channelMessages, time: Date.now() });
        totalSentCount++;
      }

      if (sentPostsHistory.length > 100) sentPostsHistory.pop();
      saveSentHistory();
      saveLastPosts();

      if (i < rawPosts.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    return ctx.reply(`✅ **Successfully sent ${totalSentCount} out of ${rawPosts.length} posts to your channels!**`);
  }

  return ctx.reply("❌ Unknown command or text. Click '📝 Create Post' or send posts containing `✅✅✅✅✅`.");
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
          const sentMsg = await bot.telegram.sendPhoto(channel, post.imageUrl, { 
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
