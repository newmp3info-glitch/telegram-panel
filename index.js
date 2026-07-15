const { Telegraf, Markup } = require("telegraf");
const { BOT_TOKEN, ADMIN_ID } = require("./config");
const http = require("http");
const fs = require("fs");

const bot = new Telegraf(BOT_TOKEN);

let channels = [];
let scheduledPosts = [];

// চ্যানেল ডাটা লোড করা
if (fs.existsSync("channels.json")) {
  try {
    channels = JSON.parse(fs.readFileSync("channels.json", "utf8"));
  } catch (e) {
    channels = [];
  }
}

// শিডিউল ডাটা লোড করা (রিস্টার্ট হলেও ডাটা হারাবে না)
if (fs.existsSync("schedule.json")) {
  try {
    scheduledPosts = JSON.parse(fs.readFileSync("schedule.json", "utf8"));
  } catch (e) {
    scheduledPosts = [];
  }
}

// স্টেট ম্যানেজমেন্ট ভেরিয়েবল
let waitingChannel = {};
let waitingRemove = {};
let postStep = {};

// নতুন ফিচারের স্টেট ভেরিয়েবল
let editStep = {};
let editData = {};
let scheduleStep = {};
let scheduleData = {};

// চ্যানেল সেভ করার ফাংশন
function saveChannels() {
  fs.writeFileSync(
    "channels.json",
    JSON.stringify(channels, null, 2)
  );
}

// শিডিউল সেভ করার ফাংশন
function saveSchedule() {
  fs.writeFileSync(
    "schedule.json",
    JSON.stringify(scheduledPosts, null, 2)
  );
}

// সব স্টেট একবারে রিসেট করার ফাংশন (কোনো কনফ্লিক্ট এড়াতে)
function resetStates(id) {
  waitingChannel[id] = false;
  waitingRemove[id] = false;
  postStep[id] = null;
  editStep[id] = null;
  editData[id] = null;
  scheduleStep[id] = null;
  scheduleData[id] = null;
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

// স্টার্ট কমান্ড ও কন্ট্রোল প্যানেল (নতুন বাটনসহ আপডেট করা হয়েছে)
bot.start((ctx) => {
  resetStates(ctx.from.id);
  ctx.reply(
    "🏠 Telegram Control Panel",
    Markup.keyboard([
      ["📝 Create Post", "⏰ Schedule Post"],
      ["📋 Channel List", "✏️ Edit Post"],
      ["➕ Add Channel", "❌ Remove Channel"],
      ["⚙️ Settings"]
    ]).resize()
  );
});

// চ্যানেল যুক্ত করার বাটন
bot.hears("➕ Add Channel", (ctx) => {
  const id = ctx.from.id;
  resetStates(id);
  waitingChannel[id] = true;

  ctx.reply("📢 Send Channel Username\n\nExample:\n@yourchannel");
});

// channel লিস্ট দেখার বাটন
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

// চ্যানেল রিমুভ করার বাটন
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

// সাধারণ পোস্ট ক্রিয়েট করার বাটন
bot.hears("📝 Create Post", (ctx) => {
  const id = ctx.from.id;
  resetStates(id);
  postStep[id] = "waiting_post";

  ctx.reply(
    "📷 **Send Photo with HTML Caption (Instant Post)**\n\n" +
    "১. প্রথমে গ্যালারি থেকে ফটোটি সিলেক্ট করুন।\n" +
    "২. 'Add a caption' বক্সে আপনার HTML ক্যাপশনটি লিখুন।\n" +
    "৩. এরপর সেন্ড বাটনে চাপুন (এটি সাথে সাথে পোস্ট হয়ে যাবে)।"
  );
});

// ১. শিডিউল পোস্ট বাটন
bot.hears("⏰ Schedule Post", (ctx) => {
  const id = ctx.from.id;
  resetStates(id);
  scheduleStep[id] = "waiting_post";

  ctx.reply(
    "⏰ **Schedule Post**\n\n" +
    "১. প্রথমে গ্যালারি থেকে ফটোটি সিলেক্ট করুন।\n" +
    "২. 'Add a caption' বক্সে আপনার HTML ক্যাপশনটি লিখুন।\n" +
    "৩. এরপর সেন্ড বাটনে চাপুন।"
  );
});

// ২. এডিট পোস্ট বাটন
bot.hears("✏️ Edit Post", (ctx) => {
  const id = ctx.from.id;
  resetStates(id);
  editStep[id] = "waiting_channel";

  ctx.reply(
    "✏️ **Edit Post (পোস্ট এডিট করুন)**\n\n" +
    "যে চ্যানেলের পোস্টটি এডিট করতে চান, তার Username লিখে পাঠান:\n\n" +
    "Example:\n@yourchannel"
  );
});

// সেটিংস বাটন
bot.hears("⚙️ Settings", (ctx) => {
  resetStates(ctx.from.id);
  ctx.reply(
    "⚙️ Telegram Control Panel\n\n" +
    "👤 Admin : " + ADMIN_ID + "\n" +
    "📢 Total Channels : " + channels.length + "\n" +
    "⏰ Scheduled Posts : " + scheduledPosts.length
  );
});

// ফটো এবং একই সাথে থাকা ক্যাপশন রিসিভ করার হ্যান্ডলার (নতুন শিডিউল পোস্টের জন্য হ্যান্ডলার অ্যাড করা হয়েছে)
bot.on("photo", async (ctx) => {
  const id = ctx.from.id;

  // ক. সাধারণ ইনস্ট্যান্ট পোস্টের জন্য
  if (postStep[id] === "waiting_post") {
    const photos = ctx.message.photo;
    const file = photos[photos.length - 1]; 
    const file_id = file.file_id;
    const caption = ctx.message.caption || "";

    postStep[id] = null;

    if (channels.length === 0) {
      return ctx.reply("❌ No channels found to send the post.");
    }

    let success = 0;
    let failed = 0;
    ctx.reply("⏳ Sending post to channels...");

    for (const channel of channels) {
      try {
        await bot.telegram.sendPhoto(channel, file_id, {
          caption: caption,
          parse_mode: "HTML"
        });
        success++;
      } catch (err) {
        failed++;
      }
    }
    return ctx.reply(`✅ Post Completed\n\nSuccess : ${success}\nFailed : ${failed}`);
  }

  // খ. শিডিউল পোস্টের জন্য প্রথম ধাপ (ফটো সেভ করা)
  if (scheduleStep[id] === "waiting_post") {
    const photos = ctx.message.photo;
    const file = photos[photos.length - 1];
    const file_id = file.file_id;
    const caption = ctx.message.caption || "";

    // ফটো ডাটা টেম্পোরারি সেভ করা
    scheduleData[id] = { file_id, caption };
    scheduleStep[id] = "waiting_time";

    return ctx.reply(
      "📷 ফটো এবং ক্যাপশন পাওয়া গেছে!\n\n" +
      "এবার পোস্টটি কখন শিডিউল করতে চান তা জানান।\n" +
      "আপনি ২ ভাবে সময় দিতে পারেন:\n\n" +
      "👉 **১. মিনিট হিসাবে (সবচেয়ে সহজ):**\n" +
      "কত মিনিট পর পোস্ট করতে চান তা শুধু সংখ্যায় লিখুন। যেমন: `30` লিখলে ৩০ মিনিট পর পোস্ট হবে।\n\n" +
      "👉 **২. নির্দিষ্ট তারিখ ও সময় হিসাবে (বাংলাদেশ সময় অনুযায়ী):**\n" +
      "এই ফরম্যাটে লিখুন: `YYYY-MM-DD HH:MM`\n" +
      "যেমন: `2026-07-15 18:30` (১৮:৩০ মানে সন্ধ্যা ৬:৩০ মিনিটে পোস্ট হবে)।\n\n" +
      "আপনার সময়টি লিখে পাঠান:"
    );
  }
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

  // ৩. এডিট পোস্ট - চ্যানেল নেম রিসিভ
  if (editStep[id] === "waiting_channel") {
    if (!text.startsWith("@")) {
      return ctx.reply("❌ Invalid Channel Username. @ সহ লিখুন।");
    }
    editData[id] = { channel: text };
    editStep[id] = "waiting_msg_id";
    return ctx.reply(
      "চ্যানেল পাওয়া গেছে। এবার পোস্টের **Message ID** অথবা পোস্টের লিংকটি (Post Link) কপি করে পাঠান:\n\n" +
      "*(টিপস: মেসেজ লিংক পাঠালে বট নিজে থেকেই আইডি বের করে নেবে)*"
    );
  }

  // ৪. এডিট পোস্ট - মেসেজ আইডি রিসিভ
  if (editStep[id] === "waiting_msg_id") {
    let msgId = text;
    // লিংক থেকে মেসেজ আইডি আলাদা করা
    if (text.includes("/")) {
      const parts = text.split("/");
      msgId = parts[parts.length - 1];
    }
    msgId = parseInt(msgId);

    if (isNaN(msgId)) {
      return ctx.reply("❌ Invalid Message ID বা লিংক। সঠিক সংখ্যা বা লিংক পাঠান।");
    }

    editData[id].messageId = msgId;
    editStep[id] = "waiting_new_text";
    return ctx.reply("এবার নতুন **HTML Caption**টি লিখে পাঠান যা আপনি আগের লেখার জায়গায় আপডেট করতে চান:");
  }

  // ৫. এডিট পোস্ট - ফাইনাল এডিটিং সম্পন্ন করা
  if (editStep[id] === "waiting_new_text") {
    const channel = editData[id].channel;
    const messageId = editData[id].messageId;
    
    editStep[id] = null;
    ctx.reply("⏳ Editing post in channel...");

    // ফটো ক্যাপশন এডিট করার চেষ্টা
    try {
      await bot.telegram.editMessageCaption(channel, messageId, null, text, {
        parse_mode: "HTML"
      });
      ctx.reply("✅ Post Caption Edited Successfully!");
    } catch (err) {
      // যদি ফটো না হয়ে সাধারণ টেক্সট পোস্ট হয়, তবে এটি রান হবে
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

  // ৬. শিডিউল পোস্ট - সময় নির্ধারণ করা
  if (scheduleStep[id] === "waiting_time") {
    let targetTime;

    // যদি ইউজার শুধু মিনিট পাঠায় (যেমন: 30)
    if (/^\d+$/.test(text)) {
      const minutes = parseInt(text);
      targetTime = new Date(Date.now() + minutes * 60 * 1000);
    } else {
      // YYYY-MM-DD HH:MM ফরম্যাট চেক ও বাংলাদেশ সময় (GMT+6) অনুযায়ী কনভার্ট করা
      const match = text.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
      if (match) {
        const [_, year, month, day, hour, minute] = match;
        // বাংলাদেশ সময় (+06:00 offset) দিয়ে ISO অবজেক্ট তৈরি
        const isoString = `${year}-${month}-${day}T${hour}:${minute}:00+06:00`;
        targetTime = new Date(isoString);
      } else {
        targetTime = new Date(text); // অন্য যেকোনো স্ট্যান্ডার্ড ফরম্যাট ট্রাই করা
      }
    }

    // ভুল বা অতীত সময় দিলে রিজেক্ট করা
    if (!targetTime || isNaN(targetTime.getTime()) || targetTime <= new Date()) {
      return ctx.reply("❌ অকার্যকর সময় বা অতীত সময় দিয়েছেন! অনুগ্রহ করে সঠিক সময় বা মিনিট লিখে পাঠান।");
    }

    // শিডিউল লিস্টে যুক্ত করা
    scheduledPosts.push({
      file_id: scheduleData[id].file_id,
      caption: scheduleData[id].caption,
      time: targetTime.toISOString()
    });
    saveSchedule();

    scheduleStep[id] = null;
    scheduleData[id] = null;

    // লোকাল ফরম্যাটে সময় দেখানো
    const timeShow = targetTime.toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka' });

    return ctx.reply(
      `✅ **Post Scheduled Successfully!**\n\n` +
      `📅 নির্ধারিত সময়: \`${timeShow}\`\n\n` +
      `ঠিক এই সময়ে বটটি আপনার সবগুলো চ্যানেলে স্বয়ংক্রিয়ভাবে পোস্টটি পাঠিয়ে দেবে।`
    );
  }
});

// ব্যাকগ্রাউন্ড শিডিউলার (প্রতি ৩০ সেকেন্ড পর পর চেক করবে কোনো পোস্টের সময় হয়েছে কি না)
setInterval(async () => {
  if (scheduledPosts.length === 0) return;

  const now = new Date();
  let hasChanges = false;

  for (let i = scheduledPosts.length - 1; i >= 0; i--) {
    const post = scheduledPosts[i];
    const postTime = new Date(post.time);

    // পোস্টের শিডিউল সময় পার হলে সেটি চ্যানেলে পাঠানো শুরু হবে
    if (postTime <= now) {
      let success = 0;
      let failed = 0;

      for (const channel of channels) {
        try {
          await bot.telegram.sendPhoto(channel, post.file_id, {
            caption: post.caption,
            parse_mode: "HTML"
          });
          success++;
        } catch (err) {
          failed++;
          console.error(`Failed scheduled post to ${channel}:`, err);
        }
      }

      // এডমিনকে নোটিফিকেশন পাঠানো
      try {
        await bot.telegram.sendMessage(
          ADMIN_ID,
          `⏰ **Scheduled Post Update:**\n\n` +
          `আপনার একটি শিডিউল করা পোস্ট সফলভাবে পাঠানো হয়েছে।\n` +
          `✅ Success: ${success}\n` +
          `❌ Failed: ${failed}`
        );
      } catch (e) {}

      // লিস্ট থেকে ডিলেট করা
      scheduledPosts.splice(i, 1);
      hasChanges = true;
    }
  }

  if (hasChanges) {
    saveSchedule();
  }
}, 30000); // ৩০ সেকেন্ড ইন্টারভাল

// গ্লোবাল এরর হ্যান্ডলিং
bot.catch((err, ctx) => {
  console.error("BOT ERROR :", err);
  if (ctx) {
    try {
      ctx.reply("❌ An error occurred! Please try again.");
    } catch (e) {}
  }
});

// বট চালু করা
bot.launch().then(() => {
  console.log("✅ Bot Started Successfully with Schedule & Edit features");
});

// গ্রেসফুল স্টপ
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
