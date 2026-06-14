const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ]
});

client.once('ready', () => {
  console.log(`✅ Bot is online as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Simple test command
  if (message.content === '!ping') {
    await message.reply('Pong! 🏓');
  }

  // Welcome new members (basic version)
  if (message.content.toLowerCase().includes('hello')) {
    await message.reply(`Hello ${message.author.username}! Welcome to Visionary Village 👋`);
  }
});

client.login(process.env.DISCORD_TOKEN);
