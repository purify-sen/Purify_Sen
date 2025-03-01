require("dotenv").config();
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require("@discordjs/voice");
const scdl = require("soundcloud-downloader").default;
const ytdl = require("ytdl-core");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions, // Đảm bảo có intent này
  ],
  partials: ['MESSAGE', 'CHANNEL', 'REACTION'], // Cho phép bot xử lý reaction của message chưa được cache
});

const queueMap = new Map();

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

async function playQueue(guildId) {
  const queue = queueMap.get(guildId);
  if (!queue) return;
  // Nếu đã hết bài trong queue
  if (queue.currentIndex >= queue.tracks.length) {
    if (queue.loop) {
      queue.currentIndex = 0; // Nếu loop toàn bộ được bật, quay lại bài đầu tiên
    } else {
      queue.textChannel.send("Queue đã kết thúc!");
      queue.connection.destroy();
      queueMap.delete(guildId);
      return;
    }
  }
  const track = queue.tracks[queue.currentIndex];
  try {
    let stream;
    // Xử lý stream cho SoundCloud
    if (track.url.includes("soundcloud.com") && scdl.isValidUrl(track.url)) {
      stream = await scdl.download(track.url);
    }
    // Xử lý stream cho YouTube
    else if (ytdl.validateURL(track.url)) {
      stream = ytdl(track.url, { filter: "audioonly" });
    } else {
      queue.textChannel.send(`Link không được hỗ trợ: ${track.url}`);
      queue.currentIndex++;
      return playQueue(guildId);
    }
    if (!stream) {
      queue.textChannel.send(`Không thể tải stream cho bài hát: ${track.title}`);
      queue.currentIndex++;
      return playQueue(guildId);
    }
    const resource = createAudioResource(stream);
    queue.player.play(resource);
    queue.textChannel.send(`Đang phát: ${track.title}`);
  } catch (error) {
    console.error(error);
    queue.textChannel.send(`Lỗi khi phát bài hát: ${track.title}`);
    queue.currentIndex++;
    playQueue(guildId);
  }
}

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  
  if (message.content === "amogus") {
    return message.channel.send("sus");
  }

  if (message.content === "ping?") {
    return message.channel.send("pong!");
  }
  
  const prefix = "sen!";
  if (!message.content.startsWith(prefix)) return;
  
  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  const guildId = message.guild.id;

 if (command === "info") {
  const infoMessage = `
**Danh sách các lệnh có thể dùng:**
+ **Phát nhạc:** 
- \`sen!p / sen!play <soundcloud_url hoặc youtube_url>\`: Thêm bài hát vào danh sách và phát nhạc (nếu không cung cấp URL, bot sẽ tiếp tục phát nếu bị tạm dừng).
- \`sen!pause / sen!unpause\`: Tạm dừng và tiếp tục phát bài hát.
- \`sen!s / sen!stop\`: Dừng phát nhạc và xóa danh sách.
- \`sen!q / sen!queue\`: Hiển thị danh sách các bài hát trong queue.
- \`sen!jump <number>\`: Nhảy đến bài hát thứ <number> trong queue.
- \`sen!skip [<number>]\`: Skip bài hiện tại (hoặc skip <number> bài).
- \`sen!loop / sen!unloop\`: Bật/Tắt chế độ loop cho toàn bộ queue.
- \`sen!looptrack / sen!unlooptrack\`: Bật/Tắt chế độ loop cho bài hát đang chạy.
  `;
  return message.channel.send(infoMessage);
}

  
  if (["p", "play"].includes(command)) {
    if (args.length === 0) {
      if (queueMap.has(guildId)) {
        const queue = queueMap.get(guildId);
        if (queue.player.state.status === AudioPlayerStatus.Paused) {
          queue.player.unpause();
          return message.channel.send("Đã tiếp tục phát bài hát.");
        } else {
          return message.channel.send("Không có bài nhạc nào đang bị tạm dừng.");
        }
      } else {
        return message.channel.send("Không có nhạc nào trong queue.");
      }
    }
    
    const url = args[0];
    if (!url || (!scdl.isValidUrl(url) && !ytdl.validateURL(url))) {
      return message.channel.send("Link gì thế này? (T chỉ hỗ trợ SoundCloud và YouTube!)");
    }
    
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
      return message.channel.send("Đào vào kênh thoại mới bật được nhạc chứ!");
    }
    
    try {
      if (!queueMap.has(guildId)) {
        const connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: message.guild.id,
          adapterCreator: message.guild.voiceAdapterCreator,
        });
        const player = createAudioPlayer();
        connection.subscribe(player);
        queueMap.set(guildId, {
          textChannel: message.channel,
          voiceChannel: voiceChannel,
          connection: connection,
          player: player,
          tracks: [],
          currentIndex: 0,
          jumped: false,
          loop: false,      // Loop toàn bộ queue tắt mặc định
          loopTrack: false, // Loop bài đang chạy tắt mặc định
        });
        player.on(AudioPlayerStatus.Idle, () => {
          const queue = queueMap.get(guildId);
          if (queue) {
            // Nếu bật loop track, giữ nguyên currentIndex để phát lại bài hiện tại
            if (queue.loopTrack) {
              // Không tăng currentIndex
            } else if (queue.jumped) {
              queue.jumped = false;
            } else {
              queue.currentIndex++;
            }
            playQueue(guildId);
          }
        });
        player.on("error", (error) => {
          console.error("Lỗi trong player:", error);
          message.channel.send("Đã xảy ra lỗi khi phát bài hát.");
        });
      }
      
      const queue = queueMap.get(guildId);
      
      // Xử lý playlist của SoundCloud
      if (url.includes("/sets/") && scdl.isValidUrl(url)) {
        const playlistInfo = await scdl.getSetInfo(url);
        if (!playlistInfo || !playlistInfo.tracks || playlistInfo.tracks.length === 0) {
          return message.channel.send("Không tìm thấy bài hát trong playlist!");
        }
        const newTracks = playlistInfo.tracks.map(track => ({
          url: track.permalink_url,
          title: track.title,
        }));
        queue.tracks.push(...newTracks);
        message.channel.send(`Đã thêm playlist: ${playlistInfo.title} với ${playlistInfo.tracks.length} bài hát vào danh sách.`);
      } else {
        let trackInfo = { title: url };
        if (scdl.isValidUrl(url)) {
          try {
            trackInfo = await scdl.getInfo(url);
          } catch {
            trackInfo = { title: url };
          }
        } else if (ytdl.validateURL(url)) {
          try {
            const info = await ytdl.getInfo(url);
            trackInfo = { title: info.videoDetails.title };
          } catch {
            trackInfo = { title: url };
          }
        }
        queue.tracks.push({ url: url, title: trackInfo.title });
        message.channel.send(`Đã thêm bài hát: ${trackInfo.title} vào danh sách.`);
      }
      
      if (queue.player.state.status !== AudioPlayerStatus.Playing) {
        playQueue(guildId);
      }
      
    } catch (error) {
      console.error("Lỗi khi xử lý lệnh play:", error);
      message.channel.send("Đã xảy ra lỗi khi xử lý lệnh.");
    }
  
  } else if (command === "pause") {
    if (queueMap.has(guildId)) {
      const queue = queueMap.get(guildId);
      if (queue.player.state.status === AudioPlayerStatus.Playing) {
        queue.player.pause();
        message.channel.send("Đã tạm dừng bài hát.");
      } else if (queue.player.state.status === AudioPlayerStatus.Paused) {
        message.channel.send("Bài hát đã được tạm dừng rồi.");
      } else {
        message.channel.send("Không có bài hát nào đang phát.");
      }
    } else {
      message.channel.send("Không có nhạc nào trong queue.");
    }
  
  } else if (command === "unpause") {
    if (queueMap.has(guildId)) {
      const queue = queueMap.get(guildId);
      if (queue.player.state.status === AudioPlayerStatus.Paused) {
        queue.player.unpause();
        message.channel.send("Đã tiếp tục phát bài hát.");
      } else if (queue.player.state.status === AudioPlayerStatus.Playing) {
        message.channel.send("Bài hát đang được phát.");
      } else {
        message.channel.send("Không có bài hát nào đang phát.");
      }
    } else {
      message.channel.send("Không có nhạc nào trong queue.");
    }
  
  } else if (["s", "stop"].includes(command)) {
    if (queueMap.has(guildId)) {
      const queue = queueMap.get(guildId);
      queue.tracks = [];
      queue.player.stop();
      queue.connection.destroy();
      queueMap.delete(guildId);
      message.channel.send("Đã dừng phát nhạc và xóa danh sách.");
    } else {
      message.channel.send("Không có nhạc đang phát!");
    }

  } else if (["q", "queue"].includes(command)) {
    if (!queueMap.has(guildId)) {
      return message.channel.send("Không có nhạc đang phát!");
    }
    const queue = queueMap.get(guildId);
    if (queue.tracks.length === 0) {
      return message.channel.send("Queue trống!");
    }
    const itemsPerPage = 10;
    const totalPages = Math.ceil(queue.tracks.length / itemsPerPage);
    let currentPage = 0;
    
    const generateEmbed = (page) => {
      const start = page * itemsPerPage;
      const currentTracks = queue.tracks.slice(start, start + itemsPerPage);
      let description = "";
      currentTracks.forEach((track, index) => {
        const trackNumber = start + index + 1;
        if (trackNumber - 1 === queue.currentIndex) {
          description += `--> Now playing: ${track.title}\n`;
        } else {
          description += `${trackNumber}. ${track.title}\n`;
        }
      });
      return new EmbedBuilder()
        .setTitle("Queue hiện tại")
        .setDescription(description)
        .setFooter({ text: `Trang ${page + 1} / ${totalPages}` });
    };
    
    const queueMsg = await message.channel.send({ embeds: [generateEmbed(currentPage)] });
    
    if (totalPages > 1) {
      try {
        await queueMsg.react("⬅️");
        await queueMsg.react("➡️");
        await queueMsg.react("❗"); // Thêm emote chấm than
      } catch (error) {
        console.error("Không thể thêm reaction:", error);
      }
      
      const filter = (reaction, user) => {
        return ["⬅️", "➡️", "❗"].includes(reaction.emoji.name) && user.id === message.author.id;
      };
      
      const collector = queueMsg.createReactionCollector({ filter, time: 60000 });
      
      collector.on("collect", (reaction, user) => {
        if (reaction.emoji.name === "➡️") {
          if (currentPage < totalPages - 1) {
            currentPage++;
            queueMsg.edit({ embeds: [generateEmbed(currentPage)] });
          }
        } else if (reaction.emoji.name === "⬅️") {
          if (currentPage > 0) {
            currentPage--;
            queueMsg.edit({ embeds: [generateEmbed(currentPage)] });
          }
        } else if (reaction.emoji.name === "❗") {
          // Nhảy thẳng tới trang chứa bài đang phát
          currentPage = Math.floor(queue.currentIndex / itemsPerPage);
          queueMsg.edit({ embeds: [generateEmbed(currentPage)] });
        }
        reaction.users.remove(user.id).catch(console.error);
      });
    }
  
  } else if (command === "jump") {
    if (!queueMap.has(guildId)) {
      return message.channel.send("Không có nhạc trong queue!");
    }
    const queue = queueMap.get(guildId);
    const jumpNumber = parseInt(args[0]);
    if (isNaN(jumpNumber) || jumpNumber < 1 || jumpNumber > queue.tracks.length) {
      return message.channel.send("Số thứ tự không hợp lệ!");
    }
    queue.currentIndex = jumpNumber - 1;
    queue.jumped = true;
    queue.player.stop();
    message.channel.send(`Đã nhảy tới bài thứ ${jumpNumber}: ${queue.tracks[jumpNumber - 1].title}`);
  
  } else if (command === "loop") {
    if (!queueMap.has(guildId)) {
      return message.channel.send("Không có nhạc trong queue!");
    }
    const queue = queueMap.get(guildId);
    queue.loop = true;
    message.channel.send("Đã bật chế độ loop cho queue.");
  
  } else if (command === "unloop") {
    if (!queueMap.has(guildId)) {
      return message.channel.send("Không có nhạc trong queue!");
    }
    const queue = queueMap.get(guildId);
    queue.loop = false;
    message.channel.send("Đã tắt chế độ loop cho queue.");
  
  } else if (command === "looptrack") {
    if (!queueMap.has(guildId)) {
      return message.channel.send("Không có nhạc trong queue!");
    }
    const queue = queueMap.get(guildId);
    queue.loopTrack = true;
    message.channel.send("Đã bật chế độ loop cho bài hát đang chạy.");
  
  } else if (command === "unlooptrack") {
    if (!queueMap.has(guildId)) {
      return message.channel.send("Không có nhạc trong queue!");
    }
    const queue = queueMap.get(guildId);
    queue.loopTrack = false;
    message.channel.send("Đã tắt chế độ loop cho bài hát đang chạy.");
  
  } else if (command === "skip") {
    // Lệnh skip: nếu không có số thì skip 1 bài, nếu có số thì skip số bài đó
    if (!queueMap.has(guildId)) {
      return message.channel.send("Không có nhạc trong queue!");
    }
    const queue = queueMap.get(guildId);
    let skipCount = 1;
    if (args[0]) {
      skipCount = parseInt(args[0]);
      if (isNaN(skipCount) || skipCount < 1) {
        return message.channel.send("Số bài skip không hợp lệ!");
      }
    }
    queue.currentIndex += skipCount;
    queue.jumped = true;
    queue.player.stop();
    message.channel.send(`Đã skip ${skipCount} bài.`);
  }
});

client.login(process.env.TOKEN);