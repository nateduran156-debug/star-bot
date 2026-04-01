const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration
  ]
});

const prefix = '.';
const TAGS_FILE    = path.join(__dirname, 'tags.json');
const HUSHED_FILE  = path.join(__dirname, 'hushed.json');
const CONFIG_FILE  = path.join(__dirname, 'config.json');

// ─── Persistent Storage Helpers ───────────────────────────────────────────────

function loadJSON(file) {
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function loadTags()    { return loadJSON(TAGS_FILE); }
function saveTags(t)   { saveJSON(TAGS_FILE, t); }
function loadHushed()  { return loadJSON(HUSHED_FILE); }
function saveHushed(h) { saveJSON(HUSHED_FILE, h); }
function loadConfig()  { return loadJSON(CONFIG_FILE); }
function saveConfig(c) { saveJSON(CONFIG_FILE, c); }

// ─── Initialize config.json on startup (ensures whitelist always persists) ───

(function initConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    saveJSON(CONFIG_FILE, { whitelist: [], logChannelId: null });
    console.log('📁 Created config.json for persistent storage.');
  } else {
    const cfg = loadConfig();
    if (!Array.isArray(cfg.whitelist)) {
      cfg.whitelist = [];
      saveConfig(cfg);
    }
  }
})();

// ─── Send to log channel ──────────────────────────────────────────────────────

async function sendLog(guild, embed) {
  const config    = loadConfig();
  const channelId = config.logChannelId;
  if (!channelId) return;
  try {
    const channel = await guild.channels.fetch(channelId);
    if (channel?.isTextBased()) await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('Failed to send to log channel:', err.message);
  }
}

// ─── Help Command List ────────────────────────────────────────────────────────

const COMMANDS = [
  { name: '.help',                               description: 'Shows this help menu (7 per page, with navigation buttons)' },
  { name: '.hb',                                 description: 'Check the bot\'s ping/heartbeat status' },
  { name: '.reboot',                             description: 'Reboot the bot — Administrator only' },
  { name: '.tag [name] | [content]',             description: 'Create/update a tag (stores text or a Roblox role ID) — Manage Messages' },
  { name: '.tag [robloxUser] [tagname]',         description: 'Rank a Roblox user using the role ID stored in a tag — Manage Messages' },
  { name: '.tags [name]',                        description: 'Display a saved tag by name (spaces supported, e.g. .tags susano tag)' },
  { name: '.roblox [username]',                  description: 'Roblox profile: avatar, creation date, profile & game buttons' },
  { name: '.groups [username]',                  description: 'List all Roblox groups a user is a member of, with their role in each' },
  { name: '.ban @user [reason]',                 description: 'Ban a member — Ban Members' },
  { name: '.grouproles',                         description: 'List all Roblox group roles with their IDs (use these IDs in tags)' },
  { name: '.hush @user',                         description: 'Toggle hush on a user — every message they send is auto-deleted — Manage Messages' },
  { name: '.timeout @user [minutes] [reason]',   description: 'Timeout a member (default 5 min) — Moderate Members' },
  { name: '.mute @user [reason]',                description: 'Mute a member indefinitely — Moderate Members' },
  { name: '.unmute @user',                       description: 'Remove a member\'s mute/timeout — Moderate Members' },
  { name: '.setlog #channel',                    description: 'Set the channel where tag rank actions are logged — Administrator' },
  { name: '.whitelist add @user',                description: 'Add a user to the bot whitelist — Administrator' },
  { name: '.whitelist remove @user',             description: 'Remove a user from the bot whitelist — Administrator' },
  { name: '.whitelist list',                     description: 'Show all whitelisted users — Administrator' },
];

const ITEMS_PER_PAGE = 7;

// ─── Help Helpers ─────────────────────────────────────────────────────────────

function buildHelpEmbed(page) {
  const totalPages = Math.ceil(COMMANDS.length / ITEMS_PER_PAGE);
  const slice = COMMANDS.slice(page * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE + ITEMS_PER_PAGE);
  return new EmbedBuilder()
    .setTitle('📖 Bot Commands')
    .setColor(0x5865F2)
    .setDescription(slice.map(c => `\`${c.name}\`\n> ${c.description}`).join('\n\n'))
    .setFooter({ text: `Page ${page + 1} of ${totalPages}  •  Prefix: .` });
}

function buildHelpRow(page) {
  const totalPages = Math.ceil(COMMANDS.length / ITEMS_PER_PAGE);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`help_${page - 1}`)
      .setLabel('◀ Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`help_${page + 1}`)
      .setLabel('Next ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === totalPages - 1)
  );
}

// ─── Roblox Group Ranking ─────────────────────────────────────────────────────

async function rankRobloxUser(robloxUsername, roleId) {
  const cookie   = process.env.ROBLOX_COOKIE;
  const groupId  = process.env.ROBLOX_GROUP_ID;

  if (!cookie || !groupId) {
    throw new Error('ROBLOX_COOKIE or ROBLOX_GROUP_ID is not configured.');
  }

  // 1. Resolve username → userId
  const lookupRes = await fetch('https://users.roblox.com/v1/usernames/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernames: [robloxUsername], excludeBannedUsers: false })
  });
  const lookupData = await lookupRes.json();
  const userBasic  = lookupData.data?.[0];
  if (!userBasic) throw new Error(`Roblox user "${robloxUsername}" not found.`);

  const userId = userBasic.id;

  // 2. Check user is actually a member of the group
  const memberRes  = await fetch(`https://groups.roblox.com/v1/users/${userId}/groups/roles`);
  const memberData = await memberRes.json();
  const isMember   = memberData.data?.some(g => String(g.group.id) === String(groupId));
  if (!isMember) {
    throw new Error(
      `**${userBasic.name}** is not a member of your Roblox group (ID: ${groupId}).\n` +
      `They must join the group before they can be ranked.`
    );
  }

  // 3. Fetch CSRF token
  const csrfRes = await fetch('https://auth.roblox.com/v2/logout', {
    method: 'POST',
    headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
  });
  const csrfToken = csrfRes.headers.get('x-csrf-token');
  if (!csrfToken) throw new Error('Could not fetch CSRF token. Check your ROBLOX_COOKIE.');

  // 4. Set rank
  const rankRes = await fetch(`https://groups.roblox.com/v1/groups/${groupId}/users/${userId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `.ROBLOSECURITY=${cookie}`,
      'X-CSRF-TOKEN': csrfToken
    },
    body: JSON.stringify({ roleId: Number(roleId) })
  });

  if (!rankRes.ok) {
    const errData = await rankRes.json().catch(() => ({}));
    const code    = errData.errors?.[0]?.code;
    const msg     = errData.errors?.[0]?.message ?? `HTTP ${rankRes.status}`;
    if (code === 4) throw new Error(`The bot's Roblox account doesn't have permission to rank this user (they may have a higher role than the bot).`);
    if (code === 2) throw new Error(`Role ID \`${roleId}\` doesn't exist in your group. Run \`.grouproles\` to find the correct ID.`);
    throw new Error(`Roblox ranking failed: ${msg}`);
  }

  // 5. Fetch avatar
  const avatarRes  = await fetch(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=420x420&format=Png&isCircular=false`);
  const avatarData = await avatarRes.json();
  const avatarUrl  = avatarData.data?.[0]?.imageUrl ?? null;

  return { userId, displayName: userBasic.name, avatarUrl };
}

// ─── Ready ────────────────────────────────────────────────────────────────────

client.on('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ─── Help Pagination Buttons ──────────────────────────────────────────────────

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('help_')) return;
  const page = parseInt(interaction.customId.split('_')[1]);
  await interaction.update({
    embeds: [buildHelpEmbed(page)],
    components: [buildHelpRow(page)]
  });
});

// ─── Message Handler ──────────────────────────────────────────────────────────

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Auto-delete hushed users' messages
  const hushed = loadHushed();
  if (hushed[message.author.id]) {
    try { await message.delete(); } catch {}
    return;
  }

  if (!message.content.startsWith(prefix)) return;

  // Whitelist gate — Administrators always pass; everyone else must be whitelisted
  const isAdmin = message.member?.permissions.has(PermissionsBitField.Flags.Administrator);
  if (!isAdmin) {
    const cfg = loadConfig();
    const whitelist = cfg.whitelist ?? [];
    if (!whitelist.includes(message.author.id)) return;
  }

  const args    = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // .hb
  if (command === 'hb') {
    const ping = client.ws.ping;
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('📡 Bot Heartbeat')
          .setColor(ping < 100 ? 0x57F287 : ping < 250 ? 0xFEE75C : 0xED4245)
          .addFields(
            { name: 'WebSocket Latency', value: `\`${ping}ms\``, inline: true },
            { name: 'Status', value: ping < 100 ? '🟢 Excellent' : ping < 250 ? '🟡 Moderate' : '🔴 High', inline: true }
          )
          .setTimestamp()
      ]
    });
  }

  // .reboot
  if (command === 'reboot') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply('❌ You need **Administrator** permission to reboot.');
    await message.reply('🔄 Rebooting the bot...');
    process.exit(0);
  }

  // .tag — Mode 1: .tag [name] | [content]  /  Mode 2: .tag [robloxUser] [tagname]
  if (command === 'tag') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
      return message.reply('❌ You need **Manage Messages** permission.');

    const full = args.join(' ');

    if (full.includes('|')) {
      // Create/update tag
      const pipeIdx = full.indexOf('|');
      const name    = full.slice(0, pipeIdx).trim().toLowerCase();
      const content = full.slice(pipeIdx + 1).trim();
      if (!name || !content)
        return message.reply('❌ Usage: `.tag [name] | [content]`\nExample: `.tag susano tag | 12345678`');
      const tags = loadTags();
      const isUpdate = !!tags[name];
      tags[name] = content;
      saveTags(tags);
      return message.reply(`✅ Tag **${name}** ${isUpdate ? 'updated' : 'created'}.`);
    }

    // Rank mode
    const robloxUser = args[0];
    const tagName    = args.slice(1).join(' ').toLowerCase();

    if (!robloxUser || !tagName)
      return message.reply(
        '❌ Usage:\n• Create tag: `.tag [name] | [roleId]`\n• Rank user: `.tag [robloxUsername] [tagname]`\nExample: `.tag Nateduraan susano tag`'
      );

    const tags = loadTags();
    if (!tags[tagName])
      return message.reply(`❌ No tag named **${tagName}** found. Create it first with \`.tag ${tagName} | [roleId]\``);

    const roleId = tags[tagName].trim();
    if (isNaN(Number(roleId)))
      return message.reply(`❌ Tag **${tagName}** doesn't contain a valid Roblox role ID (got: \`${roleId}\`).`);

    const statusMsg = await message.reply(`⏳ Ranking **${robloxUser}** to role \`${roleId}\`...`);

    try {
      const result = await rankRobloxUser(robloxUser, roleId);
      const embed  = new EmbedBuilder()
        .setTitle('✅ Roblox Rank Updated')
        .setColor(0x57F287)
        .addFields(
          { name: 'Roblox User', value: result.displayName, inline: true },
          { name: 'Tag Applied', value: tagName,            inline: true },
          { name: 'Role ID',     value: roleId,             inline: true }
        )
        .setFooter({ text: `Ranked by ${message.author.tag}` })
        .setTimestamp();
      if (result.avatarUrl) embed.setThumbnail(result.avatarUrl);
      await statusMsg.edit({ content: '', embeds: [embed] });

      // Log to log channel
      const logEmbed = new EmbedBuilder()
        .setTitle('📋 Tag Rank Log')
        .setColor(0x5865F2)
        .addFields(
          { name: 'Roblox User', value: result.displayName,        inline: true },
          { name: 'Tag Applied', value: tagName,                    inline: true },
          { name: 'Role ID',     value: roleId,                     inline: true },
          { name: 'Ranked By',   value: `<@${message.author.id}>`,  inline: true },
          { name: 'Channel',     value: `<#${message.channel.id}>`, inline: true }
        )
        .setFooter({ text: `Roblox ID: ${result.userId}` })
        .setTimestamp();
      if (result.avatarUrl) logEmbed.setThumbnail(result.avatarUrl);
      await sendLog(message.guild, logEmbed);

    } catch (err) {
      console.error(err);
      await statusMsg.edit(`❌ Ranking failed: ${err.message}`);
    }
    return;
  }

  // .tags
  if (command === 'tags') {
    const name = args.join(' ').toLowerCase();
    if (!name) return message.reply('❌ Usage: `.tags [name]`\nExample: `.tags susano tag`');
    const tags = loadTags();
    if (!tags[name]) return message.reply(`❌ No tag named **${name}** found.`);
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle(`🏷 ${name}`)
          .setDescription(tags[name])
          .setColor(0x5865F2)
          .setFooter({ text: 'Use .tag [name] | [content] to create or update tags' })
      ]
    });
  }

  // .roblox
  if (command === 'roblox') {
    const username = args[0];
    if (!username) return message.reply('❌ Usage: `.roblox [username]`');
    try {
      const lookupRes  = await fetch('https://users.roblox.com/v1/usernames/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames: [username], excludeBannedUsers: false })
      });
      const userBasic = (await lookupRes.json()).data?.[0];
      if (!userBasic) return message.reply(`❌ Roblox user **${username}** not found.`);
      const userId  = userBasic.id;
      const user    = await (await fetch(`https://users.roblox.com/v1/users/${userId}`)).json();
      const created = new Date(user.created).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      const avatarUrl  = (await (await fetch(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=420x420&format=Png&isCircular=false`)).json()).data?.[0]?.imageUrl;
      const profileUrl = `https://www.roblox.com/users/${userId}/profile`;
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`${user.displayName} (@${user.name})`).setURL(profileUrl).setColor(0x5865F2)
            .addFields(
              { name: '📅 Account Created', value: created,     inline: true },
              { name: '🆔 User ID',          value: `${userId}`, inline: true }
            )
            .setThumbnail(avatarUrl).setFooter({ text: 'Roblox' }).setTimestamp()
        ],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel('View Profile').setStyle(ButtonStyle.Link).setURL(profileUrl),
          new ButtonBuilder().setLabel('🎮 View Games').setStyle(ButtonStyle.Link).setURL(`${profileUrl}#sortName=Games`)
        )]
      });
    } catch { return message.reply('❌ Failed to fetch Roblox profile. Try again later.'); }
  }

  // .groups
  if (command === 'groups') {
    const username = args[0];
    if (!username) return message.reply('❌ Usage: `.groups [username]`');
    try {
      const lookupRes = await fetch('https://users.roblox.com/v1/usernames/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames: [username], excludeBannedUsers: false })
      });
      const userBasic = (await lookupRes.json()).data?.[0];
      if (!userBasic) return message.reply(`❌ Roblox user **${username}** not found.`);
      const userId = userBasic.id;

      const groupsRes  = await fetch(`https://groups.roblox.com/v1/users/${userId}/groups/roles`);
      const groupsData = await groupsRes.json();
      const groups     = groupsData.data ?? [];

      if (!groups.length) {
        return message.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(`👥 Groups — ${userBasic.name}`)
              .setColor(0x5865F2)
              .setDescription('This user is not a member of any Roblox groups.')
              .setTimestamp()
          ]
        });
      }

      const avatarUrl = (await (await fetch(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=420x420&format=Png&isCircular=false`)).json()).data?.[0]?.imageUrl;

      const GROUPS_PER_EMBED = 25;
      const sorted = groups.sort((a, b) => a.group.name.localeCompare(b.group.name));
      const lines  = sorted.map(g => `**${g.group.name}**\n> Role: \`${g.role.name}\`  •  Rank: \`${g.role.rank}\`  •  Group ID: \`${g.group.id}\``);

      const embeds = [];
      for (let i = 0; i < lines.length; i += GROUPS_PER_EMBED) {
        const slice = lines.slice(i, i + GROUPS_PER_EMBED);
        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setDescription(slice.join('\n\n'))
          .setTimestamp();
        if (i === 0) {
          embed.setTitle(`👥 Groups — ${userBasic.name}`);
          if (avatarUrl) embed.setThumbnail(avatarUrl);
          embed.setFooter({ text: `${groups.length} group(s) total  •  User ID: ${userId}` });
        }
        embeds.push(embed);
      }

      return message.reply({ embeds });
    } catch { return message.reply('❌ Failed to fetch Roblox groups. Try again later.'); }
  }

  // .ban
  if (command === 'ban') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers))
      return message.reply('❌ You need **Ban Members** permission.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Usage: `.ban @user [reason]`');
    if (!target.bannable) return message.reply('❌ I cannot ban this member (they may have a higher role).');
    const reason = args.slice(1).join(' ') || 'No reason provided';
    await target.ban({ reason, deleteMessageSeconds: 86400 });
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('🔨 Member Banned').setColor(0xED4245).setThumbnail(target.user.displayAvatarURL())
          .addFields(
            { name: 'User',      value: `${target.user.tag}`,    inline: true },
            { name: 'Moderator', value: `${message.author.tag}`, inline: true },
            { name: 'Reason',    value: reason }
          ).setTimestamp()
      ]
    });
  }

  // .grouproles
  if (command === 'grouproles') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
      return message.reply('❌ You need **Manage Messages** permission.');
    const groupId = process.env.ROBLOX_GROUP_ID;
    if (!groupId) return message.reply('❌ `ROBLOX_GROUP_ID` is not configured.');
    try {
      const data = await (await fetch(`https://groups.roblox.com/v1/groups/${groupId}/roles`)).json();
      if (!data.roles?.length) return message.reply('❌ No roles found for this group.');
      const lines = data.roles.sort((a, b) => a.rank - b.rank)
        .map(r => `\`Rank ${String(r.rank).padStart(3, '0')}\`  **${r.name}**\n> Role ID: \`${r.id}\``);
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('📋 Roblox Group Roles').setColor(0x5865F2).setDescription(lines.join('\n\n'))
            .setFooter({ text: `Group ID: ${groupId}  •  Use the Role ID (not Rank) in your tags` }).setTimestamp()
        ]
      });
    } catch { return message.reply('❌ Failed to fetch group roles.'); }
  }

  // .hush
  if (command === 'hush') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
      return message.reply('❌ You need **Manage Messages** permission.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Usage: `.hush @user`\nEvery message the hushed user sends will be auto-deleted.');
    const hushedData = loadHushed();
    const isHushed   = !!hushedData[target.id];
    if (isHushed) {
      delete hushedData[target.id]; saveHushed(hushedData);
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('🔊 User Unhushed').setColor(0x57F287).setThumbnail(target.user.displayAvatarURL())
            .setDescription('Their messages will no longer be auto-deleted.')
            .addFields(
              { name: 'User',      value: `${target.user.tag}`,    inline: true },
              { name: 'Moderator', value: `${message.author.tag}`, inline: true }
            ).setTimestamp()
        ]
      });
    } else {
      hushedData[target.id] = { hushedBy: message.author.id, at: Date.now() }; saveHushed(hushedData);
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('🔇 User Hushed').setColor(0xFEE75C).setThumbnail(target.user.displayAvatarURL())
            .setDescription('Every message they send will be automatically deleted.')
            .addFields(
              { name: 'User',      value: `${target.user.tag}`,    inline: true },
              { name: 'Moderator', value: `${message.author.tag}`, inline: true }
            ).setTimestamp()
        ]
      });
    }
  }

  // .timeout
  if (command === 'timeout') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
      return message.reply('❌ You need **Moderate Members** permission.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Usage: `.timeout @user [minutes] [reason]`');
    const minutes = parseInt(args[1]) || 5;
    if (minutes < 1 || minutes > 40320) return message.reply('❌ Duration must be between 1 and 40320 minutes.');
    const reason = args.slice(2).join(' ') || 'No reason provided';
    try { await target.timeout(minutes * 60 * 1000, reason); }
    catch { return message.reply('❌ Could not timeout this member (they may have a higher role).'); }
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('⏱ Member Timed Out').setColor(0xFEE75C).setThumbnail(target.user.displayAvatarURL())
          .addFields(
            { name: 'User',      value: `${target.user.tag}`,    inline: true },
            { name: 'Duration',  value: `${minutes} minute(s)`,  inline: true },
            { name: 'Moderator', value: `${message.author.tag}`, inline: true },
            { name: 'Reason',    value: reason }
          ).setTimestamp()
      ]
    });
  }

  // .mute
  if (command === 'mute') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
      return message.reply('❌ You need **Moderate Members** permission.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Usage: `.mute @user [reason]`');
    const reason = args.slice(1).join(' ') || 'No reason provided';
    try { await target.timeout(28 * 24 * 60 * 60 * 1000, reason); }
    catch { return message.reply('❌ Could not mute this member (they may have a higher role).'); }
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('🔇 Member Muted').setColor(0xED4245).setThumbnail(target.user.displayAvatarURL())
          .addFields(
            { name: 'User',      value: `${target.user.tag}`,    inline: true },
            { name: 'Moderator', value: `${message.author.tag}`, inline: true },
            { name: 'Reason',    value: reason }
          ).setTimestamp()
      ]
    });
  }

  // .unmute
  if (command === 'unmute') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
      return message.reply('❌ You need **Moderate Members** permission.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Usage: `.unmute @user`');
    try { await target.timeout(null); }
    catch { return message.reply('❌ Could not unmute this member.'); }
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('🔊 Member Unmuted').setColor(0x57F287).setThumbnail(target.user.displayAvatarURL())
          .addFields(
            { name: 'User',      value: `${target.user.tag}`,    inline: true },
            { name: 'Moderator', value: `${message.author.tag}`, inline: true }
          ).setTimestamp()
      ]
    });
  }

  // .whitelist
  if (command === 'whitelist') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply('❌ You need **Administrator** permission.');
    const sub = args[0]?.toLowerCase();
    const cfg = loadConfig();
    cfg.whitelist = cfg.whitelist ?? [];

    if (sub === 'add') {
      const target = message.mentions.members.first();
      if (!target) return message.reply('❌ Usage: `.whitelist add @user`');
      if (cfg.whitelist.includes(target.id))
        return message.reply(`ℹ️ **${target.user.tag}** is already whitelisted.`);
      cfg.whitelist.push(target.id);
      saveConfig(cfg);
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('✅ User Whitelisted').setColor(0x57F287).setThumbnail(target.user.displayAvatarURL())
            .addFields(
              { name: 'User',     value: `${target.user.tag}`,    inline: true },
              { name: 'Added By', value: `${message.author.tag}`, inline: true }
            ).setTimestamp()
        ]
      });
    }

    if (sub === 'remove') {
      const target = message.mentions.members.first();
      if (!target) return message.reply('❌ Usage: `.whitelist remove @user`');
      if (!cfg.whitelist.includes(target.id))
        return message.reply(`ℹ️ **${target.user.tag}** is not whitelisted.`);
      cfg.whitelist = cfg.whitelist.filter(id => id !== target.id);
      saveConfig(cfg);
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('🗑 User Removed from Whitelist').setColor(0xED4245).setThumbnail(target.user.displayAvatarURL())
            .addFields(
              { name: 'User',       value: `${target.user.tag}`,    inline: true },
              { name: 'Removed By', value: `${message.author.tag}`, inline: true }
            ).setTimestamp()
        ]
      });
    }

    if (sub === 'list') {
      if (!cfg.whitelist.length) {
        return message.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle('📋 Whitelist').setColor(0x5865F2)
              .setDescription('No users are currently whitelisted.\nAdministrators can always use the bot.')
              .setTimestamp()
          ]
        });
      }
      const lines = cfg.whitelist.map((id, i) => `${i + 1}. <@${id}> (\`${id}\`)`);
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('📋 Whitelist').setColor(0x5865F2).setDescription(lines.join('\n'))
            .setFooter({ text: 'Administrators always have access regardless of this list.' }).setTimestamp()
        ]
      });
    }

    return message.reply('❌ Usage: `.whitelist add @user` | `.whitelist remove @user` | `.whitelist list`');
  }

  // .setlog
  if (command === 'setlog') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply('❌ You need **Administrator** permission.');
    const channel = message.mentions.channels.first();
    if (!channel || !channel.isTextBased())
      return message.reply('❌ Usage: `.setlog #channel`\nMention the channel you want rank logs sent to.');
    const config = loadConfig();
    config.logChannelId = channel.id;
    saveConfig(config);
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('✅ Log Channel Set').setColor(0x57F287)
          .setDescription(`Tag rank logs will now be sent to ${channel}.`)
          .setTimestamp()
      ]
    });
  }

  // .help
  if (command === 'help') {
    return message.reply({
      embeds: [buildHelpEmbed(0)],
      components: [buildHelpRow(0)]
    });
  }
});

// ─── Login ────────────────────────────────────────────────────────────────────

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('❌ DISCORD_TOKEN is not set!');
  process.exit(1);
}

client.login(token);
