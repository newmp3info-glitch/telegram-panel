const { Telegraf, Markup } = require("telegraf");
const { BOT_TOKEN, ADMIN_ID } = require("./config");
const http = require("http");
const fs = require("fs");

// ============================================================
// 🆕 AUTO GITHUB PHOTO + GAME MAPPING
// ============================================================
// GITHUB_TOKEN Render Environment Variable থেকে নেওয়া হবে.
// Owner / Repo / Branch / Code File আপনার existing repository অনুযায়ী
// default করা আছে, তাই শুধু GITHUB_TOKEN থাকলেই feature কাজ করবে.
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const GITHUB_OWNER = process.env.GITHUB_OWNER || "newmp3info-glitch";
const GITHUB_REPO = process.env.GITHUB_REPO || "telegram-panel";
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";
const GITHUB_CODE_FILE = process.env.GITHUB_CODE_FILE || "index.js";
const GITHUB_API_VERSION = "2022-11-28";
const GITHUB_COMMITTER_NAME =
  process.env.GITHUB_COMMITTER_NAME || "Telegram Photo Bot";
const GITHUB_COMMITTER_EMAIL =
  process.env.GITHUB_COMMITTER_EMAIL ||
  "telegram-photo-bot@users.noreply.github.com";


const bot = new Telegraf(BOT_TOKEN);

// ============================================================
// ⚙️ SPEED SETTINGS
// ============================================================

// একই পোস্টের 10 channel parallel-এ পাঠানো হবে
// পরের পোস্ট শুরু হওয়ার আগে কমপক্ষে 8 sec interval
// 8 sec = theoretical 7.5 posts/minute
const BULK_POST_INTERVAL_MS = 8000;

// Telegram 429 হলে retry করার সর্বোচ্চ সংখ্যা
const MAX_SEND_RETRIES = 3;

// ============================================================
// 📦 MAIN DATA
// ============================================================

let channels = [];
let scheduledPosts = [];
let sentPostsHistory = [];
let lastSentPosts = {};

// Telegram photo file_id cache
// একই image আবার পাঠালে নতুন করে upload না করে file_id ব্যবহার করবে
const telegramPhotoCache = new Map();

// GitHub image buffer cache
// একই image বারবার লাগলে GitHub থেকে বারবার download করবে না
const githubImageCache = new Map();

// Document bulk job control
let documentBulkRunning = false;

// ============================================================
// 📂 LOAD CHANNEL DATA
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
// ⏰ LOAD SCHEDULE DATA
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
          Math.random()
            .toString(36)
            .substr(2, 9)
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
// 💾 LOAD SENT POSTS HISTORY
// ============================================================

if (fs.existsSync("sent_history.json")) {
  try {
    sentPostsHistory = JSON.parse(
      fs.readFileSync(
        "sent_history.json",
        "utf8"
      )
    );
  } catch (e) {
    sentPostsHistory = [];
  }
}

// ============================================================
// ✏️ LOAD LAST SENT POSTS
// ============================================================

if (fs.existsSync("last_posts.json")) {
  try {
    lastSentPosts = JSON.parse(
      fs.readFileSync(
        "last_posts.json",
        "utf8"
      )
    );
  } catch (e) {
    lastSentPosts = {};
  }
}

// ============================================================
// 🧠 STATE MANAGEMENT
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
    JSON.stringify(
      scheduledPosts,
      null,
      2
    )
  );
}

function saveSentHistory() {
  fs.writeFileSync(
    "sent_history.json",
    JSON.stringify(
      sentPostsHistory,
      null,
      2
    )
  );
}

function saveLastPosts() {
  fs.writeFileSync(
    "last_posts.json",
    JSON.stringify(
      lastSentPosts,
      null,
      2
    )
  );
}

// ============================================================
// ⏳ DELAY HELPER
// ============================================================

function delay(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
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
// 🤖 AUTOMATIC 5-BUTTON PARSER
// ============================================================

function processPost(caption) {
  if (!caption) {
    return {
      text: "",
      replyMarkup: null
    };
  }

  let cleanedText = caption;

  const rawUrlRegex =
    /(?<!href=['"=\s])(https?:\/\/[^\s<>'"\)]+)/g;

  const urls =
    caption.match(rawUrlRegex) || [];

  if (urls.length > 0) {
    const uniqueUrls = [
      ...new Set(urls)
    ];

    uniqueUrls.forEach((url) => {
      const sampleUrl =
        url.replace(
          /[-\/\\^$*+?.()|[\]{}]/g,
          '\\$&'
        );

      const removeLineRegex =
        new RegExp(
          `^.*${sampleUrl}.*$`,
          "gm"
        );

      cleanedText =
        cleanedText.replace(
          removeLineRegex,
          ""
        );
    });
  }

  cleanedText =
    cleanedText
      .replace(
        /\n\s*\n\s*\n+/g,
        "\n\n"
      )
      .trim();

  const inlineKeyboard = [
    [
      {
        text: "🎰 𝗡𝗲𝘄 𝗚𝗮𝗺𝗲 𝟰𝟱",
        url: "https://t.me/VipYonoFreeCode/3783",
        style: "primary"
      },
      {
        text: "𝗧𝗼𝘁𝗮𝗹 𝗚𝗮𝗺𝗲 𝟳𝟬 🎰",
        url: "https://t.me/AllYonoRummyCode/138",
        style: "primary"
      }
    ],
    [
      {
        text: " 🤖 𝗬𝗼𝗻𝗼 𝗔𝗜 𝗕𝗼𝘁 🤖",
        url: "https://t.me/YonoGamingHeadAIBot",
        style: "success"
      },
      {
        text: "​🤖 𝗣𝗿𝗼𝗺𝗼 𝗖𝗼𝗱𝗲 𝗕𝗼𝘁 🤖",
        url: "https://t.me/spin_crush_bot",
        style: "success"
      }
    ],
    [
      {
        text: "🔥 𝗬𝗼𝗻𝗼 𝗠𝗮𝘀𝘁𝗲𝗿 𝗔𝗽𝗽 🔥",
        url: "https://www.fastyonoapp.online",
        style: "primary"
      }
    ]
  ];

  const replyMarkup = {
    inline_keyboard:
      inlineKeyboard
  };

  return {
    text: cleanedText,
    replyMarkup
  };
}

// ============================================================
// 🔍 EXACT IMAGE FILENAME MAPPING
// ============================================================

function getImageUrlFromText(postText) {
  const textLower =
    postText.toLowerCase();

  const repoOwner =
    "newmp3info-glitch";

  const repoName =
    "telegram-panel";

  const branch =
    "main";

  let imageName =
    "yono-rummy.jpg";

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
    textLower.includes("jaihoslots") ||
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
    textLower.includes("rummy zip") ||
    textLower.includes("rummy-zip") ||
    textLower.includes("rummyzip")
  )
    imageName = "rummy-zip.jpg";
    
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
// 🆕 GITHUB CONTENT API HELPERS
// ============================================================

function githubEncodePath(filePath) {
  return filePath
    .split("/")
    .map(part => encodeURIComponent(part))
    .join("/");
}

async function githubApiRequest(method, apiPath, body) {
  if (!GITHUB_TOKEN) {
    throw new Error(
      "GITHUB_TOKEN is not configured in Render Environment Variables."
    );
  }

  const response = await fetch(
    `https://api.github.com${apiPath}`,
    {
      method,
      headers: {
        Accept:
          "application/vnd.github+json",
        Authorization:
          `Bearer ${GITHUB_TOKEN}`,
        "X-GitHub-Api-Version":
          GITHUB_API_VERSION,
        "User-Agent":
          "Telegram-Panel-Bot/1.0",
        "Content-Type":
          "application/json"
      },
      body:
        body
          ? JSON.stringify(body)
          : undefined
    }
  );

  const rawText =
    await response.text();

  let data;

  try {
    data =
      rawText
        ? JSON.parse(rawText)
        : {};
  } catch {
    data = {
      message:
        rawText
    };
  }

  if (!response.ok) {
    const error =
      new Error(
        `GitHub API ${response.status}: ${
          data.message ||
          rawText ||
          "Unknown error"
        }`
      );

    error.status =
      response.status;

    throw error;
  }

  return data;
}

async function getGitHubFile(filePath) {
  const apiPath =
    `/repos/${encodeURIComponent(
      GITHUB_OWNER
    )}/${encodeURIComponent(
      GITHUB_REPO
    )}/contents/${githubEncodePath(
      filePath
    )}?ref=${encodeURIComponent(
      GITHUB_BRANCH
    )}`;

  try {
    const data =
      await githubApiRequest(
        "GET",
        apiPath
      );

    if (
      !data ||
      !data.content ||
      !data.sha
    ) {
      throw new Error(
        `GitHub file data is invalid for ${filePath}`
      );
    }

    return {
      sha:
        data.sha,
      content:
        Buffer.from(
          data.content.replace(
            /\s/g,
            ""
          ),
          "base64"
        )
    };

  } catch (error) {

    if (
      error &&
      error.status === 404
    ) {
      return null;
    }

    throw error;
  }
}

async function putGitHubFile(
  filePath,
  contentBuffer,
  commitMessage,
  sha
) {
  const apiPath =
    `/repos/${encodeURIComponent(
      GITHUB_OWNER
    )}/${encodeURIComponent(
      GITHUB_REPO
    )}/contents/${githubEncodePath(
      filePath
    )}`;

  const body = {
    message:
      commitMessage,
    content:
      Buffer
        .from(contentBuffer)
        .toString("base64"),
    branch:
      GITHUB_BRANCH,
    committer: {
      name:
        GITHUB_COMMITTER_NAME,
      email:
        GITHUB_COMMITTER_EMAIL
    }
  };

  if (sha) {
    body.sha =
      sha;
  }

  return githubApiRequest(
    "PUT",
    apiPath,
    body
  );
}

function normalizeGameName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getGameNameVariants(gameName) {
  const normalized =
    normalizeGameName(
      gameName
    );

  const hyphen =
    normalized.replace(
      /\s+/g,
      "-"
    );

  const compact =
    normalized.replace(
      /\s+/g,
      ""
    );

  return [
    ...new Set([
      normalized,
      hyphen,
      compact
    ])
  ].filter(Boolean);
}

function makeGameMappingBlock(
  fileName,
  gameName
) {
  const variants =
    getGameNameVariants(
      gameName
    );

  const conditions =
    variants
      .map(
        variant =>
          `    textLower.includes(${JSON.stringify(
            variant
          )})`
      )
      .join(" ||\n");

  return (
    `  else if (\n` +
    `${conditions}\n` +
    `  )\n` +
    `    imageName = ${JSON.stringify(
      fileName
    )};`
  );
}

function updateGameMappingInSource(
  source,
  fileName,
  gameName
) {
  const functionStart =
    source.indexOf(
      "function getImageUrlFromText"
    );

  if (
    functionStart === -1
  ) {
    throw new Error(
      "getImageUrlFromText() was not found in index.js."
    );
  }

  const returnMarker =
    "  return `https://raw.githubusercontent.com/${repoOwner}/${repoName}/${branch}/Photo/${imageName}`;";

  const returnIndex =
    source.indexOf(
      returnMarker,
      functionStart
    );

  if (
    returnIndex === -1
  ) {
    throw new Error(
      "Image mapping return line was not found in index.js."
    );
  }

  const functionBody =
    source.slice(
      functionStart,
      returnIndex
    );

  const variants =
    getGameNameVariants(
      gameName
    );

  // ----------------------------------------------------------
  // যদি একই filename আগে থেকেই mapping-এ থাকে,
  // তাহলে code change করার দরকার নেই।
  // ----------------------------------------------------------
  const filenameAssignment =
    `imageName = ${JSON.stringify(
      fileName
    )};`;

  if (
    functionBody.includes(
      filenameAssignment
    )
  ) {
    return {
      changed:
        false,
      source,
      message:
        "This image filename is already mapped."
    };
  }

  // ----------------------------------------------------------
  // একই game name আগে থেকে থাকলে existing mapping replace হবে।
  // এতে duplicate else-if তৈরি হবে না।
  // ----------------------------------------------------------
  let matchedVariant =
    null;

  for (
    const variant of variants
  ) {
    const doubleQuoteNeedle =
      `textLower.includes(${JSON.stringify(
        variant
      )})`;

    const singleQuoteNeedle =
      `textLower.includes('${variant}')`;

    if (
      functionBody.includes(
        doubleQuoteNeedle
      ) ||
      functionBody.includes(
        singleQuoteNeedle
      )
    ) {
      matchedVariant =
        variant;
      break;
    }
  }

  const newBlock =
    makeGameMappingBlock(
      fileName,
      gameName
    );

  if (
    matchedVariant
  ) {
    const absoluteVariantIndex =
      functionStart +
      functionBody.indexOf(
        `textLower.includes(${JSON.stringify(
          matchedVariant
        )})`
      ) >= functionStart
        ? functionStart +
          functionBody.indexOf(
            `textLower.includes(${JSON.stringify(
              matchedVariant
            )})`
          )
        : functionStart +
          functionBody.indexOf(
            `textLower.includes('${matchedVariant}')`
          );

    if (
      absoluteVariantIndex <
      functionStart
    ) {
      throw new Error(
        "Could not locate the existing game mapping."
      );
    }

    const elseIndex =
      source.lastIndexOf(
        "  else if (",
        absoluteVariantIndex
      );

    const imageNameIndex =
      source.indexOf(
        "imageName =",
        absoluteVariantIndex
      );

    if (
      elseIndex === -1 ||
      imageNameIndex === -1 ||
      imageNameIndex > returnIndex
    ) {
      throw new Error(
        "Could not safely replace the existing game mapping."
      );
    }

    const semicolonIndex =
      source.indexOf(
        ";",
        imageNameIndex
      );

    if (
      semicolonIndex === -1 ||
      semicolonIndex > returnIndex
    ) {
      throw new Error(
        "Could not find the end of the existing game mapping."
      );
    }

    const blockStart =
      source.lastIndexOf(
        "\n",
        elseIndex
      ) + 1;

    const blockEnd =
      semicolonIndex + 1;

    return {
      changed:
        true,
      source:
        source.slice(
          0,
          blockStart
        ) +
        newBlock +
        source.slice(
          blockEnd
        ),
      message:
        `Existing mapping updated to ${fileName}.`
    };
  }

  // ----------------------------------------------------------
  // নতুন game হলে return-এর ঠিক আগে নতুন mapping যোগ হবে।
  // ----------------------------------------------------------
  const updatedSource =
    source.slice(
      0,
      returnIndex
    ) +
    newBlock +
    "\n\n" +
    source.slice(
      returnIndex
    );

  return {
    changed:
      true,
    source:
      updatedSource,
    message:
      `New game mapping added for ${gameName}.`
  };
}

async function uploadPhotoAndUpdateGameMapping(
  fileName,
  imageBuffer,
  gameName
) {
  // ----------------------------------------------------------
  // 1) Photo/filename.jpg GitHub-এ create অথবা update
  // ----------------------------------------------------------
  const photoPath =
    `Photo/${fileName}`;

  const existingPhoto =
    await getGitHubFile(
      photoPath
    );

  await putGitHubFile(
    photoPath,
    imageBuffer,
    existingPhoto
      ? `Update game photo: ${fileName}`
      : `Add game photo: ${fileName}`,
    existingPhoto
      ? existingPhoto.sha
      : null
  );

  // ----------------------------------------------------------
  // 2) index.js-এর latest version নিয়ে mapping update
  // ----------------------------------------------------------
  // GitHub-এ অন্য কোনো commit একই সময়ে হলে একবার fresh SHA নিয়ে
  // retry করা হবে। Existing bot logic-এ কোনো পরিবর্তন হবে না।
  for (
    let attempt = 0;
    attempt < 2;
    attempt++
  ) {

    const codeFile =
      await getGitHubFile(
        GITHUB_CODE_FILE
      );

    if (!codeFile) {
      throw new Error(
        `${GITHUB_CODE_FILE} was not found in GitHub.`
      );
    }

    const source =
      codeFile.content.toString(
        "utf8"
      );

    const updated =
      updateGameMappingInSource(
        source,
        fileName,
        gameName
      );

    if (
      !updated.changed
    ) {
      return {
        photoPath,
        codeChanged:
          false,
        message:
          updated.message
      };
    }

    try {
      await putGitHubFile(
        GITHUB_CODE_FILE,
        Buffer.from(
          updated.source,
          "utf8"
        ),
        `Auto map game photo: ${gameName}`,
        codeFile.sha
      );

      return {
        photoPath,
        codeChanged:
          true,
        message:
          updated.message
      };

    } catch (error) {

      if (
        error &&
        error.status === 409 &&
        attempt === 0
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new Error(
    "Could not update index.js because GitHub changed it during the update."
  );
}


// ============================================================
// 🖼️ DOWNLOAD IMAGE FROM GITHUB
// ============================================================

async function downloadImageFromGitHub(imageUrl) {

  // Cache থেকে image পাওয়া গেলে আবার GitHub download করবে না
  if (githubImageCache.has(imageUrl)) {
    return githubImageCache.get(imageUrl);
  }

  const response = await fetch(
    imageUrl,
    {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent":
          "Telegram-Panel-Bot/1.0"
      }
    }
  );

  if (!response.ok) {
    throw new Error(
      `GitHub image download failed: ${response.status} ${response.statusText}`
    );
  }

  const contentType =
    response.headers.get(
      "content-type"
    ) || "";

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

  const buffer =
    Buffer.from(arrayBuffer);

  // Image memory cache
  githubImageCache.set(
    imageUrl,
    buffer
  );

  return buffer;
}

// ============================================================
// 🔁 TELEGRAM 429 RETRY HELPER
// ============================================================

function getRetryAfterSeconds(err) {
  if (
    err &&
    err.response &&
    err.response.parameters &&
    err.response.parameters.retry_after
  ) {
    return Number(
      err.response.parameters.retry_after
    );
  }

  return 0;
}

// ============================================================
// 📸 SEND PHOTO TO ONE CHANNEL
//
// file_id থাকলে upload ছাড়াই send করবে
// file_id না থাকলে buffer upload করবে
// ============================================================

async function sendPhotoWithRetry(
  channel,
  photo,
  caption,
  replyMarkup
) {

  let retries =
    MAX_SEND_RETRIES;

  while (retries > 0) {

    try {

      const sentMsg =
        await bot.telegram.sendPhoto(
          channel,
          photo,
          {
            caption:
              caption,
            parse_mode:
              "HTML",
            reply_markup:
              replyMarkup,
            disable_web_page_preview:
              true
          }
        );

      return sentMsg;

    } catch (err) {

      console.error(
        `❌ Error sending photo to ${channel}:`,
        err.message
      );

      const retryAfter =
        getRetryAfterSeconds(err);

      if (retryAfter > 0) {

        const waitMs =
          (retryAfter + 1) * 1000;

        console.log(
          `⏳ Telegram requested ${retryAfter}s wait for ${channel}`
        );

        await delay(
          waitMs
        );

        retries--;

        continue;
      }

      // 429 ছাড়া অন্য error হলে
      // existing behavior অনুযায়ী আর retry না করে fail
      throw err;
    }
  }

  throw new Error(
    `Maximum retries exceeded for ${channel}`
  );
}

// ============================================================
// 🚀 FAST SEND POST TO ALL CHANNELS
//
// IMPORTANT:
// প্রথম channel-এ image buffer upload হবে
// Telegram থেকে file_id পাওয়া যাবে
// এরপর বাকি channel-গুলোতে একই file_id parallel-এ যাবে
//
// পরের একই image-এর ক্ষেত্রে cached file_id দিয়ে
// সব channel সরাসরি parallel-এ যাবে
// ============================================================

async function sendPostToAllChannels({
  imageBuffer,
  imageUrl,
  caption,
  replyMarkup
}) {

  const channelList =
    [...channels];

  const channelMessages = {};

  if (
    channelList.length === 0
  ) {
    return {
      channelMessages,
      successCount: 0
    };
  }

  // ==========================================================
  // 📸 আগে cached Telegram file_id খোঁজা
  // ==========================================================

  let telegramFileId =
    telegramPhotoCache.get(
      imageUrl
    );

  // ==========================================================
  // 🆕 যদি file_id আগে না থাকে
  // প্রথম successful channel-এ upload করবে
  // ==========================================================

  let startIndex = 0;

  if (!telegramFileId) {

    let uploaded = false;

    for (
      let i = 0;
      i < channelList.length;
      i++
    ) {

      const channel =
        channelList[i];

      try {

        console.log(
          `📤 First image upload: ${channel}`
        );

        const sentMsg =
          await sendPhotoWithRetry(
            channel,
            {
              source:
                imageBuffer,
              filename:
                "game-photo.jpg"
            },
            caption,
            replyMarkup
          );

        lastSentPosts[channel] =
          sentMsg.message_id;

        channelMessages[channel] =
          sentMsg.message_id;

        // ====================================================
        // Telegram photo array থেকে সবচেয়ে বড় size
        // ====================================================

        if (
          sentMsg.photo &&
          sentMsg.photo.length > 0
        ) {

          const largestPhoto =
            sentMsg.photo[
              sentMsg.photo.length - 1
            ];

          telegramFileId =
            largestPhoto.file_id;

          if (telegramFileId) {

            telegramPhotoCache.set(
              imageUrl,
              telegramFileId
            );

            console.log(
              `💾 Telegram file_id cached for image`
            );
          }
        }

        uploaded = true;
        startIndex = i + 1;

        break;

      } catch (err) {

        console.error(
          `❌ First upload failed for ${channel}:`,
          err.message
        );
      }
    }

    // কোনো channel-এই upload না হলে
    if (!uploaded) {

      return {
        channelMessages,
        successCount:
          0
      };
    }

  } else {

    // file_id আগে থেকেই আছে
    startIndex = 0;
  }

  // ==========================================================
  // ⚡ বাকি channels parallel-এ পাঠানো
  // ==========================================================

  const remainingChannels =
    telegramFileId
      ? channelList.filter(
          ch =>
            !channelMessages[ch]
        )
      : channelList.slice(
          startIndex
        );

  const results =
    await Promise.allSettled(
      remainingChannels.map(
        async channel => {

          try {

            let sentMsg;

            if (telegramFileId) {

              sentMsg =
                await sendPhotoWithRetry(
                  channel,
                  telegramFileId,
                  caption,
                  replyMarkup
                );

            } else {

              sentMsg =
                await sendPhotoWithRetry(
                  channel,
                  {
                    source:
                      imageBuffer,
                    filename:
                      "game-photo.jpg"
                  },
                  caption,
                  replyMarkup
                );
            }

            lastSentPosts[channel] =
              sentMsg.message_id;

            channelMessages[channel] =
              sentMsg.message_id;

            console.log(
              `✅ Photo sent to ${channel}`
            );

            return {
              channel,
              success: true
            };

          } catch (err) {

            console.error(
              `❌ Failed to send to ${channel}:`,
              err.message
            );

            return {
              channel,
              success: false,
              error:
                err.message
            };
          }
        }
      )
    );

  let successCount =
    Object.keys(
      channelMessages
    ).length;

  // Promise results count না হলেও
  // channelMessages-ই final source
  results.forEach(() => {});

  return {
    channelMessages,
    successCount
  };
}

// ============================================================
// 💾 SAVE POST HISTORY
// ============================================================

function savePostHistory(
  originalText,
  channelMessages,
  maxLength = 100
) {

  if (
    Object.keys(channelMessages)
      .length === 0
  ) {
    return;
  }

  sentPostsHistory.unshift({
    text:
      originalText,
    channelMessages,
    time:
      Date.now()
  });

  if (
    sentPostsHistory.length >
    maxLength
  ) {
    sentPostsHistory =
      sentPostsHistory.slice(
        0,
        maxLength
      );
  }

  saveSentHistory();
  saveLastPosts();
}

// ============================================================
// 📦 PROCESS ONE BULK POST
//
// এই function Create Post / Document / Auto Bulk
// সব জায়গায় একই fast sending system ব্যবহার করবে
// ============================================================

async function processSingleBulkPost(
  singlePostText,
  postNumber,
  totalPosts
) {

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

  // ==========================================================
  // 🖼️ IMAGE DOWNLOAD
  // ==========================================================

  try {

    console.log(
      `🖼️ Post ${postNumber}/${totalPosts}: ${imageUrl}`
    );

    imageBuffer =
      await downloadImageFromGitHub(
        imageUrl
      );

    console.log(
      `✅ Image ready for post ${postNumber}/${totalPosts}`
    );

  } catch (imageError) {

    console.error(
      `❌ Image failed for post ${postNumber}:`,
      imageError.message
    );

    return {
      success: false,
      channelMessages: {}
    };
  }

  // ==========================================================
  // 🚀 FAST SEND
  // ==========================================================

  const result =
    await sendPostToAllChannels({
      imageBuffer,
      imageUrl,
      caption:
        cleanedCaption,
      replyMarkup
    });

  // ==========================================================
  // 💾 HISTORY
  // ==========================================================

  if (
    result.successCount > 0
  ) {

    savePostHistory(
      singlePostText,
      result.channelMessages,
      100
    );
  }

  return {
    success:
      result.successCount > 0,
    channelMessages:
      result.channelMessages,
    successCount:
      result.successCount
  };
}

// ============================================================
// 📄 DOCUMENT BULK PROCESSOR
//
// Background-এ চলবে যাতে bot update/button processing
// আটকে না থাকে
// ============================================================

async function processDocumentBulkJob({
  chatId,
  fileName,
  rawPosts
}) {

  try {

    let totalSentCount =
      0;

    for (
      let i = 0;
      i < rawPosts.length;
      i++
    ) {

      const postStartTime =
        Date.now();

      const result =
        await processSingleBulkPost(
          rawPosts[i],
          i + 1,
          rawPosts.length
        );

      if (result.success) {
        totalSentCount++;
      }

      // ======================================================
      // ⏱️ Next post start interval
      //
      // পুরো send operation যত সময় নিয়েছে সেটা বাদ দিয়ে
      // মোট 8 sec interval maintain করার চেষ্টা
      // ======================================================

      if (
        i <
        rawPosts.length - 1
      ) {

        const elapsed =
          Date.now() -
          postStartTime;

        const remainingWait =
          Math.max(
            0,
            BULK_POST_INTERVAL_MS -
              elapsed
          );

        if (
          remainingWait > 0
        ) {
          await delay(
            remainingWait
          );
        }
      }

      // ======================================================
      // 📊 Progress প্রতি 10 post
      // ======================================================

      if (
        (i + 1) % 10 === 0 ||
        i ===
          rawPosts.length - 1
      ) {

        try {

          await bot.telegram.sendMessage(
            chatId,
            `📦 Progress: ${i + 1}/${rawPosts.length}\n✅ Successfully Sent: ${totalSentCount}`
          );

        } catch (progressError) {

          console.error(
            "❌ Progress message failed:",
            progressError.message
          );
        }
      }
    }

    // ========================================================
    // ✅ FINAL MESSAGE
    // ========================================================

    try {

      await bot.telegram.sendMessage(
        chatId,
        `✅ File Processing Finished!\n\n📄 File: ${fileName || "Document"}\n📦 Total Posts: ${rawPosts.length}\n✅ Successfully Sent: ${totalSentCount}\n❌ Failed/Skipped: ${rawPosts.length - totalSentCount}`
      );

    } catch (finalError) {

      console.error(
        "❌ Final status message failed:",
        finalError.message
      );
    }

  } catch (error) {

    console.error(
      "❌ Background document processing error:",
      error
    );

    try {

      await bot.telegram.sendMessage(
        chatId,
        `❌ File processing failed!\n\nError: ${error.message}`
      );

    } catch (sendError) {

      console.error(
        "❌ Failed to send error message:",
        sendError.message
      );
    }

  } finally {

    documentBulkRunning =
      false;
  }
}

// ============================================================
// 🔐 ADMIN VERIFICATION
// ============================================================

bot.use(
  async (ctx, next) => {

    if (!ctx.from) {
      return;
    }

    if (
      !ctx.chat ||
      ctx.chat.type !== "private"
    ) {
      return;
    }

    if (
      ctx.from.id != ADMIN_ID
    ) {
      return ctx.reply(
        "⛔ Access Denied"
      );
    }

    return next();
  }
);


// ============================================================
// 🆕 AUTO /Photo GAME IMAGE UPLOAD
// ============================================================
// ব্যবহার:
// /Photo ABC Rummy.jpg
//
// Photo Telegram থেকে GitHub-এর Photo/ folder-এ যাবে
// এবং একই সাথে index.js-এ ABC Rummy mapping automatically update হবে.
// ============================================================

bot.on(
  "photo",
  async (ctx) => {

    const caption =
      (
        ctx.message &&
        ctx.message.caption
          ? ctx.message.caption
          : ""
      ).trim();

    const photoCommand =
      caption.match(
        /^\/Photo(?:@\w+)?\s+(.+)$/i
      );

    // /Photo command না হলে existing photo behavior-এর সাথে
    // কোনো interference করবে না।
    if (
      !photoCommand
    ) {
      return;
    }

    const rawFileName =
      photoCommand[1]
        .trim()
        .replace(
          /^["']|["']$/g,
          ""
        )
        .trim();

    // ----------------------------------------------------------
    // Safe filename validation
    // ----------------------------------------------------------
    if (
      !rawFileName ||
      rawFileName.length > 180
    ) {
      return ctx.reply(
        "❌ Invalid filename. Example:\n/Photo ABC Rummy.jpg"
      );
    }

    if (
      rawFileName.includes("/") ||
      rawFileName.includes("\\") ||
      rawFileName.includes("..") ||
      /[\u0000-\u001F:*?"<>|]/u.test(
        rawFileName
      )
    ) {
      return ctx.reply(
        "❌ Invalid filename. Only a normal image filename is allowed."
      );
    }

    if (
      !/\.(jpg|jpeg|png|webp)$/i.test(
        rawFileName
      )
    ) {
      return ctx.reply(
        "❌ Image filename must end with .jpg, .jpeg, .png or .webp"
      );
    }

    const fileName =
      rawFileName;

    const gameName =
      fileName
        .replace(
          /\.(jpg|jpeg|png|webp)$/i,
          ""
        )
        .trim();

    if (
      !gameName
    ) {
      return ctx.reply(
        "❌ Game name could not be detected from the filename."
      );
    }

    if (
      !GITHUB_TOKEN
    ) {
      return ctx.reply(
        "❌ GITHUB_TOKEN is missing in Render Environment Variables."
      );
    }

    const photos =
      ctx.message.photo || [];

    if (
      photos.length === 0
    ) {
      return ctx.reply(
        "❌ Photo file not found."
      );
    }

    // Telegram-এর সবচেয়ে বড় available photo
    const largestPhoto =
      photos[
        photos.length - 1
      ];

    try {

      await ctx.reply(
        `⏳ Uploading photo...\n\n🎮 Game: ${gameName}\n📁 File: ${fileName}`
      );

      const fileLink =
        await bot.telegram.getFileLink(
          largestPhoto.file_id
        );

      const response =
        await fetch(
          fileLink.href ||
            fileLink,
          {
            method:
              "GET",
            redirect:
              "follow",
            headers: {
              "User-Agent":
                "Telegram-Panel-Bot/1.0"
            }
          }
        );

      if (
        !response.ok
      ) {
        throw new Error(
          `Telegram photo download failed: ${response.status} ${response.statusText}`
        );
      }

      const arrayBuffer =
        await response.arrayBuffer();

      if (
        !arrayBuffer ||
        arrayBuffer.byteLength === 0
      ) {
        throw new Error(
          "Downloaded Telegram photo is empty."
        );
      }

      // সাধারণ game image-এর জন্য নিরাপদ limit
      if (
        arrayBuffer.byteLength >
        20 * 1024 * 1024
      ) {
        throw new Error(
          "Photo is too large. Maximum supported size is 20 MB."
        );
      }

      const imageBuffer =
        Buffer.from(
          arrayBuffer
        );

      const result =
        await uploadPhotoAndUpdateGameMapping(
          fileName,
          imageBuffer,
          gameName
        );

      // একই filename-এর পুরোনো runtime cache থাকলে clear
      const rawImageUrl =
        `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/Photo/${fileName}`;

      githubImageCache.delete(
        rawImageUrl
      );

      telegramPhotoCache.delete(
        rawImageUrl
      );

      await ctx.reply(
        `✅ Photo system completed!\n\n` +
        `🎮 Game: ${gameName}\n` +
        `📁 GitHub: Photo/${fileName}\n` +
        `🧩 ${result.message}\n\n` +
        `🔄 GitHub-এ code/photo update হয়েছে। Render যদি GitHub auto-deploy-এ connected থাকে, নতুন deployment-এর পর normal post-এ এই image automatically ব্যবহার হবে।`
      );

    } catch (error) {

      console.error(
        "❌ /Photo GitHub upload error:",
        error
      );

      return ctx.reply(
        `❌ Photo upload/mapping failed!\n\nError: ${error.message}`
      );
    }
  }
);

// ============================================================
// 📄 DOCUMENT BULK POST HANDLER
// TXT / HTML / HTM
// ============================================================

bot.on(
  "document",
  async (ctx) => {

    const id =
      ctx.from.id;

    if (
      !ctx.chat ||
      ctx.chat.type !== "private"
    ) {
      return;
    }

    if (
      ctx.from.id != ADMIN_ID
    ) {
      return ctx.reply(
        "⛔ Access Denied"
      );
    }

    if (
      documentBulkRunning
    ) {

      return ctx.reply(
        "⏳ একটি file ইতিমধ্যে processing হচ্ছে।\n\nআগের file শেষ হলে নতুন file পাঠান।"
      );
    }

    if (
      channels.length === 0
    ) {

      return ctx.reply(
        "❌ No channels found. Please add a channel first."
      );
    }

    const document =
      ctx.message.document;

    if (!document) {
      return ctx.reply(
        "❌ Document not found."
      );
    }

    const fileName =
      document.file_name ||
      "";

    const lowerName =
      fileName.toLowerCase();

    const allowedExtension =
      lowerName.endsWith(".txt") ||
      lowerName.endsWith(".html") ||
      lowerName.endsWith(".htm");

    const mimeType =
      (
        document.mime_type ||
        ""
      ).toLowerCase();

    const allowedMime =
      mimeType ===
        "text/plain" ||
      mimeType ===
        "text/html" ||
      mimeType ===
        "application/octet-stream";

    if (
      !allowedExtension &&
      !allowedMime
    ) {

      return ctx.reply(
        "❌ Only TXT, HTML or HTM files are supported."
      );
    }

    if (
      document.file_size &&
      document.file_size >
        20 * 1024 * 1024
    ) {

      return ctx.reply(
        "❌ File is too large. Maximum supported size is 20 MB."
      );
    }

    try {

      resetStates(id);

      await ctx.reply(
        "📄 File received!\n\n⏳ Reading all posts from the document..."
      );

      // ======================================================
      // Telegram থেকে file link
      // ======================================================

      const fileLink =
        await bot.telegram.getFileLink(
          document.file_id
        );

      const response =
        await fetch(
          fileLink.href ||
            fileLink
        );

      if (!response.ok) {

        throw new Error(
          `Telegram file download failed: ${response.status} ${response.statusText}`
        );
      }

      const arrayBuffer =
        await response.arrayBuffer();

      const fileText =
        Buffer
          .from(arrayBuffer)
          .toString("utf8");

      if (
        !fileText.trim()
      ) {

        return ctx.reply(
          "❌ The uploaded document is empty."
        );
      }

      // ======================================================
      // 📦 SEPARATOR
      // ======================================================

      const rawPosts =
        fileText
          .split("✅✅✅✅✅")
          .map(p =>
            p.trim()
          )
          .filter(
            p =>
              p.length > 0
          );

      if (
        rawPosts.length === 0
      ) {

        return ctx.reply(
          "❌ No valid posts found in the document."
        );
      }

      await ctx.reply(
        `🚀 File Bulk Processing Started!\n\n📄 File: ${fileName || "Document"}\n📦 Total Posts: ${rawPosts.length}\n\n⚡ Fast sending system active.\nপ্রতিটি post-এর 10 channel parallel sending করা হবে।`
      );

      // ======================================================
      // IMPORTANT:
      // এখান থেকে background processing
      // ======================================================

      documentBulkRunning =
        true;

      setImmediate(
        () => {

          processDocumentBulkJob({
            chatId:
              ctx.chat.id,
            fileName,
            rawPosts
          }).catch(error => {

            console.error(
              "❌ Unhandled bulk job error:",
              error
            );

            documentBulkRunning =
              false;
          });

        }
      );

      return;

    } catch (error) {

      console.error(
        "❌ Document processing error:",
        error
      );

      return ctx.reply(
        `❌ File processing failed!\n\nError: ${error.message}`
      );
    }
  }
);

// ============================================================
// ▶️ START
// ============================================================

bot.start(
  (ctx) => {

    resetStates(
      ctx.from.id
    );

    ctx.reply(
      "🏠 Telegram Control Panel",
      mainKeyboard
    );
  }
);

// ============================================================
// ➕ ADD CHANNEL
// ============================================================

bot.hears(
  "➕ Add Channel",
  (ctx) => {

    const id =
      ctx.from.id;

    resetStates(id);

    waitingChannel[id] =
      true;

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

    resetStates(
      ctx.from.id
    );

    if (
      channels.length === 0
    ) {
      return ctx.reply(
        "❌ No Channel Added"
      );
    }

    let text =
      "📋 Channel List\n\n";

    channels.forEach(
      (ch, i) => {

        text +=
          `${i + 1}. ${ch}\n`;
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

    const id =
      ctx.from.id;

    resetStates(id);

    waitingRemove[id] =
      true;

    if (
      channels.length === 0
    ) {

      waitingRemove[id] =
        false;

      return ctx.reply(
        "❌ No Channel Found"
      );
    }

    let text =
      "Send Channel Username to Remove:\n\n";

    channels.forEach(
      ch => {
        text +=
          `${ch}\n`;
      }
    );

    ctx.reply(text);
  }
);

// ============================================================
// ⏳ SCHEDULED POSTS LIST
// ============================================================

bot.hears(
  "⏳ Scheduled Posts",
  async (ctx) => {

    resetStates(
      ctx.from.id
    );

    if (
      scheduledPosts.length === 0
    ) {

      return ctx.reply(
        "❌ No scheduled posts found."
      );
    }

    let text =
      `⏳ **Scheduled Posts List (${scheduledPosts.length}):**\n\n`;

    let inlineKeyboard =
      [];

    scheduledPosts.forEach(
      (post, i) => {

        const postTime =
          new Date(
            post.time
          ).toLocaleString(
            "en-IN",
            {
              timeZone:
                "Asia/Kolkata"
            }
          );

        const shortCaption =
          post.caption
            ? (
                post.caption
                  .length > 40
                  ? post.caption.substring(
                      0,
                      40
                    ) + "..."
                  : post.caption
              )
            : "Photo Post";

        text +=
          `${i + 1}. 🕒 **Time:** ${postTime}\n📝 <i>${shortCaption}</i>\n\n`;

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
        parse_mode:
          "HTML",
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
          p.id ===
          scheduleId
      );

    if (
      index === -1
    ) {

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
          "❌ All scheduled posts have been deleted. List is now empty.",
          {
            parse_mode:
              "HTML"
          }
        );

      } catch (e) {}

      return;
    }

    let text =
      `⏳ **Scheduled Posts List (${scheduledPosts.length}):**\n\n`;

    let inlineKeyboard =
      [];

    scheduledPosts.forEach(
      (post, i) => {

        const postTime =
          new Date(
            post.time
          ).toLocaleString(
            "en-IN",
            {
              timeZone:
                "Asia/Kolkata"
            }
          );

        const shortCaption =
          post.caption
            ? (
                post.caption
                  .length > 40
                  ? post.caption.substring(
                      0,
                      40
                    ) + "..."
                  : post.caption
              )
            : "Photo Post";

        text +=
          `${i + 1}. 🕒 **Time:** ${postTime}\n📝 <i>${shortCaption}</i>\n\n`;

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
          parse_mode:
            "HTML",
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

    const id =
      ctx.from.id;

    resetStates(id);

    postStep[id] =
      "waiting_post_text";

    ctx.reply(
      "📝 **Send your post text/HTML code now:**\n(একাধিক পোস্ট পাঠাতে চাইলে প্রতিটির মাঝে `✅✅✅✅✅` দিন)"
    );
  }
);

// ============================================================
// ⏰ SCHEDULE POST
// ============================================================

bot.hears(
  "⏰ Schedule Post",
  (ctx) => {

    const id =
      ctx.from.id;

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

    const id =
      ctx.from.id;

    resetStates(id);

    if (
      channels.length === 0
    ) {

      return ctx.reply(
        "❌ No channels found."
      );
    }

    editStep[id] =
      "waiting_new_text";

    ctx.reply(
      "✏️ **Send the new text/caption.**\nIt will instantly update the latest broadcasted post across all your channels!"
    );
  }
);

// ============================================================
// 🗑️ DELETE POST
// ============================================================

bot.hears(
  "🗑️ Delete Post",
  (ctx) => {

    const id =
      ctx.from.id;

    resetStates(id);

    if (
      channels.length === 0
    ) {

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
// 💬 TEXT HANDLER
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

    if (
      waitingChannel[id]
    ) {

      waitingChannel[id] =
        false;

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

      let addedCount =
        0;

      let alreadyCount =
        0;

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
        `✅ **Channels Added Successfully!**\n\n➕ Newly Added: ${addedCount}\n⚠️ Already Exists: ${alreadyCount}\n📢 Total Channels Now: ${channels.length}`
      );
    }

    // ========================================================
    // ❌ REMOVE CHANNEL
    // ========================================================

    if (
      waitingRemove[id]
    ) {

      waitingRemove[id] =
        false;

      const index =
        channels.indexOf(
          text
        );

      if (
        index === -1
      ) {

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
    // ✏️ EDIT LATEST POSTS
    // ========================================================

    if (
      editStep[id] ===
      "waiting_new_text"
    ) {

      editStep[id] =
        null;

      const {
        text:
          cleanedCaption,
        replyMarkup
      } =
        processPost(text);

      let success =
        0;

      let failed =
        0;

      const editResults =
        await Promise.allSettled(
          channels.map(
            async channel => {

              if (
                !lastSentPosts[channel]
              ) {

                throw new Error(
                  "No last message ID"
                );
              }

              await bot.telegram
                .editMessageCaption(
                  channel,
                  lastSentPosts[
                    channel
                  ],
                  null,
                  cleanedCaption,
                  {
                    parse_mode:
                      "HTML",
                    reply_markup:
                      replyMarkup
                  }
                );

              return true;
            }
          )
        );

      editResults.forEach(
        result => {

          if (
            result.status ===
            "fulfilled"
          ) {
            success++;
          } else {
            failed++;
          }
        }
      );

      return ctx.reply(
        `✅ **All Channel Posts Edited Successfully!**\n\nSuccess: ${success}\nFailed: ${failed}`
      );
    }

    // ========================================================
    // 🗑️ DELETE POST
    // ========================================================

    if (
      deleteStep[id] ===
      "waiting_delete_text"
    ) {

      deleteStep[id] =
        null;

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

      let success =
        0;

      let failed =
        0;

      const deleteResults =
        await Promise.allSettled(
          Object.entries(
            postToDelete.channelMessages
          ).map(
            async (
              [
                channel,
                msgId
              ]
            ) => {

              await bot.telegram
                .deleteMessage(
                  channel,
                  msgId
                );

              return true;
            }
          )
        );

      deleteResults.forEach(
        result => {

          if (
            result.status ===
            "fulfilled"
          ) {
            success++;
          } else {
            failed++;
          }
        }
      );

      sentPostsHistory.splice(
        targetPostIndex,
        1
      );

      saveSentHistory();

      return ctx.reply(
        `🗑️ **Post Deleted Successfully from Channels!**\n\nSuccess: ${success}\nFailed: ${failed}`
      );
    }

    // ========================================================
    // 📝 CREATE POST
    // ========================================================

    if (
      postStep[id] ===
      "waiting_post_text"
    ) {

      postStep[id] =
        null;

      if (
        channels.length === 0
      ) {

        return ctx.reply(
          "❌ No channels found. Please add a channel first."
        );
      }

      const rawPosts =
        text.includes(
          "✅✅✅✅✅"
        )
          ? text
              .split(
                "✅✅✅✅✅"
              )
              .map(p =>
                p.trim()
              )
              .filter(
                p =>
                  p.length > 0
              )
          : [text];

      await ctx.reply(
        `🚀 **Processing Started!**\nFound **${rawPosts.length}** post(s). Sending with correct game photos...`
      );

      let totalSentCount =
        0;

      for (
        let i = 0;
        i < rawPosts.length;
        i++
      ) {

        const postStartTime =
          Date.now();

        const result =
          await processSingleBulkPost(
            rawPosts[i],
            i + 1,
            rawPosts.length
          );

        if (
          result.success
        ) {
          totalSentCount++;
        }

        if (
          i <
          rawPosts.length - 1
        ) {

          const elapsed =
            Date.now() -
            postStartTime;

          const remainingWait =
            Math.max(
              0,
              BULK_POST_INTERVAL_MS -
                elapsed
            );

          if (
            remainingWait > 0
          ) {
            await delay(
              remainingWait
            );
          }
        }
      }

      return ctx.reply(
        `✅ **Finished! Successfully sent ${totalSentCount} out of ${rawPosts.length} post(s) with photos to your channels.**`
      );
    }

    // ========================================================
    // ⏰ SCHEDULE POST - TEXT
    // ========================================================

    if (
      scheduleStep[id] ===
      "waiting_post_text"
    ) {

      scheduleData[id] = {
        caption:
          text
      };

      scheduleStep[id] =
        "waiting_time";

      return ctx.reply(
        "📝 Post Text Saved! Send schedule duration in minutes OR Date & Time with AM/PM:"
      );
    }

    // ========================================================
    // ⏰ SCHEDULE POST - TIME
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
              parseInt(
                text
              ) *
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

        if (
          matchSimple
        ) {

          day =
            parseInt(
              matchSimple[1]
            );

          month =
            now.getMonth() +
            1;

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
          period ===
            "PM" &&
          hour < 12
        ) {
          hour += 12;
        }

        if (
          period ===
            "AM" &&
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
            String(
              month
            ).padStart(
              2,
              "0"
            );

          const fDay =
            String(
              day
            ).padStart(
              2,
              "0"
            );

          const fHour =
            String(
              hour
            ).padStart(
              2,
              "0"
            );

          const fMin =
            String(
              minute
            ).padStart(
              2,
              "0"
            );

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
        id:
          scheduleId,
        imageUrl:
          imageUrl,
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
    // 🚀 AUTO-DETECT BULK POST
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
        text
          .split(
            "✅✅✅✅✅"
          )
          .map(p =>
            p.trim()
          )
          .filter(
            p =>
              p.length > 0
          );

      if (
        rawPosts.length === 0
      ) {

        return ctx.reply(
          "❌ No valid posts found separated by `✅✅✅✅✅`."
        );
      }

      await ctx.reply(
        `🚀 **Bulk Processing Started!**\nFound **${rawPosts.length}** posts. Sending with photos...`
      );

      let totalSentCount =
        0;

      for (
        let i = 0;
        i < rawPosts.length;
        i++
      ) {

        const postStartTime =
          Date.now();

        const result =
          await processSingleBulkPost(
            rawPosts[i],
            i + 1,
            rawPosts.length
          );

        if (
          result.success
        ) {
          totalSentCount++;
        }

        if (
          i <
          rawPosts.length - 1
        ) {

          const elapsed =
            Date.now() -
            postStartTime;

          const remainingWait =
            Math.max(
              0,
              BULK_POST_INTERVAL_MS -
                elapsed
            );

          if (
            remainingWait > 0
          ) {
            await delay(
              remainingWait
            );
          }
        }
      }

      return ctx.reply(
        `✅ **Successfully sent ${totalSentCount} out of ${rawPosts.length} posts with photos to your channels!**`
      );
    }

    // ========================================================
    // ❌ UNKNOWN COMMAND
    // ========================================================

    return ctx.reply(
      "❌ Unknown command or text. Click '📝 Create Post' or send posts containing `✅✅✅✅✅`."
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

    let hasChanges =
      false;

    for (
      let i =
        scheduledPosts.length - 1;
      i >= 0;
      i--
    ) {

      const post =
        scheduledPosts[i];

      if (
        new Date(
          post.time
        ) <= now
      ) {

        const {
          text:
            cleanedCaption,
          replyMarkup
        } =
          processPost(
            post.caption
          );

        let channelMessages =
          {};

        // ====================================================
        // 🖼️ SCHEDULED IMAGE
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

        } catch (imageError) {

          console.error(
            "❌ Scheduled image download failed:",
            imageError.message
          );

          // Remove না করে next cycle-এ retry
          continue;
        }

        // ====================================================
        // 🚀 FAST SCHEDULED SEND
        // ====================================================

        const result =
          await sendPostToAllChannels({
            imageBuffer,
            imageUrl:
              post.imageUrl,
            caption:
              cleanedCaption,
            replyMarkup
          });

        channelMessages =
          result.channelMessages;

        // ====================================================
        // 💾 HISTORY
        // ====================================================

        if (
          Object.keys(
            channelMessages
          ).length > 0
        ) {

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

            sentPostsHistory =
              sentPostsHistory.slice(
                0,
                50
              );
          }

          saveSentHistory();
          saveLastPosts();
        }

        scheduledPosts.splice(
          i,
          1
        );

        hasChanges =
          true;
      }
    }

    if (
      hasChanges
    ) {
      saveSchedule();
    }

  },
  30000
);

// ============================================================
// 🚀 START BOT
// ============================================================

bot.launch()
  .then(
    () => {

      console.log(
        "✅ Bot launched successfully."
      );

    }
  )
  .catch(
    err => {

      console.error(
        "❌ Bot launch failed:",
        err.message
      );

    }
  );

// ============================================================
// 🌐 RENDER WEB SERVER
// ============================================================

const PORT =
  process.env.PORT ||
  10000;

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
