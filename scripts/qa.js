/*
 * Description:
 *   A QA Automation Sample.
 *
 * Dependencies:
 *   "async": "0.9.0"
 *   "request": "^2.75.0"
 *   "hubot-conversation": "1.1.1"
 *   "googleapis": "^14.1.0"
 *   "wercker-client": "0.0.4"
 *
 * Commands:
 *   android qa - Prepare QA automatically.
 *
 * Author:
 *    horie1024
*/
const request = require('request');
const async = require('async');
const Conversation = require('hubot-conversation');
const google = require('googleapis');
const drive = google.drive('v3');
const Wercker = require('wercker-client').default;

// google apis
const clientEmail = "";
const privateKey = "";
const masterSheetsId = "";
const permissionDomain = "";

// GitHub API
const gitHubToken = "";
const gitHubOwner = "";
const gitHubRepo = "";

// Qiita API
const team = "";
const qiitaToken = "";

// Wercker API
const werckerToken = "";
const targetBranch = "";
const targetPipelineId = "";

const releaseNoteTemplate = (prev) => {
  return `
# リリース日
* ${prev.releaseDate}

# QA
* 期限
  * ${prev.qaPeriod}

* QAシート
  * ${prev.sheetsUrl}

# 更新内容
  ${prev.releaseNote}
`;
}

// Authorizing and authenticating
const jwtClient = new google.auth.JWT(
  clientEmail,
  null,
  privateKey,
  ['https://www.googleapis.com/auth/drive'],
  null);

module.exports = (robot) => {

  const conversation = new Conversation(robot);

  robot.hear(/^android\s+qa$/, (msg) => {

    async.waterfall([
      (callback) => {

        // Slackに通知
        msg.reply("リリースするVersion Nameを入力してください。");

        // Version Nameの入力を待機
        var dialog = conversation.startDialog(msg);
        dialog.addChoice(/([0-9]*\.[0-9]*\.[0-9]*)/, (conversationMsg) => {
          callback(null, conversationMsg.match[1]);
        });
      },
      (versionName, callback) => {

        // コピーの作成
        drive.files.copy({auth: jwtClient, fileId: masterSheetsId}, (err, res) => {
          if (err) {
            callback(err, null);
          } else {
            callback(null, {
              versionName: versionName,
              sheetsId: res.id
            });
          }
        });
      },
      (prev, callback) => {

        // タイトルの更新
        drive.files.update({auth: jwtClient, fileId: prev.sheetsId,
          resource: {
            name: `Android ver ${prev.versionName} QA Sheet`
          }}, (err, res) => {
            if(err) {
              callback(err, null);
            } else {
              callback(null, prev);
            }
          });
      },
      (prev, callback) => {

        var sheetsUrl = `https://docs.google.com/spreadsheets/d/${prev.sheetsId}`;
        msg.send("QAシートを作成しました。");
        msg.send(sheetsUrl);

        // ファイルのアクセス権限を変更
        drive.permissions.create({auth: jwtClient, fileId: prev.sheetsId,
          resource: {
            type: "domain",
            role: "writer",
            domain: permissionDomain
          }}, (err, res) => {
            if(err) {
              callback(err, null);
            } else {
              callback(null, {sheetsUrl: sheetsUrl, versionName: prev.versionName})
            }
          });
      },
      (prev, callback) => {

        // GitHubからリリースノートを取得
        const gitHub = new GitHub(gitHubToken, gitHubOwner, gitHubRepo);
        gitHub.release((err, res) => {
          if(err) {
            callback(err, null);
          } else {
            prev.releaseNote = res[0].body;
            callback(null, prev)
          }
        });
      },
      (prev, callback) => {

        // リリース日入力
        msg.reply("リリース日を入力してください。");

        var dialog = conversation.startDialog(msg);
        dialog.addChoice(/(.*)/i, (conversationMsg) => {
          prev.releaseDate = conversationMsg.match[1];
          callback(null, prev);
        });
      },
      (prev, callback) => {

        // QA期間入力
        msg.reply("QA期間を入力してください。");

        var dialog = conversation.startDialog(msg);
        dialog.addChoice(/(.*)/i, (conversationMsg) => {
          prev.qaPeriod = conversationMsg.match[1];
          callback(null, prev);
        });
      },
      (prev, callback) => {

        const qiita = new Qiita({team: team, token: qiitaToken});
        params = {
          title: `Android ${prev.versionName} リリースノート`,
          body: releaseNoteTemplate(prev),
          coediting: true,
          tags: [{name: "リリースノート"}, {name: "Android"}]
        };

        qiita.createItem(params, (err, res) => {
          if(err) {
            callback(err, null);
          } else {
            msg.send("リリースノートを作成しました。");
            msg.send(res.url);
            callback(null, prev);
          }
        });
      },
      (prev, callback) => {

        // wercker
        const wercker = new Wercker({token: werckerToken});
        wercker.Runs.triggerNewRun({
          pipelineId: targetPipelineId,
          branch: targetBranch,
          envVars: [
            {
              "key": "DIST",
              "value": "true"
            },
            {
              "key": "NOTES",
              "value": prev.releaseNote
            }
          ]
        }).then((res) => {
          callback(null, res);
        }).catch((err) => {
          callback(err, null);
        })
      }], (err, done) => {
        if (err) {
          console.log(err);
          msg.send("リリースノートの作成に失敗しました。");
        } else {
          msg.send("APKの配布中です。")
        }
      });
    });
}

class GitHub {

  constructor(token, owner, repo) {
    this.urlBase = `https://api.github.com/repos/${owner}/${repo}/`;
    this.options = {
      headers: {
        "Authorization": `token ${token}`,
        "Content-Type": "application/json; charset=utf-8",
        "User-Agent": "Hubot"
      }
    };
  }

  release(callback) {
      this.options.url = `${this.urlBase}releases`;

      var options = {
        url: `${this.urlBase}releases`,
        headers: this.options.headers
      };

      request.get(options, (err, res, body) => {
        var _body = JSON.parse(body);
        if(_body.message) {
          callback(_body, null);
        } else {
          callback(null, _body);
        }
      });
  }
}

class Qiita {
  constructor(params) {
    this.urlBase = `https://${params.team}.qiita.com`;
    this.options = {
      headers: {
        "Authorization": `Bearer ${params.token}`,
        "Content-Type": "application/json; charset=utf-8",
        "User-Agent": "Hubot"
      }
    };
  }

  createItem(params, callback) {

    var options = {
      url: `${this.urlBase}/api/v2/items`,
      headers: this.options.headers,
      body: JSON.stringify(params)
    };

    request.post(options, (err, res, body) => {
      var _body = JSON.parse(body);
      if (_body.message) {
        callback(_body, null);
      } else {
        callback(null, _body);
      }
    });
  }
}
