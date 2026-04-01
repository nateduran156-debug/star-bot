const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  ActivityType
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

const TAGS_FILE   = path.join(__dirname, 'tags.json');
const HUSHED_FILE = path.join(__dirname, 'hushed.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const AFK_FILE    = path.join(__dirname, 'afk.json');

function loadJSON(file) {
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function loadTags()   { return loadJSON(TAGS_FILE); }
function saveTags(t)  { saveJSON(TAGS_FILE, t); }
function loadHushed() { return loadJSON(HUSHED_FILE); }
function saveHushed(h){ saveJSON(HUSHED_FILE, h); }
function loadConfig() { return loadJSON(CONFIG_FILE); }
function saveConfig(c){ saveJSON(CONFIG_FILE, c); }
function loadAfk()    { return loadJSON(AFK_FILE); }
function saveAfk(a)   { saveJSON(AFK_FILE, a); }

(function initConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    saveJSON(CONFIG_FILE, { whitelist: [], logChannelId: null, prefix: '.', status: null });
    console.log('created config.json');
  } else {
    const cfg = loadConfig();
    let changed = false;
    if (!Array.isArray(cfg.whitelist)) { cfg.whitelist = []; changed = true; }
    if (!cfg.prefix) { cfg.prefix = '.'; changed = true; }
    if (changed) saveConfig(cfg);
  }
})();

function getPrefix() {
  return loadConfig().prefix || '.';
}

async function sendLog(guild, embed) {
  const cfg = loadConfig();
  if (!cfg.logChannelId) return;
  try {
    const ch = await guild.channels.fetch(cfg.logChannelId);
    if (ch?.isTextBased()) await ch.send({ embeds: [embed] });
  } catch (err) {
    console.error('log channel error:', err.message);
  }
}

async function rankRobloxUser(robloxUsername, roleId) {
  const cookie  = process.env.ROBLOX_COOKIE;
  const groupId = process.env.ROBLOX_GROUP_ID;

  if (!cookie || !groupId)
    throw new Error('ROBLOX_COOKIE or ROBLOX_GROUP_ID is not configured.');

  const lookupRes = await fetch('https://users.roblox.com/v1/usernames/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernames: [robloxUsername], excludeBannedUsers: false })
  });
  const lookupData = await lookupRes.json();
  const userBasic  = lookupData.data?.[0];
  if (!userBasic) throw new Error(`Roblox user "${robloxUsername}" not found.`);

  const userId = userBasic.id;

  const memberRes  = await fetch(`https://groups.roblox.com/v1/users/${userId}/groups/roles`);
  const memberData = await memberRes.json();
  const isMember   = memberData.data?.some(g => String(g.group.id) === String(groupId));
  if (!isMember)
    throw new Error(`**${userBasic.name}** isn't in the group (ID: ${groupId}). They need to join first.`);

  const csrfRes = await fetch('https://auth.roblox.com/v2/logout', {
    method: 'POST',
    headers: { Cookie: `.ROBLOSECURITY=${cookie}` }
  });
  const csrfToken = csrfRes.headers.get('x-csrf-token');
  if (!csrfToken) throw new Error('Could not get CSRF token. Check your ROBLOX_COOKIE.');

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
    if (code === 4) throw new Error(`Bot doesn't have permission to rank this user (they might outrank the bot).`);
    if (code === 2) throw new Error(`Role ID \`${roleId}\` doesn't exist. Run \`${getPrefix()}grouproles\` to check.`);
    throw new Error(`Ranking failed: ${msg}`);
  }

  const avatarRes  = await fetch(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=420x420&format=Png&isCircular=false`);
  const avatarData = await avatarRes.json();
  const avatarUrl  = avatarData.data?.[0]?.imageUrl ?? null;

  return { userId, displayName: userBasic.name, avatarUrl };
}

const COMMANDS = [
  { name: '{p}help',                               description: 'Shows this help menu' },
  { name: '{p}ping',                               description: 'Check the bot\'s latency' },
  { name: '{p}hb @user [reason]',                  description: 'Hardban a user (works by ID, even if they left) — Ban Members' },
  { name: '{p}reboot',                             description: 'Restart the bot — Whitelist only' },
  { name: '{p}prefix [new prefix]',                description: 'Change the bot\'s command prefix — Whitelist only' },
  { name: '{p}status [type] [text]',               description: 'Change bot status. Types: playing/watching/listening/competing/custom' },
  { name: '{p}rps [rock/paper/scissors]',          description: 'Play rock paper scissors against the bot' },
  { name: '{p}afk [reason]',                       description: 'Set yourself as AFK. Bot will let people know when they ping you' },
  { name: '{p}gc [username]',                      description: 'Quick list of all Roblox groups a user is in' },
  { name: '{p}tag [name] | [content]',             description: 'Create/update a tag — Manage Messages' },
  { name: '{p}tag [robloxUser] [tagname]',         description: 'Rank a Roblox user using a saved tag — Manage Messages' },
  { name: '{p}tags [name]',                        description: 'Show a saved tag' },
  { name: '{p}roblox [username]',                  description: 'Look up a Roblox profile' },
  { name: '{p}groups [username]',                  description: 'Detailed list of all Roblox groups a user is in' },
  { name: '{p}ban @user [reason]',                 description: 'Ban a member — Ban Members' },
  { name: '{p}grouproles',                         description: 'List all roles in your Roblox group with their IDs' },
  { name: '{p}hush @user',                         description: 'Toggle message auto-delete on a user — Manage Messages' },
  { name: '{p}timeout @user [minutes] [reason]',   description: 'Timeout a member — Moderate Members' },
  { name: '{p}mute @user [reason]',                description: 'Mute a member indefinitely — Moderate Members' },
  { name: '{p}unmute @user',                       description: 'Remove a mute — Moderate Members' },
  { name: '{p}setlog #channel',                    description: 'Set the channel for rank logs' },
  { name: '{p}whitelist add @user',                description: 'Add someone to the bot whitelist' },
  { name: '{p}whitelist remove @user',             description: 'Remove someone from the whitelist' },
  { name: '{p}whitelist list',                     description: 'List all whitelisted users' },
];

const ITEMS_PER_PAGE = 7;

function buildHelpEmbed(page) {
  const p = getPrefix();
  const totalPages = Math.ceil(COMMANDS.length / ITEMS_PER_PAGE);
  const slice = COMMANDS.slice(page * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE + ITEMS_PER_PAGE);
  return new EmbedBuilder()
    .setTitle('Bot Commands')
    .setColor(0x5865F2)
    .setDescription(slice.map(c => `\`${c.name.replace('{p}', p)}\`\n> ${c.description}`).join('\n\n'))
    .setFooter({ text: `Page ${page + 1} of ${totalPages}  •  Prefix: ${p}` });
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

client.on('ready'
  console.log(`logged in as ${client.user.tag}`);
  const cfg = loadConfig();
  if (cfg.status) applyStatus(cfg.status);
});

function applyStatus(statusData) {
  const typeMap = {
    playing:    ActivityType.Playing,
    streaming:  ActivityType.Streaming,
    listening:  ActivityType.Listening,
    watching:   ActivityType.Watching,
    competing:  ActivityType.Competing,
    custom:     ActivityType.Custom
  };
  const type = typeMap[statusData.type] ?? ActivityType.Playing;
  client.user.setActivity({ name: statusData.text, type });
}

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('help_')) return;
  const page = parseInt(interaction.customId.split('_')[1]);
  await interaction.update({ embeds: [buildHelpEmbed(page)], components: [buildHelpRow(page)] });
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  const hushed = loadHushed();
  if (hushed[message.author.id]) {
    try { await message.delete(); } catch {}
    return;
  }

  if (message.mentions.users.size > 0) {
    const afkData = loadAfk();
    const mentioned = message.mentions.users.first();
    if (afkData[mentioned?.id]) {
      const entry = afkData[mentioned.id];
      const since = Math.floor(entry.since / 1000);
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xFEE75C)
            .setDescription(`**${mentioned.username}** is AFK: ${entry.reason || 'no reason'}\n<t:${since}:R>`)
        ]
      });
    }
  }

  const prefix = getPrefix();

  const afkData = loadAfk();
  if (afkData[message.author.id] && message.content.startsWith(prefix)) {
    delete afkData[message.author.id];
    saveAfk(afkData);
    await message.reply({ content: 'Welcome back, removed your AFK.', allowedMentions: { repliedUser: false } });
  }

  if (!message.content.startsWith(prefix)) return;

  const cfg2 = loadConfig();
  const whitelist = cfg2.whitelist ?? [];
  if (!whitelist.includes(message.author.id)) return;

  const args    = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === 'ping') {
    const sent = await message.reply('pinging...');
    const roundtrip = sent.createdTimestamp - message.createdTimestamp;
    const ws = client.ws.ping;
    await sent.edit({
      content: '',
      embeds: [
        new EmbedBuilder()
          .setTitle('Pong!')
          .setColor(ws < 100 ? 0x57F287 : ws < 250 ? 0xFEE75C : 0xED4245)
          .addFields(
            { name: 'Roundtrip', value: `\`${roundtrip}ms\``, inline: true },
            { name: 'WebSocket', value: `\`${ws}ms\``, inline: true }
          )
          .setTimestamp()
      ]
    });
    return;
  }

  if (command === 'hb') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers))
      return message.reply('you need **Ban Members** permission for that.');

    const target = message.mentions.users.first();
    const rawId  = args[0];

    if (!target && !rawId)
      return message.reply(`usage: \`${prefix}hb @user [reason]\` or \`${prefix}hb [user id] [reason]\``);

    const userId = target?.id ?? rawId;
    const reason = args.slice(1).join(' ') || 'no reason provided';

    if (!/^\d{17,19}$/.test(userId))
      return message.reply('that doesn\'t look like a valid user ID.');

    try {
      await message.guild.members.ban(userId, {
        reason: `Hardban by ${message.author.tag}: ${reason}`,
        deleteMessageSeconds: 0
      });

      let username = target?.tag ?? userId;
      if (!target) {
        try { const fetched = await client.users.fetch(userId); username = fetched.tag; } catch {}
      }

      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('Hardban')
            .setColor(0xED4245)
            .addFields(
              { name: 'User',      value: username,           inline: true },
              { name: 'Moderator', value: message.author.tag, inline: true },
              { name: 'Reason',    value: reason }
            )
            .setTimestamp()
        ]
      });
    } catch (err) {
      return message.reply(`couldn't ban that user — ${err.message}`);
    }
  }

  if (command === 'prefix') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply('you need **Administrator** permission to change the prefix.');

    const newPrefix = args[0];
    if (!newPrefix)
      return message.reply(`current prefix is \`${prefix}\`. To change it: \`${prefix}prefix [new prefix]\``);
    if (newPrefix.length > 5)
      return message.reply('prefix can\'t be longer than 5 characters.');

    const cfg = loadConfig();
    cfg.prefix = newPrefix;
    saveConfig(cfg);

    return message.reply({
      embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`prefix changed to \`${newPrefix}\``)]
    });
  }

  if (command === 'status') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply('you need **Administrator** permission for that.');

    const validTypes = ['playing', 'watching', 'listening', 'competing', 'custom'];
    const type = args[0]?.toLowerCase();
    const text = args.slice(1).join(' ');

    if (!type || !validTypes.includes(type) || !text)
      return message.reply(`usage: \`${prefix}status [playing/watching/listening/competing/custom] [text]\`\nexample: \`${prefix}status custom /tears\``);

    const statusData = { type, text };
    applyStatus(statusData);
    const cfg = loadConfig();
    cfg.status = statusData;
    saveConfig(cfg);

    return message.reply({
      embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`status updated: **${type}** — ${text}`)]
    });
  }

  if (command === 'rps') {
    const choices = ['rock', 'paper', 'scissors'];
    const short   = { r: 'rock', p: 'paper', s: 'scissors' };
    const emojis  = { rock: '🪨', paper: '📄', scissors: '✂️' };

    const raw  = args[0]?.toLowerCase();
    const pick = short[raw] ?? raw;

    if (!pick || !choices.includes(pick))
      return message.reply(`pick one: \`${prefix}rps rock\`, \`${prefix}rps paper\`, or \`${prefix}rps scissors\``);

    const botPick = choices[Math.floor(Math.random() * 3)];

    let result;
    if (pick === botPick) {
      result = "it's a tie";
    } else if (
      (pick === 'rock'     && botPick === 'scissors') ||
      (pick === 'paper'    && botPick === 'rock')     ||
      (pick === 'scissors' && botPick === 'paper')
    ) {
      result = 'you win';
    } else {
      result = 'you lose';
    }

    const colors = { 'you win': 0x57F287, "it's a tie": 0xFEE75C, 'you lose': 0xED4245 };

    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(colors[result])
          .addFields(
            { name: 'You',    value: `${emojis[pick]} ${pick}`,       inline: true },
            { name: 'Bot',    value: `${emojis[botPick]} ${botPick}`, inline: true },
            { name: 'Result', value: result }
          )
      ]
    });
  }

  if (command === 'afk') {
    const reason = args.join(' ') || null;
    const afk    = loadAfk();
    afk[message.author.id] = { reason, since: Date.now() };
    saveAfk(afk);
    return message.reply({
      embeds: [new EmbedBuilder().setColor(0xFEE75C).setDescription(`You're now AFK${reason ? `: ${reason}` : '.'}`)],
      allowedMentions: { repliedUser: false }
    });
  }

  if (command === 'reboot') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply('you need **Administrator** permission.');
    await message.reply('rebooting...');
    process.exit(0);
  }

  if (command === 'tag') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
      return message.reply('you need **Manage Messages** permission.');

    const full = args.join(' ');

    if (full.includes('|')) {
      const pipeIdx = full.indexOf('|');
      const name    = full.slice(0, pipeIdx).trim().toLowerCase();
      const content = full.slice(pipeIdx + 1).trim();
      if (!name || !content) return message.reply(`usage: \`${prefix}tag [name] | [content]\``);
      const tags = loadTags();
      const isNew = !tags[name];
      tags[name] = content;
      saveTags(tags);
      return message.reply(`tag **${name}** ${isNew ? 'created' : 'updated'}.`);
    }

    const robloxUser = args[0];
    const tagName    = args.slice(1).join(' ').toLowerCase();

    if (!robloxUser || !tagName)
      return message.reply(`usage:\n• create: \`${prefix}tag [name] | [roleId]\`\n• rank: \`${prefix}tag [robloxUsername] [tagname]\``);

    const tags = loadTags();
    if (!tags[tagName])
      return message.reply(`no tag named **${tagName}**. Create it with \`${prefix}tag ${tagName} | [roleId]\``);

    const roleId = tags[tagName].trim();
    if (isNaN(Number(roleId)))
      return message.reply(`tag **${tagName}** doesn't have a valid role ID (got: \`${roleId}\`).`);

    const status = await message.reply(`ranking **${robloxUser}**...`);

    try {
      const result = await rankRobloxUser(robloxUser, roleId);
      const embed  = new EmbedBuilder()
        .setTitle('Rank Updated').setColor(0x57F287)
        .addFields(
          { name: 'Roblox User', value: result.displayName, inline: true },
          { name: 'Tag',         value: tagName,            inline: true },
          { name: 'Role ID',     value: roleId,             inline: true }
        )
        .setFooter({ text: `by ${message.author.tag}` }).setTimestamp();
      if (result.avatarUrl) embed.setThumbnail(result.avatarUrl);
      await status.edit({ content: '', embeds: [embed] });

      const logEmbed = new EmbedBuilder()
        .setTitle('Tag Rank Log').setColor(0x5865F2)
        .addFields(
          { name: 'Roblox User', value: result.displayName,        inline: true },
          { name: 'Tag',         value: tagName,                    inline: true },
          { name: 'Role ID',     value: roleId,                     inline: true },
          { name: 'Ranked By',   value: `<@${message.author.id}>`,  inline: true },
          { name: 'Channel',     value: `<#${message.channel.id}>`, inline: true }
        )
        .setFooter({ text: `Roblox ID: ${result.userId}` }).setTimestamp();
      if (result.avatarUrl) logEmbed.setThumbnail(result.avatarUrl);
      await sendLog(message.guild, logEmbed);
    } catch (err) {
      console.error(err);
      await status.edit(`failed to rank: ${err.message}`);
    }
    return;
  }

  if (command === 'tags') {
    const name = args.join(' ').toLowerCase();
    if (!name) return message.reply(`usage: \`${prefix}tags [name]\``);
    const tags = loadTags();
    if (!tags[name]) return message.reply(`no tag named **${name}**.`);
    return message.reply({
      embeds: [
        new EmbedBuilder().setTitle(name).setDescription(tags[name]).setColor(0x5865F2)
          .setFooter({ text: `use ${prefix}tag [name] | [content] to edit` })
      ]
    });
  }

  if (command === 'roblox') {
    const username = args[0];
    if (!username) return message.reply(`usage: \`${prefix}roblox [username]\``);
    try {
      const lookup    = await fetch('https://users.roblox.com/v1/usernames/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames: [username], excludeBannedUsers: false })
      });
      const userBasic = (await lookup.json()).data?.[0];
      if (!userBasic) return message.reply(`couldn't find **${username}** on Roblox.`);
      const userId     = userBasic.id;
      const user       = await (await fetch(`https://users.roblox.com/v1/users/${userId}`)).json();
      const created    = new Date(user.created).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      const avatarUrl  = (await (await fetch(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=420x420&format=Png&isCircular=false`)).json()).data?.[0]?.imageUrl;
      const profileUrl = `https://www.roblox.com/users/${userId}/profile`;
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`${user.displayName} (@${user.name})`).setURL(profileUrl).setColor(0x5865F2)
            .addFields(
              { name: 'Account Created', value: created,     inline: true },
              { name: 'User ID',         value: `${userId}`, inline: true }
            )
            .setThumbnail(avatarUrl).setFooter({ text: 'Roblox' }).setTimestamp()
        ],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel('Profile').setStyle(ButtonStyle.Link).setURL(profileUrl),
          new ButtonBuilder().setLabel('Games').setStyle(ButtonStyle.Link).setURL(`${profileUrl}#sortName=Games`)
        )]
      });
    } catch { return message.reply('failed to fetch that profile, try again.'); }
  }

  if (command === 'groups') {
    const username = args[0];
    if (!username) return message.reply(`usage: \`${prefix}groups [username]\``);
    try {
      const lookup    = await fetch('https://users.roblox.com/v1/usernames/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames: [username], excludeBannedUsers: false })
      });
      const userBasic = (await lookup.json()).data?.[0];
      if (!userBasic) return message.reply(`couldn't find **${username}** on Roblox.`);
      const userId    = userBasic.id;

      const groupsData = await (await fetch(`https://groups.roblox.com/v1/users/${userId}/groups/roles`)).json();
      const groups     = groupsData.data ?? [];

      if (!groups.length) {
        return message.reply({
          embeds: [
            new EmbedBuilder().setTitle(`Groups — ${userBasic.name}`).setColor(0x5865F2)
              .setDescription('Not in any Roblox groups.').setTimestamp()
          ]
        });
      }

      const avatarUrl = (await (await fetch(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=420x420&format=Png&isCircular=false`)).json()).data?.[0]?.imageUrl;
      const sorted = groups.sort((a, b) => a.group.name.localeCompare(b.group.name));
      const lines  = sorted.map(g => `**${g.group.name}**\n> Role: \`${g.role.name}\`  •  Rank: \`${g.role.rank}\`  •  Group ID: \`${g.group.id}\``);

      const embeds = [];
      for (let i = 0; i < lines.length; i += 25) {
        const embed = new EmbedBuilder().setColor(0x5865F2).setDescription(lines.slice(i, i + 25).join('\n\n')).setTimestamp();
        if (i === 0) {
          embed.setTitle(`Groups — ${userBasic.name}`);
          if (avatarUrl) embed.setThumbnail(avatarUrl);
          embed.setFooter({ text: `${groups.length} group(s)  •  User ID: ${userId}` });
        }
        embeds.push(embed);
      }
      return message.reply({ embeds });
    } catch { return message.reply('failed to fetch groups, try again.'); }
  }

  if (command === 'gc') {
    const username = args[0];
    if (!username) return message.reply(`usage: \`${prefix}gc [username]\``);
    try {
      const lookup    = await fetch('https://users.roblox.com/v1/usernames/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames: [username], excludeBannedUsers: false })
      });
      const userBasic = (await lookup.json()).data?.[0];
      if (!userBasic) return message.reply(`couldn't find **${username}** on Roblox.`);
      const userId    = userBasic.id;

      const groupsData = await (await fetch(`https://groups.roblox.com/v1/users/${userId}/groups/roles`)).json();
      const groups     = groupsData.data ?? [];

      if (!groups.length) {
        return message.reply({
          embeds: [new EmbedBuilder().setColor(0x5865F2).setDescription(`**${userBasic.name}** isn't in any groups.`)]
        });
      }

      const avatarUrl = (await (await fetch(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=420x420&format=Png&isCircular=false`)).json()).data?.[0]?.imageUrl;
      const sorted = groups.sort((a, b) => a.group.name.localeCompare(b.group.name));
      const lines  = sorted.map((g, i) => `${i + 1}. **${g.group.name}**`);

      const chunks = [];
      for (let i = 0; i < lines.length; i += 40) chunks.push(lines.slice(i, i + 40).join('\n'));

      const embeds = chunks.map((chunk, i) => {
        const e = new EmbedBuilder().setColor(0x5865F2).setDescription(chunk);
        if (i === 0) {
          e.setTitle(`${userBasic.name}'s Groups`);
          if (avatarUrl) e.setThumbnail(avatarUrl);
          e.setFooter({ text: `${groups.length} group(s) total` });
        }
        return e;
      });

      return message.reply({ embeds });
    } catch { return message.reply('failed to fetch groups, try again.'); }
  }

  if (command === 'ban') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers))
      return message.reply('you need **Ban Members** permission.');
    const target = message.mentions.members.first();
    if (!target) return message.reply(`usage: \`${prefix}ban @user [reason]\``);
    if (!target.bannable) return message.reply('can\'t ban that member (they might outrank me).');
    const reason = args.slice(1).join(' ') || 'no reason provided';
    await target.ban({ reason, deleteMessageSeconds: 86400 });
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Member Banned').setColor(0xED4245).setThumbnail(target.user.displayAvatarURL())
          .addFields(
            { name: 'User',      value: target.user.tag,    inline: true },
            { name: 'Moderator', value: message.author.tag, inline: true },
            { name: 'Reason',    value: reason }
          ).setTimestamp()
      ]
    });
  }

  if (command === 'grouproles') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
      return message.reply('you need **Manage Messages** permission.');
    const groupId = process.env.ROBLOX_GROUP_ID;
    if (!groupId) return message.reply('`ROBLOX_GROUP_ID` isn\'t configured.');
    try {
      const data = await (await fetch(`https://groups.roblox.com/v1/groups/${groupId}/roles`)).json();
      if (!data.roles?.length) return message.reply('no roles found for this group.');
      const lines = data.roles.sort((a, b) => a.rank - b.rank)
        .map(r => `\`Rank ${String(r.rank).padStart(3, '0')}\`  **${r.name}**\n> Role ID: \`${r.id}\``);
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('Roblox Group Roles').setColor(0x5865F2).setDescription(lines.join('\n\n'))
            .setFooter({ text: `Group ID: ${groupId}  •  use the Role ID (not Rank) in tags` }).setTimestamp()
        ]
      });
    } catch { return message.reply('failed to fetch group roles.'); }
  }

  if (command === 'hush') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
      return message.reply('you need **Manage Messages** permission.');
    const target = message.mentions.members.first();
    if (!target) return message.reply(`usage: \`${prefix}hush @user\``);
    const hushedData = loadHushed();
    if (hushedData[target.id]) {
      delete hushedData[target.id];
      saveHushed(hushedData);
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('User Unhushed').setColor(0x57F287).setThumbnail(target.user.displayAvatarURL())
            .setDescription('Messages will no longer be auto-deleted.')
            .addFields(
              { name: 'User',      value: target.user.tag,    inline: true },
              { name: 'Moderator', value: message.author.tag, inline: true }
            ).setTimestamp()
        ]
      });
    } else {
      hushedData[target.id] = { hushedBy: message.author.id, at: Date.now() };
      saveHushed(hushedData);
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('User Hushed').setColor(0xFEE75C).setThumbnail(target.user.displayAvatarURL())
            .setDescription('Every message they send will be deleted.')
            .addFields(
              { name: 'User',      value: target.user.tag,    inline: true },
              { name: 'Moderator', value: message.author.tag, inline: true }
            ).setTimestamp()
        ]
      });
    }
  }

  if (command === 'timeout') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
      return message.reply('you need **Moderate Members** permission.');
    const target = message.mentions.members.first();
    if (!target) return message.reply(`usage: \`${prefix}timeout @user [minutes] [reason]\``);
    const minutes = parseInt(args[1]) || 5;
    if (minutes < 1 || minutes > 40320) return message.reply('duration has to be between 1 and 40320 minutes.');
    const reason = args.slice(2).join(' ') || 'no reason provided';
    try { await target.timeout(minutes * 60 * 1000, reason); }
    catch { return message.reply('couldn\'t timeout that member (they might outrank me).'); }
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Member Timed Out').setColor(0xFEE75C).setThumbnail(target.user.displayAvatarURL())
          .addFields(
            { name: 'User',      value: target.user.tag,    inline: true },
            { name: 'Duration',  value: `${minutes}m`,      inline: true },
            { name: 'Moderator', value: message.author.tag, inline: true },
            { name: 'Reason',    value: reason }
          ).setTimestamp()
      ]
    });
  }

  if (command === 'mute') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
      return message.reply('you need **Moderate Members** permission.');
    const target = message.mentions.members.first();
    if (!target) return message.reply(`usage: \`${prefix}mute @user [reason]\``);
    const reason = args.slice(1).join(' ') || 'no reason provided';
    try { await target.timeout(28 * 24 * 60 * 60 * 1000, reason); }
    catch { return message.reply('couldn\'t mute that member.'); }
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Member Muted').setColor(0xED4245).setThumbnail(target.user.displayAvatarURL())
          .addFields(
            { name: 'User',      value: target.user.tag,    inline: true },
            { name: 'Moderator', value: message.author.tag, inline: true },
            { name: 'Reason',    value: reason }
          ).setTimestamp()
      ]
    });
  }

  if (command === 'unmute') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
      return message.reply('you need **Moderate Members** permission.');
    const target = message.mentions.members.first();
    if (!target) return message.reply(`usage: \`${prefix}unmute @user\``);
    try { await target.timeout(null); }
    catch { return message.reply('couldn\'t unmute that member.'); }
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Member Unmuted').setColor(0x57F287).setThumbnail(target.user.displayAvatarURL())
          .addFields(
            { name: 'User',      value: target.user.tag,    inline: true },
            { name: 'Moderator', value: message.author.tag, inline: true }
          ).setTimestamp()
      ]
    });
  }

  if (command === 'whitelist') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply('you need **Administrator** permission.');
    const sub = args[0]?.toLowerCase();
    const cfg = loadConfig();
    cfg.whitelist = cfg.whitelist ?? [];

    if (sub === 'add') {
      const target = message.mentions.members.first();
      if (!target) return message.reply(`usage: \`${prefix}whitelist add @user\``);
      if (cfg.whitelist.includes(target.id)) return message.reply(`**${target.user.tag}** is already whitelisted.`);
      cfg.whitelist.push(target.id);
      saveConfig(cfg);
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('User Whitelisted').setColor(0x57F287).setThumbnail(target.user.displayAvatarURL())
            .addFields(
              { name: 'User',     value: target.user.tag,    inline: true },
              { name: 'Added By', value: message.author.tag, inline: true }
            ).setTimestamp()
        ]
      });
    }

    if (sub === 'remove') {
      const target = message.mentions.members.first();
      if (!target) return message.reply(`usage: \`${prefix}whitelist remove @user\``);
      if (!cfg.whitelist.includes(target.id)) return message.reply(`**${target.user.tag}** isn't whitelisted.`);
      cfg.whitelist = cfg.whitelist.filter(id => id !== target.id);
      saveConfig(cfg);
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('Removed from Whitelist').setColor(0xED4245).setThumbnail(target.user.displayAvatarURL())
            .addFields(
              { name: 'User',       value: target.user.tag,    inline: true },
              { name: 'Removed By', value: message.author.tag, inline: true }
            ).setTimestamp()
        ]
      });
    }

    if (sub === 'list') {
      if (!cfg.whitelist.length) {
        return message.reply({
          embeds: [
            new EmbedBuilder().setTitle('Whitelist').setColor(0x5865F2)
              .setDescription('No users whitelisted.').setTimestamp()
          ]
        });
      }
      const lines = cfg.whitelist.map((id, i) => `${i + 1}. <@${id}> (\`${id}\`)`);
      return message.reply({
        embeds: [
          new EmbedBuilder().setTitle('Whitelist').setColor(0x5865F2).setDescription(lines.join('\n')).setTimestamp()
        ]
      });
    }

    return message.reply(`usage: \`${prefix}whitelist add @user\` | \`${prefix}whitelist remove @user\` | \`${prefix}whitelist list\``);
  }

  if (command === 'setlog') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply('you need **Administrator** permission.');
    const channel = message.mentions.channels.first();
    if (!channel || !channel.isTextBased()) return message.reply(`usage: \`${prefix}setlog #channel\``);
    const cfg = loadConfig();
    cfg.logChannelId = channel.id;
    saveConfig(cfg);
    return message.reply({
      embeds: [
        new EmbedBuilder().setTitle('Log Channel Set').setColor(0x57F287)
          .setDescription(`Rank logs will go to ${channel}.`).setTimestamp()
      ]
    });
  }

  if (command === 'help') {
    return message.reply({ embeds: [buildHelpEmbed(0)], components: [buildHelpRow(0)] });
  }
});

const token = process.env.DISCORD_TOKEN;
if (!token) { console.error('DISCORD_TOKEN is not set'); process.exit(1); }

client.login(token);
