const log = require("npmlog");
const cron = require("cron");

const Discord = require("discord.js");
const prefix = "!";
const client = new Discord.Client({ intents: ["GUILDS", "GUILD_MESSAGES"] });

const token = process.env.TOKEN;

const mysql = require("mysql2");
const connection = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USERNAME,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DBNAME,
  multipleStatements: true,
});

/*
---------------------------------------
Bot commands
---------------------------------------
*/

client.on("ready", () => {
  log.info("Ready");
  client.user.setActivity("刷LeetCode");

  // Start scheduled tasks
  let weeklyRanking = new cron.CronJob("0 0 23 * * SUN", function () {
    getWeeklyResult(function (leaders) {
      let juanWang = "本周的卷王是：";
      let length = Math.min(3, leaders.length);
      for (let i = 0; i < length; i++) {
        juanWang += `${leaders[i].username}(${leaders[i].num}) `;
      }
      client.channels.cache.get(process.env.CHANNEL_ID).send(juanWang);
    });
  });
  weeklyRanking.start();

  let dailyReminder = new cron.CronJob("0 0 15 * * *", function () {
    client.channels.cache
      .get(process.env.CHANNEL_ID)
      .send("@everyone, 今天你刷题了吗?");
  });
  dailyReminder.start();
});

client.on("messageCreate", (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/g);
  const command = args.shift().toLowerCase();

  // Daily check in
  if (command === "checkin") {
    let arg = args[0];
    let num = Number(arg);
    if (Number.isInteger(num)) {
      if (num > 20) {
        message.reply("别卷了别卷了(一天做多打卡20题)");
      } else if (num > 0) {
        // Here we save user's response to database
        // and show a prompt
        saveResult(message.author.id, message.author.username, num, message);
      } else if (num === 0) message.reply("今天没刷题，你不心痛吗？");
      else message.reply("这位更是个...");
    } else message.reply("这位更是个...");
  }


  /*
  // Another check in command - will augment result
  if (command === "checkin2") {
    let arg = args[0];
    let num = Number(arg);
    if (Number.isInteger(num)) {
      if (num > 0) {
        // Here we save user's response to database
        // and show a prompt
        saveResultAdd(message.author.id, message.author.username, num, message);
      } else if (num === 0) message.reply("今天没刷题，你不心痛吗？");
      else message.reply("这位更是个...");
    } else message.reply("这位更是个...");
  }
  */
  
  if (command === "help") {
    message.reply(
      "!checkin count: 打卡今日做题数量，会覆盖今天的记录\n!leaders: 显示本周前三卷王"
    );
  }
  

  // Clear daily record in case mistakenly input wrong number
  if (command === "clear") {
    clearResult(message.author.id);
    message.reply("今天的记录已清空！");
  }

  // Show leaderboard
  if (command === "leaders") {
    sendWeeklyReport(message);
  }

  if (command === "test") {
    message.channel.send("test");
  }

  // if (command === "reply") {
  //   message.channel.send(`<@${message.author.id}> 今天你刷题了吗?`);
  // }
});

/*
---------------------------------------
Functions needed for commands
---------------------------------------
*/

// Save records to database (using logic of augmenting)
// Decide not to use
function saveResultAdd(userId, username, numProbs, message) {
  getPrevRecord(userId, function (num) {
    let result = parseInt(numProbs) + parseInt(num);
    if (num === 0) {
      connection.query(
        `
        INSERT INTO user_record (user_id, username, num_probs) VALUES (?, ?, ?)
        `,
        [userId, username, result],
        function (err, result) {
          if (err) log.error(err);
        }
      );
    } else {
      connection.query(
        `
        UPDATE user_record SET num_probs = ?
        WHERE user_id = ? AND DATE(CONVERT_TZ(timestamp, 'UTC', 'America/Los_Angeles')) = DATE(CONVERT_TZ(CURRENT_TIMESTAMP, 'UTC', 'America/Los_Angeles'))
        `,
        [result, userId],
        function (err, result) {
          if (err) log.error(err);
        }
      );
    }
    message.reply(
      `${message.author.username}, 打卡成功！你今天做了${result}题，你太牛了!`
    );
  });
}

// Save records to database (using logic of replacing)
function saveResult(userId, username, numProbs, message) {
  message.reply(
    `${message.author.username}, 打卡成功！你今天做了${numProbs}题，你太牛了!`
  );
  getPrevRecord(userId, function (num) {
    if (num === 0) {
      connection.query(
        `
        INSERT INTO user_record (user_id, username, num_probs) VALUES (?, ?, ?)
        `,
        [userId, username, numProbs],
        function (err, result) {
          if (err) log.error(err);
        }
      );
    } else {
      connection.query(
        `
        UPDATE user_record SET num_probs = ?
        WHERE user_id = ? AND DATE(CONVERT_TZ(timestamp, 'UTC', 'America/Los_Angeles')) = DATE(CONVERT_TZ(CURRENT_TIMESTAMP, 'UTC', 'America/Los_Angeles'))
        `,
        [numProbs, userId],
        function (err, result) {
          if (err) log.error(err);
        }
      );
    }
  });
}

// Retrieve user's daily record
function getPrevRecord(userId, callback) {
  connection.query(
    `
    SELECT num_probs FROM user_record
    WHERE user_id = ? AND DATE(CONVERT_TZ(timestamp, 'UTC', 'America/Los_Angeles')) = DATE(CONVERT_TZ(CURRENT_TIMESTAMP, 'UTC', 'America/Los_Angeles'))
    `,
    [userId],
    function (err, result) {
      if (err) log.error(err);
      if (result.length === 0) callback(0);
      else callback(result[0].num_probs);
    }
  );
}

function clearResult(userId) {
  connection.query(
    `
    DELETE FROM user_record
    WHERE user_id = ? AND DATE(CONVERT_TZ(timestamp, 'UTC', 'America/Los_Angeles')) = DATE(CONVERT_TZ(CURRENT_TIMESTAMP, 'UTC', 'America/Los_Angeles'))
    `,
    [userId],
    function (err, result) {
      if (err) log.error(err);
    }
  );
}

function sendWeeklyReport(message) {
  getWeeklyReport(function (leaders) {
    let juanWang = "本周的卷王是：";
    let length = Math.min(3, leaders.length);
    for (let i = 0; i < length; i++) {
      juanWang += `${leaders[i].username}(${leaders[i].num}) `;
    }
    message.reply(juanWang);
  });
}

function getWeeklyReport(callback) {
  connection.query(
    `
    SELECT username, num
    FROM (
      SELECT row_num, num
      FROM (
        SELECT user_id, SUM(num_probs) AS num
        FROM user_record
        WHERE DATE(CONVERT_TZ(timestamp, 'UTC', 'America/Los_Angeles'))
        BETWEEN DATE_SUB(DATE(CONVERT_TZ(CURRENT_TIMESTAMP, 'UTC', 'America/Los_Angeles')), INTERVAL(WEEKDAY(CURRENT_DATE)) DAY)
        AND DATE(CONVERT_TZ(CURRENT_TIMESTAMP, 'UTC', 'America/Los_Angeles'))
        GROUP BY user_id
      ) user_prob
      JOIN (
        SELECT user_id, MAX(id) AS row_num
        FROM user_record
        WHERE DATE(CONVERT_TZ(timestamp, 'UTC', 'America/Los_Angeles'))
        BETWEEN DATE_SUB(DATE(CONVERT_TZ(CURRENT_TIMESTAMP, 'UTC', 'America/Los_Angeles')), INTERVAL(WEEKDAY(CURRENT_DATE)) DAY)
        AND DATE(CONVERT_TZ(CURRENT_TIMESTAMP, 'UTC', 'America/Los_Angeles'))
        GROUP BY user_id
      ) record
      ON user_prob.user_id = record.user_id
    ) temp
    JOIN user_record
    ON temp.row_num = user_record.id
    ORDER BY num DESC
    `,
    function (err, result) {
      if (err) log.error(err);
      else callback(result);
    }
  );
}

client.login(token);
