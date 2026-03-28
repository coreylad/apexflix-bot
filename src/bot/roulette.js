'use strict';

const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');

// Lazy-load canvas — wheel images are optional; game runs without it.
let _createCanvas = null;
let _loadImage = null;
(function tryLoadCanvas() {
  try {
    const m = require('canvas');
    _createCanvas = m.createCanvas;
    _loadImage = m.loadImage;
  } catch (_) {
    // canvas not installed — wheel images disabled
  }
})();

// Per-guild game state
const Games = new Map();
const KickedPlayers = new Map();
const AllPlayers = new Map();

// Custom-ID prefixes (all roulette IDs start with 'rlt_')
const IDs = {
  JOIN:      'rlt_join',
  LEAVE:     'rlt_leave',
  AUTO_KICK: 'rlt_auto_kick',
  REVIVE:    'rlt_revive',
  SHIELD:    'rlt_shield',
  SWITCH:    'rlt_switch',
  FREEZE:    'rlt_freeze',
  WITHDRAW:  'rlt_withdraw'
};

function isRouletteInteraction(customId) {
  return String(customId || '').startsWith('rlt_');
}

function sleep(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

// ─── Button / row helpers ──────────────────────────────────────────────────

function createButtonRows(buttons) {
  const rows = [];
  let i = 0;
  while (i < buttons.length) {
    const row = new ActionRowBuilder();
    for (let j = 0; j < 5 && i < buttons.length; j++, i++) {
      row.addComponents(buttons[i]);
    }
    rows.push(row);
  }
  return rows;
}

function createActionRows(buttons) {
  const rows = [];
  let row = new ActionRowBuilder();
  for (let i = 0; i < buttons.length; i++) {
    if (row.components.length >= 5) { rows.push(row); row = new ActionRowBuilder(); }
    row.addComponents(buttons[i]);
  }
  if (row.components.length) rows.push(row);
  return rows;
}

function paginateButtons(buttons, typePrefix) {
  const perPage = 5 * 4; // 4 rows × 5 buttons
  const totalPages = Math.max(1, Math.ceil(buttons.length / perPage));
  const pages = [];

  for (let pg = 0; pg < totalPages; pg++) {
    const pageButtons = buttons.slice(pg * perPage, (pg + 1) * perPage);
    const components = [];
    let row = new ActionRowBuilder();
    pageButtons.forEach((btn, idx) => {
      if (idx % 5 === 0 && idx !== 0) { components.push(row); row = new ActionRowBuilder(); }
      row.addComponents(btn);
    });
    if (row.components.length) components.push(row);

    if (totalPages > 1) {
      const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`rlt_paginate_${typePrefix}_prev_${pg}`)
          .setLabel('← Previous')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(pg === 0),
        new ButtonBuilder()
          .setCustomId(`rlt_paginate_${typePrefix}_next_${pg}`)
          .setLabel('Next →')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(pg === totalPages - 1)
      );
      components.push(navRow);
    }
    pages.push(components);
  }
  return pages;
}

// ─── Wheel drawing ─────────────────────────────────────────────────────────

const SEGMENT_COLORS = [
  ['#FF5F6D', '#FFC371'], ['#24C6DC', '#514A9D'],
  ['#DA22FF', '#9733EE'], ['#F7971E', '#FFD200'],
  ['#56CCF2', '#2F80ED'], ['#43C6AC', '#F8FFAE'],
  ['#EECDA3', '#EF629F'], ['#7F00FF', '#E100FF'],
  ['#FF512F', '#DD2476'], ['#1FA2FF', '#12D8FA']
];

function wrapText(ctx, text, x, y, maxW, lineH) {
  const words = text.split(' ');
  let line = '';
  const lines = [];
  for (const word of words) {
    const test = line + word + ' ';
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line.trim());
      line = word + ' ';
    } else {
      line = test;
    }
  }
  if (line.trim()) lines.push(line.trim());
  const startY = y - ((lines.length * lineH) / 2) + lineH / 2;
  lines.forEach((l, i) => ctx.fillText(l, x, startY + i * lineH));
}

async function drawSpinWheel(data, returnCanvas) {
  if (!_createCanvas) return null;
  const canvas = _createCanvas(1080, 1080);
  const ctx = canvas.getContext('2d');
  const [cx, cy, outerR, innerR] = [540, 540, 450, 100];
  const n = data.length;
  const step = (2 * Math.PI) / n;

  // Outer dark border
  ctx.beginPath();
  ctx.arc(cx, cy, outerR + 20, 0, 2 * Math.PI);
  ctx.fillStyle = '#333333';
  ctx.fill();

  // Segments
  for (let i = 0; i < n; i++) {
    const start = i * step - Math.PI / 2;
    const end = start + step;
    const [c1, c2] = SEGMENT_COLORS[i % SEGMENT_COLORS.length];
    const grad = ctx.createLinearGradient(
      cx + Math.cos(start) * innerR, cy + Math.sin(start) * innerR,
      cx + Math.cos(end) * outerR,   cy + Math.sin(end) * outerR
    );
    grad.addColorStop(0, c1);
    grad.addColorStop(1, c2);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, outerR, start, end, false);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.stroke();

    // Label
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(start + step / 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px sans-serif';
    wrapText(ctx, data[i].label || '', (outerR + innerR) / 2, 0, outerR - innerR - 40, 32);
    ctx.restore();
  }

  // Center circle
  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, 2 * Math.PI);
  ctx.fillStyle = '#222222';
  ctx.fill();

  // Gloss
  const gloss = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
  gloss.addColorStop(0, 'rgba(255,255,255,0.15)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.beginPath();
  ctx.arc(cx, cy, outerR, 0, 2 * Math.PI);
  ctx.fillStyle = gloss;
  ctx.fill();

  return returnCanvas ? canvas : canvas.toBuffer('image/png');
}

async function drawWheel(data, winnerAvatarUrl) {
  if (!_createCanvas) return null;
  const winnerIdx = data.findIndex(d => d.winner);
  const rotated = [...data.slice(winnerIdx), ...data.slice(0, winnerIdx)];
  const spinwheel = await drawSpinWheel(rotated, true);
  if (!spinwheel) return null;

  const canvas = _createCanvas(1080, 1080);
  const ctx = canvas.getContext('2d');
  const [cx, cy, outerR, innerR] = [540, 540, 450, 100];

  // Rotate winner segment to top
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-(2 * Math.PI) / (data.length * 2));
  ctx.drawImage(spinwheel, -cx, -cy);
  ctx.restore();

  // Gold ring
  ctx.beginPath();
  ctx.arc(cx, cy, outerR + 20, 0, 2 * Math.PI);
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#FFD700';
  ctx.stroke();

  // Inner gold ring
  ctx.beginPath();
  ctx.arc(cx, cy, innerR - 10, 0, 2 * Math.PI);
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#FFD700';
  ctx.stroke();

  // Avatar in center
  const avatarR = innerR - 15;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, avatarR, 0, 2 * Math.PI);
  ctx.fillStyle = '#333333';
  ctx.fill();
  ctx.clip();
  try {
    const img = await _loadImage(winnerAvatarUrl);
    ctx.drawImage(img, cx - avatarR, cy - avatarR, avatarR * 2, avatarR * 2);
  } catch (_) { /* fallback: dark circle already rendered */ }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, avatarR, 0, 2 * Math.PI);
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#FFD700';
  ctx.stroke();

  // Pointer triangle at top
  ctx.save();
  ctx.translate(cx, cy - outerR - 40);
  ctx.fillStyle = '#FF4444';
  ctx.strokeStyle = '#CC0000';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -28);
  ctx.lineTo(-20, 28);
  ctx.lineTo(20, 28);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  return canvas.toBuffer('image/png');
}

// ─── Game start ────────────────────────────────────────────────────────────

async function handleRouletteCommand(interaction, cfg) {
  const guildId  = interaction.guildId;
  const allowedRoleId = String(cfg?.rouletteAllowedRoleId || '').trim();

  if (allowedRoleId && !interaction.member.roles.cache.has(allowedRoleId)) {
    return interaction.reply({ content: '❌ You do not have permission to start a roulette game.', flags: 64 }).catch(() => {});
  }
  if (Games.has(guildId)) {
    return interaction.reply({ content: '⚠️ A roulette game is already running in this server.', flags: 64 }).catch(() => {});
  }

  const startTime = Math.max(5, parseInt(cfg?.rouletteStartTime || '10', 10) || 10);

  const rows = createButtonRows([
    new ButtonBuilder().setCustomId(IDs.JOIN) .setLabel('🎟️ Join Game') .setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(IDs.LEAVE).setLabel('🚪 Leave Game').setStyle(ButtonStyle.Danger)
  ]);

  const msg = await interaction.channel.send({
    embeds: [
      new EmbedBuilder()
        .setTitle('🎰 Roulette — Starting Soon!')
        .setDescription(`Game starting in **${startTime}s**! Click **Join Game** to enter.\n\n**0 / 40** players joined`)
        .setColor(0xFFD700)
        .setFooter({ text: 'Last player standing wins!' })
    ],
    components: rows
  });

  Games.set(guildId, { players: [], messageId: msg.id, winner: {} });
  KickedPlayers.set(guildId, { players: [] });
  AllPlayers.set(guildId, new Map());

  await interaction.reply({ content: '✅ Roulette started! Players can join below.', flags: 64 }).catch(() => {});

  setTimeout(async () => {
    try {
      await msg.edit({ components: [] }).catch(() => {});
      await startGame(interaction.channel, guildId, cfg, true);
    } catch (err) {
      console.error('[roulette] Error starting game:', err);
    }
  }, startTime * 1000);
}

// ─── Round engine ──────────────────────────────────────────────────────────

async function startGame(channel, guildId, cfg, isFirst = false) {
  const savedData = Games.get(guildId);
  if (!savedData) return;

  const { players } = savedData;
  const timeBetween    = Math.max(2,  parseInt(cfg?.rouletteTimeBetweenRounds || '5',  10) || 5);
  const chooseTimeout  = Math.max(10, parseInt(cfg?.rouletteChooseTimeout     || '30', 10) || 30);

  if (players.length === 0) {
    await sleep(2);
    channel.send('❌ Roulette cancelled — no players.').catch(() => {});
    cleanUpGame(guildId);
    return;
  }

  if (isFirst) {
    channel.send('✅ Players locked in! Starting the first round shortly...').catch(() => {});
  }

  await sleep(timeBetween);

  // Pick random winner
  const options = players.map((u, idx) => ({
    user: u,
    label: u.username,
    color: ['#32517f','#4876a3','#5d8ec7','#74a6eb','#8ac0ff'][idx % 5]
  }));
  const winnerOpt = options[Math.floor(Math.random() * options.length)];
  options[options.indexOf(winnerOpt)] = { ...winnerOpt, winner: true };

  savedData.winner = { id: winnerOpt.user.user, until: Date.now() + chooseTimeout * 1000 };
  Games.set(guildId, savedData);

  // Try to render wheel
  let imageBuffer = null;
  try { imageBuffer = await drawWheel(options, winnerOpt.user.avatar); } catch (e) {
    console.error('[roulette] Wheel render failed:', e);
  }

  const currentPlayer = players.find(p => p.user === winnerOpt.user.user);

  // Last-player win condition
  if (players.length <= 2) {
    const winPayload = {
      embeds: [
        new EmbedBuilder()
          .setTitle('🏆 We Have a Winner!')
          .setDescription(`<@${winnerOpt.user.user}> is the last one standing and wins the roulette! 🎉`)
          .setColor(0xFFD700)
      ]
    };
    if (imageBuffer) winPayload.files = [new AttachmentBuilder(imageBuffer, { name: 'wheel.png' })];
    channel.send(winPayload).catch(() => {});
    cleanUpGame(guildId);
    return;
  }

  // Build kick buttons
  const kickButtons = players
    .filter(p => p.user !== winnerOpt.user.user)
    .map(p => new ButtonBuilder()
      .setCustomId(`rlt_kick_${p.user}`)
      .setLabel(`${p.buttonNumber} – ${p.username}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(p.shield)
    );
  const kickPages = paginateButtons(kickButtons, 'kick');

  // Action buttons
  const actionButtons = [
    new ButtonBuilder().setCustomId(IDs.AUTO_KICK).setLabel('💣 Auto Kick')   .setStyle(ButtonStyle.Primary)  .setDisabled(currentPlayer.frozen),
    new ButtonBuilder().setCustomId(IDs.REVIVE)   .setLabel('💖 Revive')      .setStyle(ButtonStyle.Success)  .setDisabled(currentPlayer.frozen || currentPlayer.reviveUsed),
    new ButtonBuilder().setCustomId(IDs.SHIELD)   .setLabel('🛡️ Shield')      .setStyle(ButtonStyle.Primary)  .setDisabled(currentPlayer.frozen || currentPlayer.shieldUsed),
    new ButtonBuilder().setCustomId(IDs.SWITCH)   .setLabel('🔄 Switch Turn') .setStyle(ButtonStyle.Secondary).setDisabled(currentPlayer.frozen || currentPlayer.switchUsed),
    new ButtonBuilder().setCustomId(IDs.FREEZE)   .setLabel('❄️ Freeze')      .setStyle(ButtonStyle.Secondary).setDisabled(currentPlayer.frozen || currentPlayer.freezeUsed),
    new ButtonBuilder().setCustomId(IDs.WITHDRAW) .setLabel('🏳️ Withdraw')    .setStyle(ButtonStyle.Danger)
  ];

  // Send wheel + kick buttons
  const kickPayload = {
    content: `**${winnerOpt.user.buttonNumber} – <@${winnerOpt.user.user}> 🎯**\n⏰ You have **${chooseTimeout}s** to choose a player to eliminate!`,
    components: kickPages[0]
  };
  if (imageBuffer) kickPayload.files = [new AttachmentBuilder(imageBuffer, { name: 'wheel.png' })];
  const kickMsg = await channel.send(kickPayload).catch(() => null);

  savedData.pagination = {
    messageId: kickMsg?.id,
    page: 0,
    totalPages: kickPages.length,
    buttonsType: 'kick',
    buttons: kickButtons
  };
  Games.set(guildId, savedData);

  // Send action row
  const actionMsg = await channel.send({
    content: `**Actions for <@${winnerOpt.user.user}>:**`,
    components: createActionRows(actionButtons)
  }).catch(() => null);
  savedData.actionMessageId = actionMsg?.id;
  Games.set(guildId, savedData);

  // Auto-kick timeout
  setTimeout(async () => {
    try {
      const check = Games.get(guildId);
      if (check && check.winner.id === winnerOpt.user.user && Date.now() >= check.winner.until) {
        check.players = check.players.filter(p => p.user !== winnerOpt.user.user);
        check.winner.id = '';
        Games.set(guildId, check);
        channel.send(`⏰ <@${winnerOpt.user.user}> ran out of time and was eliminated! Next round starting...`).catch(() => {});
        await startGame(channel, guildId, cfg);
      }
    } catch (err) { console.error('[roulette] Timeout error:', err); }
  }, chooseTimeout * 1000);

  // Reset per-round states
  if (currentPlayer.frozen) { currentPlayer.frozen = false; }
  savedData.players.forEach(p => { p.shield = false; });
  Games.set(guildId, savedData);
}

// ─── Interaction router ────────────────────────────────────────────────────

async function handleRouletteInteraction(interaction, cfg) {
  const id = interaction.customId;
  if      (id === IDs.JOIN)      return handleJoin(interaction);
  else if (id === IDs.LEAVE)     return handleLeave(interaction);
  else if (id === IDs.AUTO_KICK) return handleAutoKick(interaction, cfg);
  else if (id === IDs.REVIVE)    return handleReviveMenu(interaction);
  else if (id === IDs.SHIELD)    return handleShieldMenu(interaction);
  else if (id === IDs.SWITCH)    return handleSwitchMenu(interaction);
  else if (id === IDs.FREEZE)    return handleFreezeMenu(interaction);
  else if (id === IDs.WITHDRAW)  return handleWithdraw(interaction, cfg);
  else if (id.startsWith('rlt_kick_'))    return handleKick(interaction, cfg);
  else if (id.startsWith('rlt_sel_'))     return handleSelect(interaction, cfg);
  else if (id.startsWith('rlt_paginate_'))return handlePaginate(interaction);
}

// ─── Join / Leave ──────────────────────────────────────────────────────────

async function handleJoin(interaction) {
  const guildId = interaction.guildId;
  const savedGame = Games.get(guildId);
  const allPlayers = AllPlayers.get(guildId);
  if (!savedGame) return interaction.reply({ content: 'No game is currently running.', flags: 64 }).catch(() => {});
  if (savedGame.players.some(p => p.user === interaction.user.id)) {
    return interaction.reply({ content: 'You already joined!', flags: 64 }).catch(() => {});
  }
  if (savedGame.players.length >= 40) {
    return interaction.reply({ content: 'The game is full (40 players max).', flags: 64 }).catch(() => {});
  }

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const used = new Set(savedGame.players.map(p => p.buttonNumber));
  let number = 1;
  while (used.has(number)) number++;

  const playerData = {
    user: interaction.user.id,
    buttonNumber: number,
    username: member?.displayName || interaction.user.username,
    avatar: interaction.user.displayAvatarURL({ size: 256, extension: 'png' }),
    shield: false, shieldUsed: false, reviveUsed: false,
    freezeUsed: false, frozen: false, switchUsed: false,
    kills: 0, deaths: 0
  };

  savedGame.players.push(playerData);
  allPlayers.set(interaction.user.id, playerData);
  Games.set(guildId, savedGame);
  AllPlayers.set(guildId, allPlayers);

  try {
    const joinMsg = await interaction.channel.messages.fetch(savedGame.messageId);
    const count = savedGame.players.length;
    await joinMsg.edit({
      embeds: [EmbedBuilder.from(joinMsg.embeds[0])
        .setDescription(`Game starting soon! Click **Join Game** to enter.\n\n**${count} / 40** players joined`)]
    }).catch(() => {});
  } catch (_) {}

  interaction.reply({ content: `✅ Joined! Your number is **${number}**.`, flags: 64 }).catch(() => {});
}

async function handleLeave(interaction) {
  const guildId = interaction.guildId;
  const savedGame = Games.get(guildId);
  if (!savedGame) return interaction.reply({ content: 'No game is currently running.', flags: 64 }).catch(() => {});
  if (!savedGame.players.some(p => p.user === interaction.user.id)) {
    return interaction.reply({ content: "You haven't joined the game.", flags: 64 }).catch(() => {});
  }

  savedGame.players = savedGame.players.filter(p => p.user !== interaction.user.id);
  Games.set(guildId, savedGame);

  try {
    const joinMsg = await interaction.channel.messages.fetch(savedGame.messageId);
    const count = savedGame.players.length;
    await joinMsg.edit({
      embeds: [EmbedBuilder.from(joinMsg.embeds[0])
        .setDescription(`Game starting soon! Click **Join Game** to enter.\n\n**${count} / 40** players joined`)]
    }).catch(() => {});
  } catch (_) {}

  interaction.reply({ content: '👋 You left the game.', flags: 64 }).catch(() => {});
}

// ─── Kick ──────────────────────────────────────────────────────────────────

async function handleKick(interaction, cfg) {
  const guildId = interaction.guildId;
  const kickedUserId = interaction.customId.split('_')[2];
  const savedGame = Games.get(guildId);
  const kickedPlayers = KickedPlayers.get(guildId);
  const allPlayers = AllPlayers.get(guildId);

  if (!savedGame) return interaction.reply({ content: 'No game running.', flags: 64 }).catch(() => {});
  if (interaction.user.id !== savedGame.winner?.id) return interaction.reply({ content: "It's not your turn!", flags: 64 }).catch(() => {});
  if (Date.now() > savedGame.winner.until) return interaction.reply({ content: '⏰ Your turn timed out.', flags: 64 }).catch(() => {});

  const target = savedGame.players.find(p => p.user === kickedUserId);
  if (!target) return interaction.reply({ content: 'That player is no longer in the game.', flags: 64 }).catch(() => {});
  if (target.shield) return interaction.reply({ content: '🛡️ That player has a shield — pick someone else.', flags: 64 }).catch(() => {});

  const kicker = savedGame.players.find(p => p.user === interaction.user.id);
  if (kicker) { kicker.kills += 1; }
  target.deaths += 1;
  if (allPlayers.get(target.user)) allPlayers.get(target.user).deaths = target.deaths;
  if (allPlayers.get(interaction.user.id)) allPlayers.get(interaction.user.id).kills = (kicker?.kills || 1);

  kickedPlayers.players.push(target);
  savedGame.players = savedGame.players.filter(p => p.user !== kickedUserId);
  savedGame.winner.id = '';
  Games.set(guildId, savedGame);
  KickedPlayers.set(guildId, kickedPlayers);

  interaction.reply({ content: `💥 Kicked **${target.username}**!`, flags: 64 }).catch(() => {});
  interaction.channel.send(`💣 <@${kickedUserId}> was eliminated! Next round starting...`).catch(() => {});
  await startGame(interaction.channel, guildId, cfg);
}

async function handleAutoKick(interaction, cfg) {
  const guildId = interaction.guildId;
  const savedGame = Games.get(guildId);
  const kickedPlayers = KickedPlayers.get(guildId);
  const allPlayers = AllPlayers.get(guildId);

  if (!savedGame) return interaction.reply({ content: 'No game running.', flags: 64 }).catch(() => {});
  if (interaction.user.id !== savedGame.winner?.id) return interaction.reply({ content: "It's not your turn!", flags: 64 }).catch(() => {});
  if (Date.now() > savedGame.winner.until) return interaction.reply({ content: '⏰ Your turn timed out.', flags: 64 }).catch(() => {});

  const target = savedGame.players.find(p => p.user !== interaction.user.id && !p.shield);
  if (!target) return interaction.reply({ content: 'No available players to kick right now.', flags: 64 }).catch(() => {});

  const kicker = savedGame.players.find(p => p.user === interaction.user.id);
  if (kicker) kicker.kills += 1;
  target.deaths += 1;
  if (allPlayers.get(target.user)) allPlayers.get(target.user).deaths = target.deaths;
  if (kicker && allPlayers.get(kicker.user)) allPlayers.get(kicker.user).kills = kicker.kills;

  kickedPlayers.players.push(target);
  savedGame.players = savedGame.players.filter(p => p.user !== target.user);
  savedGame.winner.id = '';
  Games.set(guildId, savedGame);
  KickedPlayers.set(guildId, kickedPlayers);

  interaction.reply({ content: `💣 Auto-kicked **${target.username}**!`, flags: 64 }).catch(() => {});
  interaction.channel.send(`💣 <@${target.user}> was auto-eliminated! Next round starting...`).catch(() => {});
  await startGame(interaction.channel, guildId, cfg);
}

// ─── Action menus ──────────────────────────────────────────────────────────

async function handleReviveMenu(interaction) {
  const savedGame = Games.get(interaction.guildId);
  const kicked = KickedPlayers.get(interaction.guildId);
  if (!savedGame) return interaction.reply({ content: 'No game running.', flags: 64 }).catch(() => {});
  if (interaction.user.id !== savedGame.winner?.id) return interaction.reply({ content: "It's not your turn!", flags: 64 }).catch(() => {});
  if (!kicked?.players.length) return interaction.reply({ content: 'No eliminated players to revive.', flags: 64 }).catch(() => {});
  const current = savedGame.players.find(p => p.user === interaction.user.id);
  if (current.reviveUsed) return interaction.reply({ content: 'You can only revive once per game.', flags: 64 }).catch(() => {});

  const buttons = kicked.players.slice(0, 20).map(p =>
    new ButtonBuilder().setCustomId(`rlt_sel_revive_${p.user}`).setLabel(`${p.buttonNumber} – ${p.username}`).setStyle(ButtonStyle.Secondary)
  );
  interaction.reply({ content: '💖 Choose a player to revive:', components: createButtonRows(buttons), flags: 64 }).catch(() => {});
  savedGame.actionData = { action: 'revive' };
  Games.set(interaction.guildId, savedGame);
}

async function handleShieldMenu(interaction) {
  const savedGame = Games.get(interaction.guildId);
  if (!savedGame) return interaction.reply({ content: 'No game running.', flags: 64 }).catch(() => {});
  if (interaction.user.id !== savedGame.winner?.id) return interaction.reply({ content: "It's not your turn!", flags: 64 }).catch(() => {});
  const current = savedGame.players.find(p => p.user === interaction.user.id);
  if (current.shieldUsed) return interaction.reply({ content: 'You can only use shield once per game.', flags: 64 }).catch(() => {});

  const buttons = savedGame.players.slice(0, 20).map(p =>
    new ButtonBuilder().setCustomId(`rlt_sel_shield_${p.user}`).setLabel(`${p.buttonNumber} – ${p.username}`).setStyle(ButtonStyle.Secondary)
  );
  interaction.reply({ content: '🛡️ Choose a player to grant a shield (protects from this round\'s kick):', components: createButtonRows(buttons), flags: 64 }).catch(() => {});
  savedGame.actionData = { action: 'shield' };
  Games.set(interaction.guildId, savedGame);
}

async function handleSwitchMenu(interaction) {
  const savedGame = Games.get(interaction.guildId);
  if (!savedGame) return interaction.reply({ content: 'No game running.', flags: 64 }).catch(() => {});
  if (interaction.user.id !== savedGame.winner?.id) return interaction.reply({ content: "It's not your turn!", flags: 64 }).catch(() => {});
  const current = savedGame.players.find(p => p.user === interaction.user.id);
  if (current.switchUsed) return interaction.reply({ content: 'You can only switch turns once per game.', flags: 64 }).catch(() => {});

  const buttons = savedGame.players.filter(p => p.user !== interaction.user.id).slice(0, 20).map(p =>
    new ButtonBuilder().setCustomId(`rlt_sel_switch_${p.user}`).setLabel(`${p.buttonNumber} – ${p.username}`).setStyle(ButtonStyle.Secondary)
  );
  interaction.reply({ content: '🔄 Choose a player to pass your turn to:', components: createButtonRows(buttons), flags: 64 }).catch(() => {});
  savedGame.actionData = { action: 'switch' };
  Games.set(interaction.guildId, savedGame);
}

async function handleFreezeMenu(interaction) {
  const savedGame = Games.get(interaction.guildId);
  if (!savedGame) return interaction.reply({ content: 'No game running.', flags: 64 }).catch(() => {});
  if (interaction.user.id !== savedGame.winner?.id) return interaction.reply({ content: "It's not your turn!", flags: 64 }).catch(() => {});
  const current = savedGame.players.find(p => p.user === interaction.user.id);
  if (current.freezeUsed) return interaction.reply({ content: 'You can only freeze once per game.', flags: 64 }).catch(() => {});

  const buttons = savedGame.players.filter(p => p.user !== interaction.user.id).slice(0, 20).map(p =>
    new ButtonBuilder().setCustomId(`rlt_sel_freeze_${p.user}`).setLabel(`${p.buttonNumber} – ${p.username}`).setStyle(ButtonStyle.Secondary)
  );
  interaction.reply({ content: '❄️ Choose a player to freeze (disables their abilities next round):', components: createButtonRows(buttons), flags: 64 }).catch(() => {});
  savedGame.actionData = { action: 'freeze' };
  Games.set(interaction.guildId, savedGame);
}

async function handleWithdraw(interaction, cfg) {
  const guildId = interaction.guildId;
  const savedGame = Games.get(guildId);
  if (!savedGame) return interaction.reply({ content: 'No game running.', flags: 64 }).catch(() => {});
  if (interaction.user.id !== savedGame.winner?.id) return interaction.reply({ content: "It's not your turn!", flags: 64 }).catch(() => {});

  savedGame.players = savedGame.players.filter(p => p.user !== interaction.user.id);
  savedGame.winner.id = '';
  Games.set(guildId, savedGame);

  interaction.reply({ content: '🏳️ You withdrew from the game.', flags: 64 }).catch(() => {});
  interaction.channel.send(`🏳️ <@${interaction.user.id}> withdrew! Next round starting...`).catch(() => {});
  await startGame(interaction.channel, guildId, cfg);
}

// ─── Select-player dispatch ────────────────────────────────────────────────

async function handleSelect(interaction, cfg) {
  // customId format: rlt_sel_{action}_{userId}
  const parts = interaction.customId.split('_');
  const action = parts[2];
  const userId = parts[3];
  switch (action) {
    case 'revive': return doRevive(interaction, userId, cfg);
    case 'shield': return doShield(interaction, userId, cfg);
    case 'switch': return doSwitch(interaction, userId, cfg);
    case 'freeze': return doFreeze(interaction, userId, cfg);
    default: interaction.reply({ content: 'Unknown action.', flags: 64 }).catch(() => {});
  }
}

async function doRevive(interaction, userId, cfg) {
  const guildId = interaction.guildId;
  const savedGame = Games.get(guildId);
  const kicked = KickedPlayers.get(guildId);
  const allPlayers = AllPlayers.get(guildId);
  const current = savedGame.players.find(p => p.user === interaction.user.id);
  if (current.reviveUsed) return interaction.reply({ content: 'Already used', flags: 64 }).catch(() => {});
  const target = kicked.players.find(p => p.user === userId);
  if (!target) return interaction.reply({ content: 'Player not found in eliminated list.', flags: 64 }).catch(() => {});

  kicked.players = kicked.players.filter(p => p.user !== userId);
  savedGame.players.push(target);
  savedGame.winner.id = '';
  current.reviveUsed = true;
  if (allPlayers.get(target.user)) allPlayers.get(target.user).reviveUsed = true;
  Games.set(guildId, savedGame); KickedPlayers.set(guildId, kicked); AllPlayers.set(guildId, allPlayers);
  interaction.reply({ content: `💖 Revived **${target.username}**!`, flags: 64 }).catch(() => {});
  interaction.channel.send(`💖 <@${target.user}> was revived and is back in the game! Next round starting...`).catch(() => {});
  await startGame(interaction.channel, guildId, cfg);
}

async function doShield(interaction, userId, cfg) {
  const guildId = interaction.guildId;
  const savedGame = Games.get(guildId);
  const allPlayers = AllPlayers.get(guildId);
  const current = savedGame.players.find(p => p.user === interaction.user.id);
  if (current.shieldUsed) return interaction.reply({ content: 'Already used', flags: 64 }).catch(() => {});
  const target = savedGame.players.find(p => p.user === userId);
  if (!target) return interaction.reply({ content: 'Player not found.', flags: 64 }).catch(() => {});

  target.shield = true;
  current.shieldUsed = true;
  if (allPlayers.get(target.user)) allPlayers.get(target.user).shieldUsed = true;
  Games.set(guildId, savedGame); AllPlayers.set(guildId, allPlayers);
  savedGame.winner.id = '';
  Games.set(guildId, savedGame);
  interaction.reply({ content: `🛡️ Shielded **${target.username}** for this round!`, flags: 64 }).catch(() => {});
  interaction.channel.send(`🛡️ <@${target.user}> has been shielded and cannot be kicked this round!`).catch(() => {});
  await startGame(interaction.channel, guildId, cfg);
}

async function doSwitch(interaction, userId, cfg) {
  const guildId = interaction.guildId;
  const savedGame = Games.get(guildId);
  const allPlayers = AllPlayers.get(guildId);
  const chooseTimeout = Math.max(10, parseInt(cfg?.rouletteChooseTimeout || '30', 10) || 30);
  const current = savedGame.players.find(p => p.user === interaction.user.id);
  if (current.switchUsed) return interaction.reply({ content: 'Already used', flags: 64 }).catch(() => {});
  const target = savedGame.players.find(p => p.user === userId);
  if (!target) return interaction.reply({ content: 'Player not found.', flags: 64 }).catch(() => {});

  savedGame.winner = { id: target.user, until: Date.now() + chooseTimeout * 1000 };
  current.switchUsed = true;
  if (allPlayers.get(interaction.user.id)) allPlayers.get(interaction.user.id).switchUsed = true;
  Games.set(guildId, savedGame); AllPlayers.set(guildId, allPlayers);
  interaction.reply({ content: `🔄 Passed your turn to **${target.username}**!`, flags: 64 }).catch(() => {});
  interaction.channel.send(`🔄 <@${interaction.user.id}> passed their turn to <@${target.user}>. They have **${chooseTimeout}s** to act!`).catch(() => {});

  setTimeout(async () => {
    try {
      const check = Games.get(guildId);
      if (check && check.winner.id === target.user && Date.now() >= check.winner.until) {
        check.players = check.players.filter(p => p.user !== target.user);
        check.winner.id = '';
        Games.set(guildId, check);
        interaction.channel.send(`⏰ <@${target.user}> timed out and was eliminated!`).catch(() => {});
        await startGame(interaction.channel, guildId, cfg);
      }
    } catch (_) {}
  }, chooseTimeout * 1000);
}

async function doFreeze(interaction, userId, cfg) {
  const guildId = interaction.guildId;
  const savedGame = Games.get(guildId);
  const allPlayers = AllPlayers.get(guildId);
  const current = savedGame.players.find(p => p.user === interaction.user.id);
  if (current.freezeUsed) return interaction.reply({ content: 'Already used', flags: 64 }).catch(() => {});
  const target = savedGame.players.find(p => p.user === userId);
  if (!target) return interaction.reply({ content: 'Player not found.', flags: 64 }).catch(() => {});

  target.frozen = true;
  current.freezeUsed = true;
  if (allPlayers.get(target.user)) allPlayers.get(target.user).frozen = true;
  if (allPlayers.get(interaction.user.id)) allPlayers.get(interaction.user.id).freezeUsed = true;
  Games.set(guildId, savedGame); AllPlayers.set(guildId, allPlayers);
  savedGame.winner.id = '';
  Games.set(guildId, savedGame);
  interaction.reply({ content: `❄️ Froze **${target.username}** — their abilities are disabled next round!`, flags: 64 }).catch(() => {});
  interaction.channel.send(`❄️ <@${target.user}>'s abilities are frozen for the next round!`).catch(() => {});
  await startGame(interaction.channel, guildId, cfg);
}

// ─── Pagination ────────────────────────────────────────────────────────────

async function handlePaginate(interaction) {
  // customId: rlt_paginate_{type}_{prev|next}_{currentPage}
  const parts = interaction.customId.split('_');
  const direction   = parts[3];   // 'prev' | 'next'
  const currentPage = parseInt(parts[4] || '0', 10);
  const guildId = interaction.guildId;
  const savedData = Games.get(guildId);
  if (!savedData?.pagination) return interaction.reply({ content: 'No pagination data.', flags: 64 }).catch(() => {});

  const { buttons, totalPages, buttonsType } = savedData.pagination;
  const newPage = direction === 'next' ? currentPage + 1 : Math.max(0, currentPage - 1);
  if (newPage < 0 || newPage >= totalPages) return interaction.reply({ content: 'Invalid page.', flags: 64 }).catch(() => {});

  const pages = paginateButtons(buttons, buttonsType);
  savedData.pagination.page = newPage;
  Games.set(guildId, savedData);
  interaction.update({ components: pages[newPage] }).catch(() => {
    interaction.reply({ content: 'Navigated to page ' + (newPage + 1), flags: 64 }).catch(() => {});
  });
}

// ─── Cleanup ───────────────────────────────────────────────────────────────

function cleanUpGame(guildId) {
  Games.delete(guildId);
  KickedPlayers.delete(guildId);
  AllPlayers.delete(guildId);
}

module.exports = { handleRouletteCommand, handleRouletteInteraction, isRouletteInteraction };
