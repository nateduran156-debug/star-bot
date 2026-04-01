const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');
const fetch = require('node-fetch');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const prefix = '.';

// 🔥 REPLACE WITH YOUR LOGO URL
const LOGO_URL = 'https://your-logo-url.com/logo.png';

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (!message.content.startsWith(prefix) || message.author.bot) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // =========================
  // 🔁 REBOOT COMMAND
  // =========================
  if (command === 'reboot') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply('❌ No permission.');
    }

    await message.reply('🔄 Rebooting...');
    process.exit();
  }

  // =========================
  // 🏷 TAG COMMAND (replaces setrank)
  // =========================
  if (command === 'tag') {
    const tag = args.join(' ');
    if (!tag) return message.reply('❌ Provide a tag.');

    message.reply(`✅ Tag set to: **${tag}**`);
  }

  // =========================
  // 🎮 ROBLOX COMMAND
  // =========================
  if (command === 'roblox') {
    const username = args[0];
    if (!username) return message.reply('❌ Provide a Roblox username.');

    try {
      // Get user ID
      const res = await fetch('https://users.roblox.com/v1/usernames/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usernames: [username],
          excludeBannedUsers: false
        })
      });

      const data = await res.json();
      const user = data.data[0];
      if (!user) return message.reply('❌ User not found.');

      const userId = user.id;

      // Avatar
      const avatarRes = await fetch(
        `https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=420x420&format=Png&isCircular=false`
      );
      const avatarData = await avatarRes.json();
      const avatarUrl = avatarData.data[0].imageUrl;

      const profileUrl = `https://www.roblox.com/users/${userId}/profile`;

      // Embed
      const embed = new EmbedBuilder()
        .setTitle(user.name)
        .setURL(profileUrl)
        .setDescription('Roblox Profile')
        .setColor(0x5865F2)
        .setThumbnail(LOGO_URL) // top-right logo
        .setImage(avatarUrl)
        .setFooter({ text: `User ID: ${userId}` });

      // Buttons
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('View Profile')
          .setStyle(ButtonStyle.Link)
          .setURL(profileUrl),

        new ButtonBuilder()
          .setLabel('Join Game')
          .setStyle(ButtonStyle.Link)
          .setURL(profileUrl) // placeholder
      );

      message.reply({ embeds: [embed], components: [row] });

    } catch (err) {
      console.error(err);
      message.reply('❌ Error fetching Roblox user.');
    }
  }
});

client.login('YOUR_BOT_TOKEN');
