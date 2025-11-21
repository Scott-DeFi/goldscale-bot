// index.js
const { Client, GatewayIntentBits, Events } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// ===== CONFIG =====
const COOLDOWN_MS = 60 * 60 * 1000; // 60 seconds cooldown per /weigh (change this if you want)

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

// Load existing data at startup
loadData();

// ===== DISCORD CLIENT =====
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// Helper: random float between min & max, 2 decimals
function randomOunces(min = 1, max = 31.1) {
  const val = Math.random() * (max - min) + min;
  return Number(val.toFixed(2));
}

// Decide a “weight rank” based on how heavy the pull is
function getWeightRank(oz) {
  if (oz < 5) return 'Dirt Digger';
  if (oz < 10) return 'Copper Collector';
  if (oz < 20) return 'Silverback';
  if (oz < 26) return 'Vault Guardian';
  if (oz < 30) return 'FortKnox Elite';
  return 'Mythic Nugget Master';
}

// Fun random rank for /rank
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

// ===== BOT READY =====
client.once(Events.ClientReady, readyClient => {
  console.log(`✅ Logged in as ${readyClient.user.tag}`);
});

// ===== COMMAND HANDLER =====
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  // Only allow GoldScale commands in one channel
const allowedChannel = "1441424180791873617";

if (interaction.channelId !== allowedChannel) {
  return interaction.reply({
    content: "⚠️ GoldScale commands only work in <#1441424180791873617>.",
    ephemeral: true
  });
}

  // /weigh with cooldown + tracking
  if (interaction.commandName === 'weigh') {
    const userId = interaction.user.id;
    const now = Date.now();

    // Ensure user exists in data
    if (!goldData[userId]) {
      goldData[userId] = {
        totalOunces: 0,
        lastWeigh: 0,
      };
    }

    const userData = goldData[userId];

    // Cooldown check
    if (userData.lastWeigh) {
      const diff = now - userData.lastWeigh;
      if (diff < COOLDOWN_MS) {
        const secondsLeft = Math.ceil((COOLDOWN_MS - diff) / 1000);
        return interaction.reply({
          content: `⏳ You need to wait **${secondsLeft}s** before weighing again.`,
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

    await interaction.reply({
      content:
        `💰 **Your gold weighs:** \`${ounces} troy oz\`\n` +
        `🏅 **Rank for this weigh:** ${rank}\n` +
        `📊 **Your total:** \`${userData.totalOunces.toFixed(2)} troy oz\``,
    });
  }

  // /rank (fun random title, no data tracking)
  if (interaction.commandName === 'rank') {
    const rank = getRandomGoldRank();

    await interaction.reply({
      content: `🧾 **Your gold rank:** \`${rank}\``,
    });
  }

  // /topgold (leaderboard)
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

    await interaction.reply({
      content:
        `🏆 **GoldScale Leaderboard**\n` +
        `Top ${entries.length} vault holders by total ounces:\n\n` +
        lines.join('\n'),
    });
  }
});

// Log in the bot
client.login(process.env.DISCORD_TOKEN);