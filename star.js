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

// ── ROBLOX GROUP MEMBER HELPERS ──────────────────────────
async function getMembersInRole(roleId) {
    let members = [];
    let cursor = '';
    do {
        const url = `https://groups.roblox.com/v1/groups/${ROBLOX_GROUP_ID}/roles/${roleId}/users?limit=100${cursor ? `&cursor=${cursor}` : ''}`;
        const res = await fetch(url);
        const data = await res.json();
        members.push(...(data.data ?? []));
        cursor = data.nextPageCursor ?? '';
    } while (cursor);
    return members;
}

// ── MESSAGE COMMANDS ─────────────────────────────────────
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const args = message.content.trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // ── .tag add/remove ──────────────────────────────────
    if (command === '.tag') {
        const action = args[0]?.toLowerCase();
        const username = args[1];

        if (!['add', 'remove'].includes(action) || !username)
            return message.reply({ embeds: [embed('❌ Usage', '`.tag add <username> <role>` or `.tag remove <username>`')] });

        // Permission: must be rank 2+ in the Roblox group OR Discord admin
        // We check Discord admin first, then require the whitelist role as a proxy for rank-2
        if (!isAllowed(message.member))
            return message.reply({ embeds: [embed('🚫 Denied', 'You must be rank 2 or higher in the group to use this command.')] });

        const msg = await message.reply({ embeds: [embed('⏳ Working...', 'Processing...')] });

        try {
            const roles = await getGroupRoles();

            // Verify the command author is rank 2+ in the Roblox group via their own username
            // (rank-2 gate enforced via Discord whitelist role / admin above)

            const user = await robloxUsernameToId(username);
            if (!user)
                return msg.edit({ embeds: [embed('❌ Error', `Roblox user \`${username}\` not found.`)] });

            if (action === 'add') {
                const roleInput = args.slice(2).join(' ');
                if (!roleInput)
                    return msg.edit({ embeds: [embed('❌ Usage', '`.tag add <username> <role_name_or_rank>`')] });

                const targetRole = isNaN(roleInput)
                    ? roles.find(r => r.name.toLowerCase() === roleInput.toLowerCase())
                    : roles.find(r => r.rank == parseInt(roleInput));

                if (!targetRole)
                    return msg.edit({ embeds: [embed('❌ Error', `Role \`${roleInput}\` not found in the group.`)] });

                const current = await getGroupMember(user.id);
                const prevRoleName = current?.role?.name ?? 'Guest';

                await setGroupRank(user.id, targetRole.id);

                await msg.edit({
                    embeds: [embed('✅ Done',
                        `**${user.name}** has been assigned to **${targetRole.name}**.\n${prevRoleName} → ${targetRole.name}`)]
                });

                await sendTagLog(message.guild,
                    `👤 **By:** ${message.author.tag}\n🎮 **User:** [${user.name}](https://www.roblox.com/users/${user.id}/profile)\n📈 **Rank:** ${prevRoleName} → ${targetRole.name}`
                );

            } else if (action === 'remove') {
                const current = await getGroupMember(user.id);
                const prevRoleName = current?.role?.name ?? 'Guest';

                if (!current)
                    return msg.edit({ embeds: [embed('❌ Error', `**${user.name}** is not in the group.`)] });

                // Rank 0 = guest (removes from group)
                const guestRole = roles.find(r => r.rank === 0);
                if (!guestRole)
                    return msg.edit({ embeds: [embed('❌ Error', 'Could not find the guest role (rank 0) in the group.')] });

                await setGroupRank(user.id, guestRole.id);

                await msg.edit({
                    embeds: [embed('✅ Done',
                        `**${user.name}** has been removed from the group.\n${prevRoleName} → Guest`)]
                });

                await sendTagLog(message.guild,
                    `👤 **By:** ${message.author.tag}\n🎮 **User:** [${user.name}](https://www.roblox.com/users/${user.id}/profile)\n📉 **Rank:** ${prevRoleName} → Guest (removed)`
                );
            }

        } catch (err) {
            console.error(err);
            msg.edit({ embeds: [embed('❌ Error', err.message)] });
        }
        return;
    }

    // ── .taglist ─────────────────────────────────────────
    if (command === '.taglist') {
        const msg = await message.reply({ embeds: [embed('⏳ Loading...', 'Fetching rank 2 members...')] });

        try {
            const roles = await getGroupRoles();
            const rank2Role = roles.find(r => r.rank === 2);

            if (!rank2Role)
                return msg.edit({ embeds: [embed('❌ Error', 'Could not find rank 2 in the group.')] });

            const members = await getMembersInRole(rank2Role.id);

            if (members.length === 0)
                return msg.edit({ embeds: [embed('📋 Tag List', `No members currently hold the **${rank2Role.name}** rank.`)] });

            // Paginate: 20 names per page
            const PAGE_SIZE = 20;
            const pages = [];
            for (let i = 0; i < members.length; i += PAGE_SIZE) {
                const slice = members.slice(i, i + PAGE_SIZE);
                const lines = slice.map((m, idx) => `\`${i + idx + 1}.\` [${m.username}](https://www.roblox.com/users/${m.userId}/profile)`);
                pages.push(lines.join('\n'));
            }

            let page = 0;

            const buildEmbed = (p) =>
                embed(`📋 ${rank2Role.name} Members (${members.length} total)`,
                    pages[p] + `\n\nPage ${p + 1} / ${pages.length}`);

            const row = () => new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('taglist_prev')
                    .setLabel('◀')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(page === 0),
                new ButtonBuilder()
                    .setCustomId('taglist_next')
                    .setLabel('▶')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(page === pages.length - 1)
            );

            await msg.edit({
                embeds: [buildEmbed(page)],
                components: pages.length > 1 ? [row()] : []
            });

            if (pages.length <= 1) return;

            const collector = msg.createMessageComponentCollector({ time: 120_000 });

            collector.on('collect', async (i) => {
                if (i.user.id !== message.author.id) {
                    await i.reply({ content: 'Only the command author can navigate pages.', ephemeral: true });
                    return;
                }
                if (i.customId === 'taglist_prev' && page > 0) page--;
                if (i.customId === 'taglist_next' && page < pages.length - 1) page++;
                await i.update({ embeds: [buildEmbed(page)], components: [row()] });
            });

            collector.on('end', () => {
                msg.edit({ components: [] }).catch(() => {});
            });

        } catch (err) {
            console.error(err);
            msg.edit({ embeds: [embed('❌ Error', err.message)] });
        }
        return;
    }

    // ── .reboot ──────────────────────────────────────────
    if (command === '.reboot') {
        if (!message.member.permissions.has('Administrator'))
            return message.reply('Admin only');

        await message.reply('Rebooting...');
        process.exit(0);
    }
});

// ── READY ────────────────────────────────────────────────
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);

    // Clear all global slash commands (tag command removed in favour of prefix commands)
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
});

// ── HEALTH SERVER (RAILWAY) ──────────────────────────────
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.end('OK');
}).listen(PORT);

// ── LOGIN ────────────────────────────────────────────────
client.login(TOKEN);
