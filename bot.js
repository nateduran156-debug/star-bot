const {
    Client, GatewayIntentBits, Partials,
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    AttachmentBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
    SlashCommandBuilder, REST, Routes
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const http = require('http');

const TOKEN   = process.env.DISCORD_BOT_TOKEN;
const ROLE_ID = process.env.DISCORD_WHITELIST_ROLE_ID;
const ROBLOX_GROUP_ID = process.env.ROBLOX_GROUP_ID;

// ── Roblox cookie — file takes priority over env var ───────────────────────
const COOKIE_FILE = path.join(__dirname, 'cookie.json');
let robloxCookie = (() => {
    if (fs.existsSync(COOKIE_FILE)) {
        try { return JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8')).cookie || null; } catch {}
    }
    return process.env.ROBLOX_COOKIE || null;
})();
function saveCookie(value) {
    robloxCookie = value;
    fs.writeFileSync(COOKIE_FILE, JSON.stringify({ cookie: value }), 'utf8');
}

if (!TOKEN)   { console.error('DISCORD_BOT_TOKEN is required');   process.exit(1); }
if (!ROLE_ID) { console.error('DISCORD_WHITELIST_ROLE_ID is required'); process.exit(1); }

// ── Whitelist ──────────────────────────────────────────────────────────────
const DATA_FILE = path.join(__dirname, 'whitelist.json');
let whitelist = new Set();
if (fs.existsSync(DATA_FILE)) {
    try { whitelist = new Set(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))); }
    catch (e) { console.error('Failed to load whitelist:', e.message); }
} else {
    fs.writeFileSync(DATA_FILE, JSON.stringify([]));
}
function saveWhitelist() {
    fs.writeFileSync(DATA_FILE, JSON.stringify([...whitelist], null, 2));
}
function isAllowed(member) {
    if (!member) return false;
    if (member.permissions.has('Administrator')) return true;
    if (member.roles.cache.has(ROLE_ID)) return true;
    if (whitelist.has(member.id)) return true;
    return false;
}

// ── Logo ───────────────────────────────────────────────────────────────────
const LOGO_PATH = path.join(__dirname, 'assets', 'logo.png');
const LOGO_NAME = 'logo.png';
function getLogo() {
    if (!fs.existsSync(LOGO_PATH)) return null;
    return new AttachmentBuilder(LOGO_PATH, { name: LOGO_NAME });
}

// ── Embed helper ───────────────────────────────────────────────────────────
const BLUE = 0x1E90FF;
function embed(title, description) {
    const e = new EmbedBuilder()
        .setColor(BLUE)
        .setTitle(title)
        .setDescription(description)
        .setTimestamp()
        .setFooter({ text: 'made by @averagelarp' });
    const logo = getLogo();
    if (logo) {
        e.setThumbnail(`attachment://${LOGO_NAME}`);
        e.setFooter({ text: 'made by @averagelarp', iconURL: `attachment://${LOGO_NAME}` });
    }
    return e;
}
async function reply(message, embedOrBuilder, extra = {}) {
    const logo = getLogo();
    const files = logo ? [logo] : [];
    return message.reply({ embeds: [embedOrBuilder], files, ...extra });
}

// ── Duration parser (e.g. "5m", "1h", "2d") ───────────────────────────────
function parseDuration(str) {
    if (!str) return null;
    const match = str.match(/^(\d+)(s|m|h|d)$/i);
    if (!match) return null;
    const n = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    return n * multipliers[unit];
}

function formatDuration(ms) {
    if (ms < 60000)  return `${ms / 1000}s`;
    if (ms < 3600000) return `${ms / 60000}m`;
    if (ms < 86400000) return `${ms / 3600000}h`;
    return `${ms / 86400000}d`;
}

// Strip Discord mention tokens from an args array
function stripMentions(args) {
    return args.filter(a => !a.match(/^<@!?\d+>$/) && !a.match(/^<#\d+>$/));
}

// ── Roblox API helpers ─────────────────────────────────────────────────────
let csrfToken = null;

async function refreshCsrf() {
    const res = await fetch('https://auth.roblox.com/v2/logout', {
        method: 'POST',
        headers: { Cookie: `.ROBLOSECURITY=${robloxCookie}` }
    });
    const token = res.headers.get('x-csrf-token');
    if (token) csrfToken = token;
    return token;
}

async function robloxFetch(url, options = {}) {
    if (!csrfToken) await refreshCsrf();
    const headers = {
        'Content-Type': 'application/json',
        Cookie: `.ROBLOSECURITY=${robloxCookie}`,
        'X-CSRF-TOKEN': csrfToken,
        ...options.headers
    };
    let res = await fetch(url, { ...options, headers });
    if (res.status === 403) {
        await refreshCsrf();
        headers['X-CSRF-TOKEN'] = csrfToken;
        res = await fetch(url, { ...options, headers });
    }
    return res;
}

async function robloxUsernameToId(username) {
    const res = await fetch('https://users.roblox.com/v1/usernames/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames: [username], excludeBannedUsers: false })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.data?.[0] ?? null;
}

async function getRobloxGroups(userId) {
    const res = await fetch(`https://groups.roblox.com/v2/users/${userId}/groups/roles`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.data ?? [];
}

async function getGroupRoles() {
    const res = await fetch(`https://groups.roblox.com/v1/groups/${ROBLOX_GROUP_ID}/roles`, {
        headers: { Cookie: `.ROBLOSECURITY=${robloxCookie}` }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.roles ?? [];
}

async function getGroupMember(userId) {
    const res = await fetch(`https://groups.roblox.com/v2/users/${userId}/groups/roles`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const entry = (data.data ?? []).find(g => String(g.group.id) === String(ROBLOX_GROUP_ID));
    if (!entry) return null;
    return { role: { name: entry.role.name, rank: entry.role.rank, id: entry.role.id } };
}

async function setGroupRank(userId, roleId) {
    const res = await robloxFetch(
        `https://groups.roblox.com/v1/groups/${ROBLOX_GROUP_ID}/users/${userId}`,
        {
            method: 'PATCH',
            body: JSON.stringify({ roleId })
        }
    );
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.errors?.[0]?.message || `HTTP ${res.status}`);
    }
    return true;
}

// ── Black Tea word game (Mudae-themed categories) ──────────────────────────
const BT_CATEGORIES = [
    { name: 'Anime Series', hint: 'Name an anime series!' },
    { name: 'Anime Characters', hint: 'Name an anime character!' },
    { name: 'Manga Series', hint: 'Name a manga series!' },
    { name: 'Pokémon', hint: 'Name a Pokémon!' },
    { name: 'Video Game Characters', hint: 'Name a video game character!' },
    { name: 'Video Game Titles', hint: 'Name a video game!' },
    { name: 'Visual Novels', hint: 'Name a visual novel!' },
    { name: 'Anime Studios', hint: 'Name an anime studio!' },
    { name: 'Vtubers', hint: 'Name a Vtuber!' },
    { name: 'Manhwa / Manhua', hint: 'Name a manhwa or manhua!' },
    { name: 'Shonen Anime', hint: 'Name a shonen anime!' },
    { name: 'Isekai Anime', hint: 'Name an isekai anime!' },
    { name: 'Nintendo Games', hint: 'Name a Nintendo game!' },
    { name: 'One Piece Characters', hint: 'Name a One Piece character!' },
    { name: 'Naruto Characters', hint: 'Name a Naruto character!' },
    { name: 'Dragon Ball Characters', hint: 'Name a Dragon Ball character!' },
    { name: 'Genshin Impact Characters', hint: 'Name a Genshin Impact character!' },
    { name: 'League of Legends Champions', hint: 'Name a League of Legends champion!' },
];
const btGames = new Map();

function buildBtEmbed(game) {
    const current = game.players[game.turn];
    const other   = game.players[1 - game.turn];
    return new EmbedBuilder()
        .setColor(BLUE)
        .setTitle(`🍵 Black Tea — ${game.category.name}`)
        .setDescription(
            `**${game.category.hint}**\n\n` +
            `Said so far (${game.said.size}): ${game.said.size > 0
                ? [...game.said].slice(-8).map(w => `\`${w}\``).join(' ')
                : '*none yet*'}\n\n` +
            `⚡ **${current.displayName}**'s turn — type your answer!\n` +
            `_(${other.displayName} is waiting)_`
        )
        .setTimestamp()
        .setFooter({ text: 'made by @averagelarp  •  Type "forfeit" to give up' });
}

// ── Discord client ─────────────────────────────────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User]
});

let snipedMessage = null;
client.on('messageDelete', (message) => {
    if (!message.partial && message.content) {
        snipedMessage = { content: message.content, author: message.author.tag };
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // ── Black Tea: collect in-game answers ────────────────
    if (btGames.has(message.channelId)) {
        const game = btGames.get(message.channelId);
        const current = game.players[game.turn];

        if (message.author.id !== current.id) return;

        const answer = message.content.trim().toLowerCase();

        if (answer === 'forfeit') {
            btGames.delete(message.channelId);
            const loser  = game.players[game.turn];
            const winner = game.players[1 - game.turn];
            return reply(message,
                embed('🍵 Black Tea — Forfeit',
                    `**${loser.displayName}** forfeited!\n🏆 **${winner.displayName}** wins!`
                )
            );
        }

        if (game.said.has(answer)) {
            btGames.delete(message.channelId);
            const winner = game.players[1 - game.turn];
            return reply(message,
                embed('🍵 Black Tea — Already Said!',
                    `**${current.displayName}** said \`${answer}\` which was already used!\n🏆 **${winner.displayName}** wins!`
                )
            );
        }

        game.said.add(answer);
        game.turn = 1 - game.turn;

        return reply(message, buildBtEmbed(game));
    }

    const args    = message.content.trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const member  = message.member;

    // ── Admin: whitelist ──────────────────────────────────
    if (command === '.whitelist') {
        if (!member.permissions.has('Administrator')) return;
        const user = message.mentions.users.first();
        if (!user) return reply(message, embed('Error', 'Mention a user to whitelist'));
        whitelist.add(user.id);
        saveWhitelist();
        return reply(message, embed('✅ Whitelist', `**${user.tag}** has been added to the whitelist`));
    }

    if (command === '.unwhitelist') {
        if (!member.permissions.has('Administrator')) return;
        const user = message.mentions.users.first();
        if (!user) return reply(message, embed('Error', 'Mention a user to remove'));
        whitelist.delete(user.id);
        saveWhitelist();
        return reply(message, embed('❌ Whitelist', `**${user.tag}** has been removed from the whitelist`));
    }

    if (command === '.listwhitelist' || command === '.wl') {
        if (!member.permissions.has('Administrator')) return;
        if (whitelist.size === 0)
            return reply(message, embed('📋 Whitelist', 'The whitelist is currently empty'));

        const lines = await Promise.all([...whitelist].map(async (id, i) => {
            const u = await client.users.fetch(id).catch(() => null);
            return `\`${i + 1}.\` ${u ? `**${u.tag}**` : `Unknown User`} — \`${id}\``;
        }));

        return reply(message, embed('📋 Whitelist', lines.join('\n') + `\n\n**Total:** ${whitelist.size} user${whitelist.size === 1 ? '' : 's'}`));
    }

    // ── .ban ──────────────────────────────────────────────
    if (command === '.ban') {
        if (!isAllowed(member))
            return reply(message, embed('🚫 Access Denied', 'You are not whitelisted to use this command'));

        const target = message.mentions.members.first();
        if (!target)
            return reply(message, embed('❌ Usage', '`.ban @user [reason]`'));
        if (!target.bannable)
            return reply(message, embed('❌ Error', `I cannot ban **${target.displayName}** — they may have a higher role than me`));
        if (target.id === message.author.id)
            return reply(message, embed('❌ Error', 'You cannot ban yourself'));

        const reason = stripMentions(args).join(' ') || 'No reason provided';
        try {
            await target.send({
                embeds: [embed('🔨 You have been banned',
                    `**Server:** ${message.guild.name}\n**Reason:** ${reason}\n**Banned by:** ${message.author.tag}`)]
            }).catch(() => {});
            await target.ban({ reason: `${message.author.tag}: ${reason}` });
            await message.delete().catch(() => {});
            return reply(message, embed('🔨 Banned', `**${target.user.tag}** has been banned\n**Reason:** ${reason}`));
        } catch (err) {
            return reply(message, embed('❌ Error', `Failed to ban: ${err.message}`));
        }
    }

    // ── .hb — hackban by user ID ──────────────────────────
    if (command === '.hb') {
        if (!isAllowed(member))
            return reply(message, embed('🚫 Access Denied', 'You are not whitelisted to use this command'));

        const userId = args[0];
        if (!userId || !/^\d{17,20}$/.test(userId))
            return reply(message, embed('❌ Usage', '`.hb <user_id> [reason]`\n\nProvide a valid Discord user ID'));

        const reason = args.slice(1).join(' ') || 'No reason provided';
        try {
            await message.guild.bans.create(userId, { reason: `${message.author.tag}: ${reason}` });
            await message.delete().catch(() => {});
            return reply(message, embed('🔨 Hackbanned', `User \`${userId}\` has been banned\n**Reason:** ${reason}`));
        } catch (err) {
            return reply(message, embed('❌ Error', `Failed to hackban: ${err.message}`));
        }
    }

    // ── .timeout ──────────────────────────────────────────
    if (command === '.timeout') {
        if (!member.permissions.has('Administrator'))
            return reply(message, embed('🚫 Admin Only', 'Only administrators can use this command'));

        const target = message.mentions.members.first();
        if (!target)
            return reply(message, embed('❌ Usage', '`.timeout @user <duration> [reason]`\n\nDuration examples: `10s` `5m` `1h` `1d`'));

        const restArgs = stripMentions(args);
        const durationStr = restArgs[0];
        const reason = restArgs.slice(1).join(' ') || 'No reason provided';

        const durationMs = parseDuration(durationStr);
        if (!durationMs)
            return reply(message, embed('❌ Invalid Duration', 'Use a duration like `10s` `5m` `2h` `1d`\n(Max: 28 days)'));
        if (durationMs > 28 * 24 * 60 * 60 * 1000)
            return reply(message, embed('❌ Too Long', 'Max timeout duration is **28 days**'));
        if (!target.moderatable)
            return reply(message, embed('❌ Error', `I cannot timeout **${target.displayName}**`));

        try {
            await target.timeout(durationMs, `${message.author.tag}: ${reason}`);
            await message.delete().catch(() => {});
            return reply(message, embed('⏱️ Timed Out',
                `**${target.user.tag}** has been timed out\n**Duration:** ${durationStr}\n**Reason:** ${reason}`));
        } catch (err) {
            return reply(message, embed('❌ Error', `Failed: ${err.message}`));
        }
    }

    // ── .mute ─────────────────────────────────────────────
    if (command === '.mute') {
        if (!member.permissions.has('Administrator'))
            return reply(message, embed('🚫 Admin Only', 'Only administrators can use this command'));

        const target = message.mentions.members.first();
        if (!target)
            return reply(message, embed('❌ Usage', '`.mute @user` — server-mutes the user in voice\nUse `.unmute @user` to remove'));

        if (!target.voice.channel)
            return reply(message, embed('❌ Error', `**${target.displayName}** is not in a voice channel`));

        try {
            const isMuted = target.voice.serverMute;
            await target.voice.setMute(!isMuted, `${message.author.tag}`);
            await message.delete().catch(() => {});
            return reply(message, embed(
                isMuted ? '🔊 Unmuted' : '🔇 Muted',
                `**${target.user.tag}** has been ${isMuted ? 'unmuted' : 'server-muted'}`
            ));
        } catch (err) {
            return reply(message, embed('❌ Error', `Failed: ${err.message}`));
        }
    }

    // ── .unmute ───────────────────────────────────────────
    if (command === '.unmute') {
        if (!member.permissions.has('Administrator'))
            return reply(message, embed('🚫 Admin Only', 'Only administrators can use this command'));

        const target = message.mentions.members.first();
        if (!target)
            return reply(message, embed('❌ Usage', '`.unmute @user`'));
        if (!target.voice.channel)
            return reply(message, embed('❌ Error', `**${target.displayName}** is not in a voice channel`));

        try {
            await target.voice.setMute(false, `${message.author.tag}`);
            await message.delete().catch(() => {});
            return reply(message, embed('🔊 Unmuted', `**${target.user.tag}** has been unmuted`));
        } catch (err) {
            return reply(message, embed('❌ Error', `Failed: ${err.message}`));
        }
    }

    // ── .untimeout ────────────────────────────────────────
    if (command === '.untimeout') {
        if (!member.permissions.has('Administrator'))
            return reply(message, embed('🚫 Admin Only', 'Only administrators can use this command'));

        const target = message.mentions.members.first();
        if (!target)
            return reply(message, embed('❌ Usage', '`.untimeout @user`'));
        if (!target.moderatable)
            return reply(message, embed('❌ Error', `I cannot modify **${target.displayName}**`));

        try {
            await target.timeout(null, `${message.author.tag}`);
            await message.delete().catch(() => {});
            return reply(message, embed('✅ Timeout Removed', `**${target.user.tag}**'s timeout has been lifted`));
        } catch (err) {
            return reply(message, embed('❌ Error', `Failed: ${err.message}`));
        }
    }

    // ── Whitelist guard (Roblox / rank commands) ───────────
    const restricted = ['.groups', '.rank', '.setrank', '.roles'];
    if (restricted.includes(command) && !isAllowed(member)) {
        return reply(message, embed('🚫 Access Denied', 'You are not whitelisted to use this command'));
    }

    // ── .8ball ────────────────────────────────────────────
    if (command === '.8ball') {
        const question = args.join(' ');
        if (!question) return reply(message, embed('🎱 8Ball', 'Ask me a question!'));
        const responses = [
            '✅ Yes', '❌ No', '🤔 Maybe', '💯 Definitely', '⏳ Ask again later',
            '🌟 Without a doubt', '😬 Very doubtful', '❗ Outlook not so good',
            '🔮 Signs point to yes', '🚫 My sources say no'
        ];
        const res = responses[Math.floor(Math.random() * responses.length)];
        return reply(message, embed('🎱 8Ball', `> ${question}\n\n**${res}**`));
    }

    // ── .coinflip ─────────────────────────────────────────
    if (command === '.coinflip') {
        const result = Math.random() < 0.5 ? '🪙 **Heads**' : '🔵 **Tails**';
        return reply(message, embed('🪙 Coin Flip', result));
    }

    // ── .dice ─────────────────────────────────────────────
    if (command === '.dice') {
        const sides = parseInt(args[0]) || 6;
        if (sides < 2 || sides > 100)
            return reply(message, embed('Error', 'Sides must be between **2** and **100**'));
        const roll = Math.floor(Math.random() * sides) + 1;
        return reply(message, embed(`🎲 Dice — d${sides}`, `You rolled **${roll}**`));
    }

    // ── .rps ──────────────────────────────────────────────
    if (command === '.rps') {
        const choices = ['rock', 'paper', 'scissors'];
        const userChoice = args[0]?.toLowerCase();
        if (!choices.includes(userChoice))
            return reply(message, embed('Error', 'Choose: `rock` `paper` or `scissors`'));
        const botChoice = choices[Math.floor(Math.random() * choices.length)];
        const icons = { rock: '🪨', paper: '📄', scissors: '✂️' };
        let result = '🤝 **Draw!**';
        if (
            (userChoice === 'rock'     && botChoice === 'scissors') ||
            (userChoice === 'paper'    && botChoice === 'rock') ||
            (userChoice === 'scissors' && botChoice === 'paper')
        ) result = '🎉 **You win!**';
        else if (userChoice !== botChoice) result = '💀 **You lose!**';
        return reply(message,
            embed('✂️ Rock Paper Scissors',
                `**You:** ${icons[userChoice]} ${userChoice}\n**Bot:** ${icons[botChoice]} ${botChoice}\n\n${result}`)
        );
    }

    // ── .avatar ───────────────────────────────────────────
    if (command === '.avatar') {
        const user = message.mentions.users.first() || message.author;
        const url = user.displayAvatarURL({ dynamic: true, size: 512 });
        return message.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(BLUE)
                    .setTitle(`🖼️ ${user.displayName}'s Avatar`)
                    .setImage(url)
                    .setDescription(`[Open full size](${url})`)
                    .setTimestamp()
                    .setFooter({ text: 'made by @averagelarp' })
            ]
        });
    }

    // ── .blacktea ─────────────────────────────────────────
    if (command === '.blacktea') {
        if (btGames.has(message.channelId))
            return reply(message, embed('❌ Black Tea', 'A game is already running in this channel!'));

        const category = BT_CATEGORIES[Math.floor(Math.random() * BT_CATEGORIES.length)];

        const challengeMsg = await message.reply({
            embeds: [embed('🍵 Black Tea — Open Challenge',
                `**${message.author.displayName}** wants to play Black Tea!\n\n` +
                `📂 Category: **${category.name}**\n\n` +
                `React with ✅ to join the game!\n` +
                `*(30 seconds to accept)*`)]
        });

        // Bot reacts with checkmark so players can just click it
        await challengeMsg.react('✅');

        const filter = (reaction, user) =>
            reaction.emoji.name === '✅' &&
            user.id !== message.author.id &&
            !user.bot;

        let opponentUser = null;
        try {
            const collected = await challengeMsg.awaitReactions({ filter, max: 1, time: 30000, errors: ['time'] });
            opponentUser = collected.first()?.users.cache.find(u => u.id !== message.author.id && !u.bot) ?? null;
        } catch {
            // Timed out — no one reacted
            return challengeMsg.edit({
                embeds: [embed('🍵 Black Tea', `⏰ No one joined **${message.author.displayName}**'s game in time`)],
            }).catch(() => {});
        }

        if (!opponentUser) return;

        const opponentMember = await message.guild.members.fetch(opponentUser.id).catch(() => null);
        if (!opponentMember) return;

        const game = {
            category,
            players: [message.member, opponentMember],
            turn: 0,
            said: new Set()
        };
        btGames.set(message.channelId, game);

        game.timeout = setTimeout(() => {
            if (btGames.get(message.channelId) === game) {
                btGames.delete(message.channelId);
                message.channel.send({
                    embeds: [embed('🍵 Black Tea', '⏰ Game timed out due to inactivity')]
                }).catch(() => {});
            }
        }, 300000);

        await challengeMsg.edit({
            embeds: [buildBtEmbed(game)],
        });
        return;
    }

    // ── .groups ───────────────────────────────────────────
    if (command === '.groups') {
        const username = args[0];
        if (!username)
            return reply(message, embed('🔍 Roblox Groups', 'Usage: `.groups <roblox_username>`'));

        const loading = await reply(message, embed('⏳ Fetching...', `Looking up **${username}** on Roblox...`));

        try {
            const robloxUser = await robloxUsernameToId(username);
            if (!robloxUser) {
                return loading.edit({ embeds: [embed('❌ Not Found', `No Roblox user found for **${username}**`)] });
            }

            const groupData = await getRobloxGroups(robloxUser.id);
            if (groupData.length === 0) {
                return loading.edit({ embeds: [embed('📭 No Groups', `**${robloxUser.name}** has no public groups`)] });
            }

            const groups = groupData.map(g => ({ name: g.group.name, id: g.group.id, role: g.role.name }))
                .sort((a, b) => a.name.localeCompare(b.name));

            const perPage = 10;
            let page = 0;
            const totalPages = Math.ceil(groups.length / perPage);

            const buildEmbed = (p) => {
                const start = p * perPage;
                const lines = groups.slice(start, start + perPage)
                    .map((g, i) => `\`${start + i + 1}.\` **[${g.name}](https://www.roblox.com/groups/${g.id})** — *${g.role}*`)
                    .join('\n');
                return new EmbedBuilder()
                    .setColor(BLUE)
                    .setTitle(`📋 ${robloxUser.name}'s Roblox Groups`)
                    .setDescription(lines)
                    .setFooter({ text: `made by @averagelarp  •  Page ${p + 1}/${totalPages}  •  ${groups.length} groups` })
                    .setTimestamp();
            };

            const buildRow = (p) => new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('grp_prev').setLabel('◀ Prev').setStyle(ButtonStyle.Primary).setDisabled(p === 0),
                new ButtonBuilder().setCustomId('grp_page').setLabel(`${p + 1} / ${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId('grp_next').setLabel('Next ▶').setStyle(ButtonStyle.Primary).setDisabled(p === totalPages - 1)
            );

            await loading.edit({ embeds: [buildEmbed(page)], components: [buildRow(page)] });

            const collector = loading.createMessageComponentCollector({ time: 90000 });
            collector.on('collect', async (interaction) => {
                if (interaction.user.id !== message.author.id)
                    return interaction.reply({ content: 'Only the command user can navigate', ephemeral: true });
                if (interaction.customId === 'grp_prev') page--;
                if (interaction.customId === 'grp_next') page++;
                await interaction.update({ embeds: [buildEmbed(page)], components: [buildRow(page)] });
            });
            collector.on('end', () => loading.edit({ components: [] }).catch(() => {}));
        } catch (err) {
            console.error('Groups error:', err);
            loading.edit({ embeds: [embed('❌ Error', `Failed: ${err.message}`)] });
        }
        return;
    }

    // ── .roles — list group ranks ──────────────────────────
    if (command === '.roles') {
        if (!ROBLOX_GROUP_ID || !robloxCookie)
            return reply(message, embed('❌ Not Configured', 'Roblox group credentials are not set up'));

        const loading = await reply(message, embed('⏳ Fetching...', 'Loading group roles...'));
        try {
            const roles = await getGroupRoles();
            const lines = roles
                .filter(r => r.rank > 0)
                .sort((a, b) => a.rank - b.rank)
                .map(r => `\`Rank ${r.rank}\` — **${r.name}** *(${r.memberCount ?? 0} members)*`)
                .join('\n');
            await loading.edit({ embeds: [embed('🎖️ Group Roles', lines || 'No roles found')] });
        } catch (err) {
            console.error('Roles error:', err);
            loading.edit({ embeds: [embed('❌ Error', `Failed: ${err.message}`)] });
        }
        return;
    }

    // ── .rank — check a user's rank ────────────────────────
    if (command === '.rank') {
        if (!ROBLOX_GROUP_ID || !robloxCookie)
            return reply(message, embed('❌ Not Configured', 'Roblox group credentials are not set up'));

        const username = args[0];
        if (!username)
            return reply(message, embed('❌ Usage', '`.rank <roblox_username>`'));

        const loading = await reply(message, embed('⏳ Fetching...', `Checking rank for **${username}**...`));
        try {
            const robloxUser = await robloxUsernameToId(username);
            if (!robloxUser)
                return loading.edit({ embeds: [embed('❌ Not Found', `No Roblox user: **${username}**`)] });

            const mem = await getGroupMember(robloxUser.id);
            if (!mem)
                return loading.edit({ embeds: [embed('📭 Not in Group', `**${robloxUser.name}** is not in this group`)] });

            await loading.edit({
                embeds: [embed('🎖️ Group Rank',
                    `**${robloxUser.name}**\nRole: **${mem.role.name}**\nRank: \`${mem.role.rank}\``)]
            });
        } catch (err) {
            console.error('Rank error:', err);
            loading.edit({ embeds: [embed('❌ Error', `Failed: ${err.message}`)] });
        }
        return;
    }

    // ── .setrank — set a user's rank ───────────────────────
    if (command === '.setrank') {
        if (!ROBLOX_GROUP_ID || !robloxCookie)
            return reply(message, embed('❌ Not Configured', 'Roblox group credentials are not set up'));

        const username  = args[0];
        const rankInput = args[1];

        if (!username || !rankInput)
            return reply(message, embed('❌ Usage',
                '`.setrank <roblox_username> <role_name_or_rank_number>`\n\nUse `.roles` to see available roles'));

        const loading = await reply(message, embed('⏳ Working...', `Setting rank for **${username}**...`));

        try {
            const robloxUser = await robloxUsernameToId(username);
            if (!robloxUser)
                return loading.edit({ embeds: [embed('❌ Not Found', `No Roblox user: **${username}**`)] });

            const groupRoles = await getGroupRoles();

            const rankNum = parseInt(rankInput);
            let targetRole = isNaN(rankNum)
                ? groupRoles.find(r => r.name.toLowerCase() === rankInput.toLowerCase())
                : groupRoles.find(r => r.rank === rankNum);

            if (!targetRole)
                return loading.edit({
                    embeds: [embed('❌ Role Not Found',
                        `No role matching \`${rankInput}\`\nUse \`.roles\` to see available roles`)]
                });

            const currentMember = await getGroupMember(robloxUser.id);
            if (!currentMember)
                return loading.edit({
                    embeds: [embed('📭 Not in Group', `**${robloxUser.name}** is not a member of this group`)]
                });

            await setGroupRank(robloxUser.id, targetRole.id);

            await loading.edit({
                embeds: [embed('✅ Rank Updated',
                    `**${robloxUser.name}**\n` +
                    `**${currentMember.role.name}** → **${targetRole.name}** (Rank ${targetRole.rank})`)]
            });

            console.log(`[SETRANK] ${message.author.tag} set ${robloxUser.name} to ${targetRole.name} (rank ${targetRole.rank})`);
        } catch (err) {
            console.error('Setrank error:', err);
            loading.edit({ embeds: [embed('❌ Error', `Failed: ${err.message}`)] });
        }
        return;
    }

    // ── .promote — move user up one rank (admin only) ─────
    if (command === '.promote') {
        if (!member.permissions.has('Administrator'))
            return reply(message, embed('🚫 Admin Only', 'Only administrators can use `.promote`'));
        if (!ROBLOX_GROUP_ID || !robloxCookie)
            return reply(message, embed('❌ Not Configured', 'Roblox group credentials are not set up'));

        const username = args[0];
        if (!username)
            return reply(message, embed('❌ Usage', '`.promote <roblox_username>`'));

        const loading = await reply(message, embed('⏳ Working...', `Promoting **${username}**...`));

        try {
            const robloxUser = await robloxUsernameToId(username);
            if (!robloxUser)
                return loading.edit({ embeds: [embed('❌ Not Found', `No Roblox user: **${username}**`)] });

            const currentMember = await getGroupMember(robloxUser.id);
            if (!currentMember)
                return loading.edit({ embeds: [embed('📭 Not in Group', `**${robloxUser.name}** is not a member of this group`)] });

            const groupRoles = await getGroupRoles();
            const sortedRoles = groupRoles.filter(r => r.rank > 0).sort((a, b) => a.rank - b.rank);
            const currentIndex = sortedRoles.findIndex(r => r.rank === currentMember.role.rank);

            if (currentIndex === -1 || currentIndex >= sortedRoles.length - 1)
                return loading.edit({ embeds: [embed('❌ Cannot Promote', `**${robloxUser.name}** is already at the highest rank`)] });

            const newRole = sortedRoles[currentIndex + 1];
            await setGroupRank(robloxUser.id, newRole.id);

            await loading.edit({
                embeds: [embed('⬆️ Promoted',
                    `**${robloxUser.name}**\n**${currentMember.role.name}** → **${newRole.name}** (Rank ${newRole.rank})`)]
            });

            console.log(`[PROMOTE] ${message.author.tag} promoted ${robloxUser.name} to ${newRole.name}`);
        } catch (err) {
            console.error('Promote error:', err);
            loading.edit({ embeds: [embed('❌ Error', `Failed: ${err.message}`)] });
        }
        return;
    }

    // ── .demote — move user down one rank (admin only) ────
    if (command === '.demote') {
        if (!member.permissions.has('Administrator'))
            return reply(message, embed('🚫 Admin Only', 'Only administrators can use `.demote`'));
        if (!ROBLOX_GROUP_ID || !robloxCookie)
            return reply(message, embed('❌ Not Configured', 'Roblox group credentials are not set up'));

        const username = args[0];
        if (!username)
            return reply(message, embed('❌ Usage', '`.demote <roblox_username>`'));

        const loading = await reply(message, embed('⏳ Working...', `Demoting **${username}**...`));

        try {
            const robloxUser = await robloxUsernameToId(username);
            if (!robloxUser)
                return loading.edit({ embeds: [embed('❌ Not Found', `No Roblox user: **${username}**`)] });

            const currentMember = await getGroupMember(robloxUser.id);
            if (!currentMember)
                return loading.edit({ embeds: [embed('📭 Not in Group', `**${robloxUser.name}** is not a member of this group`)] });

            const groupRoles = await getGroupRoles();
            const sortedRoles = groupRoles.filter(r => r.rank > 0).sort((a, b) => a.rank - b.rank);
            const currentIndex = sortedRoles.findIndex(r => r.rank === currentMember.role.rank);

            if (currentIndex <= 0)
                return loading.edit({ embeds: [embed('❌ Cannot Demote', `**${robloxUser.name}** is already at the lowest rank`)] });

            const newRole = sortedRoles[currentIndex - 1];
            await setGroupRank(robloxUser.id, newRole.id);

            await loading.edit({
                embeds: [embed('⬇️ Demoted',
                    `**${robloxUser.name}**\n**${currentMember.role.name}** → **${newRole.name}** (Rank ${newRole.rank})`)]
            });

            console.log(`[DEMOTE] ${message.author.tag} demoted ${robloxUser.name} to ${newRole.name}`);
        } catch (err) {
            console.error('Demote error:', err);
            loading.edit({ embeds: [embed('❌ Error', `Failed: ${err.message}`)] });
        }
        return;
    }

    // ── .s — snipe ────────────────────────────────────────
    if (command === '.s') {
        if (!snipedMessage) return reply(message, embed('👻 Sniper', 'No deleted message to snipe'));
        return reply(message, embed('👻 Sniped', `**${snipedMessage.author}:**\n${snipedMessage.content}`));
    }

    // ── .cs — clear snipe ─────────────────────────────────
    if (command === '.cs') {
        if (!member.permissions.has('Administrator')) return;
        snipedMessage = null;
        return reply(message, embed('🗑️ Sniper', 'Sniped message cleared'));
    }

    // ── .help / .info — paginated help menu ───────────────
    if (command === '.help' || command === '.info') {
        const pages = [
            new EmbedBuilder()
                .setColor(BLUE)
                .setTitle('📖 Help — Fun Commands')
                .setDescription(
                    '**`.8ball <question>`**\nAsk the magic 8-ball a yes/no question\n\n' +
                    '**`.coinflip`**\nFlip a coin — heads or tails\n\n' +
                    '**`.dice [sides]`**\nRoll a dice (default d6, up to d100)\n\n' +
                    '**`.rps rock|paper|scissors`**\nPlay rock paper scissors against the bot\n\n' +
                    '**`.avatar [@user]`**\nShow your avatar or someone else\'s\n\n' +
                    '**`.s`**\nSnipe the last deleted message in this channel\n\n' +
                    '**`.blacktea`**\nPost an open challenge — the bot reacts ✅ and anyone who clicks it plays!\n' +
                    '*Categories: anime, manga, characters, Pokémon, VNs, VTubers, games & more*\n' +
                    '*Type "forfeit" during a game to give up*'
                )
                .setFooter({ text: 'made by @averagelarp  •  Page 1/3 — Fun' })
                .setTimestamp(),

            new EmbedBuilder()
                .setColor(BLUE)
                .setTitle('📖 Help — Moderation (Whitelisted)')
                .setDescription(
                    '*Requires whitelist role, admin, or `.whitelist` entry*\n\n' +
                    '**`.ban @user [reason]`**\nBan a member and DM them the reason\n\n' +
                    '**`.hb <user_id> [reason]`**\nHackban — ban a user by ID even if not in server\n\n' +
                    '**`.rank <roblox_username>`**\nCheck someone\'s current rank in the Roblox group\n\n' +
                    '**`.setrank <username> <role_name_or_number>`**\nSet someone\'s exact Roblox group rank\n' +
                    '*Example: `.setrank Builderman Senior Member` or `.setrank Builderman 50`*\n\n' +
                    '**`.roles`**\nList all available ranks in the Roblox group\n\n' +
                    '**`.groups <roblox_username>`**\nBrowse all Roblox groups a user is in (paginated)'
                )
                .setFooter({ text: 'made by @averagelarp  •  Page 2/3 — Moderation' })
                .setTimestamp(),

            new EmbedBuilder()
                .setColor(BLUE)
                .setTitle('📖 Help — Admin Only')
                .setDescription(
                    '*Requires Administrator permission*\n\n' +
                    '**`.promote <roblox_username>`**\nPromote someone up one rank in the Roblox group\n\n' +
                    '**`.demote <roblox_username>`**\nDemote someone down one rank in the Roblox group\n\n' +
                    '**`.timeout @user <duration> [reason]`**\nTimeout a member — durations: `10s` `5m` `2h` `1d` (max 28d)\n\n' +
                    '**`.untimeout @user`**\nRemove a timeout early\n\n' +
                    '**`.mute @user`**\nServer-mute a user in voice (run again to unmute)\n\n' +
                    '**`.unmute @user`**\nForce-remove server-mute\n\n' +
                    '**`.whitelist @user`** / **`.unwhitelist @user`**\nAdd or remove someone from the bot whitelist\n\n' +
                    '**`.listwhitelist`** (or **`.wl`**)\nShow all whitelisted users with their Discord tags\n\n' +
                    '**`.cs`**\nClear the sniped message\n\n' +
                    '**`/setcookie`**\nUpdate the Roblox cookie via a secure modal (slash command)'
                )
                .setFooter({ text: 'made by @averagelarp  •  Page 3/3 — Admin' })
                .setTimestamp(),
        ];

        let page = 0;

        const buildRow = (p) => new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('help_prev').setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(p === 0),
            new ButtonBuilder().setCustomId('help_page').setLabel(`${p + 1} / ${pages.length}`).setStyle(ButtonStyle.Primary).setDisabled(true),
            new ButtonBuilder().setCustomId('help_next').setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(p === pages.length - 1)
        );

        const helpMsg = await message.reply({ embeds: [pages[page]], components: [buildRow(page)] });

        const collector = helpMsg.createMessageComponentCollector({ time: 120000 });
        collector.on('collect', async (interaction) => {
            if (interaction.user.id !== message.author.id)
                return interaction.reply({ content: 'Only the command user can navigate', ephemeral: true });
            if (interaction.customId === 'help_prev') page--;
            if (interaction.customId === 'help_next') page++;
            await interaction.update({ embeds: [pages[page]], components: [buildRow(page)] });
        });
        collector.on('end', () => helpMsg.edit({ components: [] }).catch(() => {}));
        return;
    }
});

client.once('clientReady', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    console.log(`Whitelist role: ${ROLE_ID} | Group ID: ${ROBLOX_GROUP_ID ?? 'not set'}`);

    const command = new SlashCommandBuilder()
        .setName('setcookie')
        .setDescription('Update the Roblox cookie used by the bot (admin only)');

    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: [command.toJSON()] });
        console.log('Slash commands registered globally');
    } catch (err) {
        console.error('Failed to register slash commands:', err);
    }
});

// ── Slash commands + modals ────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand() && interaction.commandName === 'setcookie') {
        if (!interaction.member?.permissions?.has('Administrator')) {
            return interaction.reply({ content: '❌ Only administrators can use this command.', ephemeral: true });
        }

        const modal = new ModalBuilder()
            .setCustomId('setcookie_modal')
            .setTitle('Update Roblox Cookie');

        const input = new TextInputBuilder()
            .setCustomId('cookie_value')
            .setLabel('Paste your .ROBLOSECURITY cookie')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('_|WARNING:-DO-NOT-SHARE-THIS...')
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'setcookie_modal') {
        if (!interaction.member?.permissions?.has('Administrator')) {
            return interaction.reply({ content: '❌ Only administrators can use this command.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const cookieValue = interaction.fields.getTextInputValue('cookie_value').trim();

        let robloxUser = null;
        try {
            const res = await fetch('https://users.roblox.com/v1/users/authenticated', {
                headers: {
                    Cookie: `.ROBLOSECURITY=${cookieValue}`,
                    'User-Agent': 'Mozilla/5.0'
                }
            });
            if (res.ok) robloxUser = await res.json();
        } catch {}

        if (!robloxUser) {
            return interaction.editReply({ content: '❌ Invalid or expired cookie — Roblox rejected it.' });
        }

        saveCookie(cookieValue);
        console.log(`Roblox cookie updated by ${interaction.user.tag} — authenticated as ${robloxUser.name}`);

        return interaction.editReply({
            content: `✅ Cookie updated! Now authenticated as **${robloxUser.displayName}** (\`${robloxUser.name}\`).`
        });
    }
});

client.on('error', (err) => console.error('Client error:', err));

// ── Minimal health check HTTP server (required for deployment) ─────────────
const PORT = parseInt(process.env.PORT || '3000');
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', bot: client.isReady() ? 'ready' : 'connecting' }));
}).listen(PORT, () => {
    console.log(`Health server listening on port ${PORT}`);
});

client.login(TOKEN);
