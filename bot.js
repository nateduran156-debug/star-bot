const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  AttachmentBuilder
} = require('discord.js');
const fs   = require('fs');
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

const prefix    = '.';
const LOGO_PATH = path.join(__dirname, 'logo.png');

const TAGS_FILE   = path.join(__dirname, 'data', 'tags.json');
const HUSHED_FILE = path.join(__dirname, 'data', 'hushed.json');
const CONFIG_FILE = path.join(__dirname, 'data', 'config.json');
const ALTS_FILE   = path.join(__dirname, 'data', 'alts.json');
const REBOOT_FILE = path.join(__dirname, 'data', 'reboot.json');

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
function loadAlts()    { return loadJSON(ALTS_FILE); }
function saveAlts(a)   { saveJSON(ALTS_FILE, a); }

// ─── Logo Attachment Helper ────────────────────────────────────────────────────

function logoAttachment() {
  if (!fs.existsSync(LOGO_PATH)) return { files: [], logoUrl: null };
  return {
    files: [new AttachmentBuilder(LOGO_PATH, { name: 'logo.png' })],
    logoUrl: 'attachment://logo.png'
  };
}

// ─── Send to log channel ──────────────────────────────────────────────────────

async function sendLog(guild, embed) {
  const config    = loadConfig();
  const channelId = config.logChannelId;
  if (!channelId) return;
  try {
    const channel = await guild.channels.fetch(channelId);
    if (channel?.isTextBased()) {
      const { files, logoUrl } = logoAttachment();
      if (logoUrl) embed.setThumbnail(logoUrl);
      await channel.send({ embeds: [embed], files });
    }
  } catch (err) {
    console.error('Failed to send to log channel:', err.message);
  }
}

// ─── Reply helper with logo ────────────────────────────────────────────────────

async function replyWithLogo(message, embed, extra = {}) {
  const { files, logoUrl } = logoAttachment();
  if (logoUrl) embed.setThumbnail(logoUrl);
  return message.reply({ embeds: [embed], files, ...extra });
}

// ─── Alt account helpers ──────────────────────────────────────────────────────

function getAltsFor(userId) {
  const alts = loadAlts();
  return alts[userId] ?? [];
}

function linkAlts(id1, id2) {
  const alts = loadAlts();
  if (!alts[id1]) alts[id1] = [];
  if (!alts[id2]) alts[id2] = [];
  if (!alts[id1].includes(id2)) alts[id1].push(id2);
  if (!alts[id2].includes(id1)) alts[id2].push(id1);
  saveAlts(alts);
}

function unlinkAlts(id1, id2) {
  const alts = loadAlts();
  if (alts[id1]) alts[id1] = alts[id1].filter(id => id !== id2);
  if (alts[id2]) alts[id2] = alts[id2].filter(id => id !== id1);
  saveAlts(alts);
}

// ─── Help Command List ─────────────────────────────────────────────────────────

const COMMANDS = [
  { name: '.help',                               description: 'Shows this help menu (7 per page, with navigation buttons)' },
  { name: '.ping',                               description: 'Check the bot\'s ping/latency status' },
  { name: '.reboot',                             description: 'Reboot the bot — notifies you when it\'s back online — Administrator only' },
  { name: '.hb @user [reason]',                  description: 'Hardban a user + all their registered alts — Ban Members' },
  { name: '.addalt @user1 @user2',               description: 'Link two accounts as alts of each other — Administrator' },
  { name: '.removealt @user1 @user2',            description: 'Unlink two accounts — Administrator' },
  { name: '.ban @user [reason]',                 description: 'Ban a member — Ban Members' },
  { name: '.role @user [rolename]',              description: 'Assign a Discord role to a user (case-insensitive) — Manage Roles' },
  { name: '.tag [name] | [content]',             description: 'Create/update a tag (stores text or a Roblox role ID) — Manage Messages' },
  { name: '.tag [robloxUser] [tagname]',         description: 'Rank a Roblox user using the role ID stored in a tag — Manage Messages' },
  { name: '.tags [name]',                        description: 'Display a saved tag by name (e.g. .tags susano tag)' },
  { name: '.roblox [username]',                  description: 'Roblox profile: avatar, creation date, profile & game buttons' },
  { name: '.grouproles',                         description: 'List all Roblox group roles with their IDs' },
  { name: '.hush @user',                         description: 'Toggle hush on a user — every message they send is auto-deleted — Manage Messages' },
  { name: '.timeout @user [minutes] [reason]',   description: 'Timeout a member (default 5 min) — Moderate Members' },
  { name: '.mute @user [reason]',                description: 'Mute a member indefinitely — Moderate Members' },
  { name: '.unmute @user',                       description: 'Remove a member\'s mute/timeout — Moderate Members' },
  { name: '.setlog #channel',                    description: 'Set the channel where rank logs are sent — Administrator' },
  { name: '.whitelist add @user',                description: 'Add a user to the bot whitelist — Administrator' },
  { name: '.whitelist remove @user',             description: 'Remove a user from the bot whitelist — Administrator' },
  { name: '.whitelist list',                     description: 'Show all whitelisted users — Administrator' },
];

const ITEMS_PER_PAGE = 7;

function buildHelpEmbed(page) {
  const totalPages = Math.ceil(COMMANDS.length / ITEMS_PER_PAGE);
  const slice      = COMMANDS.slice(page * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE + ITEMS_PER_PAGE);
  const { logoUrl } = logoAttachment();
  const embed = new EmbedBuilder()
    .setTitle('📖 Bot Commands')
    .setColor(0x5865F2)
    .setDescription(slice.map(c => `\`${c.name}\`\n> ${c.description}`).join('\n\n'))
    .setFooter({ text: `Page ${page + 1} of ${totalPages}  •  Prefix: .` });
  if (logoUrl) embed.setThumbnail(logoUrl);
  return embed;
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
  const cookie  = process.env.ROBLOX_COOKIE;
  const groupId = process.env.ROBLOX_GROUP_ID;

  if (!cookie || !groupId) {
    throw new Error('ROBLOX_COOKIE or ROBLOX_GROUP_ID is not configured.');
  }

  const lookupRes  = await fetch('https://users.roblox.com/v1/usernames/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernames: [robloxUsername], excludeBannedUsers: false })
  });
  const lookupData = await lookupRes.json();
  const userBasic  = lookupData.data?.[0];
  if (!userBasic) throw new Error(`Roblox user "${robloxUsername}" not found.`);

  const userId     = userBasic.id;
  const memberRes  = await fetch(`https://groups.roblox.com/v1/users/${userId}/groups/roles`);
  const memberData = await memberRes.json();
  const isMember   = memberData.data?.some(g => String(g.group.id) === String(groupId));
  if (!isMember) {
    throw new Error(
      `**${userBasic.name}** is not a member of your Roblox group (ID: ${groupId}).\n` +
      `They must join the group before they can be ranked.`
    );
  }

  const csrfRes = await fetch('https://auth.roblox.com/v2/logout', {
    method: 'POST',
    headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
  });
  const csrfToken = csrfRes.headers.get('x-csrf-token');
  if (!csrfToken) throw new Error('Could not fetch CSRF token. Check your ROBLOX_COOKIE.');

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
    if (code === 4) throw new Error(`The bot's Roblox account doesn't have permission to rank this user.`);
    if (code === 2) throw new Error(`Role ID \`${roleId}\` doesn't exist in your group. Run \`.grouproles\` to find the correct ID.`);
    throw new Error(`Roblox ranking failed: ${msg}`);
  }

  const avatarRes  = await fetch(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=420x420&format=Png&isCircular=false`);
  const avatarData = await avatarRes.json();
  const avatarUrl  = avatarData.data?.[0]?.imageUrl ?? null;

  return { userId, displayName: userBasic.name, avatarUrl };
}

// ─── Ready ────────────────────────────────────────────────────────────────────

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  if (fs.existsSync(REBOOT_FILE)) {
    try {
      const rebootData = loadJSON(REBOOT_FILE);
      fs.unlinkSync(REBOOT_FILE);

      if (rebootData.channelId && rebootData.userId) {
        const channel = await client.channels.fetch(rebootData.channelId).catch(() => null);
        if (channel?.isTextBased()) {
          const { files, logoUrl } = logoAttachment();
          const embed = new EmbedBuilder()
            .setTitle('✅ Bot Back Online')
            .setColor(0x57F287)
            .setDescription(`<@${rebootData.userId}> The bot has finished rebooting and is back online.`)
            .setTimestamp();
          if (logoUrl) embed.setThumbnail(logoUrl);
          await channel.send({ embeds: [embed], files }).catch(console.error);
        }
      }
    } catch (err) {
      console.error('Failed to send reboot notification:', err.message);
    }
  }
});

// ─── Help Pagination Buttons ──────────────────────────────────────────────────

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('help_')) return;
  const page  = parseInt(interaction.customId.split('_')[1]);
  const { files } = logoAttachment();
  await interaction.update({
    embeds: [buildHelpEmbed(page)],
    components: [buildHelpRow(page)],
    files
  });
});

// ─── Message Handler ──────────────────────────────────────────────────────────

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const hushed = loadHushed();
  if (hushed[message.author.id]) {
    try { await message.delete(); } catch {}
    return;
  }

  if (!message.content.startsWith(prefix)) return;

  const isAdmin = message.member?.permissions.has(PermissionsBitField.Flags.Administrator);
  if (!isAdmin) {
    const cfg       = loadConfig();
    const whitelist = cfg.whitelist ?? [];
    if (!whitelist.includes(message.author.id)) return;
  }

  const args    = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // .ping
  if (command === 'ping') {
    const ping = client.ws.ping;
    return replyWithLogo(message,
      new EmbedBuilder()
        .setTitle('📡 Bot Heartbeat')
        .setColor(ping < 100 ? 0x57F287 : ping < 250 ? 0xFEE75C : 0xED4245)
        .addFields(
          { name: 'WebSocket Latency', value: `\`${ping}ms\``, inline: true },
          { name: 'Status', value: ping < 100 ? '🟢 Excellent' : ping < 250 ? '🟡 Moderate' : '🔴 High', inline: true }
        )
        .setTimestamp()
    );
  }

  // .hb — hardban
  if (command === 'hb') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers))
      return message.reply('❌ You need **Ban Members** permission.');

    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Usage: `.hb @user [reason]`\nThis will hardban the user and all their registered alts.');
    if (!target.bannable)
      return message.reply('❌ I cannot ban this member (they may have a higher role than me).');

    const reason      = args.slice(1).join(' ') || 'Hardban — no reason provided';
    const altIds      = getAltsFor(target.id);
    const bannedUsers = [];
    const failedUsers = [];

    try {
      await target.ban({ reason, deleteMessageSeconds: 604800 });
      bannedUsers.push(`${target.user.tag} (\`${target.id}\`)`);
    } catch (err) {
      failedUsers.push(`${target.user.tag} (\`${target.id}\`) — ${err.message}`);
    }

    for (const altId of altIds) {
      try {
        await message.guild.members.ban(altId, { reason: `Alt of ${target.user.tag} — ${reason}`, deleteMessageSeconds: 604800 });
        bannedUsers.push(`<@${altId}> (\`${altId}\`)`);
      } catch (err) {
        failedUsers.push(`\`${altId}\` — ${err.message}`);
      }
    }

    const embed = new EmbedBuilder()
      .setTitle('🔨 Hardban Executed')
      .setColor(0xED4245)
      .addFields(
        { name: 'Primary Target', value: `${target.user.tag} (\`${target.id}\`)`, inline: true },
        { name: 'Moderator',      value: message.author.tag,                       inline: true },
        { name: 'Reason',         value: reason },
        { name: `✅ Banned (${bannedUsers.length})`, value: bannedUsers.join('\n') || 'None' }
      )
      .setTimestamp();

    if (failedUsers.length)
      embed.addFields({ name: `❌ Failed (${failedUsers.length})`, value: failedUsers.join('\n') });

    await replyWithLogo(message, embed);

    const logEmbed = new EmbedBuilder()
      .setTitle('🔨 Hardban Log')
      .setColor(0xED4245)
      .addFields(
        { name: 'Primary Target', value: `${target.user.tag} (\`${target.id}\`)`, inline: true },
        { name: 'Banned By',      value: `<@${message.author.id}>`,               inline: true },
        { name: 'Reason',         value: reason },
        { name: `Banned (${bannedUsers.length})`, value: bannedUsers.join('\n') || 'None' }
      )
      .setTimestamp();
    await sendLog(message.guild, logEmbed);
    return;
  }

  // .addalt
  if (command === 'addalt') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply('❌ You need **Administrator** permission.');
    const members = [...message.mentions.members.values()];
    if (members.length < 2)
      return message.reply('❌ Usage: `.addalt @user1 @user2`');
    const [u1, u2] = members;
    linkAlts(u1.id, u2.id);
    return replyWithLogo(message,
      new EmbedBuilder()
        .setTitle('🔗 Alts Linked')
        .setColor(0xFEE75C)
        .setDescription(`**${u1.user.tag}** and **${u2.user.tag}** are now registered as alts.\nBanning either with \`.hb\` will also ban the other.`)
        .setTimestamp()
    );
  }

  // .removealt
  if (command === 'removealt') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply('❌ You need **Administrator** permission.');
    const members = [...message.mentions.members.values()];
    if (members.length < 2)
      return message.reply('❌ Usage: `.removealt @user1 @user2`');
    const [u1, u2] = members;
    unlinkAlts(u1.id, u2.id);
    return replyWithLogo(message,
      new EmbedBuilder()
        .setTitle('🔓 Alts Unlinked')
        .setColor(0x57F287)
        .setDescription(`**${u1.user.tag}** and **${u2.user.tag}** are no longer registered as alts.`)
        .setTimestamp()
    );
  }

  // .reboot
  if (command === 'reboot') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply('❌ You need **Administrator** permission to reboot.');
    saveJSON(REBOOT_FILE, { channelId: message.channel.id, userId: message.author.id });
    await message.reply('🔄 Rebooting... I\'ll ping you when I\'m back online.');
    process.exit(0);
  }

  // .role
  if (command === 'role') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles))
      return message.reply('❌ You need **Manage Roles** permission.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Usage: `.role @user [role name]`');
    const roleName = args.slice(1).join(' ').trim().toLowerCase();
    if (!roleName) return message.reply('❌ Please provide a role name. Example: `.role @John Owner`');
    const role = message.guild.roles.cache.find(r => r.name.toLowerCase() === roleName);
    if (!role) return message.reply(`❌ No role named **${args.slice(1).join(' ')}** found in this server.`);
    if (role.position >= message.guild.members.me.roles.highest.position)
      return message.reply('❌ I cannot assign that role — it is equal to or higher than my highest role.');
    const alreadyHas = target.roles.cache.has(role.id);
    try {
      if (alreadyHas) {
        await target.roles.remove(role, `Removed by ${message.author.tag}`);
      } else {
        await target.roles.add(role, `Assigned by ${message.author.tag}`);
      }
    } catch (err) {
      return message.reply(`❌ Failed to ${alreadyHas ? 'remove' : 'assign'} role: ${err.message}`);
    }
    return replyWithLogo(message,
      new EmbedBuilder()
        .setTitle(alreadyHas ? '🗑 Role Removed' : '✅ Role Assigned')
        .setColor(alreadyHas ? 0xED4245 : 0x57F287)
        .addFields(
          { name: 'User',      value: target.user.tag,    inline: true },
          { name: 'Role',      value: role.name,          inline: true },
          { name: 'Moderator', value: message.author.tag, inline: true }
        )
        .setTimestamp()
    );
  }

  // .tag
  if (command === 'tag') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
      return message.reply('❌ You need **Manage Messages** permission.');
    const full = args.join(' ');
    if (full.includes('|')) {
      const pipeIdx = full.indexOf('|');
      const name    = full.slice(0, pipeIdx).trim().toLowerCase();
      const content = full.slice(pipeIdx + 1).trim();
      if (!name || !content) return message.reply('❌ Usage: `.tag [name] | [content]`');
      const tags = loadTags();
      const isUpdate = !!tags[name];
      tags[name] = content;
      saveTags(tags);
      return message.reply(`✅ Tag **${name}** ${isUpdate ? 'updated' : 'created'}.`);
    }
    const robloxUser = args[0];
    const tagName    = args.slice(1).join(' ').toLowerCase();
    if (!robloxUser || !tagName)
      return message.reply('❌ Usage:\n• Create: `.tag [name] | [roleId]`\n• Rank: `.tag [robloxUser] [tagname]`');
    const tags = loadTags();
    if (!tags[tagName]) return message.reply(`❌ No tag named **${tagName}** found.`);
    const roleId = tags[tagName].trim();
    if (isNaN(Number(roleId))) return message.reply(`❌ Tag **${tagName}** doesn't contain a valid role ID.`);
    const statusMsg = await message.reply(`⏳ Ranking **${robloxUser}** to role \`${roleId}\`...`);
    try {
      const result = await rankRobloxUser(robloxUser, roleId);
      const { files, logoUrl } = logoAttachment();
      const embed = new EmbedBuilder()
        .setTitle('✅ Roblox Rank Updated')
        .setColor(0x57F287)
        .addFields(
          { name: 'Roblox User', value: result.displayName, inline: true },
          { name: 'Tag Applied', value: tagName,            inline: true },
          { name: 'Role ID',     value: roleId,             inline: true }
        )
        .setFooter({ text: `Ranked by ${message.author.tag}` })
        .setTimestamp();
      if (result.avatarUrl) embed.setImage(result.avatarUrl);
      if (logoUrl) embed.setThumbnail(logoUrl);
      await statusMsg.edit({ content: '', embeds: [embed], files });
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
    if (!name) return message.reply('❌ Usage: `.tags [name]`');
    const tags = loadTags();
    if (!tags[name]) return message.reply(`❌ No tag named **${name}** found.`);
    return replyWithLogo(message,
      new EmbedBuilder()
        .setTitle(`🏷 ${name}`)
        .setDescription(tags[name])
        .setColor(0x5865F2)
        .setFooter({ text: 'Use .tag [name] | [content] to create or update tags' })
    );
  }

  // .roblox
  if (command === 'roblox') {
    const username = args[0];
    if (!username) return message.reply('❌ Usage: `.roblox [username]`');
    try {
      const lookupRes = await fetch('https://users.roblox.com/v1/usernames/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames: [username], excludeBannedUsers: false })
      });
      const userBasic = (await lookupRes.json()).data?.[0];
      if (!userBasic) return message.reply(`❌ Roblox user **${username}** not found.`);
      const userId     = userBasic.id;
      const user       = await (await fetch(`https://users.roblox.com/v1/users/${userId}`)).json();
      const created    = new Date(user.created).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      const avatarUrl  = (await (await fetch(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=420x420&format=Png&isCircular=false`)).json()).data?.[0]?.imageUrl;
      const profileUrl = `https://www.roblox.com/users/${userId}/profile`;
      const { files, logoUrl } = logoAttachment();
      const embed = new EmbedBuilder()
        .setTitle(`${user.displayName} (@${user.name})`).setURL(profileUrl).setColor(0x5865F2)
        .addFields(
          { name: '📅 Account Created', value: created,     inline: true },
          { name: '🆔 User ID',          value: `${userId}`, inline: true }
        )
        .setImage(avatarUrl)
        .setFooter({ text: 'Roblox' }).setTimestamp();
      if (logoUrl) embed.setThumbnail(logoUrl);
      return message.reply({
        embeds: [embed], files,
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel('View Profile').setStyle(ButtonStyle.Link).setURL(profileUrl),
          new ButtonBuilder().setLabel('🎮 View Games').setStyle(ButtonStyle.Link).setURL(`${profileUrl}#sortName=Games`)
        )]
      });
    } catch { return message.reply('❌ Failed to fetch Roblox profile. Try again later.'); }
  }

  // .ban
  if (command === 'ban') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers))
      return message.reply('❌ You need **Ban Members** permission.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Usage: `.ban @user [reason]`');
    if (!target.bannable) return message.reply('❌ I cannot ban this member.');
    const reason = args.slice(1).join(' ') || 'No reason provided';
    await target.ban({ reason, deleteMessageSeconds: 86400 });
    return replyWithLogo(message,
      new EmbedBuilder()
        .setTitle('🔨 Member Banned').setColor(0xED4245)
        .addFields(
          { name: 'User',      value: target.user.tag,    inline: true },
          { name: 'Moderator', value: message.author.tag, inline: true },
          { name: 'Reason',    value: reason }
        ).setTimestamp()
    );
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
      return replyWithLogo(message,
        new EmbedBuilder()
          .setTitle('📋 Roblox Group Roles').setColor(0x5865F2).setDescription(lines.join('\n\n'))
          .setFooter({ text: `Group ID: ${groupId}  •  Use the Role ID (not Rank) in your tags` }).setTimestamp()
      );
    } catch { return message.reply('❌ Failed to fetch group roles.'); }
  }

  // .hush
  if (command === 'hush') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
      return message.reply('❌ You need **Manage Messages** permission.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Usage: `.hush @user`');
    const hushedData = loadHushed();
    const isHushed   = !!hushedData[target.id];
    if (isHushed) {
      delete hushedData[target.id]; saveHushed(hushedData);
      return replyWithLogo(message,
        new EmbedBuilder().setTitle('🔊 User Unhushed').setColor(0x57F287)
          .setDescription('Their messages will no longer be auto-deleted.')
          .addFields(
            { name: 'User',      value: target.user.tag,    inline: true },
            { name: 'Moderator', value: message.author.tag, inline: true }
          ).setTimestamp()
      );
    } else {
      hushedData[target.id] = { hushedBy: message.author.id, at: Date.now() }; saveHushed(hushedData);
      return replyWithLogo(message,
        new EmbedBuilder().setTitle('🔇 User Hushed').setColor(0xFEE75C)
          .setDescription('Every message they send will be automatically deleted.')
          .addFields(
            { name: 'User',      value: target.user.tag,    inline: true },
            { name: 'Moderator', value: message.author.tag, inline: true }
          ).setTimestamp()
      );
    }
  }

  // .timeout
  if (command === 'timeout') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
      return message.reply('❌ You need **Moderate Members** permission.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Usage: `.timeout @user [minutes] [reason]`');
    const minutes = parseInt(args[1]) || 5;
    if (minutes < 1 || minutes > 40320) return message.reply('❌ Duration must be 1–40320 minutes.');
    const reason = args.slice(2).join(' ') || 'No reason provided';
    try { await target.timeout(minutes * 60 * 1000, reason); }
    catch { return message.reply('❌ Could not timeout this member.'); }
    return replyWithLogo(message,
      new EmbedBuilder().setTitle('⏱ Member Timed Out').setColor(0xFEE75C)
        .addFields(
          { name: 'User',      value: target.user.tag,        inline: true },
          { name: 'Duration',  value: `${minutes} minute(s)`, inline: true },
          { name: 'Moderator', value: message.author.tag,     inline: true },
          { name: 'Reason',    value: reason }
        ).setTimestamp()
    );
  }

  // .mute
  if (command === 'mute') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
      return message.reply('❌ You need **Moderate Members** permission.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Usage: `.mute @user [reason]`');
    const reason = args.slice(1).join(' ') || 'No reason provided';
    try { await target.timeout(28 * 24 * 60 * 60 * 1000, reason); }
    catch { return message.reply('❌ Could not mute this member.'); }
    return replyWithLogo(message,
      new EmbedBuilder().setTitle('🔇 Member Muted').setColor(0xED4245)
        .addFields(
          { name: 'User',      value: target.user.tag,    inline: true },
          { name: 'Moderator', value: message.author.tag, inline: true },
          { name: 'Reason',    value: reason }
        ).setTimestamp()
    );
  }

  // .unmute
  if (command === 'unmute') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
      return message.reply('❌ You need **Moderate Members** permission.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Usage: `.unmute @user`');
    try { await target.timeout(null); }
    catch { return message.reply('❌ Could not unmute this member.'); }
    return replyWithLogo(message,
      new EmbedBuilder().setTitle('🔊 Member Unmuted').setColor(0x57F287)
        .addFields(
          { name: 'User',      value: target.user.tag,    inline: true },
          { name: 'Moderator', value: message.author.tag, inline: true }
        ).setTimestamp()
    );
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
      if (cfg.whitelist.includes(target.id)) return message.reply(`ℹ️ **${target.user.tag}** is already whitelisted.`);
      cfg.whitelist.push(target.id); saveConfig(cfg);
      return replyWithLogo(message,
        new EmbedBuilder().setTitle('✅ User Whitelisted').setColor(0x57F287)
          .addFields(
            { name: 'User',     value: target.user.tag,    inline: true },
            { name: 'Added By', value: message.author.tag, inline: true }
          ).setTimestamp()
      );
    }

    if (sub === 'remove') {
      const target = message.mentions.members.first();
      if (!target) return message.reply('❌ Usage: `.whitelist remove @user`');
      if (!cfg.whitelist.includes(target.id)) return message.reply(`ℹ️ **${target.user.tag}** is not whitelisted.`);
      cfg.whitelist = cfg.whitelist.filter(id => id !== target.id); saveConfig(cfg);
      return replyWithLogo(message,
        new EmbedBuilder().setTitle('🗑 User Removed from Whitelist').setColor(0xED4245)
          .addFields(
            { name: 'User',       value: target.user.tag,    inline: true },
            { name: 'Removed By', value: message.author.tag, inline: true }
          ).setTimestamp()
      );
    }

    if (sub === 'list') {
      if (!cfg.whitelist.length) {
        return replyWithLogo(message,
          new EmbedBuilder().setTitle('📋 Whitelist').setColor(0x5865F2)
            .setDescription('No users are currently whitelisted.\nAdministrators can always use the bot.')
            .setTimestamp()
        );
      }
      return replyWithLogo(message,
        new EmbedBuilder().setTitle('📋 Whitelist').setColor(0x5865F2)
          .setDescription(cfg.whitelist.map((id, i) => `${i + 1}. <@${id}> (\`${id}\`)`).join('\n'))
          .setFooter({ text: 'Administrators always have access regardless of this list.' }).setTimestamp()
      );
    }

    return message.reply('❌ Usage: `.whitelist add @user` | `.whitelist remove @user` | `.whitelist list`');
  }

  // .setlog
  if (command === 'setlog') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply('❌ You need **Administrator** permission.');
    const channel = message.mentions.channels.first();
    if (!channel || !channel.isTextBased())
      return message.reply('❌ Usage: `.setlog #channel`');
    const config = loadConfig();
    config.logChannelId = channel.id;
    saveConfig(config);
    return replyWithLogo(message,
      new EmbedBuilder().setTitle('✅ Log Channel Set').setColor(0x57F287)
        .setDescription(`Tag rank logs will now be sent to ${channel}.`)
        .setTimestamp()
    );
  }

  // .help
  if (command === 'help') {
    const { files } = logoAttachment();
    return message.reply({ embeds: [buildHelpEmbed(0)], components: [buildHelpRow(0)], files });
  }
});

// ─── Login ────────────────────────────────────────────────────────────────────

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('❌ DISCORD_TOKEN is not set! Please add it to your secrets.');
  process.exit(1);
}

client.login(token);
