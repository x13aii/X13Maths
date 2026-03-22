const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const Anthropic = require('@anthropic-ai/sdk');
const fetch = require('node-fetch');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Store working out per message so the button can retrieve it
const workingOutStore = new Map();

client.once('ready', () => {
  console.log(`✅ Sparx Bot is online as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Only process messages with image attachments
  const imageAttachments = message.attachments.filter(att =>
    att.contentType && att.contentType.startsWith('image/')
  );

  if (imageAttachments.size === 0) return;

  // Let the user know we're working on it
  const thinkingMsg = await message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865F2)
        .setDescription('🔍 Analysing your Sparx question...')
    ]
  });

  try {
    // Download and encode each image as base64
    const imageContents = [];
    for (const [, attachment] of imageAttachments) {
      const response = await fetch(attachment.url);
      const buffer = await response.buffer();
      const base64 = buffer.toString('base64');
      const mediaType = attachment.contentType.split(';')[0]; // e.g. image/png

      imageContents.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType,
          data: base64,
        },
      });
    }

    // Ask Claude to solve the question
    const aiResponse = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            ...imageContents,
            {
              type: 'text',
              text: `You are a maths tutor helping a student with their Sparx Maths homework.
Look at the question in the image(s) and respond in this EXACT format (keep the headers exactly as written):

ANSWER:
[Write only the final answer here, nothing else]

WORKING_OUT:
[Write the full step-by-step working out here, clearly numbered]

Be concise in the answer section — just the number/expression/value. Be thorough in the working out section.`,
            },
          ],
        },
      ],
    });

    const fullText = aiResponse.content[0].text;

    // Parse answer and working out from the response
    const answerMatch = fullText.match(/ANSWER:\s*([\s\S]*?)(?=WORKING_OUT:|$)/i);
    const workingMatch = fullText.match(/WORKING_OUT:\s*([\s\S]*)/i);

    const answer = answerMatch ? answerMatch[1].trim() : 'Could not determine answer.';
    const workingOut = workingMatch ? workingMatch[1].trim() : 'No working out available.';

    // Store working out keyed by the thinking message ID (we'll update it)
    const storeKey = `${message.id}`;
    workingOutStore.set(storeKey, workingOut);

    // Clean up old entries (keep last 50)
    if (workingOutStore.size > 50) {
      const firstKey = workingOutStore.keys().next().value;
      workingOutStore.delete(firstKey);
    }

    // Build the answer embed
    const answerEmbed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle('✅ Sparx Answer')
      .addFields({ name: '📌 Answer', value: `\`\`\`\n${answer}\n\`\`\`` })
      .setFooter({ text: 'Click ? to see full working out' })
      .setTimestamp();

    // Build the button row
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`working_${storeKey}`)
        .setEmoji('❓')
        .setLabel('Show Working Out')
        .setStyle(ButtonStyle.Secondary)
    );

    // Edit the thinking message with the real answer
    await thinkingMsg.edit({
      embeds: [answerEmbed],
      components: [row],
    });

  } catch (error) {
    console.error('Error processing image:', error);
    await thinkingMsg.edit({
      embeds: [
        new EmbedBuilder()
          .setColor(0xED4245)
          .setTitle('❌ Error')
          .setDescription('Sorry, I couldn\'t process that image. Make sure it\'s a clear photo of a Sparx Maths question.')
      ],
      components: [],
    });
  }
});

// Handle button interactions
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId.startsWith('working_')) {
    const storeKey = interaction.customId.replace('working_', '');
    const workingOut = workingOutStore.get(storeKey);

    if (!workingOut) {
      await interaction.reply({
        content: '⚠️ Working out has expired. Please re-send the image.',
        ephemeral: true,
      });
      return;
    }

    // Split working out if it's too long for a single field (Discord limit: 1024 chars)
    const chunks = [];
    let remaining = workingOut;
    while (remaining.length > 0) {
      chunks.push(remaining.slice(0, 1024));
      remaining = remaining.slice(1024);
    }

    const workingEmbed = new EmbedBuilder()
      .setColor(0xFEE75C)
      .setTitle('📝 Working Out');

    chunks.forEach((chunk, i) => {
      workingEmbed.addFields({
        name: chunks.length > 1 ? `Step-by-step (part ${i + 1})` : 'Step-by-step',
        value: chunk,
      });
    });

    // Reply ephemerally so only the button-clicker sees it
    await interaction.reply({
      embeds: [workingEmbed],
      ephemeral: true,
    });
  }
});

client.login(process.env.DISCORD_TOKEN);
