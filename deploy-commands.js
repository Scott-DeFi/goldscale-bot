// deploy-commands.js
const { REST, Routes, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

// Define the slash commands
const commands = [
  new SlashCommandBuilder()
    .setName('weigh')
    .setDescription('Weigh your gold in troy ounces'),

  new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Find out your gold rank'),

  new SlashCommandBuilder()
    .setName('topgold')
    .setDescription('Show the top gold holders on the server'),

  new SlashCommandBuilder()
    .setName('resetleaderboard')
    .setDescription('Admin only: reset the GoldScale leaderboard'),

  // ✅ NEW: /mine
  new SlashCommandBuilder()
    .setName('mine')
    .setDescription('⛏️ Mine for gold (spicy risk/reward)'),

  // ✅ NEW: /daily
  new SlashCommandBuilder()
    .setName('daily')
    .setDescription('🎁 Claim daily gold + streak bonus'),

  // ✅ NEW: /duel @user
  new SlashCommandBuilder()
    .setName('duel')
    .setDescription('⚔️ Challenge someone to a duel (winner gains, loser loses)')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('Who you want to duel')
        .setRequired(true)
    ),
].map(cmd => cmd.toJSON());

// Set up REST client with your bot token
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

// Register the commands to your guild
(async () => {
  try {
    console.log('🔃 Refreshing application (/) commands...');

    await rest.put(
      Routes.applicationGuildCommands(
        process.env.DISCORD_CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    );

    console.log('✅ Successfully registered application (/) commands.');
  } catch (error) {
    console.error('❌ Error registering commands:', error);
  }
})();