const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder
} = require('discord.js');
const Database = require('better-sqlite3');

const configPath = path.join(__dirname, 'config.json');
const config = require('./config.json');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

const db = new Database('lspd_mdt.sqlite');

/* =========================
   BASE DE DONNÉES SQLITE
========================= */

db.exec(`
CREATE TABLE IF NOT EXISTS service_sessions (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  started_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS persons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT,
  UNIQUE(first_name, last_name)
);

CREATE TABLE IF NOT EXISTS casiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL,
  delits TEXT NOT NULL,
  peine TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(person_id) REFERENCES persons(id)
);

CREATE TABLE IF NOT EXISTS rapports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  matricule TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  contenu TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`);

/* =========================
   HELPERS
========================= */

function saveConfig() {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

function getOrCreatePerson(firstName, lastName, phone = '') {
  const existing = db
    .prepare(`SELECT * FROM persons WHERE first_name = ? AND last_name = ?`)
    .get(firstName, lastName);

  if (existing) {
    if (phone && existing.phone !== phone) {
      db.prepare(`UPDATE persons SET phone = ? WHERE id = ?`).run(phone, existing.id);
      return { ...existing, phone };
    }
    return existing;
  }

  const insert = db.prepare(
    `INSERT INTO persons (first_name, last_name, phone) VALUES (?, ?, ?)`
  );

  const info = insert.run(firstName, lastName, phone || 'Non renseigné');

  return db.prepare(`SELECT * FROM persons WHERE id = ?`).get(info.lastInsertRowid);
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

function formatMoney(value) {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(value);
}

function buildLogo() {
  if (config.botLogoUrl && config.botLogoUrl.startsWith('http')) {
    return config.botLogoUrl;
  }
  return null;
}

function applyBranding(embed) {
  const logo = buildLogo();

  if (logo) {
    embed.setAuthor({
      name: config.botName || 'LSPD • Los Santos Police Department',
      iconURL: logo
    });

    embed.setFooter({
      text: config.botName || 'LSPD Bot',
      iconURL: logo
    });

    embed.setThumbnail(logo);
  } else {
    embed.setFooter({
      text: config.botName || 'LSPD Bot'
    });
  }

  return embed;
}

function divider() {
  return '━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
}

function header(title) {
  return `**${title}**\n${divider()}`;
}

function stamp() {
  return `<t:${Math.floor(Date.now() / 1000)}:F>`;
}

function checkHighGrade(interaction) {
  if (!config.highGradeRoleIds || config.highGradeRoleIds.length === 0) {
    return true;
  }

  const hasPermission = config.highGradeRoleIds.some(roleId =>
    interaction.member.roles.cache.has(roleId)
  );

  if (!hasPermission) {
    interaction.reply({
      content: '❌ Cette commande est réservée aux hauts gradés.',
      ephemeral: true
    });
    return false;
  }

  return true;
}

function getMemberGrade(member) {
  if (!config.grades || !Array.isArray(config.grades)) return null;

  for (const grade of config.grades) {
    if (member.roles.cache.has(grade.roleId)) {
      return grade;
    }
  }

  return null;
}

function buildEffectifLines(membersByGrade) {
  const lines = [];

  for (const grade of config.grades || []) {
    const members = membersByGrade.get(grade.name) || [];
    if (members.length === 0) continue;

    lines.push(`**${grade.name}**`);
    lines.push(...members);
    lines.push('━━━━━━━━━━━━━━━━━━');
  }

  return lines;
}

async function buildEffectifEmbed(guild) {
  await guild.members.fetch();

  const membersByGrade = new Map();
  for (const grade of config.grades || []) {
    membersByGrade.set(grade.name, []);
  }

  const guildMembers = guild.members.cache.filter(member => !member.user.bot);

  for (const member of guildMembers.values()) {
    const grade = getMemberGrade(member);
    if (!grade) continue;

    membersByGrade.get(grade.name).push(`• ${member} — <@&${grade.roleId}>`);
  }

  const lines = buildEffectifLines(membersByGrade);

  return applyBranding(
    new EmbedBuilder()
      .setColor(0x2563eb)
      .setTitle('👮 Effectif LSPD')
      .setDescription(
        lines.length > 0
          ? [
              header('LISTE DU PERSONNEL'),
              '```yaml',
              'Synchronisé avec les rôles Discord',
              '```',
              lines.join('\n')
            ].join('\n')
          : [
              header('LISTE DU PERSONNEL'),
              'Aucun membre avec un grade LSPD n’a été trouvé.'
            ].join('\n')
      )
      .setTimestamp()
  );
}

async function updateEffectifPanel() {
  try {
    if (!config.effectifChannelId || !config.effectifMessageId) return;

    const guild = await client.guilds.fetch(config.guildId);
    const channel = await guild.channels.fetch(config.effectifChannelId);
    if (!channel || !channel.isTextBased()) return;

    const message = await channel.messages.fetch(config.effectifMessageId);
    if (!message) return;

    const embed = await buildEffectifEmbed(guild);
    await message.edit({ embeds: [embed] });
  } catch (error) {
    console.error('❌ Erreur mise à jour panneau effectif :', error.message);
  }
}

/* =========================
   COMMANDES SLASH
========================= */

const commands = [
  new SlashCommandBuilder()
    .setName('prise_service')
    .setDescription('Prendre son service'),

  new SlashCommandBuilder()
    .setName('fin_service')
    .setDescription('Terminer son service'),

  new SlashCommandBuilder()
    .setName('heure_service')
    .setDescription('Voir le temps de service des agents'),

  new SlashCommandBuilder()
    .setName('reset_heure')
    .setDescription('Réinitialiser tous les temps de service'),

  new SlashCommandBuilder()
    .setName('service')
    .setDescription('Voir les agents actuellement en service'),

  new SlashCommandBuilder()
    .setName('casier')
    .setDescription('Ouvrir le formulaire de casier judiciaire'),

  new SlashCommandBuilder()
    .setName('rapport')
    .setDescription("Ouvrir le formulaire de rapport d'intervention"),

  new SlashCommandBuilder()
    .setName('mdt_recherche')
    .setDescription('Rechercher une personne dans le MDT')
    .addStringOption(option =>
      option.setName('nom')
        .setDescription('Nom')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('prenom')
        .setDescription('Prénom')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('mdt_casier')
    .setDescription('Voir le casier complet d’une personne')
    .addStringOption(option =>
      option.setName('nom')
        .setDescription('Nom')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('prenom')
        .setDescription('Prénom')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('mdt_unites')
    .setDescription('Voir les unités en service'),

  new SlashCommandBuilder()
    .setName('effectif')
    .setDescription("Voir l'effectif LSPD par grade"),

  new SlashCommandBuilder()
    .setName('effectif_panel')
    .setDescription("Créer ou remplacer le panneau auto d'effectif"),

  new SlashCommandBuilder()
    .setName('paye')
    .setDescription('Calculer et afficher la paye d’un agent')
    .addUserOption(option =>
      option.setName('agent')
        .setDescription('Agent concerné')
        .setRequired(true))
    .addNumberOption(option =>
      option.setName('salaire_fixe')
        .setDescription('Salaire fixe')
        .setRequired(true))
    .addNumberOption(option =>
      option.setName('taux_horaire')
        .setDescription('Montant payé par heure prestée')
        .setRequired(true))
    .addNumberOption(option =>
      option.setName('heures')
        .setDescription('Nombre d’heures prestées')
        .setRequired(true))
    .addNumberOption(option =>
      option.setName('prime')
        .setDescription('Prime')
        .setRequired(false))
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(config.token);

(async () => {
  try {
    await rest.put(
      Routes.applicationGuildCommands(config.clientId, config.guildId),
      { body: commands }
    );
    console.log('✅ Commandes installées');
  } catch (error) {
    console.error('❌ Erreur installation commandes :', error);
  }
})();

/* =========================
   READY
========================= */

client.on('clientReady', async () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);

  setInterval(async () => {
    await updateEffectifPanel();
  }, 60_000);
});

/* =========================
   INTERACTIONS
========================= */

client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand()) {
    const userId = interaction.user.id;

    if (interaction.commandName === 'prise_service') {
      const existing = db
        .prepare(`SELECT * FROM service_sessions WHERE user_id = ?`)
        .get(userId);

      if (existing) {
        return interaction.reply({
          content: '❌ Tu es déjà en service.',
          ephemeral: true
        });
      }

      db.prepare(
        `INSERT INTO service_sessions (user_id, username, started_at) VALUES (?, ?, ?)`
      ).run(userId, interaction.user.tag, Date.now());

      const embed = applyBranding(
        new EmbedBuilder()
          .setColor(0x0ea5e9)
          .setTitle('🚓 Prise de service')
          .setDescription(
            [
              header('OUVERTURE DE SERVICE'),
              '```fix',
              'Accès validé • Statut opérationnel actif',
              '```'
            ].join('\n')
          )
          .addFields(
            { name: '👤 Agent', value: `${interaction.user}`, inline: true },
            { name: '⏱️ Heure', value: stamp(), inline: true },
            { name: '📍 Statut', value: '🟢 En service', inline: true }
          )
          .setTimestamp()
      );

      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'fin_service') {
      const session = db
        .prepare(`SELECT * FROM service_sessions WHERE user_id = ?`)
        .get(userId);

      if (!session) {
        return interaction.reply({
          content: "❌ Tu n'es pas actuellement en service.",
          ephemeral: true
        });
      }

      const duration = Date.now() - session.started_at;
      db.prepare(`DELETE FROM service_sessions WHERE user_id = ?`).run(userId);

      const embed = applyBranding(
        new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle('🛑 Fin de service')
          .setDescription(
            [
              header('CLÔTURE DE SERVICE'),
              '```fix',
              'Session terminée • Archivage effectué',
              '```'
            ].join('\n')
          )
          .addFields(
            { name: '👤 Agent', value: `${interaction.user}`, inline: true },
            { name: '⏱️ Durée', value: formatDuration(duration), inline: true },
            { name: '📍 Statut', value: '🔴 Hors service', inline: true }
          )
          .setTimestamp()
      );

      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'heure_service' || interaction.commandName === 'mdt_unites') {
      const sessions = db
        .prepare(`SELECT * FROM service_sessions ORDER BY started_at ASC`)
        .all();

      if (sessions.length === 0) {
        const embed = applyBranding(
          new EmbedBuilder()
            .setTitle(
              interaction.commandName === 'mdt_unites'
                ? '👮 Unités en service'
                : '⏱️ Temps de service'
            )
            .setDescription(
              `${header('SUIVI DES AGENTS')}\nAucun agent en service actuellement.`
            )
            .setColor(0x38bdf8)
            .setTimestamp()
        );

        return interaction.reply({ embeds: [embed] });
      }

      const lines = sessions.map(session => {
        const duration = formatDuration(Date.now() - session.started_at);
        return `👤 <@${session.user_id}>\n⏱️ Temps : **${duration}**\n━━━━━━━━━━━━━━━━━━`;
      });

      const embed = applyBranding(
        new EmbedBuilder()
          .setTitle(
            interaction.commandName === 'mdt_unites'
              ? '👮 Unités en service'
              : '⏱️ Temps de service'
          )
          .setDescription(
            `${header('SUIVI DES AGENTS')}\n${lines.join('\n')}`
          )
          .setColor(0x38bdf8)
          .setTimestamp()
      );

      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'reset_heure') {
      if (!checkHighGrade(interaction)) return;

      db.prepare(`DELETE FROM service_sessions`).run();

      const embed = applyBranding(
        new EmbedBuilder()
          .setTitle('🧹 Réinitialisation des services')
          .setDescription(
            `${header('RÉINITIALISATION')}\nTous les temps de service ont été remis à zéro.`
          )
          .setColor(0xf59e0b)
          .setTimestamp()
      );

      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'service') {
      if (!checkHighGrade(interaction)) return;

      const sessions = db
        .prepare(`SELECT * FROM service_sessions ORDER BY started_at ASC`)
        .all();

      const lines = sessions.map(session => {
        const duration = formatDuration(Date.now() - session.started_at);
        return `• <@${session.user_id}> — ${duration}`;
      });

      const embed = applyBranding(
        new EmbedBuilder()
          .setTitle('👮 Agents en service')
          .setDescription(
            `${header('TABLEAU DE SERVICE')}\n${lines.join('\n') || 'Aucun agent en service.'}`
          )
          .setColor(0x7c3aed)
          .setTimestamp()
      );

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (interaction.commandName === 'casier') {
      const modal = new ModalBuilder()
        .setCustomId('casier_modal')
        .setTitle('Casier judiciaire');

      const nom = new TextInputBuilder()
        .setCustomId('nom')
        .setLabel('Nom')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100);

      const prenom = new TextInputBuilder()
        .setCustomId('prenom')
        .setLabel('Prénom')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100);

      const telephone = new TextInputBuilder()
        .setCustomId('telephone')
        .setLabel('Numéro de téléphone')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100);

      const delits = new TextInputBuilder()
        .setCustomId('delits')
        .setLabel('Délits')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000);

      const peine = new TextInputBuilder()
        .setCustomId('peine')
        .setLabel('Peine')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000);

      modal.addComponents(
        new ActionRowBuilder().addComponents(nom),
        new ActionRowBuilder().addComponents(prenom),
        new ActionRowBuilder().addComponents(telephone),
        new ActionRowBuilder().addComponents(delits),
        new ActionRowBuilder().addComponents(peine)
      );

      return interaction.showModal(modal);
    }

    if (interaction.commandName === 'rapport') {
      const modal = new ModalBuilder()
        .setCustomId('rapport_modal')
        .setTitle("Rapport d'intervention");

      const matricule = new TextInputBuilder()
        .setCustomId('matricule')
        .setLabel('Matricule')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100);

      const nomAgent = new TextInputBuilder()
        .setCustomId('nom_agent')
        .setLabel("Nom de l'agent")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100);

      const rapportIntervention = new TextInputBuilder()
        .setCustomId('rapport_intervention')
        .setLabel("Rapport d'intervention")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(2000);

      modal.addComponents(
        new ActionRowBuilder().addComponents(matricule),
        new ActionRowBuilder().addComponents(nomAgent),
        new ActionRowBuilder().addComponents(rapportIntervention)
      );

      return interaction.showModal(modal);
    }

    if (interaction.commandName === 'mdt_recherche') {
      const nom = interaction.options.getString('nom');
      const prenom = interaction.options.getString('prenom');

      const person = db
        .prepare(`SELECT * FROM persons WHERE first_name = ? AND last_name = ?`)
        .get(prenom, nom);

      if (!person) {
        return interaction.reply({
          content: '❌ Aucune fiche trouvée pour cette personne.',
          ephemeral: true
        });
      }

      const casiers = db
        .prepare(`SELECT * FROM casiers WHERE person_id = ? ORDER BY created_at DESC`)
        .all(person.id);

      const embed = applyBranding(
        new EmbedBuilder()
          .setColor(0xf5e6c8)
          .setTitle('🖥️ DOSSIER MDT')
          .setDescription(
            [
              header('FICHE INDIVIDUELLE'),
              '```yaml',
              'Base : LSPD MDT',
              'Statut : Consultable',
              '```'
            ].join('\n')
          )
          .addFields(
            { name: '🧾 Identité', value: `**${person.last_name} ${person.first_name}**`, inline: false },
            { name: '📞 Téléphone', value: `\`${person.phone || 'Non renseigné'}\``, inline: true },
            { name: '📁 Casiers', value: `${casiers.length}`, inline: true }
          )
          .setTimestamp()
      );

      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'mdt_casier') {
      const nom = interaction.options.getString('nom');
      const prenom = interaction.options.getString('prenom');

      const person = db
        .prepare(`SELECT * FROM persons WHERE first_name = ? AND last_name = ?`)
        .get(prenom, nom);

      if (!person) {
        return interaction.reply({
          content: '❌ Aucun dossier trouvé.',
          ephemeral: true
        });
      }

      const rows = db
        .prepare(`SELECT * FROM casiers WHERE person_id = ? ORDER BY created_at DESC`)
        .all(person.id);

      const casierText = rows.length
        ? rows.map((row, index) => {
            return [
              `**#${index + 1}** • ${row.delits}`,
              `Peine : ${row.peine}`,
              `Rédigé par : ${row.agent_name} • <t:${Math.floor(row.created_at / 1000)}:d>`
            ].join('\n');
          }).join('\n\n')
        : 'Aucun casier enregistré.';

      const embed = applyBranding(
        new EmbedBuilder()
          .setColor(0xf5e6c8)
          .setTitle('📁 CASIER COMPLET')
          .setDescription(
            `${header('HISTORIQUE JUDICIAIRE')}\n${casierText}`
          )
          .setTimestamp()
      );

      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'effectif') {
      if (!config.grades || !Array.isArray(config.grades) || config.grades.length === 0) {
        return interaction.reply({
          content: '❌ Aucun grade n’a été configuré dans le config.json.',
          ephemeral: true
        });
      }

      const embed = await buildEffectifEmbed(interaction.guild);
      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'effectif_panel') {
      if (!checkHighGrade(interaction)) return;

      if (!config.grades || !Array.isArray(config.grades) || config.grades.length === 0) {
        return interaction.reply({
          content: '❌ Aucun grade n’a été configuré dans le config.json.',
          ephemeral: true
        });
      }

      const embed = await buildEffectifEmbed(interaction.guild);
      const sentMessage = await interaction.channel.send({ embeds: [embed] });

      config.effectifChannelId = interaction.channelId;
      config.effectifMessageId = sentMessage.id;
      saveConfig();

      return interaction.reply({
        content: '✅ Panneau d’effectif créé et synchronisation automatique activée.',
        ephemeral: true
      });
    }

    if (interaction.commandName === 'paye') {
      if (!checkHighGrade(interaction)) return;

      const agent = interaction.options.getUser('agent');
      const salaireFixe = interaction.options.getNumber('salaire_fixe');
      const tauxHoraire = interaction.options.getNumber('taux_horaire');
      const heures = interaction.options.getNumber('heures');
      const prime = interaction.options.getNumber('prime') ?? 0;

      const salaireHeures = tauxHoraire * heures;
      const total = salaireFixe + salaireHeures + prime;

      const embed = applyBranding(
        new EmbedBuilder()
          .setColor(0x22c55e)
          .setTitle('💸 Fiche de paye')
          .setDescription(
            [
              header('CALCUL DE LA PAYE'),
              '```yaml',
              'Document : Paiement de service',
              'Statut : Calcul effectué',
              '```'
            ].join('\n')
          )
          .addFields(
            { name: '👤 Agent', value: `${agent}`, inline: false },
            { name: '💼 Salaire fixe', value: `**$${formatMoney(salaireFixe)}**`, inline: true },
            { name: '⏱️ Salaire heures prestées', value: `**$${formatMoney(salaireHeures)}**`, inline: true },
            { name: '🎁 Prime', value: `**$${formatMoney(prime)}**`, inline: true },
            { name: '📊 Détail heures', value: `**${formatMoney(heures)} h** × **$${formatMoney(tauxHoraire)}**/h`, inline: false },
            { name: '✅ Total', value: `# $${formatMoney(total)}`, inline: false }
          )
          .setTimestamp()
      );

      return interaction.reply({ embeds: [embed] });
    }
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId === 'casier_modal') {
      const nom = interaction.fields.getTextInputValue('nom');
      const prenom = interaction.fields.getTextInputValue('prenom');
      const telephone = interaction.fields.getTextInputValue('telephone');
      const delits = interaction.fields.getTextInputValue('delits');
      const peine = interaction.fields.getTextInputValue('peine');

      const person = getOrCreatePerson(prenom, nom, telephone);

      db.prepare(
        `INSERT INTO casiers (person_id, delits, peine, agent_name, created_at) VALUES (?, ?, ?, ?, ?)`
      ).run(person.id, delits, peine, interaction.user.tag, Date.now());

      const embed = applyBranding(
        new EmbedBuilder()
          .setColor(0xf5e6c8)
          .setTitle('📁 CASIER JUDICIAIRE')
          .setDescription(
            [
              header('DOSSIER INDIVIDUEL'),
              '```yaml',
              'Classification : Confidentiel',
              'Statut : Actif',
              '```'
            ].join('\n')
          )
          .addFields(
            { name: '🧾 Identité', value: `**${nom} ${prenom}**`, inline: false },
            { name: '📞 Téléphone', value: `\`${telephone}\``, inline: true },
            { name: '🗓️ Enregistré', value: stamp(), inline: true },
            { name: '⚖️ Délits', value: `>>> ${delits}`, inline: false },
            { name: '🏛️ Peine', value: `>>> ${peine}`, inline: false },
            { name: '✍️ Agent', value: `${interaction.user}`, inline: false }
          )
          .setTimestamp()
      );

      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.customId === 'rapport_modal') {
      const matricule = interaction.fields.getTextInputValue('matricule');
      const nomAgent = interaction.fields.getTextInputValue('nom_agent');
      const rapportIntervention = interaction.fields.getTextInputValue('rapport_intervention');

      db.prepare(
        `INSERT INTO rapports (matricule, agent_name, contenu, created_at) VALUES (?, ?, ?, ?)`
      ).run(matricule, nomAgent, rapportIntervention, Date.now());

      const embed = applyBranding(
        new EmbedBuilder()
          .setColor(0xf5e6c8)
          .setTitle("📝 RAPPORT D'INTERVENTION")
          .setDescription(
            [
              header('COMPTE-RENDU OPÉRATIONNEL'),
              '```yaml',
              'Division : LSPD',
              'Type : Intervention',
              '```'
            ].join('\n')
          )
          .addFields(
            { name: '🆔 Matricule', value: `**${matricule}**`, inline: true },
            { name: '👮 Agent', value: `**${nomAgent}**`, inline: true },
            { name: '🗓️ Date', value: stamp(), inline: false },
            { name: '📝 Rapport', value: `>>> ${rapportIntervention}`, inline: false }
          )
          .setTimestamp()
      );

      return interaction.reply({ embeds: [embed] });
    }
  }
});

client.login(config.token);