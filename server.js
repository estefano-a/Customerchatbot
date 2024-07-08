require('dotenv').config();
const http = require('http');
const { MongoClient } = require('mongodb');
const { OpenAI } = require("openai");
const { App } = require('@slack/bolt');
const fs = require('fs');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const port = process.env.PORT || 10000;

const slackApp = new App({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  token: process.env.SLACK_BOT_TOKEN,
});

var unreadMessages = [];

// MongoDB constants
const uri = process.env.MONGOD_CONNECT_URI;
const client = new MongoClient(uri);
const chatDatabase = "chatdb";
const namesAndEmailsCollection = "namesAndEmails";
const messagesCollection = "messages";
client.connect();

http.createServer(async function (req, res) {
  let body = "";
  req.on('data', chunk => {
    body += chunk.toString();
  });
  req.on('end', async () => {
    try {
      body = JSON.parse(body);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
        'Access-Control-Allow-Headers': 'Content-Type'
      });

      switch (body.request) {
        case "send-message":
          const { type } = body;
          let text;
          if (type === 'like') {
            text = "Our user gave a 👍 on Rebecca's performance.";
          } else if (type === 'dislike') {
            text = "Our user gave a 👎 on Rebecca's performance.";
          }
          try {
            await slackApp.client.chat.postMessage({
              token: process.env.SLACK_BOT_TOKEN,
              channel: process.env.SLACK_CHANNEL,
              text: text,
            });
            res.end(JSON.stringify({ status: 'Message sent' }));
          } catch (error) {
            console.error(error);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Error sending message' }));
          }
          break;

        // Other cases...
        
        default:
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'Invalid request' }));
      }
    } catch (error) {
      console.error('Error handling request:', error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "Internal Server Error" }));
      } else {
        res.end();
      }
    }
  });
}).listen(port, () => {
  console.log(`Chatbot and Slack integration listening on port ${port}`);
});
