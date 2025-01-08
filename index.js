const TelegramBot = require('node-telegram-bot-api');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;

// Set ffmpeg and ffprobe paths for fluent-ffmpeg
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

// Replace with your Telegram bot token
const TOKEN = '8102710935:AAFmP5c08v4KBCu1XVTKEvs_OtXUQXM_HB8';
const ADMIN_ID = '1343548529'; // Replace with your Telegram admin ID
const CHANNEL_USERNAME = '@awt_bots'; // Replace with your channel username
const DB_CHANNEL_ID = '@awtbotsdb'; // Replace with the database channel ID

const bot = new TelegramBot(TOKEN, { polling: true });
const users = new Map(); // Store user info
let combineFiles = []; // Store files for combining

// Utility function to calculate duration
function calculateDuration(start, end) {
  const [startMin, startSec] = start.split(':').map(Number);
  const [endMin, endSec] = end.split(':').map(Number);
  const startTime = startMin * 60 + startSec;
  const endTime = endMin * 60 + endSec;
  return endTime - startTime;
}

// Function to check if a user is subscribed
async function isUserSubscribed(chatId) {
  try {
    const member = await bot.getChatMember(CHANNEL_USERNAME, chatId);
    return ['creator', 'administrator', 'member'].includes(member.status);
  } catch (err) {
    console.error(err);
    return false;
  }
}

// Function to handle file processing commands
async function handleFileProcessing(msg, chatId, callback) {
  if (msg.audio || msg.voice || msg.document) {
    const fileId = msg.audio?.file_id || msg.voice?.file_id || msg.document?.file_id;
    const filePath = await bot.downloadFile(fileId, './downloads');
    callback(filePath);
  } else {
    bot.sendMessage(chatId, 'Please send a valid audio file.');
  }
}

// /start command handler
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;

  if (!users.has(chatId)) {
    const userInfo = {
      id: chatId,
      username: msg.from.username || 'N/A',
      firstName: msg.from.first_name || 'N/A',
      lastName: msg.from.last_name || 'N/A',
      startTime: new Date().toISOString(),
    };
    users.set(chatId, userInfo);

    bot.sendMessage(
      DB_CHANNEL_ID,
      `New User Started:\nUsername: @${userInfo.username}\nName: ${userInfo.firstName} ${userInfo.lastName}\nID: ${userInfo.id}`
    );
  }

  const isSubscribed = await isUserSubscribed(chatId);

  if (!isSubscribed) {
    bot.sendMessage(chatId, `Please join our channel: ${CHANNEL_USERNAME}`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Join Channel', url: `https://t.me/${CHANNEL_USERNAME.slice(1)}` }],
          [{ text: 'I have joined', callback_data: 'joined' }],
        ],
      },
    });
  } else {
    bot.sendMessage(chatId, 'Welcome back! You can now use the bot features.');
  }
});

// "I have joined" callback handler
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;

  if (query.data === 'joined') {
    const isSubscribed = await isUserSubscribed(chatId);

    if (isSubscribed) {
      bot.sendMessage(chatId, 'Thank you for joining! You can now use the bot features.');
    } else {
      bot.sendMessage(chatId, `You must join our channel: ${CHANNEL_USERNAME}`);
    }
  }
});

// /trim command handler
bot.onText(/\/trim/, async (msg) => {
  const chatId = msg.chat.id;
  const isSubscribed = await isUserSubscribed(chatId);

  if (!isSubscribed) {
    bot.sendMessage(chatId, `Please join our channel: ${CHANNEL_USERNAME} to use this feature.`);
    return;
  }

  bot.sendMessage(chatId, 'Send an audio file and specify the trim range (e.g., "0:00-0:54").');

  bot.once('message', (fileMsg) => {
    handleFileProcessing(fileMsg, chatId, (filePath) => {
      bot.sendMessage(chatId, 'File received. Now send the trim range (e.g., "0:00-0:54").');

      bot.once('message', (rangeMsg) => {
        const range = rangeMsg.text;

        if (/^\d+:\d+-\d+:\d+$/.test(range)) {
          const [start, end] = range.split('-');
          const outputPath = path.join(__dirname, 'downloads', `trimmed_${Date.now()}.mp3`);

          ffmpeg(filePath)
            .setStartTime(start)
            .setDuration(calculateDuration(start, end))
            .output(outputPath)
            .on('end', async () => {
              await bot.sendDocument(chatId, outputPath, { caption: 'Trimmed by @awt_audioeditor_bot' });
              await bot.sendDocument(DB_CHANNEL_ID, outputPath, {
                caption: `Trimmed File by: @${fileMsg.from.username || 'N/A'} (${fileMsg.from.id})`,
              });
              fs.unlinkSync(filePath);
              fs.unlinkSync(outputPath);
            })
            .on('error', (err) => {
              console.error(err);
              bot.sendMessage(chatId, 'An error occurred while trimming the file.');
            })
            .run();
        } else {
          bot.sendMessage(chatId, 'Invalid range format. Please use "0:00-0:54".');
        }
      });
    });
  });
});

// /combine command handler
bot.onText(/\/combine/, async (msg) => {
  const chatId = msg.chat.id;
  const isSubscribed = await isUserSubscribed(chatId);

  if (!isSubscribed) {
    bot.sendMessage(chatId, `Please join our channel: ${CHANNEL_USERNAME} to use this feature.`);
    return;
  }

  combineFiles = []; // Reset files list
  bot.sendMessage(chatId, 'Send the audio files to combine, one by one. Send /done when finished.');
});

// File collector for combining
bot.on('message', async (msg) => {
  if (combineFiles && (msg.audio || msg.voice || msg.document)) {
    handleFileProcessing(msg, msg.chat.id, (filePath) => {
      combineFiles.push(filePath);
      bot.sendMessage(msg.chat.id, 'File added for combining.');
    });
  }
});

// /done command handler for combining
bot.onText(/\/done/, async (msg) => {
  const chatId = msg.chat.id;

  if (combineFiles.length < 2) {
    bot.sendMessage(chatId, 'Please send at least two files to combine.');
    return;
  }

  const outputPath = path.join(__dirname, 'downloads', `combined_${Date.now()}.mp3`);

  const ffmpegCommand = ffmpeg();
  combineFiles.forEach((file) => {
    ffmpegCommand.input(file);
  });

  ffmpegCommand
    .mergeToFile(outputPath)
    .on('end', async () => {
      await bot.sendDocument(chatId, outputPath, { caption: 'Combined by  @awt_audioeditor_bot' });
      await bot.sendDocument(DB_CHANNEL_ID, outputPath, {
        caption: `Combined File by: @${msg.from.username || 'N/A'} (${msg.from.id})`,
      });
      combineFiles.forEach((file) => fs.unlinkSync(file));
      fs.unlinkSync(outputPath);
    })
    .on('error', (err) => {
      console.error(err);
      bot.sendMessage(chatId, 'An error occurred while combining the files.');
    });
});

// /
// /admin broadcast command
bot.onText(/\/broadcast (.+)/, async (msg, match) => {
  if (msg.from.id.toString() === ADMIN_ID) {
    const broadcastMessage = match[1];
    users.forEach((user) => {
      bot.sendMessage(user.id, broadcastMessage).catch((err) => {
        console.error(`Error sending message to ${user.id}:`, err.message);
      });
    });
    bot.sendMessage(msg.chat.id, 'Broadcast sent successfully.');
  } else {
    bot.sendMessage(msg.chat.id, 'You do not have permission to use this command.');
  }
});

// /admin usersinfo command
bot.onText(/\/usersinfo/, async (msg) => {
  if (msg.from.id.toString() === ADMIN_ID) {
    let userInfoMessage = 'Users Information:\n\n';
    users.forEach((user) => {
      userInfoMessage += `Name: ${user.firstName} ${user.lastName}\n`;
      userInfoMessage += `Username: @${user.username}\n`;
      userInfoMessage += `ID: ${user.id}\n`;
      userInfoMessage += `[Go to Profile](tg://user?id=${user.id})\n\n`;
    });
    bot.sendMessage(msg.chat.id, userInfoMessage, { parse_mode: 'Markdown' });
  } else {
    bot.sendMessage(msg.chat.id, 'You do not have permission to use this command.');
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Bot shutting down...');
  bot.stopPolling();
  process.exit(0);
});
