const {
    Client, GatewayIntentBits, Partials,
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    AttachmentBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
    SlashCommandBuilder, REST, Routes
} = require('discord.js');

const fs = require('fs');
const path = require('path');
const http = require('http');

// ✅ FETCH FIX FOR RAILWAY
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const TOKEN   = process.env.DISCORD_BOT_TOKEN;
const ROLE_ID = process.env.DISCORD_WHITELIST_ROLE_ID;
const ROBLOX_GROUP_ID = process.env.ROBLOX_GROUP_ID;
const TAG_LOG_CHANNEL_ID = process.env.TAG_LOG_CHANNEL_ID;

// ── BASIC CHECKS ─────────────────────────────────────────
if (!TOKEN) process.exit(1);
if (!ROLE_ID) process.exit(1);

// ── EMBED ────────────────────────────────────────────────
const BLUE = 0x1E90FF;
function embed(title, description) {
    return new EmbedBuilder()
        .setColor(BLUE)
        .setTitle(title)
        .setDescription(description)
        .setTimestamp()
        .setFooter({ text: 'made by @averagelarp' });
}

// ── TAG LOG SYSTEM ───────────────────────────────────────
async function sendTagLog(guild, content) {
    try {
        if (!TAG_LOG_CHANNEL_ID) return;
        const channel = await guild.channels.fetch(TAG_LOG_CHANNEL_ID).catch(() => null);
        if (!channel) return;

        await channel.send({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x2ecc71)
                    .setTitle('📜 Tag Log')
                    .setDescription(content)
                    .setTimestamp()
            ]
        });
    } catch (err) {
        console.error(err);
    }
}

// ── PERMISSION CHECK ─────────────────────────────────────
function isAllowed(member) {
    if (!member) return false;
    if (member.permissions.has('Administrator')) return true;
    if (member.roles.cache.has(ROLE_ID)) return true;
    return false;
}

// ── Tags storage ──────────────────────────────────────────────────────────
const TAGS_FILE = path.join(__dirname, 'tags.json');
let tags = new Map();
if (fs.existsSync(TAGS_FILE)) {
    try { tags = new Map(JSON.parse(fs.readFileSync(TAGS_FILE, 'utf8'))); }
    catch (e) { console.error('Failed to load tags:', e.message); }
} else {
    fs.writeFileSync(TAGS_FILE, JSON.stringify([]));
}
function saveTags() {
    fs.writeFileSync(TAGS_FILE, JSON.stringify([...tags], null, 2));
}

// ── ROBLOX HELPERS ───────────────────────────────────────
let robloxCookie = process.env.ROBLOX_COOKIE;
let csrfToken = null;

async function refreshCsrf() {
    const res = await fetch('https://auth.roblox.com/v2/logout', {
        method: 'POST',
        headers: { Cookie: `.ROBLOSECURITY=${robloxCookie}` }
    });
    csrfToken = res.headers.get('x-csrf-token');
}

async function robloxFetch(url, options = {}) {
    if (!csrfToken) await refreshCsrf();

    let res = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            Cookie: `.ROBLOSECURITY=${robloxCookie}`,
            'X-CSRF-TOKEN': csrfToken
        }
    });

    if (res.status === 403) {
        await refreshCsrf();
        res = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                Cookie: `.ROBLOSECURITY=${robloxCookie}`,
                'X-CSRF-TOKEN': csrfToken
            }
        });
    }

    return res;
}

async function robloxUsernameToId(username) {
    const res = await fetch('https://users.roblox.com/v1/usernames/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames: [username] })
    });
    const data = await res.json();
    return data.data?.[0] ?? null;
}

async function getGroupRoles() {
    const res = await fetch(`https://groups.roblox.com/v1/groups/${ROBLOX_GROUP_ID}/roles`);
    const data = await res.json();
    return data.roles ?? [];
}

async function getGroupMember(userId) {
    const res = await fetch(`https://groups.roblox.com/v2/users/${userId}/groups/roles`);
    const data = await res.json();
    return data.data.find(g => g.group.id == ROBLOX_GROUP_ID);
}

async function setGroupRank(userId, roleId) {
    const res = await robloxFetch(
        `https://groups.roblox.com/v1/groups/${ROBLOX_GROUP_ID}/users/${userId}`,
        {
            method: 'PATCH',
            body: JSON.stringify({ roleId })
        }
    );
    if (!res.ok) throw new Error('Failed to set rank');
}

// ── CLIENT ───────────────────────────────────────────────
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// ── MESSAGE COMMANDS ─────────────────────────────────────
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const args = message.content.split(/ +/);
    const command = args.shift().toLowerCase();

    // ── .tag — create, view, or delete tags ────────────────────────────────
    if (command === '.tag') {
        const subcommand = args[0]?.toLowerCase();
        const tagName = args[1]?.toLowerCase();
        const tagContent = args.slice(2).join(' ');

        if (!subcommand) {
            return message.reply({ embeds: [embed('❌ Usage',
                '**`.tag create <name> <content>`** — Create a tag\n' +
                '**`.tag view <name>`** — View a tag\n' +
                '**`.tag delete <name>`** — Delete a tag (creator or admin only)\n' +
                '**`.tag list`** — List all tags'
            )] });
        }

        if (subcommand === 'create') {
            if (!tagName || !tagContent)
                return message.reply({ embeds: [embed('❌ Usage', '`.tag create <name> <content>`')] });
            if (tags.has(tagName))
                return message.reply({ embeds: [embed('❌ Error', `Tag \`${tagName}\` already exists`)] });
            tags.set(tagName, { content: tagContent, creator: message.author.id, createdAt: new Date().toISOString() });
            saveTags();
            return message.reply({ embeds: [embed('✅ Tag Created', `Tag \`${tagName}\` has been created`)] });
        }

        if (subcommand === 'view') {
            if (!tagName)
                return message.reply({ embeds: [embed('❌ Usage', '`.tag view <name>`')] });
            const tag = tags.get(tagName);
            if (!tag)
                return message.reply({ embeds: [embed('❌ Not Found', `Tag \`${tagName}\` does not exist`)] });
            return message.reply({ embeds: [embed(`📌 Tag: ${tagName}`, tag.content)] });
        }

        if (subcommand === 'delete') {
            if (!tagName)
                return message.reply({ embeds: [embed('❌ Usage', '`.tag delete <name>`')] });
            const tag = tags.get(tagName);
            if (!tag)
                return message.reply({ embeds: [embed('❌ Not Found', `Tag \`${tagName}\` does not exist`)] });
            if (tag.creator !== message.author.id && !message.member.permissions.has('Administrator'))
                return message.reply({ embeds: [embed('🚫 Access Denied', 'Only the tag creator or admins can delete this tag')] });
            tags.delete(tagName);
            saveTags();
            return message.reply({ embeds: [embed('🗑️ Tag Deleted', `Tag \`${tagName}\` has been deleted`)] });
        }

        if (subcommand === 'list') {
            if (tags.size === 0)
                return message.reply({ embeds: [embed('📭 No Tags', 'No tags have been created yet')] });
            const tagList = [...tags.keys()].map((name, i) => `\`${i + 1}.\` \`${name}\``).join('\n');
            return message.reply({ embeds: [embed('📌 All Tags', tagList + `\n\n**Total:** ${tags.size} tag${tags.size === 1 ? '' : 's'}`)] });
        }

        return message.reply({ embeds: [embed('❌ Unknown Subcommand', 'Use: `create`, `view`, `delete`, or `list`')] });
    }

    // ── .reboot — restart the bot (admin only) ────────────────────────────
    if (command === '.reboot') {
        if (!message.member.permissions.has('Administrator'))
            return message.reply({ embeds: [embed('🚫 Admin Only', 'Only administrators can use this command')] });
        await message.reply({ embeds: [embed('🔄 Rebooting', 'Bot is restarting...')] });
        console.log(`[REBOOT] Initiated by ${message.author.tag}`);
        process.exit(0);
    }
});

// ── SLASH COMMANDS ───────────────────────────────────────
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);

    const tagCommand = new SlashCommandBuilder()
        .setName('tag')
        .setDescription('View a tag')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('Tag name to view')
                .setRequired(true)
        );

    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), {
        body: [tagCommand.toJSON()]
    });
});

// ── SLASH HANDLER ────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand() && interaction.commandName === 'tag') {
        const tagName = interaction.options.getString('name').toLowerCase();
        const tag = tags.get(tagName);
        if (!tag) {
            return interaction.reply({ embeds: [embed('❌ Not Found', `Tag \`${tagName}\` does not exist`)], ephemeral: true });
        }
        return interaction.reply({ embeds: [embed(`📌 Tag: ${tagName}`, tag.content)] });
    }
});

// ── HEALTH SERVER (RAILWAY) ──────────────────────────────
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.end('OK');
}).listen(PORT);

// ── LOGIN ────────────────────────────────────────────────
client.login(TOKEN);
