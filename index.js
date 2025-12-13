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
const DUEL_EXPIRE_MS = 3 * 60 * 1000; // 3 min to accept/decline duel

const DUEL_WIN = 50;
const DUEL_LOSS = 35;

const allowedChannel = "1441424180791873617";

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
      totalOunces: 0,
      lastWeigh: 0,

      // Arcade additions
      points: 0,
      lastMine: 0,
      lastDaily: 0,
      dailyStreak: 0,
      lastDuel: 0,
      wins: 0,
      losses: 0,
    };
    return goldData[userId];
  }

  // backfill fields for existing users
  const u = goldData[userId];
  if (typeof u.points !== 'number') u.points = 0;
  if (typeof u.lastMine !== 'number') u.lastMine = 0;
  if (typeof u.lastDaily !== 'number') u.lastDaily = 0;
  if (typeof u.dailyStreak !== 'number') u.dailyStreak = 0;
  if (typeof u.lastDuel !== 'number') u.lastDuel = 0;
  if (typeof u.wins !== 'number') u.wins = 0;
  if (typeof u.losses !== 'number') u.losses = 0;

  // keep weigh fields safe too
  if (typeof u.totalOunces !== 'number') u.totalOunces = 0;
  if (typeof u.lastWeigh !== 'number') u.lastWeigh = 0;

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

  // Buttons (duel accept/decline) should still be allowed only in the same channel
  if (interaction.channelId !== allowedChannel) {
    if (interaction.isChatInputCommand() || interaction.isButton()) {
      return interaction.reply({
        content: `⚠️ GoldScale commands only work in <#${allowedChannel}>.`,
        ephemeral: true
      });
    }
    return;
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

    if (action === "accept") {
      // Only target can accept
      if (interaction.user.id !== targetId) {
        return interaction.reply({ content: "Only the challenged user can accept.", ephemeral: true });
      }

      // Ensure both users exist
      const challenger = ensureUser(challengerId);
      const target = ensureUser(targetId);

      // Roll winner
      const winnerId = Math.random() < 0.5 ? challengerId : targetId;
      const loserId = winnerId === challengerId ? targetId : challengerId;

      const winner = ensureUser(winnerId);
      const loser = ensureUser(loserId);

      // Apply payouts
      winner.points += DUEL_WIN;
      const lossAmount = Math.min(DUEL_LOSS, loser.points);
      loser.points = clamp0(loser.points - lossAmount);

      winner.wins += 1;
      loser.losses += 1;

      // Update duel cooldowns to prevent chain spam (both get cooldown)
      challenger.lastDuel = now;
      target.lastDuel = now;

      saveData();

     const winnerUser = await client.users.fetch(winnerId);
     const loserUser = await client.users.fetch(loserId);

     const duelEmbed = new EmbedBuilder()
     .setTitle('⚔️ Duel Result')
    .setColor(0xf5c542) // gold vibe
    .setThumbnail(winnerUser.displayAvatarURL({ dynamic: true, size: 256 }))
    .addFields(
    {
      name: '🏆 Winner',
      value: `<@${winnerId}> (+${DUEL_WIN})`,
      inline: true,
    },
    {
      name: '💀 Loser',
      value: `<@${loserId}> (-${lostAmount})`,
      inline: true,
    },
    {
      name: '🏦 Updated Totals',
      value:
        `<@${winnerId}>: **${winner.points}** gold\n` +
        `<@${loserId}>: **${loser.points}** gold`,
      }
   )
    .setFooter({
      text: `${loserUser.username}`,
      iconURL: loserUser.displayAvatarURL({ dynamic: true, size: 64 }),
   });

    await interaction.reply({ embeds: [duelEmbed] });
    }

    return;
  }

  
  if (!interaction.isChatInputCommand()) return;

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

    // Not on cooldown → generate ounces
    const ounces = randomOunces();
    const rank = getWeightRank(ounces);

    // Update totals
    userData.totalOunces += ounces;
    userData.lastWeigh = now;
    saveData();

    return interaction.reply({
      content:
        `💰 **Your gold weighs:** \`${ounces} troy oz\`\n` +
        `🏅 **Rank for this weigh:** ${rank}\n` +
        `🏦 **Your total:** \`${userData.totalOunces.toFixed(2)} troy oz\``,
    });
  }

  // /rank (fun random title, no data tracking)
  if (interaction.commandName === 'rank') {
    const rank = getRandomGoldRank();
    return interaction.reply({
      content: `🧾 **Your gold rank:** \`${rank}\``,
    });
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

      let timeLeft = "";
   if (minutes > 0) {
      timeLeft = `${minutes}m ${seconds}s`;
      } else {
        timeLeft = `${seconds}s`;
     }

      return interaction.reply({
         content: `⏳ Mine cooldown. Wait **${timeLeft}**.`,
         ephemeral: true
    });
    }

    // 80% win (+10..+30), 20% cave-in (-5..-15)
    const roll = randInt(1, 100);
    let delta = 0;
    let flavor = "";

    if (roll <= 80) {
      delta = randInt(10, 30);
      flavor = "⛏️ Clean pull.";
      user.points += delta;
    } else {
      delta = -randInt(5, 15);
      flavor = "Cave-in. You lost some gold.";
      user.points = clamp0(user.points + delta);
    }

    user.lastMine = now;
    saveData();

    const sign = delta >= 0 ? "+" : "";
    return interaction.reply(
      `${flavor}\n` +
      `🪙 ${interaction.user} mined **${sign}${delta}** gold.\n` +
      `🏦 Total Gold: **${user.points}**`
    );
  }

  // /daily (streak bonus)
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

    // If they miss more than 48h, streak resets
    if (user.lastDaily && (diff > (DAILY_COOLDOWN_MS * 2))) {
      user.dailyStreak = 0;
    }

    user.dailyStreak += 1;

    const base = 100;
    const streakBonus = Math.min(user.dailyStreak * 10, 100); // +10/day, cap +100
    const total = base + streakBonus;

    user.points += total;
    user.lastDaily = now;

    saveData();

    return interaction.reply(
      `🎁 ${interaction.user} claimed daily gold.\n` +
      `🔥 Streak: **${user.dailyStreak}** days\n` +
      `🪙 Payout: **+${total}** (Base ${base} + Streak ${streakBonus})\n` +
      `🏦 Total Gold: **${user.points}**`
    );
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
    const targetUser = ensureUser(target.id);

    // Duel cooldown check (both)
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

const tDiff = now - (targetUser.lastDuel || 0);
if (tDiff < DUEL_COOLDOWN_MS) {
  return interaction.reply({
    content: `⏳ ${target} is on duel cooldown. Try later.`,
    ephemeral: true
  });
}

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

      return interaction.reply({
       content:
         `⚔️ ${target}, you’ve been challenged by ${interaction.user}.\n` +
         `Stakes: Winner **+${DUEL_WIN}** | Loser **-${DUEL_LOSS}** (never below 0)\n` +
         `⏳ Accept within **3 minutes**.`,
       components: [row]
   });
  }

  // /resetleaderboard (admin only) — now resets arcade stats too
  if (interaction.commandName === 'resetleaderboard') {
    if (
      !interaction.memberPermissions ||
      !interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)
    ) {
      return interaction.reply({
        content: '⛔ This command is admin-only.',
        ephemeral: true,
      });
    }

    goldData = {};
    saveData();

    return interaction.reply('🧹 Leaderboard has been reset. Fresh start for everyone.');
  }
});

// Log in the bot
client.login(process.env.DISCORD_TOKEN);