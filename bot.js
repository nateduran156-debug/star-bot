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
const ROBLOX_GROUP_ID = "489845165"; // Updated for FRIDFG

// ── Roblox cookie ─────────────────────────────────────────────────────────
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

if (!TOKEN) { console.error('DISCORD_BOT_TOKEN is required'); process.exit(1); }
if (!ROLE_ID) { console.error('DISCORD_WHITELIST_ROLE_ID is required'); process.exit(1); }

// ── Whitelist & Tags Data ──────────────────────────────────────────────────
const DATA_FILE = path.join(__dirname, 'whitelist.json');
const TAGS_FILE = path.join(__dirname, 'tags.json');

let whitelist = new Set();
if (fs.existsSync(DATA_FILE)) {
    try { whitelist = new Set(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))); }
    catch (e) { console.error('Failed to load whitelist:', e.message); }
}

let customTags = {};
if (fs.existsSync(TAGS_FILE)) {
    try { customTags = JSON.parse(fs.readFileSync(TAGS_FILE, 'utf8')); }
    catch (e) { console.error('Failed to load tags:', e.message); }
}

function saveWhitelist() {
    fs.writeFileSync(DATA_FILE, JSON.stringify([...whitelist], null, 2));
}

function saveTags() {
    fs.writeFileSync(TAGS_FILE, JSON.stringify(customTags, null, 2));
}

function isAllowed(member) {
    if (!member) return false;
    if (member.permissions.has('Administrator')) return true;
    if (member.roles.cache.has(ROLE_ID)) return true;
    if (whitelist.has(member.id)) return true;
    return false;
}

// ── Embed helper ───────────────────────────────────────────────────────────
const BLUE = 0x1E90FF;
function embed(title, description) {
    return new EmbedBuilder()
        .setColor(BLUE)
        .setTitle(title)
        .setDescription(description)
        .setTimestamp()
        .setFooter({ text: 'made by @averagelarp' });
}

async function reply(message, embedOrBuilder, extra = {}) {
    return message.reply({ embeds: [embedOrBuilder], ...extra });
}

// ── Roblox API helpers ─────────────────────────────────────────────────────
let csrfToken = null;

async function refreshCsrf() {
    const res = await fetch('https://auth.roblox.com/v2/logout', {
        method: 'POST',
        headers: { Cookie: `.ROBLOSECURITY=${robloxCookie}` }
    });
    csrfToken = res.headers.get('x-csrf-token');
    return csrfToken;
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
    const data = await res.json();
    return data.data?.[0] ?? null;
}

async function getGroupMember(userId) {
    const res = await fetch(`https://groups.roblox.com/v2/users/${userId}/groups/roles`);
    const data = await res.json();
    const entry = (data.data ?? []).find(g => String(g.group.id) === String(ROBLOX_GROUP_ID));
    return entry ? { role: { name: entry.role.name, rank: entry.role.rank } } : null;
}

async function getGroupRoles() {
    const res = await fetch(`https://groups.roblox.com/v1/groups/${ROBLOX_GROUP_ID}/roles`);
    const data = await res.json();
    return data.roles ?? [];
}

async function setGroupRank(userId, roleId) {
    const res = await robloxFetch(`https://groups.roblox.com/v1/groups/${ROBLOX_GROUP_ID}/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ roleId })
    });
    return res.ok;
}

// ── Discord Client ─────────────────────────────────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.content.startsWith('.')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const member = message.member;

    // ── .tag add/remove & .taglist ───────────────────────
    if (command === 'tag') {
        if (!isAllowed(member)) return reply(message, embed('🚫 Access Denied', 'Insufficient permissions.'));
        
        const sub = args[0]?.toLowerCase();
        const username = args[1];
        const tagText = args.slice(2).join(' ');

        if (!sub || !username) return reply(message, embed('❌ Usage', '`.tag add <user> <text>` or `.tag remove <user>`'));

        const robloxUser = await robloxUsernameToId(username);
        if (!robloxUser) return reply(message, embed('❌ Error', 'Roblox user not found.'));

        if (sub === 'add') {
            if (!tagText) return reply(message, embed('❌ Error', 'Please provide tag text.'));
            customTags[robloxUser.id] = { name: robloxUser.name, tag: tagText };
            saveTags();
            return reply(message, embed('✅ Tag Added', `Added tag \`[${tagText}]\` to **${robloxUser.name}**.`));
        } 
        
        if (sub === 'remove') {
            delete customTags[robloxUser.id];
            saveTags();
            return reply(message, embed('❌ Tag Removed', `Removed tag from **${robloxUser.name}**.`));
        }
    }

    if (command === 'taglist') {
        const list = Object.entries(customTags).map(([id, data]) => `**${data.name}** (\`${id}\`): ${data.tag}`).join('\n');
        return reply(message, embed('📋 Custom Tag List', list || 'No tags set.'));
    }

    // ── .rank ─────────────────────────────────────────────
    if (command === 'rank') {
        const username = args[0];
        if (!username) return reply(message, embed('❌ Usage', '`.rank <username>`'));

        const robloxUser = await robloxUsernameToId(username);
        if (!robloxUser) return reply(message, embed('❌ Error', 'User not found.'));

        const mem = await getGroupMember(robloxUser.id);
        if (!mem) return reply(message, embed('📭 Info', `**${robloxUser.name}** is not in the group.`));

        const tagData = customTags[robloxUser.id];
        const tagInfo = tagData ? `\n**Tag:** [${tagData.tag}]` : "";

        return reply(message, embed('🎖️ Rank Check', `**User:** ${robloxUser.name}\n**Role:** ${mem.role.name} (${mem.role.rank})${tagInfo}`));
    }

    // ── .whitelist ────────────────────────────────────────
    if (command === 'whitelist' && member.permissions.has('Administrator')) {
        const target = message.mentions.users.first();
        if (!target) return reply(message, embed('❌ Error', 'Mention a user.'));
        whitelist.add(target.id);
        saveWhitelist();
        return reply(message, embed('✅ Whitelist', `${target.tag} added.`));
    }
});

// ── Slash Commands (Cookie Setup) ──────────────────────────────────────────
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    const slash = new SlashCommandBuilder().setName('setcookie').setDescription('Update Roblox Cookie').addStringOption(opt => opt.setName('cookie').setDescription('New .ROBLOSECURITY').setRequired(true));
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: [slash.toJSON()] });
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'setcookie') return;
    if (!interaction.member.permissions.has('Administrator')) return interaction.reply({ content: 'Admin only.', ephemeral: true });

    const newCookie = interaction.options.getString('cookie');
    saveCookie(newCookie);
    await interaction.reply({ content: '✅ Cookie updated.', ephemeral: true });
});

// Health check server
http.createServer((req, res) => { res.writeHead(200); res.end('OK'); }).listen(process.env.PORT || 3000);

client.login(TOKEN);
