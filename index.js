// index.js
const {
  Client,
  GatewayIntentBits,
  Events,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');

const fs = require('fs');
const path = require('path');
require('dotenv').config();

// ===== CONFIG =====
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour cooldown for /weigh
const MINE_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour cooldown for /mine
const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h for /daily
const DUEL_COOLDOWN_MS = 30 * 60 * 1000; // 30 min cooldown for /duel
const DUEL_EXPIRE_MS = 5 * 60 * 1000; // 5 min to accept/decline duel

const DUEL_WIN = 50;
const DUEL_LOSS = 35;

const allowedChannel = "1441424180791873617";
const VERIFY_CHANNEL_ID = "1365855471952592896";

// Wallet Verified role id (copy from Discord role settings)
const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID || ""; // Vault Verified (100k+)
const ELITE_ROLE_ID = process.env.ELITE_ROLE_ID || "";       // Vault Elite (1M+)
const WHALE_ROLE_ID = process.env.WHALE_ROLE_ID || "";       // Vault Whale (10M+)

// Helius + FORTKNOX gate
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || "";
const FORTKNOX_MINT = "FfN1Cgy56n9GVyeXN1LKxyKLegVpSf74jZ7k5KYrH6HC";
const MIN_FORTKNOX_BALANCE = 100000;

async function getFortKnoxBalance(walletAddress) {
  if (!HELIUS_API_KEY) throw new Error("Missing HELIUS_API_KEY");

  const url = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

  const body = {
    jsonrpc: "2.0",
    id: "fortknox-balance",
    method: "getTokenAccountsByOwner",
    params: [
      walletAddress,
      { mint: FORTKNOX_MINT },
      { encoding: "jsonParsed" }
    ]
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Helius RPC error ${res.status}`);
  }

  const json = await res.json();
  const accounts = json?.result?.value || [];

  let total = 0;
  for (const acc of accounts) {
    const amt =
      acc?.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0;
    total += amt;
  }

  return total;
}

// ===== DATA STORAGE =====
const DATA_FILE = path.join(__dirname, 'gold-data.json');

let goldData = {};

// Load data from file on startup
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      goldData = raw ? JSON.parse(raw) : {};
    } else {
      goldData = {};
    }
  } catch (err) {
    console.error('❌ Error loading gold data:', err);
    goldData = {};
  }
}

// Save data to file
function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(goldData, null, 2), 'utf8');
  } catch (err) {
    console.error('❌ Error saving gold data:', err);
  }
}

// Ensure a user object exists and is upgraded with new fields
function ensureUser(userId) {
  if (!goldData[userId]) {
    goldData[userId] = {
      // /weigh bucket
      totalOunces: 0,
      lastWeigh: 0,

      // single gold bucket (mine + daily + duel +/-)
      points: 0,

      // mine + daily
      lastMine: 0,
      lastDaily: 0,
      dailyStreak: 0,

      // duel
      lastDuel: 0,
      wins: 0,
      losses: 0,

      // wallet link
      wallet: "",
      walletLinkedAt: 0,
      redeemPending: false,

    };
    return goldData[userId];
  }

  const u = goldData[userId];

  // backfills (migration-safe)
  if (typeof u.totalOunces !== 'number') u.totalOunces = 0;
  if (typeof u.lastWeigh !== 'number') u.lastWeigh = 0;

  if (typeof u.points !== 'number') u.points = 0;

  if (typeof u.lastMine !== 'number') u.lastMine = 0;
  if (typeof u.lastDaily !== 'number') u.lastDaily = 0;
  if (typeof u.dailyStreak !== 'number') u.dailyStreak = 0;

  if (typeof u.lastDuel !== 'number') u.lastDuel = 0;
  if (typeof u.wins !== 'number') u.wins = 0;
  if (typeof u.losses !== 'number') u.losses = 0;

  if (typeof u.wallet !== "string") u.wallet = "";
  if (typeof u.walletLinkedAt !== "number") u.walletLinkedAt = 0;
  if (typeof u.redeemPending !== "boolean") u.redeemPending = false;

  return u;
}

// helpers
function clamp0(n) {
  return Math.max(0, n);
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}


function randomOunces(min = 1, max = 31.1) {
  const val = Math.random() * (max - min) + min;
  return Number(val.toFixed(2));
}

// Decide 
function getWeightRank(oz) {
  if (oz < 5) return 'Dirt Digger';
  if (oz < 10) return 'Copper Collector';
  if (oz < 20) return 'Silverback';
  if (oz < 26) return 'Vault Guardian';
  if (oz < 30) return 'FortKnox Elite';
  return 'Mythic Nugget Master';
}

// random rank for /rank
function getRandomGoldRank() {
  const pool = [
    'Dirt Digger',
    'Copper Collector',
    'Copper Collector',
    'Silverback',
    'Silverback',
    'Gold Hoarder',
    'Vault Guardian',
    'Vault Guardian',
    'FortKnox Elite',
    'Mythic Nugget Master', // rare
  ];
  const index = Math.floor(Math.random() * pool.length);
  return pool[index];
}

// Load existing data at startup
loadData();

// ===== DISCORD CLIENT =====
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// ===== BOT READY =====
client.once(Events.ClientReady, readyClient => {
  console.log(`✅ Logged in as ${readyClient.user.tag}`);
});

// ===== COMMAND HANDLER =====
client.on(Events.InteractionCreate, async interaction => {
  const now = Date.now();

  // ===== CHANNEL GATES =====

if (interaction.isChatInputCommand()) {
  if (interaction.commandName === "verifywallet") {
    if (interaction.channelId !== VERIFY_CHANNEL_ID) {
      return interaction.reply({
        content: `⚠️ Use /verifywallet in <#${VERIFY_CHANNEL_ID}> only.`,
        ephemeral: true,
      });
    }
  } else {
    if (interaction.channelId !== allowedChannel) {
      return interaction.reply({
        content: `⚠️ GoldScale commands only work in <#${allowedChannel}>.`,
        ephemeral: true,
      });
    }
  }
}

if (interaction.isButton()) {
  // duel buttons should only work in the main GoldScale channel
  if (interaction.channelId !== allowedChannel) {
    return interaction.reply({
      content: `⚠️ GoldScale buttons only work in <#${allowedChannel}>.`,
      ephemeral: true,
    });
  }
}

  if (interaction.isButton()) {
    const id = interaction.customId || "";

    if (!id.startsWith("duel:")) return;

    // customId format:
    // duel:accept:<challengerId>:<targetId>:<createdAt>
    // duel:decline:<challengerId>:<targetId>:<createdAt>
    const parts = id.split(":");
    const action = parts[1];
    const challengerId = parts[2];
    const targetId = parts[3];
    const createdAt = Number(parts[4] || 0);

    // Expire check
    if (now - createdAt > DUEL_EXPIRE_MS) {
      return interaction.update({
        content: "⏳ Duel expired. Run `/duel` again.",
        components: []
      });
    }

    if (action === "decline") {
      // Only target can decline
      if (interaction.user.id !== targetId) {
        return interaction.reply({ content: "Only the challenged user can decline.", ephemeral: true });
      }
      return interaction.update({
        content: "❌ Duel declined.",
        components: []
      });
    }

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    if (action === "accept") {
  // Only target can accept
  if (interaction.user.id !== targetId) {
    return interaction.reply({ content: "Only the challenged user can accept.", ephemeral: true });
  }

  // We are going to animate edits, so defer the button interaction
  await interaction.deferUpdate();

  // Ensure both users exist
  const challenger = ensureUser(challengerId);
  const target = ensureUser(targetId);

  // Roll winner
  const winnerId = Math.random() < 0.5 ? challengerId : targetId;
  const loserId = winnerId === challengerId ? targetId : challengerId;

  const winner = ensureUser(winnerId);
  const loser = ensureUser(loserId);

  // Apply payouts (single-bucket model) — unchanged
  winner.points = (winner.points || 0) + DUEL_WIN;

  const lossAmount = Math.min(DUEL_LOSS, loser.points);
  loser.points = clamp0((loser.points || 0) - lossAmount);

  winner.wins += 1;
  loser.losses += 1;

  saveData();

  // Fetch members for reliable avatars (guild-scoped)
  const winnerMember = await interaction.guild.members.fetch(winnerId);
  const loserMember  = await interaction.guild.members.fetch(loserId);

  // ===== DRAMA / ANIMATION =====
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const HEADER_DIV = "━━━━━━━━━━━━━━━━━━━━\n";  

const logBase = new EmbedBuilder()
  .setTitle("⚔️ Combat Log")
  .setColor(0xf5c542); // gold

const stage1 = [
  "⚔️ Challengers step forward…",
  "⚔️ Blades drawn… crowd goes silent…",
  "⚔️ Eyes locked. No backing out.",
];

const stage2 = [
  "⚖️ Gold on the line…",
  "💰 Wager locked. Vault rules apply.",
  "🪙 Stake set. Winner takes momentum.",
];

const stage3 = [
  "🥶 Waiting for an opening…",
  "⚡ Tension builds…",
  "🧠 Reading movement… someone slips…",
];

const stage4 = [
  "🩸 A clean hit lands!",
  "💥 Steel sparks — direct strike!",
  "⚡ Counter hit — big damage!",
];

// Pick ONE line per stage (in order)
const s1 = pick(stage1);
const s2 = pick(stage2);
const s3 = pick(stage3);
const swingLine =
  `🏦 Vault seizes **${lossAmount}** gold from <@${loserId}> · 🏦 Vault awards **+${DUEL_WIN}** gold to <@${winnerId}>`;
const s4Base = pick(stage4); 
const s4 = `${s4Base}\n\n${swingLine}`;

// Build frames in order (no random stage order)
const frames = [
  `${HEADER_DIV}\n\n${s1}`,
  `${HEADER_DIV}\n\n${s1}\n\n${s2}`,
  `${HEADER_DIV}\n\n${s1}\n\n${s2}\n\n${s3}`,
  `${HEADER_DIV}\n\n${s1}\n\n${s2}\n\n${s3}\n\n${s4}`,
];

  // First: remove buttons + show first log line
  await interaction.editReply({
    content: null,
    embeds: [EmbedBuilder.from(logBase).setDescription(frames[0])],
    components: [], // removes buttons
  });

  // Animate remaining lines
  for (let i = 1; i < frames.length; i++) {
    await sleep(2500);
    await interaction.editReply({
      embeds: [EmbedBuilder.from(logBase).setDescription(frames[i])],
      components: [],
    });
  }

  // small final beat
  await sleep(2800);

  // ===== FINAL RESULT EMBED (your original result box) =====
  const duelEmbed = new EmbedBuilder()
    .setTitle('⚔️ Duel Result')
    .setColor(0xf5c542) // gold vibe
    .setThumbnail(winnerMember.displayAvatarURL({ extension: 'png', size: 256 }))
    .addFields(
      {
        name: '🏆 Winner',
        value: `<@${winnerId}> (+${DUEL_WIN})`,
        inline: true,
      },
      {
        name: '💀 Loser',
        value: `<@${loserId}> (-${lossAmount})`,
        inline: true,
      },
      {
        name: '🏦 Updated Totals',
        value:
          `<@${winnerId}>: **${winner.points}** gold\n` +
          `<@${loserId}>: **${loser.points}** gold`,
        inline: false,
      }
    )
    .setFooter({
      text: `Defeated: ${loserMember.user.username}`,
      iconURL: loserMember.displayAvatarURL({ extension: 'png', size: 64 }),
    });

  // Show result
await interaction.editReply({
  embeds: [
    duelEmbed,
    EmbedBuilder
      .from(logBase)
      .setDescription(
        frames[frames.length - 1] +
        `\n\n${HEADER_DIV}\n\n` +
        "💥 The duel is decided."
      ),
  ],
  components: [],
});

         return; 
    }

    return; 
  }

  if (!interaction.isChatInputCommand()) return;

  // /verifywallet — holder gate + role + save
if (interaction.commandName === "verifywallet") {
  // hard lock to verify channel (extra safety)
  if (interaction.channelId !== VERIFY_CHANNEL_ID) {
    return interaction.reply({
      content: `⚠️ Use /verifywallet in <#${VERIFY_CHANNEL_ID}> only.`,
      ephemeral: true,
    });
  }

  const userId = interaction.user.id;
  const user = ensureUser(userId);

  const address = interaction.options.getString("address", true).trim();

  // basic sanity check
  if (address.length < 32 || address.length > 44) {
    return interaction.reply({
      content: "Invalid Solana wallet address.",
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const bal = await getFortKnoxBalance(address);

    if (bal < MIN_FORTKNOX_BALANCE) {
      return interaction.editReply(
        `⛔ Holder gate failed.\n` +
        `Wallet has ~${Math.floor(bal).toLocaleString()} FORTKNOX.\n` +
        `Need **${MIN_FORTKNOX_BALANCE.toLocaleString()}**.`
      );
    }

    // Save wallet ONLY if gate passes
    user.wallet = address;
    user.walletLinkedAt = Date.now();
    user.redeemPending = false;
    saveData();

   // ===== ROLE SYNC (Vault Verified + tiers) =====
const member = await interaction.guild.members.fetch(userId);

// helper safe remove/add
const safeRemove = async (roleId) => {
  if (!roleId) return;
  if (member.roles.cache.has(roleId)) {
    await member.roles.remove(roleId).catch(() => {});
  }
};
const safeAdd = async (roleId) => {
  if (!roleId) return;
  if (!member.roles.cache.has(roleId)) {
    await member.roles.add(roleId);
  }
};

// always clear tier roles first (keeps status accurate)
await safeRemove(ELITE_ROLE_ID);
await safeRemove(WHALE_ROLE_ID);

// always add Vault Verified (they passed the 100k gate)
if (!VERIFIED_ROLE_ID) {
  return interaction.editReply(
    `✅ Gate OK (~${Math.floor(bal).toLocaleString()} FORTKNOX). Wallet saved.\n` +
    `⚠️ VERIFIED_ROLE_ID missing in env so role was not assigned.`
  );
}
await safeAdd(VERIFIED_ROLE_ID);

// add ONE tier role on top (keep Vault Verified for claims)
let tierText = "Vault Verified";

if (bal >= 10_000_000) {
  if (WHALE_ROLE_ID) {
    await safeAdd(WHALE_ROLE_ID);
    tierText = "Vault Verified + Vault Whale";
  } else {
    tierText = "Vault Verified (Vault Whale role missing)";
  }
} else if (bal >= 1_000_000) {
  if (ELITE_ROLE_ID) {
    await safeAdd(ELITE_ROLE_ID);
    tierText = "Vault Verified + Vault Elite";
  } else {
    tierText = "Vault Verified (Vault Elite role missing)";
  }
}
return interaction.editReply(
  `✅ Verified + saved: \`${address.slice(0, 4)}…${address.slice(-4)}\`\n` +
  `Gate OK (~${Math.floor(bal).toLocaleString()} FORTKNOX).\n` +
  `Roles: **${tierText}**`
);
  } catch (e) {
    return interaction.editReply(
      `❌ Verification failed. ${String(e?.message || e)}`
    );
  }
}

  // /weigh with cooldown + tracking
  if (interaction.commandName === 'weigh') {
    const userId = interaction.user.id;

    const userData = ensureUser(userId);

    // Cooldown check
    if (userData.lastWeigh) {
      const diff = now - userData.lastWeigh;
      if (diff < COOLDOWN_MS) {
        const remainingMs = COOLDOWN_MS - diff;
        const minutes = Math.floor(remainingMs / 60000);
        const seconds = Math.ceil((remainingMs % 60000) / 1000);

        let timeLeft = "";
      if (minutes > 0) {
         timeLeft = `${minutes}m ${seconds}s`;
      } else {
         timeLeft = `${seconds}s`;
  }

   return interaction.reply({
           content: `⏳ You need to wait **${timeLeft}** before weighing again.`,
          ephemeral: true,
        });
      }
    }

    
    // DRAMA WEIGH
await interaction.deferReply();

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const ounces = randomOunces();
const rank = getWeightRank(ounces);

userData.totalOunces += ounces;
userData.lastWeigh = now;
saveData();

const frames = [
  "⚖️ Placing gold on the scale…",
  "⚖️ Calibrating…",
  "⚖️ Reading weight…",
];

for (const frame of frames) {
  await interaction.editReply(frame);
  await sleep(2000);
}

await sleep(2100);

return interaction.editReply(
  `💰 **Your gold weighs:** \`${ounces} troy oz\`\n` +
  `🏅 **Rank for this weigh:** ${rank}\n` +
  `🏦 **Your total:** \`${userData.totalOunces.toFixed(2)} troy oz\``
);
  }

  if (interaction.commandName === 'rank') {
  const suspenseLines = [
    "🔥 Power levels rising…",
    "💪 Flex calibration in progress…",
    "👑 Checking throne eligibility…",
    "📜 Dusting off ancient ledgers…",
    "🪨 Asking the magic rock…",
    "🐒 Monkey brain activated…",
  ];

  const suspense = suspenseLines[Math.floor(Math.random() * suspenseLines.length)];
  const rank = getRandomGoldRank();

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // Step 1: show suspense
  await interaction.reply({ content: suspense });

  // Step 2: pause
  await sleep(1500); 

  // Step 3: reveal
  if (rank === 'Mythic Nugget Master') {
    return interaction.editReply(
      `👑 **MYTHIC NUGGET MASTER**\n✨ *Few ever see this.*`
    );
  }

  return interaction.editReply(
    `🧾 **Your gold rank:** \`${rank}\``
  );
}

  // /topgold (leaderboard by ounces)
  if (interaction.commandName === 'topgold') {
    const entries = Object.entries(goldData)
      .filter(([, data]) => data.totalOunces && data.totalOunces > 0)
      .sort((a, b) => b[1].totalOunces - a[1].totalOunces)
      .slice(0, 10);

    if (entries.length === 0) {
      return interaction.reply({
        content: '📉 No gold weighed yet. Use `/weigh` to start filling the vault.',
        ephemeral: true,
      });
    }

    const lines = entries.map(([userId, data], index) => {
      const place = index + 1;
      return `${place}. <@${userId}> — \`${data.totalOunces.toFixed(2)} troy oz\``;
    });

    return interaction.reply({
      content:
        `🏆 **GoldScale Leaderboard**\n` +
        `Top ${entries.length} vault holders by total ounces:\n\n` +
        lines.join('\n'),
    });
  }


  if (interaction.commandName === 'mine') {
  const userId = interaction.user.id;
  const user = ensureUser(userId);

  const diff = now - (user.lastMine || 0);
  if (diff < MINE_COOLDOWN_MS) {
    const remainingMs = MINE_COOLDOWN_MS - diff;
    const minutes = Math.floor(remainingMs / 60000);
    const seconds = Math.ceil((remainingMs % 60000) / 1000);

    const timeLeft = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

    return interaction.reply({
      content: `⏳ Mine cooldown. Wait **${timeLeft}**.`,
      ephemeral: true
    });
  }

  //  MINING SEQUENCE
  await interaction.deferReply();

  const frames = [
  "⛏️🪨🪨🪨🪨🪨🪨🪨🪨\nMining...",
  "🪨⛏️🪨🪨🪨🪨🪨🪨🪨\nMining...",
  "🪨🪨⛏️🪨🪨🪨🪨🪨🪨\nMining...",
  "🪨🪨🪨⛏️🪨🪨🪨🪨🪨\nMining...",
  "🪨🪨🪨🪨⛏️🪨🪨🪨🪨\nMining...",
  "🪨🪨🪨🪨🪨⛏️🪨🪨🪨\nMining...",
  "🪨🪨🪨🪨🪨🪨⛏️🪨🪨\nMining...",
  "🪨🪨🪨🪨🪨🪨🪨⛏️🪨\nMining...",
  "🪨🪨🪨🪨🪨🪨🪨🪨⛏️\nMining..."
];

  for (const frame of frames) {
    await interaction.editReply({ content: frame, embeds: [] });
    await new Promise(r => setTimeout(r, 900));
  }

  // ROLL RESULT (UNCHANGED LOGIC)
  const roll = randInt(1, 100);
  let delta = 0;
  let flavor = "";
  let emoji = "";

  if (roll <= 80) {
    delta = randInt(10, 30);
    emoji = "🏆";
    flavor = "Paydirt 💰.";
    user.points += delta;
  } else {
    delta = -randInt(5, 15);
    emoji = "🧨";
    flavor = "Cave-in 🪨.";
    user.points = clamp0(user.points + delta);
  }

  user.lastMine = now;
  saveData();

  const sign = delta >= 0 ? "+" : "";

  // Fetch member for PFP
const member = await interaction.guild.members.fetch(userId);

const mineEmbed = new EmbedBuilder()
  .setColor(0xf5c542) // gold
  .setThumbnail(member.displayAvatarURL({ extension: 'png', size: 256 }))
  .setDescription(
    `${emoji} **${flavor}**\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🪙 ${interaction.user} mined **${sign}${delta}** gold\n` +
    `🏦 Total Gold: **${user.points}**`
  );

return interaction.editReply({
  content: null,         
  embeds: [mineEmbed],
  components: [],
});
}

  // /daily (streak bonus + drama)
if (interaction.commandName === 'daily') {
  const userId = interaction.user.id;
  const user = ensureUser(userId);

  const diff = now - (user.lastDaily || 0);
  if (diff < DAILY_COOLDOWN_MS) {
    const hoursLeft = Math.ceil((DAILY_COOLDOWN_MS - diff) / (60 * 60 * 1000));
    return interaction.reply({
      content: `⏳ Daily already claimed. Try again in **${hoursLeft}h**.`,
      ephemeral: true
    });
  }

  // 48 hr streak resets
  if (user.lastDaily && diff > DAILY_COOLDOWN_MS * 2) {
    user.dailyStreak = 0;
  }

  user.dailyStreak += 1;

  const base = 100;
  const streakBonus = Math.min(user.dailyStreak * 10, 100);
  const total = base + streakBonus;

  user.points = (user.points || 0) + total;
  user.lastDaily = now;

  saveData();

  const flavorLines = [
    "🔒 Vault check-in complete…",
    "🗝️ Daily vault seal verified…",
    "📜 Ledger updated for today…",
    "🪙 Gold reserves acknowledged…",
  ];

  const flavor =
    flavorLines[Math.floor(Math.random() * flavorLines.length)];

  // DRAMA SEQUENCE
  await interaction.deferReply();

  // First line (thinking / confirmation)
  await interaction.editReply(flavor);

  // Pause before reveal
  await new Promise(r => setTimeout(r, 2000));

  // Fetch member for PFP
  const member = await interaction.guild.members.fetch(userId);

  const dailyEmbed = new EmbedBuilder()
    .setColor(0xf5c542) // gold
    .setThumbnail(member.displayAvatarURL({ extension: 'png', size: 256 }))
    .setDescription(
      `🗝️ ${interaction.user} claimed daily gold.\n` +
      `🔥 Streak: **${user.dailyStreak}** days\n` +
      `🪙 Payout: **+${total}** (Base ${base} + Streak ${streakBonus})\n` +
      `🏦 Total Gold: **${user.points}**`
    );

  return interaction.editReply({
    embeds: [dailyEmbed],
  });
}

  //  /duel @user (accept button)
  if (interaction.commandName === 'duel') {
    const challengerId = interaction.user.id;
    const target = interaction.options.getUser('user');

    if (!target) {
      return interaction.reply({ content: "Pick a user to duel.", ephemeral: true });
    }
    if (target.bot) {
      return interaction.reply({ content: "You can’t duel bots.", ephemeral: true });
    }
    if (target.id === challengerId) {
      return interaction.reply({ content: "You can’t duel yourself.", ephemeral: true });
    }

    const challenger = ensureUser(challengerId);

    // check starter cooldown
    const cDiff = now - (challenger.lastDuel || 0);
      if (cDiff < DUEL_COOLDOWN_MS) {
    const remainingMs = DUEL_COOLDOWN_MS - cDiff;
    const minutes = Math.floor(remainingMs / 60000);
    const seconds = Math.ceil((remainingMs % 60000) / 1000);
    const timeLeft = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

    return interaction.reply({
    content: `⏳ You’re on duel cooldown. Try again in **${timeLeft}**.`,
    ephemeral: true
  });
}

challenger.lastDuel = now;
saveData();

// Create duel buttons
const createdAt = now;
const row = new ActionRowBuilder().addComponents(
  new ButtonBuilder()
    .setCustomId(`duel:accept:${challengerId}:${target.id}:${createdAt}`)
    .setLabel('Accept Duel')
    .setStyle(ButtonStyle.Success),
  new ButtonBuilder()
    .setCustomId(`duel:decline:${challengerId}:${target.id}:${createdAt}`)
    .setLabel('Decline')
    .setStyle(ButtonStyle.Danger),
);

// Fetch members for avatars (guild-scoped)
const challengerMember = await interaction.guild.members.fetch(challengerId);
const targetMember = await interaction.guild.members.fetch(target.id);

const challengeEmbed = new EmbedBuilder()
  .setTitle('⚔️ Duel Challenge')
  .setColor(0xf5c542)

  // Challenger avatar shows up here (top-left)
  .setAuthor({
    name: `Challenger: ${challengerMember.user.username}`,
    iconURL: challengerMember.displayAvatarURL({ extension: 'png', size: 64 }),
  })

  // Challenged avatar shows up here (right thumbnail)
  .setThumbnail(targetMember.displayAvatarURL({ extension: 'png', size: 256 }))

  .addFields(
    { name: 'Challenger', value: `<@${challengerId}>`, inline: true },
    { name: 'Challenged', value: `<@${target.id}>`, inline: true },
    {
      name: '💰 Stakes',
      value: `Winner **+${DUEL_WIN}** | Loser **-${DUEL_LOSS}** (never below 0)`,
      inline: false,
    },
    { name: '⏳ Time Limit', value: 'Accept within **5 minutes**.', inline: false },
  )

  .setFooter({
    text: `Target: ${targetMember.user.username}`,
    iconURL: targetMember.displayAvatarURL({ extension: 'png', size: 64 }),
  });

return interaction.reply({
  content: `${target}, you’ve been challenged by ${interaction.user}.`,
  embeds: [challengeEmbed],
  components: [row],
});
  }

  // ===== ADMIN RESET HELPERS =====
function isAdmin(interaction) {
  return (
    interaction.memberPermissions &&
    interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)
  );
}

// TopGold (/weigh) reset ONLY
function doWeightReset() {
  for (const userId of Object.keys(goldData)) {
    const u = ensureUser(userId);
    u.totalOunces = 0;
    u.lastWeigh = 0;
  }
}

// Gold economy reset (single-bucket points + cooldowns/stats)
function doMineReset() {
  for (const userId of Object.keys(goldData)) {
    const u = ensureUser(userId);

    // single gold balance
    u.points = 0;

    // mine + daily
    u.lastMine = 0;
    u.lastDaily = 0;
    u.dailyStreak = 0;

    // duel
    u.lastDuel = 0;
    u.wins = 0;
    u.losses = 0;
  }
}

// Full season reset (TopGold + Gold economy)
function doSeasonReset() {
  doWeightReset();
  doMineReset();
}

// ===== ADMIN RESET COMMANDS =====

// /resetleaderboard => ONLY resets /weigh leaderboard
if (interaction.commandName === 'resetleaderboard') {
  if (!isAdmin(interaction)) {
    return interaction.reply({ content: '⛔ This command is admin-only.', ephemeral: true });
  }

  doWeightReset();
  saveData();
  return interaction.reply('🧹 TopGold reset: /weigh leaderboard wiped.');
}

// /minereset => resets the gold economy (mine + daily + duel)
if (interaction.commandName === 'minereset') {
  if (!isAdmin(interaction)) {
    return interaction.reply({ content: '⛔ This command is admin-only.', ephemeral: true });
  }

  doMineReset();
  saveData();
  return interaction.reply('🧹 Gold reset: points + cooldowns + streak + W/L wiped.');
}

// /seasonreset => wipes EVERYTHING (TopGold + Gold economy)
if (interaction.commandName === 'seasonreset') {
  if (!isAdmin(interaction)) {
    return interaction.reply({ content: '⛔ This command is admin-only.', ephemeral: true });
  }

  doSeasonReset();
  saveData();
  return interaction.reply('🧹 Season reset: everything wiped (TopGold + Gold).');
}
});

// Log in the bot
client.login(process.env.DISCORD_TOKEN);