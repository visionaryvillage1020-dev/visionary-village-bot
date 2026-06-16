const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const cron = require('node-cron');
const { Pool } = require('pg');
require('dotenv').config();

// ============================================================
// CONFIGURATION
// ============================================================
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
    MEMBER: 'Member',
  },
  TIMEZONE: 'Europe/Vilnius',
};

// ============================================================
// POSTGRESQL CONNECTION
// ============================================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Create streaks table if it doesn't exist
async function initDatabase() {
  const query = `
    CREATE TABLE IF NOT EXISTS streaks (
      user_id TEXT PRIMARY KEY,
      username TEXT,
      current_streak INTEGER DEFAULT 0,
      last_week TEXT,
      total_logs INTEGER DEFAULT 0
    );
  `;
  await pool.query(query);
  console.log('✅ Database initialized');
}

// Get current week key (e.g. 2026-W25)
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

// Update streak in database
async function updateStreak(userId, username) {
  const weekKey = getWeekKey();
  const prevKey = getPrevWeekKey();

  const res = await pool.query('SELECT * FROM streaks WHERE user_id = $1', [userId]);
  let user = res.rows[0];

  if (!user) {
    // First time logging
    await pool.query(
      `INSERT INTO streaks (user_id, username, current_streak, last_week, total_logs) 
       VALUES ($1, $2, 1, $3, 1)`,
      [userId, username, weekKey]
    );
    return 1;
  }

  let newStreak = user.current_streak;

  if (user.last_week === weekKey) {
    // Already logged this week
  } else if (user.last_week === prevKey) {
    newStreak += 1;
  } else {
    newStreak = 1;
  }

  await pool.query(
    `UPDATE streaks 
     SET username = $1, current_streak = $2, last_week = $3, total_logs = total_logs + 1 
     WHERE user_id = $4`,
    [username, newStreak, weekKey, userId]
  );

  return newStreak;
}

// Get user streak
async function getUserStreak(userId) {
  const res = await pool.query('SELECT * FROM streaks WHERE user_id = $1', [userId]);
  return res.rows[0] || null;
}

// Get top streaks for leaderboard
async function getTopStreaks(limit = 5) {
  const res = await pool.query(
    'SELECT username, current_streak FROM streaks WHERE current_streak > 0 ORDER BY current_streak DESC LIMIT $1',
    [limit]
  );
  return res.rows;
}

// ============================================================
// CLIENT SETUP
// ============================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

// ============================================================
// HTTP SERVER
// ============================================================
const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (_req, res) => res.send('Visionary Village Bot is running!'));
app.listen(PORT, () => console.log(`🌐 HTTP server running on port ${PORT}`));

// ============================================================
// HELPER
// ============================================================
function getChannel(guild, name) {
  return guild.channels.cache.find(ch => ch.name === name) || null;
}

// ============================================================
// BOT READY
// ============================================================
client.once('clientReady', async () => {
  console.log(`✅ Bot is online as ${client.user.tag}`);
  await initDatabase();
  startScheduler();
});

// ============================================================
// NEW MEMBER WELCOME + DM
// ============================================================
client.on('guildMemberAdd', async (member) => {
  const welcomeChannel = getChannel(member.guild, CONFIG.CHANNELS.WELCOME);
  if (welcomeChannel) {
    await welcomeChannel.send(
      `Welcome to **Visionary Village**, ${member}.\n\n` +
      `Read the rules, then head to <#${getChannel(member.guild, CONFIG.CHANNELS.INTRODUCTIONS)?.id || 'introductions'}> ` +
      `and post your intro video.`
    ).catch(() => {});
  }

  try {
    await member.send(
      `Hey ${member.user.username}, welcome to Visionary Village.\n\n` +
      `Before you get placed in a team, two things to do:\n\n` +
      `**1. Fill out the pre-call survey:**\n${CONFIG.SURVEY_LINK}\n\n` +
      `**2. Book your 30-minute onboarding call:**\n${CONFIG.BOOKING_LINK}\n\n` +
      `After the call, record a short intro video and post it in #introductions.\n\n` +
      `Talk soon.`
    );
  } catch {
    console.log(`Could not DM ${member.user.username}`);
  }
});

// ============================================================
// MESSAGE HANDLER
// ============================================================
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  const ch = message.channel.name;
  const msg = message.content.trim();

  // Auto Verified role + reactions on intro
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
  if (msg.toLowerCase().startsWith('!log')) {
    // ... (keep your existing !log logic, just use await updateStreak)
    // For brevity, the logic stays the same as before
    return;
  }

  if (msg.toLowerCase().startsWith('!win')) {
    // Keep existing !win logic
    return;
  }

  if (msg.toLowerCase() === '!streak') {
    const userData = await getUserStreak(message.author.id);
    if (!userData) {
      await message.reply('No streak yet. Use `!log` to start one.');
    } else {
      await message.reply(
        `Your streak: **${userData.current_streak} week${userData.current_streak !== 1 ? 's' : ''}** 🔥\n` +
        `Total logs: **${userData.total_logs}**`
      );
    }
    return;
  }

  if (msg.toLowerCase() === '!leaderboard') {
    const top = await getTopStreaks(5);
    if (top.length === 0) {
      await message.reply('No streaks yet.');
      return;
    }
    const medals = ['🥇', '🥈', '🥉', '4.', '5.'];
    const board = top.map((u, i) => `${medals[i]} **${u.username}** — ${u.current_streak} weeks`).join('\n');
    await message.reply(`**Consistency Leaderboard**\n\n${board}`);
    return;
  }

  if (msg.toLowerCase() === '!ping') {
    await message.reply('Online. 🟢');
    return;
  }

  // You can keep !guide and !help here as well
});

// ============================================================
// SCHEDULER (keep your existing schedules)
// ============================================================
function startScheduler() {
  const guild = client.guilds.cache.first();
  if (!guild) return;

  // Monday 9pm - Mission
  cron.schedule('0 21 * * 1', async () => {
    const ch = getChannel(guild, CONFIG.CHANNELS.WEEKLY_MISSION);
    if (ch) {
      await ch.send(`**This week's mission** 🎯\n\nPost your 3 commitments below...`).catch(() => {});
    }
  }, { timezone: CONFIG.TIMEZONE });

  // Add the rest of your schedules here (Wednesday, Friday, Saturday, Sunday)...

  console.log('✅ Scheduler started');
}

client.login(process.env.DISCORD_TOKEN);
