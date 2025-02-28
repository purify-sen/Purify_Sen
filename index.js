require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require("@discordjs/voice");
const scdl = require("soundcloud-downloader").default; // Import soundcloud-downloader

// Tạo client với các intents cần thiết
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
});

// Map lưu trữ queue cho từng guild
const queueMap = new Map();

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// Hàm phát queue cho guild
async function playQueue(guildId) {
  const queue = queueMap.get(guildId);
  if (!queue) return;
  // Nếu hết bài hát trong queue thì dừng và xóa queue
  if (queue.currentIndex >= queue.tracks.length) {
    queue.textChannel.send("Queue đã kết thúc!");
    queue.connection.destroy();
    queueMap.delete(guildId);
    return;
  }
  const track = queue.tracks[queue.currentIndex];
  try {
    const stream = await scdl.download(track.url);
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
  
  // Trả lời tin nhắn đặc biệt
  if (message.content === "Phú có béo không?") {
    return message.channel.send("Béo hơn con lợn!");
  }
  
  const prefix = "sen!";
  if (!message.content.startsWith(prefix)) return;
  
  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  const guildId = message.guild.id;

  // Lệnh info: hiển thị danh sách các lệnh có thể dùng
  if (command === "info") {
    const infoMessage = `
**Danh sách các lệnh có thể dùng:**
+ Lệnh chạy nhạc:
- \`sen!p <soundcloud_url>\` hoặc \`sen!play <soundcloud_url>\`: Thêm bài hát vào danh sách và phát nhạc. Nếu không cung cấp URL, bot sẽ tiếp tục phát nếu đang tạm dừng.
- \`sen!pause\`: Tạm dừng bài hát đang phát.
- \`sen!s\` hoặc \`sen!stop\`: Dừng phát nhạc và xóa danh sách.
- \`sen!q\` hoặc \`sen!queue\`: Hiển thị danh sách các bài hát trong queue.
    `;
    return message.channel.send(infoMessage);
  }
  
  // Lệnh chơi nhạc (alias: "p" và "play")
  if (["p", "play"].includes(command)) {
    // Nếu không có URL được cung cấp, kiểm tra xem có bài nhạc đang bị tạm dừng không để tiếp tục phát
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
    if (!url || !scdl.isValidUrl(url)) {
      return message.channel.send("Link gì thế này? (T chỉ hỗ trợ Soundcloud!)");
    }
    
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
      return message.channel.send("Đào vào kênh thoại mới bật được nhạc chứ!");
    }
    
    try {
      // Nếu guild chưa có queue, tạo mới và tham gia kênh thoại
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
        });
        // Khi track kết thúc, chuyển sang bài tiếp theo trong queue
        player.on(AudioPlayerStatus.Idle, () => {
          const queue = queueMap.get(guildId);
          if (queue) {
            queue.currentIndex++;
            playQueue(guildId);


          }
        });
        player.on("error", (error) => {
          console.error("Lỗi trong player:", error);
          message.channel.send("Đã xảy ra lỗi khi phát bài hát.");
        });
      }
      
      const queue = queueMap.get(guildId);
      
      // Nếu URL là playlist (thường chứa "/sets/")
      if (url.includes("/sets/")) {
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
        // Xử lý trường hợp single track
        let trackInfo;
        try {
          trackInfo = await scdl.getInfo(url);
        } catch {
          trackInfo = { title: url };
        }
        queue.tracks.push({ url: url, title: trackInfo.title });
        message.channel.send(`Đã thêm bài hát: ${trackInfo.title} vào danh sách.`);
      }
      
      // Nếu không có bài nào đang phát, bắt đầu queue
      if (queue.player.state.status !== AudioPlayerStatus.Playing) {
        playQueue(guildId);
      }
      
    } catch (error) {
      console.error("Lỗi khi xử lý lệnh play:", error);
      message.channel.send("Đã xảy ra lỗi khi xử lý lệnh.");
    }
  
  // Lệnh tạm dừng nhạc: "sen!pause"
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
  
  // Lệnh dừng nhạc (alias: "s" và "stop")
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
  
  // Lệnh kiểm tra queue (alias: "q" và "queue")
  } else if (["q", "queue"].includes(command)) {
    if (queueMap.has(guildId)) {
      const queue = queueMap.get(guildId);
      if (queue.tracks.length === 0) {
        message.channel.send("Queue trống!");
      } else {
        let queueMessage = "Queue hiện tại:\n";
        queue.tracks.forEach((track, index) => {
          if (index === queue.currentIndex) {
            queueMessage += `--> Now playing: ${track.title}\n`;
          } else {
            queueMessage += `${index + 1}. ${track.title}\n`;
          }
        });
        message.channel.send(queueMessage);
      }
    } else {
      message.channel.send("Không có nhạc đang phát!");
    }
  }
});

client.login(process.env.TOKEN);


