const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// ============================================================
// CONFIGURATION — edit these to match your setup
// ============================================================
const CONFIG = {
  SURVEY_LINK:  'https://your-survey-link.com',   // Replace with your Google Form / Typeform
  BOOKING_LINK: 'https://your-calendly-link.com', // Replace with your Calendly or booking link

  CHANNELS: {
    WELCOME:       'welcome-and-rules',
    INTRODUCTIONS: 'introductions',
    GENERAL:       'general',
    ANNOUNCEMENTS: 'announcements',
    WEEKLY_MISSION:'weekly-mission',
    PROGRESS_LOGS: 'progress-logs',
    WINS:          'wins',
    TEAM_MEETINGS: 'team-meetings',
  },

  ROLES: {
    VERIFIED: 'Verified',
    MEMBER:   'Member',
  },

  // Your timezone (Lithuania = Europe/Vilnius)
  TIMEZONE: 'Europe/Vilnius',
};

// ============================================================
// STREAK TRACKING (saved to streaks.json)
// NOTE: On Render, this file resets on each redeploy.
// Back it up manually or migrate to a DB when you have members.
// ============================================================
const STREAKS_FILE = path.join(__dirname, 'streaks.json');

function loadStreaks() {
  if (!fs.existsSync(STREAKS_FILE)) fs.writeFileSync(STREAKS_FILE, '{}');
  try { return JSON.parse(fs.readFileSync(STREAKS_FILE, 'utf8')); }
  catch { return {}; }
}

function saveStreaks(data) {
  fs.writeFileSync(STREAKS_FILE, JSON.stringify(data, null, 2));
}

function getWeekKey() {
  const now  = new Date();
  const year = now.getFullYear();
  const start = new Date(year, 0, 1);
  const week  = Math.ceil(((now - start) / 86400000 + start.getDay() + 1) / 7);
  return `${year}-W${week}`;
}

function getPrevWeekKey() {
  const now  = new Date();
  const prev = new Date(now - 7 * 86400000);
  const year = prev.getFullYear();
  const start = new Date(year, 0, 1);
  const week  = Math.ceil(((prev - start) / 86400000 + start.getDay() + 1) / 7);
  return `${year}-W${week}`;
}

// Returns the new streak count
function updateStreak(userId, username) {
  const streaks = loadStreaks();
  const weekKey = getWeekKey();
  const prevKey = getPrevWeekKey();

  if (!streaks[userId]) {
    streaks[userId] = { username, currentStreak: 0, lastWeek: null, totalLogs: 0 };
  }

  const user = streaks[userId];

  if (user.lastWeek === weekKey) {
    // Already logged this week — no change
  } else if (user.lastWeek === prevKey) {
    user.currentStreak += 1; // Consecutive week
  } else {
    user.currentStreak = 1;  // Streak reset or first log
  }

  user.lastWeek  = weekKey;
  user.username  = username;
  user.totalLogs = (user.totalLogs || 0) + 1;
  saveStreaks(streaks);
  return user.currentStreak;
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
// HTTP SERVER (keeps Render alive)
// ============================================================
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (_req, res) => res.send('Visionary Village Bot is running!'));
app.listen(PORT, () => console.log(`🌐 HTTP server running on port ${PORT}`));

// ============================================================
// HELPER: get a channel by name
// ============================================================
function getChannel(guild, name) {
  return guild.channels.cache.find(ch => ch.name === name) || null;
}

// ============================================================
// BOT READY
// ============================================================
client.once('clientReady', () => {
  console.log(`✅ Bot is online as ${client.user.tag}`);
  startScheduler();
});

// ============================================================
// NEW MEMBER — auto welcome + DM with survey and booking link
// ============================================================
client.on('guildMemberAdd', async (member) => {
  // Welcome in the welcome channel
  const welcomeChannel = getChannel(member.guild, CONFIG.CHANNELS.WELCOME);
  if (welcomeChannel) {
    await welcomeChannel.send(
      `Welcome to **Visionary Village**, ${member}.\n\n` +
      `Read the rules, then head to <#${getChannel(member.guild, CONFIG.CHANNELS.INTRODUCTIONS)?.id || 'introductions'}> ` +
      `and post your intro video.`
    ).catch(() => {});
  }

  // Personal DM — this is the most important message you send
  try {
    await member.send(
      `Hey ${member.user.username}, welcome to Visionary Village.\n\n` +
      `Before you get placed in a team, two things to do:\n\n` +
      `**1. Fill out the pre-call survey:**\n${CONFIG.SURVEY_LINK}\n\n` +
      `**2. Book your 30-minute onboarding call:**\n${CONFIG.BOOKING_LINK}\n\n` +
      `On the call we go through what you are building, what you need, and I place you in the right team.\n\n` +
      `After the call, record a short intro video (30 seconds to 2 minutes) and post it in #introductions. ` +
      `Cover: your name, what you are working on (or why you joined), one goal for the next 30 days, and one thing you need help with.\n\n` +
      `Talk soon.`
    );
  } catch {
    console.log(`Could not DM ${member.user.username} — they may have DMs disabled.`);
  }
});

// ============================================================
// MESSAGE HANDLER — commands + auto-reactions + verified role
// ============================================================
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const ch  = message.channel.name;
  const msg = message.content.trim();

  // ----- AUTO: Verified role + welcome react on intro post -----
  if (ch === CONFIG.CHANNELS.INTRODUCTIONS) {
    const role = message.guild.roles.cache.find(r => r.name === CONFIG.ROLES.VERIFIED);
    if (role) {
      await message.member.roles.add(role).catch(() => {});
    }
    await message.react('👋').catch(() => {});
    await message.react('🔥').catch(() => {});
    return;
  }

  // ----- AUTO: React + streak update on progress logs -----
  if (ch === CONFIG.CHANNELS.PROGRESS_LOGS) {
    await message.react('✅').catch(() => {});
    const streak = updateStreak(message.author.id, message.author.username);
    const winsChannel = getChannel(message.guild, CONFIG.CHANNELS.WINS);

    // Celebrate streak milestones in #wins
    const milestones = { 4: '4-week streak', 8: '8-week streak', 12: '12-week streak', 24: '6-month streak' };
    if (milestones[streak] && winsChannel) {
      await winsChannel.send(
        `🔥 **${milestones[streak]}!** ${message.author} has posted a progress log every week for ${streak} weeks straight. ` +
        `That kind of consistency is exactly what this is about.`
      ).catch(() => {});
    }
    return;
  }

  // ----- AUTO: React to wins -----
  if (ch === CONFIG.CHANNELS.WINS) {
    await message.react('🏆').catch(() => {});
    await message.react('🔥').catch(() => {});
    return;
  }

  // ---- COMMANDS (work in any channel) ----

  // !log — post a formatted progress log
  if (msg.toLowerCase().startsWith('!log')) {
    const progressChannel = getChannel(message.guild, CONFIG.CHANNELS.PROGRESS_LOGS);
    if (!progressChannel) {
      await message.reply('Cannot find the #progress-logs channel.').catch(() => {});
      return;
    }

    const content = msg.slice(4).trim();
    const committedMatch = content.match(/committed:\s*(.+?)(?=\s*did:|\s*blocked:|$)/is);
    const didMatch       = content.match(/did:\s*(.+?)(?=\s*committed:|\s*blocked:|$)/is);
    const blockedMatch   = content.match(/blocked:\s*(.+?)(?=\s*committed:|\s*did:|$)/is);

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
    const did       = didMatch[1].trim();
    const blocked   = blockedMatch ? blockedMatch[1].trim() : 'Nothing';
    const streak    = updateStreak(message.author.id, message.author.username);
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

  // !win — post a win to #wins
  if (msg.toLowerCase().startsWith('!win')) {
    const winsChannel = getChannel(message.guild, CONFIG.CHANNELS.WINS);
    if (!winsChannel) {
      await message.reply('Cannot find the #wins channel.').catch(() => {});
      return;
    }

    const winText = msg.slice(4).trim();
    if (!winText) {
      await message.reply('Tell us what the win is.\nUse: `!win [your win here]`').catch(() => {});
      return;
    }

    await winsChannel.send(
      `🏆 **Win — ${message.member.displayName}:**\n\n${winText}`
    ).catch(() => {});

    await message.delete().catch(() => {});
    return;
  }

  // !streak — check your own streak
  if (msg.toLowerCase() === '!streak') {
    const streaks  = loadStreaks();
    const userData = streaks[message.author.id];

    if (!userData || userData.currentStreak === 0) {
      await message.reply(
        'No streak yet. Post your first progress log with `!log` to start one.'
      ).catch(() => {});
    } else {
      await message.reply(
        `Your streak: **${userData.currentStreak} week${userData.currentStreak !== 1 ? 's' : ''}** 🔥\n` +
        `Total logs posted: **${userData.totalLogs}**`
      ).catch(() => {});
    }
    return;
  }

  // !leaderboard — top 5 streaks
  if (msg.toLowerCase() === '!leaderboard') {
    const streaks = loadStreaks();
    const sorted  = Object.entries(streaks)
      .filter(([, d]) => d.currentStreak > 0)
      .sort((a, b) => b[1].currentStreak - a[1].currentStreak)
      .slice(0, 5);

    if (sorted.length === 0) {
      await message.reply('No streaks yet. Be the first to log progress with `!log`.').catch(() => {});
      return;
    }

    const medals = ['🥇', '🥈', '🥉', '4.', '5.'];
    const board  = sorted
      .map(([, d], i) => `${medals[i]} **${d.username}** — ${d.currentStreak} week${d.currentStreak !== 1 ? 's' : ''}`)
      .join('\n');

    await message.reply(`**Consistency Leaderboard**\n\n${board}`).catch(() => {});
    return;
  }

  // !help
  if (msg.toLowerCase() === '!help') {
    await message.reply(
      `**Visionary Village — Bot Commands**\n\n` +
      `\`!log committed: [X] did: [Y] blocked: [Z]\`\n→ Post your weekly progress log to #progress-logs\n\n` +
      `\`!win [your win]\`\n→ Share a win in #wins\n\n` +
      `\`!streak\`\n→ Check your current consistency streak\n\n` +
      `\`!leaderboard\`\n→ See the top 5 streaks in the community\n\n` +
      `\`!ping\`\n→ Check if the bot is alive`
    ).catch(() => {});
    return;
  }

  // !ping
  if (msg.toLowerCase() === '!ping') {
    await message.reply('Online. 🟢').catch(() => {});
    return;
  }
});

// ============================================================
// SCHEDULER — weekly posts (runs automatically every week)
// ============================================================
function startScheduler() {
  const guild = client.guilds.cache.first();
  if (!guild) {
    console.log('No guild found — scheduler not started.');
    return;
  }

  // MONDAY 9pm — Mission launch
  cron.schedule('0 21 * * 1', async () => {
    const ch = getChannel(guild, CONFIG.CHANNELS.WEEKLY_MISSION);
    if (!ch) return;
    await ch.send(
      `**This week's mission** 🎯\n\n` +
      `*(Founder: replace this message with your weekly theme before it posts)*\n\n` +
      `Post your 3 commitments for the week below:\n\n` +
      `**This week I will:**\n` +
      `1. [specific task]\n` +
      `2. [specific task]\n` +
      `3. [specific task]\n\n` +
      `Your team leader will review and reply. Friday is progress day — you report back on everything here.`
    ).catch(() => {});
  }, { timezone: CONFIG.TIMEZONE });

  // WEDNESDAY 9pm — Mid-week pulse check
  cron.schedule('0 21 * * 3', async () => {
    const ch = getChannel(guild, CONFIG.CHANNELS.GENERAL);
    if (!ch) return;
    await ch.send(
      `**Mid-week check** ⚡\n\n` +
      `How is everyone tracking this week?\n\n` +
      `**[On track]** — what you have done so far\n` +
      `**[Need help]** — what you are stuck on\n` +
      `**[Off track]** — what happened and what the plan is\n\n` +
      `No judgment. The only wrong answer is silence.`
    ).catch(() => {});
  }, { timezone: CONFIG.TIMEZONE });

  // FRIDAY 9pm — Progress log reminder
  cron.schedule('0 21 * * 5', async () => {
    const ch = getChannel(guild, CONFIG.CHANNELS.PROGRESS_LOGS);
    if (!ch) return;
    await ch.send(
      `**Progress log time** 📊\n\n` +
      `Post your update with the \`!log\` command:\n\n` +
      `\`\`\`\n!log committed: [what you planned Monday] did: [what you actually did] blocked: [what got in the way]\`\`\`\n\n` +
      `Your team sees this. Keep it honest.`
    ).catch(() => {});
  }, { timezone: CONFIG.TIMEZONE });

  // SATURDAY 9am — Team call reminder
  cron.schedule('0 9 * * 6', async () => {
    const ch = getChannel(guild, CONFIG.CHANNELS.TEAM_MEETINGS);
    if (!ch) return;
    await ch.send(
      `**Team calls today** 📞\n\n` +
      `Check with your team leader for your call time. Voice channels are open.\n\n` +
      `Agenda:\n` +
      `1. Wins from the week (2 min each)\n` +
      `2. Blockers — what got in the way\n` +
      `3. Next week focus\n\n` +
      `Show up.`
    ).catch(() => {});
  }, { timezone: CONFIG.TIMEZONE });

  // SUNDAY 8pm — Week prep
  cron.schedule('0 20 * * 0', async () => {
    const ch = getChannel(guild, CONFIG.CHANNELS.GENERAL);
    if (!ch) return;
    await ch.send(
      `**Sunday reset** 🔄\n\n` +
      `New week tomorrow. Take 10 minutes tonight:\n\n` +
      `— What is your focus for this week?\n` +
      `— What got in the way last week?\n` +
      `— Are you on track for your monthly goals?\n\n` +
      `Mission drops tomorrow at 9pm. Be ready.`
    ).catch(() => {});
  }, { timezone: CONFIG.TIMEZONE });

  console.log('✅ Weekly schedule active (Mon/Wed/Fri/Sat/Sun)');
}

// ============================================================
client.login(process.env.DISCORD_TOKEN);
