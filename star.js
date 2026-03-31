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

    // ✅ TAG COMMAND
    if (command === '.tag') {
        if (!isAllowed(message.member))
            return message.reply({ embeds: [embed('🚫 Denied', 'Not allowed')] });

        const username = args[0];
        const rankInput = args[1];

        if (!username || !rankInput)
            return message.reply({ embeds: [embed('❌ Usage', '.tag <user> <rank>')] });

        const msg = await message.reply({ embeds: [embed('⏳ Working...', 'Setting rank...')] });

        try {
            const user = await robloxUsernameToId(username);
            const roles = await getGroupRoles();

            const role = isNaN(rankInput)
                ? roles.find(r => r.name.toLowerCase() === rankInput.toLowerCase())
                : roles.find(r => r.rank == parseInt(rankInput));

            const current = await getGroupMember(user.id);

            await setGroupRank(user.id, role.id);

            await msg.edit({
                embeds: [embed('✅ Done',
                    `${user.name}\n${current.role.name} → ${role.name}`)]
            });

            await sendTagLog(message.guild,
                `👤 ${message.author.tag}\n🎮 ${user.name}\n📈 ${current.role.name} → ${role.name}`
            );

        } catch (err) {
            msg.edit({ embeds: [embed('❌ Error', err.message)] });
        }
    }

    // ✅ REBOOT
    if (command === '.reboot') {
        if (!message.member.permissions.has('Administrator'))
            return message.reply('Admin only');

        await message.reply('Rebooting...');
        process.exit(0);
    }
});

// ── SLASH COMMANDS ───────────────────────────────────────
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);

    const commands = [
        new SlashCommandBuilder()
            .setName('tag')
            .setDescription('Set Roblox rank')
            .addStringOption(o => o.setName('username').setRequired(true))
            .addStringOption(o => o.setName('rank').setRequired(true))
    ];

    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), {
        body: commands.map(c => c.toJSON())
    });
});

// ── SLASH HANDLER ────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'tag') {
        if (!isAllowed(interaction.member))
            return interaction.reply({ content: 'Not allowed', ephemeral: true });

        const username = interaction.options.getString('username');
        const rankInput = interaction.options.getString('rank');

        await interaction.deferReply();

        try {
            const user = await robloxUsernameToId(username);
            const roles = await getGroupRoles();

            const role = isNaN(rankInput)
                ? roles.find(r => r.name.toLowerCase() === rankInput.toLowerCase())
                : roles.find(r => r.rank == parseInt(rankInput));

            const current = await getGroupMember(user.id);

            await setGroupRank(user.id, role.id);

            await interaction.editReply(`✅ ${user.name}: ${current.role.name} → ${role.name}`);

            await sendTagLog(interaction.guild,
                `👤 ${interaction.user.tag}\n🎮 ${user.name}\n📈 ${current.role.name} → ${role.name}`
            );

        } catch (err) {
            interaction.editReply(`❌ ${err.message}`);
        }
    }
});

// ── HEALTH SERVER (RAILWAY) ──────────────────────────────
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.end('OK');
}).listen(PORT);

// ── LOGIN ────────────────────────────────────────────────
client.login(TOKEN);
