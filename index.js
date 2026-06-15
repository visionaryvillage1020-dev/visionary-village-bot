const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ]
});

// === HTTP Server for Render (Required) ===
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

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.content === '!ping') {
    await message.reply('Pong! 🏓');
  }

  if (message.content.toLowerCase().includes('hello')) {
    await message.reply(`Hello ${message.author.username}! Welcome to Visionary Village 👋`);
  }
});

client.login(process.env.DISCORD_TOKEN);
