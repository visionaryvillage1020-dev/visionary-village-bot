const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const cron = require('node-cron');
const { Pool } = require('pg');
require('dotenv').config();

// ==================== CONFIG ====================
const CONFIG = {
  SURVEY_LINK: 'https://forms.gle/LhnbJ61rBaouuPrQA',
  BOOKING_LINK: 'https://calendly.com/visionaryvillage1020/30min',
  CHANNELS: {
    WELCOME: 'welcome-and-rules',
    INTRODUCTIONS: 'introductions',
    GENERAL: 'general',
    ANNOUNCEMENTS: 'announcements',
    WEEKLY_MISSION: 'weekly-mission',
    PROGRESS_LOGS: 'progress-logs',
    WINS: 'wins',
    TEAM_MEETINGS: 'team-meetings',
  },
  ROLES: {
    VERIFIED: 'Verified',
  },
  TIMEZONE: 'Europe/Vilnius',
};

// ==================== POSTGRESQL ====================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS streaks (
      user_id TEXT PRIMARY KEY,
      username TEXT,
      current_streak INTEGER DEFAULT 0,
      last_week TEXT,
      total_logs INTEGER DEFAULT 0
    );
  `);
  console.log('✅ Database ready');
}

function getWeekKey() {
  const now = new Date();
  const year = now.getFullYear();
  const start = new Date(year, 0, 1);
  const week = Math.ceil(((now - start) / 86400000 + start.getDay() + 1) / 7);
  return `${year}-W${week}`;
}

function getPrevWeekKey() {
  const now = new Date();
  const prev = new Date(now - 7 * 86400000);
  const year = prev.getFullYear();
  const start = new Date(year, 0, 1);
  const week = Math.ceil(((prev - start) / 86400000 + start.getDay() + 1) / 7);
  return `${year}-W${week}`;
}

async function updateStreak(userId, username) {
  const weekKey = getWeekKey();
  const prevKey = getPrevWeekKey();

  const res = await pool.query('SELECT * FROM streaks WHERE user_id = $1', [userId]);
  let user = res.rows[0];

  if (!user) {
    await pool.query(
      `INSERT INTO streaks (user_id, username, current_streak, last_week, total_logs) 
       VALUES ($1, $2, 1, $3, 1)`,
      [userId, username, weekKey]
    );
    return 1;
  }

  let newStreak = user.current_streak;
  if (user.last_week === weekKey) {
    // already logged this week
  } else if (user.last_week === prevKey) {
    newStreak += 1;
  } else {
    newStreak = 1;
  }

  await pool.query(
    `UPDATE streaks SET username = $1, current_streak = $2, last_week = $3, total_logs = total_logs + 1 
     WHERE user_id = $4`,
    [username, newStreak, weekKey, userId]
  );
  return newStreak;
}

async function getUserStreak(userId) {
  const res = await pool.query('SELECT * FROM streaks WHERE user_id = $1', [userId]);
  return res.rows[0] || null;
}

async function getTopStreaks(limit = 5) {
  const res = await pool.query(
    'SELECT username, current_streak FROM streaks WHERE current_streak > 0 ORDER BY current_streak DESC LIMIT $1',
    [limit]
  );
  return res.rows;
}

// ==================== CLIENT ====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

// ==================== HTTP SERVER ====================
const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (_req, res) => res.send('Visionary Village Bot is running!'));
app.listen(PORT, () => console.log(`🌐 HTTP server running on port ${PORT}`));

// ==================== HELPERS ====================
function getChannel(guild, name) {
  return guild.channels.cache.find(ch => ch.name === name) || null;
}

// ==================== READY ====================
client.once('clientReady', async () => {
  console.log(`✅ Bot is online as ${client.user.tag}`);
  await initDatabase();
  startScheduler();
});

// ==================== WELCOME NEW MEMBERS ====================
client.on('guildMemberAdd', async (member) => {
  const welcomeChannel = getChannel(member.guild, CONFIG.CHANNELS.WELCOME);
  if (welcomeChannel) {
    await welcomeChannel.send(
      `Welcome to **Visionary Village**, ${member}!\n\n` +
      `Please read the rules and post your intro video in <#${getChannel(member.guild, CONFIG.CHANNELS.INTRODUCTIONS)?.id || 'introductions'}>.`
    ).catch(() => {});
  }

  try {
    await member.send(
      `Hey ${member.user.username}, welcome to Visionary Village.\n\n` +
      `**Next steps:**\n` +
      `1. Fill out the pre-call survey: ${CONFIG.SURVEY_LINK}\n` +
      `2. Book your onboarding call: ${CONFIG.BOOKING_LINK}\n\n` +
      `After the call, record a short intro video and post it in #introductions.`
    );
  } catch {
    console.log(`Could not DM ${member.user.username}`);
  }
});

// ==================== MESSAGE HANDLER ====================
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  const ch = message.channel.name;
  const msg = message.content.trim().toLowerCase();

  // Auto Verified + reactions on intro posts
  if (ch === CONFIG.CHANNELS.INTRODUCTIONS) {
    const role = message.guild.roles.cache.find(r => r.name === CONFIG.ROLES.VERIFIED);
    if (role) await message.member.roles.add(role).catch(() => {});
    await message.react('👋').catch(() => {});
    await message.react('🔥').catch(() => {});
    return;
  }

  // Auto react + streak on progress logs
  if (ch === CONFIG.CHANNELS.PROGRESS_LOGS) {
    await message.react('✅').catch(() => {});
    const streak = await updateStreak(message.author.id, message.author.username);

    const winsChannel = getChannel(message.guild, CONFIG.CHANNELS.WINS);
    const milestones = { 4: '4-week streak', 8: '8-week streak', 12: '12-week streak' };
    if (milestones[streak] && winsChannel) {
      await winsChannel.send(
        `🔥 **${milestones[streak]}!** ${message.author} has posted consistently for ${streak} weeks straight.`
      ).catch(() => {});
    }
    return;
  }

  // React to wins
  if (ch === CONFIG.CHANNELS.WINS) {
    await message.react('🏆').catch(() => {});
    await message.react('🔥').catch(() => {});
    return;
  }

  // ====================== COMMANDS ======================
// ==================== !log COMMAND ====================
if (msg.startsWith('!log')) {
  const progressChannel = getChannel(message.guild, CONFIG.CHANNELS.PROGRESS_LOGS);
  if (!progressChannel) {
    await message.reply('Cannot find the #progress-logs channel.').catch(() => {});
    return;
  }

  const content = message.content.slice(4).trim();

  const committedMatch = content.match(/committed:\s*(.+?)(?=\s*did:|\s*blocked:|$)/is);
  const didMatch = content.match(/did:\s*(.+?)(?=\s*committed:|\s*blocked:|$)/is);
  const blockedMatch = content.match(/blocked:\s*(.+?)(?=\s*committed:|\s*did:|$)/is);

  if (!committedMatch || !didMatch) {
    await message.reply(
      `Use this format:\n` +
      `\`\`\`\n!log committed: [what you planned] did: [what you did] blocked: [what got in the way]\`\`\`\n` +
      `Example:\n` +
      `\`\`\`\n!log committed: finish landing page did: got 70% done blocked: ran out of time\`\`\``
    ).catch(() => {});
    return;
  }

  const committed = committedMatch[1].trim();
  const did = didMatch[1].trim();
  const blocked = blockedMatch ? blockedMatch[1].trim() : 'Nothing';

  const streak = await updateStreak(message.author.id, message.author.username);
  const streakTag = streak > 1 ? ` · ${streak} week streak 🔥` : '';

  await progressChannel.send(
    `**Progress Log — ${message.member.displayName}**${streakTag}\n` +
    `───────────────────────────\n` +
    `📌 **Committed:** ${committed}\n` +
    `✅ **Did:** ${did}\n` +
    `🚧 **Blocked by:** ${blocked}\n` +
    `───────────────────────────`
  ).catch(() => {});

  await message.delete().catch(() => {});
  return;
}

// ==================== !win COMMAND ====================
if (msg.startsWith('!win')) {
  const winsChannel = getChannel(message.guild, CONFIG.CHANNELS.WINS);
  if (!winsChannel) {
    await message.reply('Cannot find the #wins channel.').catch(() => {});
    return;
  }

  const winText = message.content.slice(4).trim();
  if (!winText) {
    await message.reply('Tell us what the win is.\nExample: `!win sent my first cold email and got a reply`').catch(() => {});
    return;
  }

  await winsChannel.send(
    `🏆 **Win — ${message.member.displayName}**\n\n${winText}`
  ).catch(() => {});

  await message.delete().catch(() => {});
  return;
}
  // ==================== !guide COMMAND ====================
if (msg === '!guide') {
  await message.reply(
    `**📌 How Visionary Village Works**\n\n` +
    `This is a structured accountability community. The bot helps keep everything running automatically.\n\n` +
    `**Weekly Rhythm:**\n` +
    `• **Monday 9pm** — Mission drops in #weekly-mission\n` +
    `• **Wednesday 9pm** — Mid-week check-in\n` +
    `• **Friday 9pm** — Progress log reminder\n` +
    `• **Saturday** — Team calls\n` +
    `• **Sunday 8pm** — Week reset\n\n` +
    `**Useful Commands:**\n` +
    `• \`!log\` — Post your weekly progress\n` +
    `• \`!win [text]\` — Share a win\n` +
    `• \`!streak\` — Check your consistency streak\n` +
    `• \`!leaderboard\` — Top 5 streaks\n` +
    `• \`!help\` — See all commands\n\n` +
    `Stay consistent. That’s what makes this work.`
  ).catch(() => {});
  return;
}

  if (msg === '!streak') {
    const userData = await getUserStreak(message.author.id);
    if (!userData) {
      await message.reply('No streak yet. Start logging with `!log`.');
    } else {
      await message.reply(
        `Your streak: **${userData.current_streak} week${userData.current_streak !== 1 ? 's' : ''}** 🔥\n` +
        `Total logs: **${userData.total_logs}**`
      );
    }
    return;
  }

  if (msg === '!leaderboard') {
    const top = await getTopStreaks(5);
    if (top.length === 0) return message.reply('No streaks yet.');
    const medals = ['🥇', '🥈', '🥉', '4.', '5.'];
    const board = top.map((u, i) => `${medals[i]} **${u.username}** — ${u.current_streak} weeks`).join('\n');
    await message.reply(`**Consistency Leaderboard**\n\n${board}`);
    return;
  }

  if (msg === '!ping') {
    await message.reply('Online. 🟢');
    return;
  }

  if (msg === '!help') {
    await message.reply(
      `**Visionary Village Bot Commands**\n\n` +
      `\`!log\` — Post progress log\n` +
      `\`!win [text]\` — Share a win\n` +
      `\`!streak\` — Check your streak\n` +
      `\`!leaderboard\` — Top consistency streaks\n` +
      `\`!guide\` — Full community guide\n` +
      `\`!ping\` — Check if bot is alive`
    );
    return;
  }
});

// ==================== IMPROVED SCHEDULER ====================
function startScheduler() {
  const guild = client.guilds.cache.first();
  if (!guild) return;

  // Monday 9pm - Mission
  cron.schedule('0 21 * * 1', async () => {
    const ch = getChannel(guild, CONFIG.CHANNELS.WEEKLY_MISSION);
    if (!ch) return;
    await ch.send(
      `**🎯 This Week’s Mission**\n\n` +
      `Post your 3 commitments below:\n\n` +
      `**This week I will:**\n` +
      `1. [task]\n2. [task]\n3. [task]`
    ).catch(() => {});
  }, { timezone: CONFIG.TIMEZONE });

  // Wednesday 9pm - Mid-week check
  cron.schedule('0 21 * * 3', async () => {
    const ch = getChannel(guild, CONFIG.CHANNELS.GENERAL);
    if (!ch) return;
    await ch.send(
      `**⚡ Mid-Week Check-In**\n\n` +
      `Reply with: **[On track]**, **[Need help]**, or **[Off track]**`
    ).catch(() => {});
  }, { timezone: CONFIG.TIMEZONE });

  // Friday 9pm - Progress reminder
  cron.schedule('0 21 * * 5', async () => {
    const ch = getChannel(guild, CONFIG.CHANNELS.PROGRESS_LOGS);
    if (!ch) return;
    await ch.send(
      `**📊 Progress Log Time**\n\n` +
      `Use: \`!log committed: X did: Y blocked: Z\``
    ).catch(() => {});
  }, { timezone: CONFIG.TIMEZONE });

  // Saturday 9am - Team calls
  cron.schedule('0 9 * * 6', async () => {
    const ch = getChannel(guild, CONFIG.CHANNELS.TEAM_MEETINGS);
    if (!ch) return;
    await ch.send(`**📞 Team Calls Today** — Check with your team leader.`).catch(() => {});
  }, { timezone: CONFIG.TIMEZONE });

  // Sunday 8pm - Reset
  cron.schedule('0 20 * * 0', async () => {
    const ch = getChannel(guild, CONFIG.CHANNELS.GENERAL);
    if (!ch) return;
    await ch.send(`**🔄 Sunday Reset** — New week tomorrow. Get ready.`).catch(() => {});
  }, { timezone: CONFIG.TIMEZONE });

  console.log('✅ Scheduler active');
}

client.login(process.env.DISCORD_TOKEN);
