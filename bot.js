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

const config = {
  token: process.env.token,
  clientId: process.env.clientId,
  guildId: process.env.guildId,
  highGradeRoleIds: process.env.highGradeRoleIds
    ? process.env.highGradeRoleIds.split(',').map(id => id.trim()).filter(Boolean)
    : [],
  botName: process.env.botName || 'LSPD Urban',
  botLogoUrl: process.env.botLogoUrl || ''
};

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const serviceSessions = new Map();

/* =========================
   HELPERS
========================= */

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
     Routes.applicationCommands(config.clientId)
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
});

/* =========================
   INTERACTIONS
========================= */

client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand()) {
    const userId = interaction.user.id;

    if (interaction.commandName === 'prise_service') {
      if (serviceSessions.has(userId)) {
        return interaction.reply({
          content: '❌ Tu es déjà en service.',
          ephemeral: true
        });
      }

      serviceSessions.set(userId, {
        username: interaction.user.tag,
        startedAt: Date.now()
      });

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
      const session = serviceSessions.get(userId);

      if (!session) {
        return interaction.reply({
          content: "❌ Tu n'es pas actuellement en service.",
          ephemeral: true
        });
      }

      const duration = Date.now() - session.startedAt;
      serviceSessions.delete(userId);

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

    if (interaction.commandName === 'heure_service') {
      const sessions = Array.from(serviceSessions.entries());

      if (sessions.length === 0) {
        const embed = applyBranding(
          new EmbedBuilder()
            .setTitle('⏱️ Temps de service')
            .setDescription(
              `${header('SUIVI DES AGENTS')}\nAucun agent en service actuellement.`
            )
            .setColor(0x38bdf8)
            .setTimestamp()
        );

        return interaction.reply({ embeds: [embed] });
      }

      const lines = sessions.map(([id, session]) => {
        const duration = formatDuration(Date.now() - session.startedAt);
        return `👤 <@${id}>\n⏱️ Temps : **${duration}**\n━━━━━━━━━━━━━━━━━━`;
      });

      const embed = applyBranding(
        new EmbedBuilder()
          .setTitle('⏱️ Temps de service')
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

      serviceSessions.clear();

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

      const sessions = Array.from(serviceSessions.entries());

      const lines = sessions.map(([id, session]) => {
        const duration = formatDuration(Date.now() - session.startedAt);
        return `• <@${id}> — ${duration}`;
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
