const { Telegraf, Markup } = require("telegraf");
const { BOT_TOKEN, ADMIN_ID } = require("./config");
const http = require("http");
const fs = require("fs");

const bot = new Telegraf(BOT_TOKEN);

let channels = [];
let scheduledPosts = [];
let sentPostsHistory = [];
let lastSentPosts = {};

// ============================================================
// 📁 LOAD CHANNEL DATA
// ============================================================

if (fs.existsSync("channels.json")) {
  try {
    channels = JSON.parse(
      fs.readFileSync("channels.json", "utf8")
    );
  } catch (e) {
    channels = [];
  }
}

// ============================================================
// 📁 LOAD SCHEDULE DATA
// ============================================================

if (fs.existsSync("schedule.json")) {
  try {
    scheduledPosts = JSON.parse(
      fs.readFileSync("schedule.json", "utf8")
    );

    scheduledPosts = scheduledPosts.map(p => ({
      id:
        p.id ||
        (
          Date.now().toString() +
          Math.random().toString(36).substr(2, 9)
        ),
      file_id: p.file_id,
      imageUrl: p.imageUrl,
      caption: p.caption,
      time: p.time
    }));
  } catch (e) {
    scheduledPosts = [];
  }
}

// ============================================================
// 📁 LOAD SENT HISTORY
// ============================================================

if (fs.existsSync("sent_history.json")) {
  try {
    sentPostsHistory = JSON.parse(
      fs.readFileSync("sent_history.json", "utf8")
    );
  } catch (e) {
    sentPostsHistory = [];
  }
}

// ============================================================
// 📁 LOAD LAST SENT POSTS
// ============================================================

if (fs.existsSync("last_posts.json")) {
  try {
    lastSentPosts = JSON.parse(
      fs.readFileSync("last_posts.json", "utf8")
    );
  } catch (e) {
    lastSentPosts = {};
  }
}

// ============================================================
// 🔄 STATE MANAGEMENT
// ============================================================

let waitingChannel = {};
let waitingRemove = {};
let postStep = {};
let editStep = {};
let deleteStep = {};
let scheduleStep = {};
let scheduleData = {};

// ============================================================
// 📱 MAIN MENU
// ============================================================

const mainKeyboard = Markup.keyboard([
  ["📝 Create Post", "⏰ Schedule Post"],
  ["📋 Channel List", "✏️ Edit Post"],
  ["🗑️ Delete Post", "➕ Add Channel"],
  ["❌ Remove Channel"],
  ["⏳ Scheduled Posts"]
]).resize();

// ============================================================
// 💾 SAVE FUNCTIONS
// ============================================================

function saveChannels() {
  fs.writeFileSync(
    "channels.json",
    JSON.stringify(channels, null, 2)
  );
}

function saveSchedule() {
  fs.writeFileSync(
    "schedule.json",
    JSON.stringify(scheduledPosts, null, 2)
  );
}

function saveSentHistory() {
  fs.writeFileSync(
    "sent_history.json",
    JSON.stringify(sentPostsHistory, null, 2)
  );
}

function saveLastPosts() {
  fs.writeFileSync(
    "last_posts.json",
    JSON.stringify(lastSentPosts, null, 2)
  );
}

// ============================================================
// 🔄 RESET STATES
// ============================================================

function resetStates(id) {
  waitingChannel[id] = false;
  waitingRemove[id] = false;
  postStep[id] = null;
  editStep[id] = null;
  deleteStep[id] = null;
  scheduleStep[id] = null;
  scheduleData[id] = null;
}

// ============================================================
// 🤖 POST PROCESSOR
// IMPORTANT:
// এখানে আর URL থাকা কোনো LINE delete করা হবে না.
// তাই game link / HTML link / Markdown link কাটা যাবে না.
// ============================================================

function processPost(caption) {
  if (!caption) {
    return {
      text: "",
      replyMarkup: null
    };
  }

  // পুরো পোস্ট 그대로 রাখা হবে
  const cleanedText = caption.trim();

  const inlineKeyboard = [
    [
      {
        text: "🎰 𝗡𝗲𝘄 𝗚𝗮𝗺𝗲 𝟰𝟱",
        url: "https://t.me/VipYonoFreeCode/3783"
      },
      {
        text: "𝗧𝗼𝘁𝗮𝗹 𝗚𝗮𝗺𝗲 𝟳𝟬 🎰",
        url: "https://t.me/AllYonoRummyCode/138"
      }
    ],
    [
      {
        text: "🤖 𝗬𝗼𝗻𝗼 𝗔𝗜 𝗕𝗼𝘁 🤖",
        url: "https://t.me/YonoGamingHeadAIBot"
      },
      {
        text: "🤖 𝗣𝗿𝗼𝗺𝗼 𝗖𝗼𝗱𝗲 𝗕𝗼𝘁 🤖",
        url: "https://t.me/spin_crush_bot"
      }
    ],
    [
      {
        text: "🔥 𝗬𝗼𝗻𝗼 𝗠𝗮𝘀𝘁𝗲𝗿 𝗔𝗽𝗽 🔥",
        url: "https://www.fastyonoapp.online"
      }
    ]
  ];

  return {
    text: cleanedText,
    replyMarkup: {
      inline_keyboard: inlineKeyboard
    }
  };
}

// ============================================================
// 🔍 EXACT IMAGE FILENAMES MAPPING
// ============================================================

function getImageUrlFromText(postText) {
  const textLower = postText.toLowerCase();

  const repoOwner = "newmp3info-glitch";
  const repoName = "telegram-panel";
  const branch = "main";

  let imageName = "yono-rummy.jpg";

  if (
    textLower.includes("101-z") ||
    textLower.includes("101z")
  )
    imageName = "101-z.jpg";

  else if (
    textLower.includes("567-slots") ||
    textLower.includes("567slots")
  )
    imageName = "567-slots.jpg";

  else if (
    textLower.includes("777-game") ||
    textLower.includes("777game")
  )
    imageName = "777-game.jpg";

  else if (
    textLower.includes("789-jackpots") ||
    textLower.includes("789jackpots")
  )
    imageName = "789-jackpots.jpg";

  else if (
    textLower.includes("abc rummy") ||
    textLower.includes("abc-rummy")
  )
    imageName = "abc-rummy.jpg";

  else if (
    textLower.includes("bet-213") ||
    textLower.includes("bet213")
  )
    imageName = "bet-213.jpg";

  else if (
    textLower.includes("bingo-101") ||
    textLower.includes("bingo101")
  )
    imageName = "bingo-101.jpg";

  else if (
    textLower.includes("boss rummy") ||
    textLower.includes("boss-rummy")
  )
    imageName = "boss-rummy.jpg";

  else if (
    textLower.includes("club inr") ||
    textLower.includes("club-inr")
  )
    imageName = "club-inr.jpg";

  else if (
    textLower.includes("dhan game") ||
    textLower.includes("dhan-game")
  )
    imageName = "dhan-game.jpg";

  else if (
    textLower.includes("ever 777") ||
    textLower.includes("ever-777")
  )
    imageName = "ever-777.jpg";

  else if (
    textLower.includes("game rummy") ||
    textLower.includes("game-rummy")
  )
    imageName = "game-rummy.jpg";

  else if (
    textLower.includes("gogo rummy") ||
    textLower.includes("gogo-rummy")
  )
    imageName = "gogo-rummy.jpg";

  else if (
    textLower.includes("gold rummy") ||
    textLower.includes("gold-rummy")
  )
    imageName = "gold-rummy.jpg";

  else if (
    textLower.includes("hi rummy") ||
    textLower.includes("hi-rummy")
  )
    imageName = "hi-rummy.jpg";

  else if (
    textLower.includes("hindi 777") ||
    textLower.includes("hindi-777")
  )
    imageName = "hindi-777.jpg";

  else if (
    textLower.includes("ind club") ||
    textLower.includes("ind-club")
  )
    imageName = "ind-club.jpg";

  else if (
    textLower.includes("ind rummy") ||
    textLower.includes("ind-rummy")
  )
    imageName = "ind-rummy.jpg";

  else if (
    textLower.includes("ind slots") ||
    textLower.includes("ind-slots")
  )
    imageName = "ind-slots.jpg";

  else if (
    textLower.includes("inr rummy") ||
    textLower.includes("inr-rummy")
  )
    imageName = "inr-rummy.jpg";

  else if (
    textLower.includes("jaiho 777") ||
    textLower.includes("jaiho-777-vip")
  )
    imageName = "jaiho-777-vip.jpg";

  else if (
    textLower.includes("jaiho 91") ||
    textLower.includes("jaiho-91")
  )
    imageName = "jaiho-91.jpg";

  else if (
    textLower.includes("jaiho arcade") ||
    textLower.includes("jaiho-arcade")
  )
    imageName = "jaiho-arcade.jpg";

  else if (
    textLower.includes("jaiho rummy") ||
    textLower.includes("jaiho-rummy")
  )
    imageName = "jaiho-rummy.jpg";

  else if (
    textLower.includes("jaiho slots") ||
    textLower.includes("jaihslots") ||
    textLower.includes("jaiho-slots")
  )
    imageName = "jaiho-slots.jpg";

  else if (
    textLower.includes("jaiho spin") ||
    textLower.includes("jaihospin") ||
    textLower.includes("jaiho-spin")
  )
    imageName = "jaiho-spin.jpg";

  else if (
    textLower.includes("jaiho win") ||
    textLower.includes("jaiho-win")
  )
    imageName = "jaiho-win.jpg";

  else if (
    textLower.includes("joy rummy") ||
    textLower.includes("joy-rummy")
  )
    imageName = "joy-rummy.jpg";

  else if (
    textLower.includes("love rummy") ||
    textLower.includes("love-rummy")
  )
    imageName = "love-rummy.jpg";

  else if (
    textLower.includes("maha games") ||
    textLower.includes("maha-games")
  )
    imageName = "maha-games.jpg";

  else if (
    textLower.includes("max rummy") ||
    textLower.includes("max-rummy")
  )
    imageName = "max-rummy.jpg";

  else if (
    textLower.includes("mbm bet") ||
    textLower.includes("mbm-bet")
  )
    imageName = "mbm-bet.jpg";

  else if (
    textLower.includes("money rummy") ||
    textLower.includes("money-rummy")
  )
    imageName = "money-rummy.jpg";

  else if (
    textLower.includes("neta vip") ||
    textLower.includes("neta-vip")
  )
    imageName = "neta-vip.jpg";

  else if (
    textLower.includes("ok rummy") ||
    textLower.includes("ok-rummy")
  )
    imageName = "ok-rummy.jpg";

  else if (
    textLower.includes("rumble rummy") ||
    textLower.includes("rumble-rummy")
  )
    imageName = "rumble-rummy.jpg";

  else if (
    textLower.includes("rummy 77") ||
    textLower.includes("rummy-77")
  )
    imageName = "rummy-77.jpg";

  else if (
    textLower.includes("rummy 888") ||
    textLower.includes("rummy-888")
  )
    imageName = "rummy-888.jpg";

  else if (
    textLower.includes("rummy 91") ||
    textLower.includes("rummy-91")
  )
    imageName = "rummy-91.jpg";

  else if (
    textLower.includes("rummy ludo") ||
    textLower.includes("rummy-ludo")
  )
    imageName = "rummy-ludo.jpg";

  else if (
    textLower.includes("saga slots") ||
    textLower.includes("saga-slots")
  )
    imageName = "saga-slots.jpg";

  else if (
    textLower.includes("share slots") ||
    textLower.includes("share-slots")
  )
    imageName = "share-slots.jpg";

  else if (
    textLower.includes("slots spin") ||
    textLower.includes("slots-spin")
  )
    imageName = "slots-spin.jpg";

  else if (
    textLower.includes("slots winner") ||
    textLower.includes("slots-winner")
  )
    imageName = "slots-winner.jpg";

  else if (
    textLower.includes("spin 101") ||
    textLower.includes("spin101")
  )
    imageName = "spin-101.jpg";

  else if (
    textLower.includes("spin 777") ||
    textLower.includes("spin777")
  )
    imageName = "spin-777.jpg";

  else if (
    textLower.includes("spin crush") ||
    textLower.includes("spin-crush")
  )
    imageName = "spin-crush.jpg";

  else if (
    textLower.includes("spin gold") ||
    textLower.includes("spin-gold")
  )
    imageName = "spin-gold.jpg";

  else if (
    textLower.includes("spin winner") ||
    textLower.includes("spin-winner")
  )
    imageName = "spin-winner.jpg";

  else if (
    textLower.includes("top rummy") ||
    textLower.includes("top-rummy")
  )
    imageName = "top-rummy.jpg";

  else if (
    textLower.includes("win rummy") ||
    textLower.includes("win-rummy")
  )
    imageName = "win-rummy.jpg";

  else if (
    textLower.includes("yn 777") ||
    textLower.includes("yn777")
  )
    imageName = "yn-777.jpg";

  else if (
    textLower.includes("yono 777") ||
    textLower.includes("yono-777")
  )
    imageName = "yono-777.jpg";

  else if (
    textLower.includes("yono arcade") ||
    textLower.includes("yono-arcade")
  )
    imageName = "yono-arcade.jpg";

  else if (
    textLower.includes("yono games") ||
    textLower.includes("yono-games")
  )
    imageName = "yono-games.jpg";

  else if (
    textLower.includes("yono slots") ||
    textLower.includes("yono-slots")
  )
    imageName = "yono-slots.jpg";

  else if (
    textLower.includes("yono vip") ||
    textLower.includes("yono-vip")
  )
    imageName = "yono-vip.jpg";

  else if (
    textLower.includes("yes spin") ||
    textLower.includes("yes-spin")
  )
    imageName = "yes-spin.jpg";

  else if (
    textLower.includes("yono rummy") ||
    textLower.includes("yono-rummy")
  )
    imageName = "yono-rummy.jpg";

  return `https://raw.githubusercontent.com/${repoOwner}/${repoName}/${branch}/Photo/${imageName}`;
}

// ============================================================
// 🖼️ DOWNLOAD IMAGE FROM GITHUB
// ============================================================

async function downloadImageFromGitHub(imageUrl) {
  const response = await fetch(imageUrl, {
    method: "GET",
    redirect: "follow",
    headers: {
      "User-Agent": "Telegram-Panel-Bot/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(
      `GitHub image download failed: ${response.status} ${response.statusText}`
    );
  }

  const contentType =
    response.headers.get("content-type") || "";

  if (
    !contentType
      .toLowerCase()
      .startsWith("image/")
  ) {
    throw new Error(
      `GitHub URL did not return an image. Content-Type: ${contentType}`
    );
  }

  const arrayBuffer =
    await response.arrayBuffer();

  if (
    !arrayBuffer ||
    arrayBuffer.byteLength === 0
  ) {
    throw new Error(
      "Downloaded image is empty."
    );
  }

  return Buffer.from(arrayBuffer);
}

// ============================================================
// ✂️ SAFE TEXT CHUNKER
// Telegram normal text = max 4096 chars
// ============================================================

function splitTextSafely(text, maxLength = 4096) {
  if (!text) return [];

  if (text.length <= maxLength) {
    return [text];
  }

  const chunks = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let cutAt =
      remaining.lastIndexOf("\n", maxLength);

    if (cutAt < 100) {
      cutAt =
        remaining.lastIndexOf(" ", maxLength);
    }

    if (cutAt < 100) {
      cutAt = maxLength;
    }

    chunks.push(
      remaining.slice(0, cutAt).trim()
    );

    remaining =
      remaining.slice(cutAt).trim();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

// ============================================================
// 📦 SPLIT BULK POSTS
// ONLY split on:
// ✅✅✅✅✅
// ============================================================

function splitBulkPosts(text) {
  if (!text) return [];

  return text
    .split("✅✅✅✅✅")
    .map(post => post.trim())
    .filter(post => post.length > 0);
}

// ============================================================
// 📤 SEND ONE COMPLETE POST TO ONE CHANNEL
//
// Telegram photo caption max = 1024 chars.
// If longer:
// 1. Photo is sent first.
// 2. Full post is sent as text chunks.
// 3. No other post will be mixed into it.
// ============================================================

async function sendOnePostToChannel(
  channel,
  imageBuffer,
  caption,
  replyMarkup
) {
  const messageIds = [];

  // ----------------------------------------------------------
  // CASE 1: Caption fits Telegram photo caption limit
  // ----------------------------------------------------------

  if (caption.length <= 1024) {
    const sentMsg =
      await bot.telegram.sendPhoto(
        channel,
        {
          source: imageBuffer,
          filename: "game-photo.jpg"
        },
        {
          caption: caption,
          parse_mode: "HTML",
          reply_markup: replyMarkup
        }
      );

    messageIds.push(
      sentMsg.message_id
    );

    return messageIds;
  }

  // ----------------------------------------------------------
  // CASE 2: Caption is longer than 1024
  //
  // Photo without caption.
  // Then SAME post's complete text in chunks.
  // ----------------------------------------------------------

  const photoMsg =
    await bot.telegram.sendPhoto(
      channel,
      {
        source: imageBuffer,
        filename: "game-photo.jpg"
      },
      {
        reply_markup: replyMarkup
      }
    );

  messageIds.push(
    photoMsg.message_id
  );

  const textChunks =
    splitTextSafely(
      caption,
      4096
    );

  for (const chunk of textChunks) {
    const textMsg =
      await bot.telegram.sendMessage(
        channel,
        chunk,
        {
          parse_mode: "HTML"
        }
      );

    messageIds.push(
      textMsg.message_id
    );

    await new Promise(
      resolve =>
        setTimeout(resolve, 500)
    );
  }

  return messageIds;
}

// ============================================================
// 👮 ADMIN VERIFICATION
// ============================================================

bot.use(async (ctx, next) => {
  if (!ctx.from) return;

  if (ctx.chat.type !== "private") {
    return;
  }

  if (ctx.from.id != ADMIN_ID) {
    return ctx.reply(
      "⛔ Access Denied"
    );
  }

  return next();
});

// ============================================================
// /START
// ============================================================

bot.start((ctx) => {
  resetStates(ctx.from.id);

  ctx.reply(
    "🏠 Telegram Control Panel",
    mainKeyboard
  );
});

// ============================================================
// ➕ ADD CHANNEL
// ============================================================

bot.hears(
  "➕ Add Channel",
  (ctx) => {
    const id = ctx.from.id;

    resetStates(id);

    waitingChannel[id] = true;

    ctx.reply(
      "📢 Send all channel usernames together (one per line or space separated):"
    );
  }
);

// ============================================================
// 📋 CHANNEL LIST
// ============================================================

bot.hears(
  "📋 Channel List",
  (ctx) => {
    resetStates(ctx.from.id);

    if (channels.length === 0) {
      return ctx.reply(
        "❌ No Channel Added"
      );
    }

    let text =
      "📋 Channel List\n\n";

    channels.forEach(
      (ch, i) => {
        text += `${i + 1}. ${ch}\n`;
      }
    );

    ctx.reply(text);
  }
);

// ============================================================
// ❌ REMOVE CHANNEL
// ============================================================

bot.hears(
  "❌ Remove Channel",
  (ctx) => {
    const id = ctx.from.id;

    resetStates(id);

    waitingRemove[id] = true;

    if (channels.length === 0) {
      waitingRemove[id] = false;

      return ctx.reply(
        "❌ No Channel Found"
      );
    }

    let text =
      "Send Channel Username to Remove:\n\n";

    channels.forEach(ch => {
      text += `${ch}\n`;
    });

    ctx.reply(text);
  }
);

// ============================================================
// ⏳ SCHEDULED POSTS LIST
// ============================================================

bot.hears(
  "⏳ Scheduled Posts",
  async (ctx) => {
    resetStates(ctx.from.id);

    if (scheduledPosts.length === 0) {
      return ctx.reply(
        "❌ No scheduled posts found."
      );
    }

    let text =
      `⏳ **Scheduled Posts List (${scheduledPosts.length}):**\n\n`;

    let inlineKeyboard = [];

    scheduledPosts.forEach(
      (post, i) => {
        const postTime =
          new Date(post.time)
            .toLocaleString(
              "en-IN",
              {
                timeZone:
                  "Asia/Kolkata"
              }
            );

        const shortCaption =
          post.caption
            ? (
                post.caption.length > 40
                  ? post.caption.substring(
                      0,
                      40
                    ) + "..."
                  : post.caption
              )
            : "Photo Post";

        text +=
          `${i + 1}. 🕒 **Time:** ${postTime}\n` +
          `📝 <i>${shortCaption}</i>\n\n`;

        inlineKeyboard.push([
          {
            text:
              `❌ Delete Post #${i + 1}`,
            callback_data:
              `del_sched_${post.id}`
          }
        ]);
      }
    );

    await ctx.reply(
      text,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard:
            inlineKeyboard
        }
      }
    );
  }
);

// ============================================================
// ❌ DELETE SCHEDULED POST
// ============================================================

bot.action(
  /^del_sched_(.+)$/,
  async (ctx) => {
    const scheduleId =
      ctx.match[1];

    const index =
      scheduledPosts.findIndex(
        p =>
          p.id === scheduleId
      );

    if (index === -1) {
      return ctx.answerCbQuery(
        "❌ Scheduled post already deleted or not found!"
      );
    }

    scheduledPosts.splice(
      index,
      1
    );

    saveSchedule();

    await ctx.answerCbQuery(
      "✅ Scheduled post deleted successfully!"
    );

    if (
      scheduledPosts.length === 0
    ) {
      try {
        await ctx.editMessageText(
          "❌ **All scheduled posts have been deleted. List is now empty.**",
          {
            parse_mode: "HTML"
          }
        );
      } catch (e) {}

      return;
    }

    let text =
      `⏳ **Scheduled Posts List (${scheduledPosts.length}):**\n\n`;

    let inlineKeyboard = [];

    scheduledPosts.forEach(
      (post, i) => {
        const postTime =
          new Date(post.time)
            .toLocaleString(
              "en-IN",
              {
                timeZone:
                  "Asia/Kolkata"
              }
            );

        const shortCaption =
          post.caption
            ? (
                post.caption.length > 40
                  ? post.caption.substring(
                      0,
                      40
                    ) + "..."
                  : post.caption
              )
            : "Photo Post";

        text +=
          `${i + 1}. 🕒 **Time:** ${postTime}\n` +
          `📝 <i>${shortCaption}</i>\n\n`;

        inlineKeyboard.push([
          {
            text:
              `❌ Delete Post #${i + 1}`,
            callback_data:
              `del_sched_${post.id}`
          }
        ]);
      }
    );

    try {
      await ctx.editMessageText(
        text,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard:
              inlineKeyboard
          }
        }
      );
    } catch (e) {}
  }
);

// ============================================================
// 📝 CREATE POST
// ============================================================

bot.hears(
  "📝 Create Post",
  (ctx) => {
    const id = ctx.from.id;

    resetStates(id);

    postStep[id] =
      "waiting_post_text";

    ctx.reply(
      "📝 **Send your post text/HTML code now:**\n\n" +
      "একাধিক পোস্ট পাঠাতে চাইলে প্রতিটি পোস্টের মাঝে:\n" +
      "`✅✅✅✅✅`\n\n" +
      "দিয়ে আলাদা করুন।"
    );
  }
);

// ============================================================
// ⏰ SCHEDULE POST
// ============================================================

bot.hears(
  "⏰ Schedule Post",
  (ctx) => {
    const id = ctx.from.id;

    resetStates(id);

    scheduleStep[id] =
      "waiting_post_text";

    ctx.reply(
      "⏰ **Send your post text/HTML code for schedule:**"
    );
  }
);

// ============================================================
// ✏️ EDIT POST
// ============================================================

bot.hears(
  "✏️ Edit Post",
  (ctx) => {
    const id = ctx.from.id;

    resetStates(id);

    if (channels.length === 0) {
      return ctx.reply(
        "❌ No channels found."
      );
    }

    editStep[id] =
      "waiting_new_text";

    ctx.reply(
      "✏️ **Send the new text/caption.**\n" +
      "It will instantly update the latest broadcasted post across all your channels!"
    );
  }
);

// ============================================================
// 🗑️ DELETE POST
// ============================================================

bot.hears(
  "🗑️ Delete Post",
  (ctx) => {
    const id = ctx.from.id;

    resetStates(id);

    if (channels.length === 0) {
      return ctx.reply(
        "❌ No channels found."
      );
    }

    deleteStep[id] =
      "waiting_delete_text";

    ctx.reply(
      "🗑️ **Send the text (or caption) of the post you want to delete from all channels:**"
    );
  }
);

// ============================================================
// 📨 TEXT HANDLER
// ============================================================

bot.on(
  "text",
  async (ctx) => {
    const id =
      ctx.from.id;

    const text =
      ctx.message.text.trim();

    // ========================================================
    // ➕ ADD CHANNEL
    // ========================================================

    if (waitingChannel[id]) {
      waitingChannel[id] = false;

      const foundChannels =
        text.match(
          /@[^\s]+/g
        );

      if (
        !foundChannels ||
        foundChannels.length === 0
      ) {
        return ctx.reply(
          "❌ No valid channel usernames found starting '@'."
        );
      }

      let addedCount = 0;
      let alreadyCount = 0;

      foundChannels.forEach(
        ch => {
          const cleanCh =
            ch.trim();

          if (
            !channels.includes(
              cleanCh
            )
          ) {
            channels.push(
              cleanCh
            );

            addedCount++;
          } else {
            alreadyCount++;
          }
        }
      );

      saveChannels();

      return ctx.reply(
        `✅ **Channels Added Successfully!**\n\n` +
        `➕ Newly Added: ${addedCount}\n` +
        `⚠️ Already Exists: ${alreadyCount}\n` +
        `📢 Total Channels Now: ${channels.length}`
      );
    }

    // ========================================================
    // ❌ REMOVE CHANNEL
    // ========================================================

    if (waitingRemove[id]) {
      waitingRemove[id] = false;

      const index =
        channels.indexOf(text);

      if (index === -1) {
        return ctx.reply(
          "❌ Channel Not Found"
        );
      }

      channels.splice(
        index,
        1
      );

      saveChannels();

      return ctx.reply(
        "✅ Channel Removed"
      );
    }

    // ========================================================
    // ✏️ EDIT POST
    // ========================================================

    if (
      editStep[id] ===
      "waiting_new_text"
    ) {
      editStep[id] = null;

      const {
        text: cleanedCaption,
        replyMarkup
      } =
        processPost(text);

      let success = 0;
      let failed = 0;

      for (
        const channel of channels
      ) {
        if (
          lastSentPosts[channel]
        ) {
          try {
            await bot.telegram.editMessageCaption(
              channel,
              lastSentPosts[channel],
              null,
              cleanedCaption,
              {
                parse_mode:
                  "HTML",
                reply_markup:
                  replyMarkup
              }
            );

            success++;
          } catch (err) {
            failed++;
          }
        } else {
          failed++;
        }
      }

      return ctx.reply(
        `✅ **All Channel Posts Edited Successfully!**\n\n` +
        `Success: ${success}\n` +
        `Failed: ${failed}`
      );
    }

    // ========================================================
    // 🗑️ DELETE POST
    // ========================================================

    if (
      deleteStep[id] ===
      "waiting_delete_text"
    ) {
      deleteStep[id] = null;

      const targetPostIndex =
        sentPostsHistory.findIndex(
          p =>
            p.text.includes(
              text
            ) ||
            text.includes(
              p.text.substring(
                0,
                15
              )
            )
        );

      if (
        targetPostIndex === -1
      ) {
        return ctx.reply(
          "❌ No matching sent post found with this text!"
        );
      }

      const postToDelete =
        sentPostsHistory[
          targetPostIndex
        ];

      let success = 0;
      let failed = 0;

      for (
        const [
          channel,
          msgData
        ] of Object.entries(
          postToDelete.channelMessages
        )
      ) {
        try {
          let ids = [];

          if (
            Array.isArray(
              msgData
            )
          ) {
            ids = msgData;
          } else {
            ids = [msgData];
          }

          for (
            const msgId of ids
          ) {
            try {
              await bot.telegram.deleteMessage(
                channel,
                msgId
              );

              success++;
            } catch (e) {
              failed++;
            }
          }
        } catch (err) {
          failed++;
        }
      }

      sentPostsHistory.splice(
        targetPostIndex,
        1
      );

      saveSentHistory();

      return ctx.reply(
        `🗑️ **Post Deleted Successfully from Channels!**\n\n` +
        `Success: ${success}\n` +
        `Failed: ${failed}`
      );
    }

    // ========================================================
    // 🚀 CREATE POST / BULK POST
    // ========================================================

    if (
      postStep[id] ===
      "waiting_post_text"
    ) {
      postStep[id] = null;

      if (
        channels.length === 0
      ) {
        return ctx.reply(
          "❌ No channels found. Please add a channel first."
        );
      }

      const rawPosts =
        splitBulkPosts(text);

      if (
        rawPosts.length === 0
      ) {
        return ctx.reply(
          "❌ No valid post found."
        );
      }

      await ctx.reply(
        `🚀 **Processing Started!**\n\n` +
        `Found **${rawPosts.length}** post(s).\n\n` +
        `প্রতিটি পোস্ট আলাদাভাবে process হবে।`
      );

      let totalSentCount = 0;

      // ======================================================
      // PROCESS EACH POST ONE BY ONE
      // ======================================================

      for (
        let i = 0;
        i < rawPosts.length;
        i++
      ) {
        const singlePostText =
          rawPosts[i];

        console.log(
          `\n========================================`
        );

        console.log(
          `🚀 Processing Post ${i + 1}/${rawPosts.length}`
        );

        console.log(
          `========================================`
        );

        const imageUrl =
          getImageUrlFromText(
            singlePostText
          );

        const {
          text: cleanedCaption,
          replyMarkup
        } =
          processPost(
            singlePostText
          );

        console.log(
          `🖼️ Image URL: ${imageUrl}`
        );

        let imageBuffer;

        // ====================================================
        // DOWNLOAD IMAGE
        // ====================================================

        try {
          console.log(
            `🖼️ Downloading image for post ${i + 1}...`
          );

          imageBuffer =
            await downloadImageFromGitHub(
              imageUrl
            );

          console.log(
            `✅ Image downloaded successfully for post ${i + 1}`
          );
        } catch (imageError) {
          console.error(
            `❌ Image download failed for post ${i + 1}:`,
            imageError.message
          );

          continue;
        }

        let channelMessages = {};

        // ====================================================
        // SEND THIS ONE POST TO ALL CHANNELS
        // ====================================================

        for (
          const channel of channels
        ) {
          let sent = false;
          let retries = 3;

          while (
            !sent &&
            retries > 0
          ) {
            try {
              const messageIds =
                await sendOnePostToChannel(
                  channel,
                  imageBuffer,
                  cleanedCaption,
                  replyMarkup
                );

              if (
                messageIds &&
                messageIds.length > 0
              ) {
                lastSentPosts[
                  channel
                ] =
                  messageIds[
                    messageIds.length - 1
                  ];

                channelMessages[
                  channel
                ] =
                  messageIds;

                sent = true;

                console.log(
                  `✅ Post ${i + 1} sent to ${channel}`
                );
              }
            } catch (err) {
              console.error(
                `❌ Error sending post ${i + 1} to ${channel}:`,
                err.message
              );

              if (
                err.response &&
                err.response.parameters &&
                err.response.parameters
                  .retry_after
              ) {
                const waitSec =
                  err.response
                    .parameters
                    .retry_after + 2;

                console.log(
                  `⏳ FloodWait: waiting ${waitSec}s`
                );

                await new Promise(
                  resolve =>
                    setTimeout(
                      resolve,
                      waitSec * 1000
                    )
                );

                retries--;
              } else {
                break;
              }
            }
          }

          await new Promise(
            resolve =>
              setTimeout(
                resolve,
                1500
              )
          );
        }

        // ====================================================
        // SAVE HISTORY
        // ====================================================

        if (
          Object.keys(
            channelMessages
          ).length > 0
        ) {
          sentPostsHistory.unshift({
            text: singlePostText,
            channelMessages,
            time: Date.now()
          });

          totalSentCount++;
        }

        if (
          sentPostsHistory.length >
          100
        ) {
          sentPostsHistory.pop();
        }

        saveSentHistory();
        saveLastPosts();

        // ====================================================
        // DELAY BETWEEN POSTS
        // ====================================================

        if (
          i <
          rawPosts.length - 1
        ) {
          await new Promise(
            resolve =>
              setTimeout(
                resolve,
                5000
              )
          );
        }
      }

      return ctx.reply(
        `✅ **Finished!**\n\n` +
        `📦 Total Posts: ${rawPosts.length}\n` +
        `✅ Successfully Sent: ${totalSentCount}\n` +
        `❌ Failed: ${rawPosts.length - totalSentCount}`
      );
    }

    // ========================================================
    // ⏰ SCHEDULE POST TEXT
    // ========================================================

    if (
      scheduleStep[id] ===
      "waiting_post_text"
    ) {
      scheduleData[id] = {
        caption: text
      };

      scheduleStep[id] =
        "waiting_time";

      return ctx.reply(
        "📝 Post Text Saved!\n\n" +
        "Send schedule duration in minutes OR Date & Time with AM/PM:"
      );
    }

    // ========================================================
    // ⏰ SCHEDULE TIME
    // ========================================================

    if (
      scheduleStep[id] ===
      "waiting_time"
    ) {
      let targetTime;

      if (
        /^\d+$/.test(text)
      ) {
        targetTime =
          new Date(
            Date.now() +
            parseInt(text) *
              60 *
              1000
          );
      } else {
        const matchSimple =
          text.match(
            /^(\d{1,2})[,\s]+(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)$/i
          );

        const matchFull =
          text.match(
            /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})[,\s]+(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)$/i
          );

        let day;
        let month;
        let year;
        let hour;
        let minute;
        let period;

        const now =
          new Date();

        if (matchSimple) {
          day =
            parseInt(
              matchSimple[1]
            );

          month =
            now.getMonth() + 1;

          year =
            now.getFullYear();

          hour =
            parseInt(
              matchSimple[2]
            );

          minute =
            parseInt(
              matchSimple[3]
            );

          period =
            matchSimple[4]
              .toUpperCase();
        } else if (
          matchFull
        ) {
          day =
            parseInt(
              matchFull[1]
            );

          month =
            parseInt(
              matchFull[2]
            );

          year =
            parseInt(
              matchFull[3]
            );

          hour =
            parseInt(
              matchFull[4]
            );

          minute =
            parseInt(
              matchFull[5]
            );

          period =
            matchFull[6]
              .toUpperCase();
        }

        if (
          period === "PM" &&
          hour < 12
        ) {
          hour += 12;
        }

        if (
          period === "AM" &&
          hour === 12
        ) {
          hour = 0;
        }

        if (
          day &&
          month &&
          year &&
          !isNaN(hour)
        ) {
          const fMonth =
            String(month)
              .padStart(2, "0");

          const fDay =
            String(day)
              .padStart(2, "0");

          const fHour =
            String(hour)
              .padStart(2, "0");

          const fMin =
            String(minute)
              .padStart(2, "0");

          targetTime =
            new Date(
              `${year}-${fMonth}-${fDay}T${fHour}:${fMin}:00+05:30`
            );
        }
      }

      if (
        !targetTime ||
        isNaN(
          targetTime.getTime()
        )
      ) {
        return ctx.reply(
          "❌ Invalid time format!"
        );
      }

      const scheduleId =
        Date.now().toString() +
        Math.random()
          .toString(36)
          .substr(2, 9);

      const imageUrl =
        getImageUrlFromText(
          scheduleData[id]
            .caption
        );

      scheduledPosts.push({
        id: scheduleId,
        imageUrl: imageUrl,
        caption:
          scheduleData[id]
            .caption,
        time:
          targetTime.toISOString()
      });

      saveSchedule();

      scheduleStep[id] =
        null;

      scheduleData[id] =
        null;

      return ctx.reply(
        `✅ Post Scheduled for (IST): ${targetTime.toLocaleString(
          "en-IN",
          {
            timeZone:
              "Asia/Kolkata"
          }
        )}`
      );
    }

    // ========================================================
    // 🚀 AUTO DETECT BULK POST
    // ========================================================

    if (
      text.includes(
        "✅✅✅✅✅"
      )
    ) {
      if (
        channels.length === 0
      ) {
        return ctx.reply(
          "❌ No channels found. Please add a channel first."
        );
      }

      const rawPosts =
        splitBulkPosts(text);

      if (
        rawPosts.length === 0
      ) {
        return ctx.reply(
          "❌ No valid posts found separated by `✅✅✅✅✅`."
        );
      }

      await ctx.reply(
        `🚀 **Bulk Processing Started!**\n\n` +
        `Found **${rawPosts.length}** posts.\n\n` +
        `প্রতিটি পোস্ট আলাদাভাবে পাঠানো হবে।`
      );

      let totalSentCount = 0;

      // ======================================================
      // PROCESS EVERY POST SEPARATELY
      // ======================================================

      for (
        let i = 0;
        i < rawPosts.length;
        i++
      ) {
        const singlePostText =
          rawPosts[i];

        console.log(
          `🚀 Auto Bulk Post ${i + 1}/${rawPosts.length}`
        );

        const imageUrl =
          getImageUrlFromText(
            singlePostText
          );

        const {
          text: cleanedCaption,
          replyMarkup
        } =
          processPost(
            singlePostText
          );

        let imageBuffer;

        // ====================================================
        // DOWNLOAD IMAGE
        // ====================================================

        try {
          console.log(
            `🖼️ Downloading bulk image ${i + 1}: ${imageUrl}`
          );

          imageBuffer =
            await downloadImageFromGitHub(
              imageUrl
            );

          console.log(
            `✅ Bulk image ${i + 1} downloaded`
          );
        } catch (imageError) {
          console.error(
            `❌ Bulk image ${i + 1} failed:`,
            imageError.message
          );

          continue;
        }

        let channelMessages = {};

        // ====================================================
        // SEND TO ALL CHANNELS
        // ====================================================

        for (
          const channel of channels
        ) {
          let sent = false;
          let retries = 3;

          while (
            !sent &&
            retries > 0
          ) {
            try {
              const messageIds =
                await sendOnePostToChannel(
                  channel,
                  imageBuffer,
                  cleanedCaption,
                  replyMarkup
                );

              if (
                messageIds &&
                messageIds.length > 0
              ) {
                lastSentPosts[
                  channel
                ] =
                  messageIds[
                    messageIds.length - 1
                  ];

                channelMessages[
                  channel
                ] =
                  messageIds;

                sent = true;

                console.log(
                  `✅ Bulk post ${i + 1} sent to ${channel}`
                );
              }
            } catch (err) {
              console.error(
                `❌ Error sending bulk post to ${channel}:`,
                err.message
              );

              if (
                err.response &&
                err.response.parameters &&
                err.response.parameters
                  .retry_after
              ) {
                const waitSec =
                  err.response
                    .parameters
                    .retry_after + 2;

                await new Promise(
                  resolve =>
                    setTimeout(
                      resolve,
                      waitSec * 1000
                    )
                );

                retries--;
              } else {
                break;
              }
            }
          }

          await new Promise(
            resolve =>
              setTimeout(
                resolve,
                1500
              )
          );
        }

        // ====================================================
        // SAVE HISTORY
        // ====================================================

        if (
          Object.keys(
            channelMessages
          ).length > 0
        ) {
          sentPostsHistory.unshift({
            text: singlePostText,
            channelMessages,
            time: Date.now()
          });

          totalSentCount++;
        }

        if (
          sentPostsHistory.length >
          100
        ) {
          sentPostsHistory.pop();
        }

        saveSentHistory();
        saveLastPosts();

        // ====================================================
        // DELAY
        // ====================================================

        if (
          i <
          rawPosts.length - 1
        ) {
          await new Promise(
            resolve =>
              setTimeout(
                resolve,
                5000
              )
          );
        }
      }

      return ctx.reply(
        `✅ **Bulk Finished!**\n\n` +
        `📦 Total Posts: ${rawPosts.length}\n` +
        `✅ Successfully Sent: ${totalSentCount}\n` +
        `❌ Failed: ${rawPosts.length - totalSentCount}`
      );
    }

    // ========================================================
    // UNKNOWN
    // ========================================================

    return ctx.reply(
      "❌ Unknown command or text.\n\n" +
      "Click '📝 Create Post' or send posts containing `✅✅✅✅✅`."
    );
  }
);

// ============================================================
// ⏰ BACKGROUND SCHEDULER
// ============================================================

setInterval(
  async () => {
    if (
      scheduledPosts.length === 0
    ) {
      return;
    }

    const now =
      new Date();

    let hasChanges = false;

    for (
      let i =
        scheduledPosts.length - 1;
      i >= 0;
      i--
    ) {
      const post =
        scheduledPosts[i];

      if (
        new Date(post.time) <=
        now
      ) {
        const {
          text: cleanedCaption,
          replyMarkup
        } =
          processPost(
            post.caption
          );

        let channelMessages = {};

        // ====================================================
        // DOWNLOAD SCHEDULED IMAGE
        // ====================================================

        let imageBuffer;

        try {
          console.log(
            `🖼️ Downloading scheduled image: ${post.imageUrl}`
          );

          imageBuffer =
            await downloadImageFromGitHub(
              post.imageUrl
            );

          console.log(
            "✅ Scheduled image downloaded"
          );
        } catch (
          imageError
        ) {
          console.error(
            "❌ Scheduled image download failed:",
            imageError.message
          );

          // আবার চেষ্টা করবে
          continue;
        }

        // ====================================================
        // SEND SCHEDULED POST
        // ====================================================

        for (
          const channel of channels
        ) {
          try {
            const messageIds =
              await sendOnePostToChannel(
                channel,
                imageBuffer,
                cleanedCaption,
                replyMarkup
              );

            lastSentPosts[
              channel
            ] =
              messageIds[
                messageIds.length - 1
              ];

            channelMessages[
              channel
            ] =
              messageIds;

            console.log(
              `✅ Scheduled photo sent to ${channel}`
            );
          } catch (e) {
            console.error(
              `❌ Scheduled post failed for ${channel}:`,
              e.message
            );
          }

          await new Promise(
            resolve =>
              setTimeout(
                resolve,
                1500
              )
          );
        }

        // ====================================================
        // SAVE HISTORY
        // ====================================================

        sentPostsHistory.unshift({
          text:
            post.caption,
          channelMessages,
          time:
            Date.now()
        });

        if (
          sentPostsHistory.length >
          50
        ) {
          sentPostsHistory.pop();
        }

        saveSentHistory();
        saveLastPosts();

        scheduledPosts.splice(
          i,
          1
        );

        hasChanges = true;
      }
    }

    if (hasChanges) {
      saveSchedule();
    }
  },
  30000
);

// ============================================================
// 🚀 START BOT
// ============================================================

bot.launch()
  .then(() => {
    console.log(
      "✅ Bot launched successfully."
    );
  })
  .catch(err => {
    console.error(
      "❌ Bot launch failed:",
      err.message
    );
  });

// ============================================================
// 🌐 RENDER WEB SERVER
// ============================================================

const PORT =
  process.env.PORT || 10000;

http
  .createServer(
    (req, res) => {
      res.writeHead(
        200,
        {
          "Content-Type":
            "text/plain"
        }
      );

      res.end(
        "Bot Engine Online"
      );
    }
  )
  .listen(PORT);
