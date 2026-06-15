const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,   // Important for welcome messages
  ]
});

// === HTTP Server for Render ===
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
  res.send('Visionary Village Bot is running!');
});

app.listen(PORT, () => {
  console.log(`🌐 HTTP server running on port ${PORT}`);
});

// === Discord Bot ===
client.once('ready', () => {
  console.log(`✅ Bot is online as ${client.user.tag}`);
});

// === AUTO WELCOME MESSAGE ===
client.on('guildMemberAdd', async (member) => {
  const welcomeChannel = member.guild.channels.cache.find(
    ch => ch.name === 'introductions' || ch.name === 'welcome' || ch.name === 'general'
  );

  if (welcomeChannel) {
    await welcomeChannel.send(
      `👋 Welcome to **Visionary Village**, ${member}! We're glad you're here.\n\n` +
      `Please introduce yourself in this channel and check the pinned messages for how everything works.`
    );
  }

  // Optional: Send a DM to the new member
  try {
    await member.send(
      `Hey ${member.user.username}! Welcome to **Visionary Village**.\n\n` +
      `We're excited to have you. Feel free to introduce yourself and let us know what you're working on!`
    );
  } catch (err) {
    console.log('Could not send DM to new member.');
  }
});

// Basic commands
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.content === '!ping') {
    await message.reply('Pong! 🏓');
  }
});

client.login(process.env.DISCORD_TOKEN);
