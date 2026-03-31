// CLEAN FULL IMPLEMENTATION (relevant additions only)

process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const args = message.content.trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const member = message.member;

    // ── .reboot ─────────────
    if (command === '.reboot') {
        if (!member.permissions.has('Administrator'))
            return reply(message, embed('🚫 Admin Only', 'Only administrators can use this command'));

        await reply(message, embed('♻️ Rebooting', 'Restarting bot...'));
        setTimeout(() => process.exit(1), 1000);
        return;
    }

    // ── .striprole ─────────────
    if (command === '.striprole') {
        if (!member.permissions.has('Administrator')) return;

        const roleInput = args.join(' ');
        const loading = await reply(message, embed('⏳ Working...', 'Processing...'));

        const roles = await getGroupRoles();
        const target = roles.find(r => r.name.toLowerCase() === roleInput.toLowerCase() || r.rank == roleInput);
        if (!target) return loading.edit({ embeds: [embed('❌ Error', 'Role not found')] });

        const lowest = roles.filter(r=>r.rank>0).sort((a,b)=>a.rank-b.rank)[0];

        let users=[]; let cursor="";
        do {
            const res = await fetch(`https://groups.roblox.com/v1/groups/${ROBLOX_GROUP_ID}/roles/${target.id}/users?limit=100&cursor=${cursor}`);
            const data = await res.json();
            users.push(...data.data);
            cursor = data.nextPageCursor;
        } while(cursor);

        let done=0;
        for (const u of users) {
            await setGroupRank(u.userId, lowest.id);
            done++;
            if (done % 10 === 0) {
                await loading.edit({ embeds:[embed('Progress', `${done}/${users.length}`)]});
            }
            await new Promise(r=>setTimeout(r,500));
        }

        loading.edit({ embeds:[embed('✅ Done', `Processed ${done}`)]});
        return;
    }

    // ── .tag ─────────────
    if (command === '.tag') {
        const action = args[0];
        const username = args[1];
        if (!['add','remove'].includes(action)) return;

        const robloxUser = await robloxUsernameToId(username);
        const roles = await getGroupRoles();
        const sorted = roles.filter(r=>r.rank>0).sort((a,b)=>a.rank-b.rank);

        const newRole = action==='add' ? sorted[1] : sorted[0];
        await setGroupRank(robloxUser.id, newRole.id);

        const profile = `https://www.roblox.com/users/${robloxUser.id}/profile`;

        const logChannel = message.guild.channels.cache.get(process.env.TAG_LOG_CHANNEL_ID);
        if (logChannel) {
            logChannel.send({ embeds:[embed('Tag Log',
                `User: [${robloxUser.name}](${profile})\nAction: ${action}`)]});
        }

        reply(message, embed('Done', `${robloxUser.name} updated`));
        return;
    }

    // ── .roblox ─────────────
    if (command === '.roblox') {
        const username = args[0];
        const robloxUser = await robloxUsernameToId(username);

        const userRes = await fetch(`https://users.roblox.com/v1/users/${robloxUser.id}`);
        const userData = await userRes.json();

        const profile = `https://www.roblox.com/users/${robloxUser.id}/profile`;

        const e = new EmbedBuilder()
            .setTitle(robloxUser.name)
            .setURL(profile)
            .setDescription(`[View Profile](${profile})`)
            .addFields({ name:'Created', value:new Date(userData.created).toLocaleDateString() })
            .setFooter({ text:`ID: ${robloxUser.id}` });

        reply(message, e);
        return;
    }
});
