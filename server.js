require('dotenv').config();
const http = require('http');
const express = require('express');
const { MongoClient } = require('mongodb');
const { OpenAI } = require("openai");
const fs = require('fs');
const pkg = require('@slack/bolt');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const { App } = pkg;

const slackApp = new App({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  token: process.env.SLACK_BOT_TOKEN,
});

//trying new code
const bodyParser = require(‘body-parser’); // Add this line if body-parser is not being used already
const app = express();
// Middleware to parse JSON bodies
app.use(express.json()); // Use this for parsing JSON
// Alternatively, if you are using body-parser
app.use(bodyParser.json()); // Use this if using body-parser

const port = process.env.PORT || 10000;
const app = express();
app.use(express.json());

var unreadMessages = [];

// MongoDB constants
const uri = process.env.MONGOD_CONNECT_URI;
const client = new MongoClient(uri);
const chatDatabase = "chatdb";
const namesAndEmailsCollection = "namesAndEmails";
const messagesCollection = "messages";
client.connect();

async function callChatBot(str) {
  try {
    const run = await openai.beta.threads.createAndRun({
      assistant_id: process.env.OPENAI_ASSISTANT_ID,
      thread: {
        messages: [
          { role: "user", content: str },
        ],
      },
    });

    console.log("run status: ", run.status);

    while (
      await openai.beta.threads.runs.retrieve(
        run.thread_id,
        run.id
      ).status != 'failed'
    ) {
      const result = await openai.beta.threads.runs.retrieve(
        run.thread_id,
        run.id
      );

      if (result.status == 'completed') {
        const threadMessages = await openai.beta.threads.messages.list(
          run.thread_id
        );

        const response = threadMessages.data[0].content[0].text.value;
        const cleanedResponse = response.replace(/【\d+:\d+†source】/g, '');
        console.log(cleanedResponse);

        return cleanedResponse;
      }
    }
  } catch (error) {
    console.error('An error occurred:', error);
    return "";
  }
}

function currentTime() {
  let d = new Date()
  return d.toString()
}

async function obtainSession(name) {
  const result = await client.db(chatDatabase).collection(namesAndEmailsCollection).findOne({
    "username": name
  })
  if (!result) {
    console.error("No user found with the username:", name);
    return null;  // or handle the absence of the user appropriately
  }
  return parseInt(result.sessionNumber);
}

function updateStatus(name, status) {
  client.db(chatDatabase).collection(namesAndEmailsCollection).findOneAndUpdate({
    "username": name
  }, { $set: { "sessionStatus": status } }
  )
}

async function addNameAndEmail(name, email) {
  client.db(chatDatabase).collection(namesAndEmailsCollection).insertOne({
    username: name,
    userEmail: email,
    sessionNumber: 1,
    sessionStatus: "default"
  })
}

async function addMessage(name, message, recipient) {
  if (name == "customerRep" || name == "chat-bot") {
    const session = await obtainSession(recipient)
    client.db(chatDatabase).collection(messagesCollection).insertOne({
      sender: name,
      reciever: recipient,
      time: currentTime(),
      session: session,
      messageSent: message
    })
  } else {
    const session = await obtainSession(name)
    client.db(chatDatabase).collection(messagesCollection).insertOne({
      sender: name,
      reciever: recipient,
      time: currentTime(),
      session: session,
      messageSent: message
    })
  }
  unreadMessages.push([name, message, recipient])
}

// Existing HTTP Server routes integrated with Express
app.post('/api', async (req, res) => {
  let body = req.body;
  try {
    switch (body.request) {
      case "addUser":
        addNameAndEmail(body.name, body.email);
        break;
      case "message":
        if (body.message == "A customer service representative has taken your call") {
          updateStatus(body.recipient, "taken")
        }
        await addMessage(body.name, body.message, body.recipient);
        break
      case "getSession":
        session = await obtainSession(body.name)
        res.json(session.toString());
        break
      case "callChatBot":
        await addMessage(body.name, body.message, 'chat-bot')
        response = await callChatBot(body.message)
        await addMessage('chat-bot', response, body.name)
        res.json(response);
        break
      case "reloadUsers":
        let updatedPage = [[], [], []]
        response = await client.db(chatDatabase).collection(namesAndEmailsCollection).find({
          "sessionStatus": "live"
        }).toArray()
        response.forEach(function (x) {
          updatedPage[0].push([x.username, x.userEmail])
          setTimeout(function () {
            updateStatus(x.username, "default")
          }, 990)
        })
        response = await client.db(chatDatabase).collection(namesAndEmailsCollection).find({
          "sessionStatus": "taken"
        }).toArray()
        response.forEach(function (x) {
          updatedPage[1].push(x.username)
          setTimeout(function () {
            updateStatus(x.username, "default")
          }, 4000)
        })
        response = await client.db(chatDatabase).collection(namesAndEmailsCollection).find({
          "sessionStatus": "closed"
        }).toArray()
        response.forEach(function (x) {
          updatedPage[2].push(x.username)
          setTimeout(function () {
            updateStatus(x.username, "default")
          }, 990)
        })
        res.json(updatedPage);
        break;
      case "reloadMessages":
        let updatedMessages = [];
        unreadMessages.forEach((i) => {
          if (i[0] == body.recipient && i[2] == body.name) {
            updatedMessages.push(i[1])
            unreadMessages.splice(unreadMessages.indexOf(i), 1)
          }
        })
        res.json(updatedMessages);
        break;
      case "addUserToLiveChat":
        updateStatus(body.name, "live")
        break;
      case "removeUser":
        client.db(chatDatabase).collection(namesAndEmailsCollection).findOneAndUpdate({
          "username": body.name
        }, {
          $inc: { "sessionNumber": 1 },
          $set: { "sessionStatus": "closed" }
        }
        )
        unreadMessages.forEach((i) => {
          if (i[0] == body.name || i[2] == body.name) {
            unreadMessages.splice(unreadMessages.indexOf(i), 1)
          }
        })
        break
      case "getMessagesDuringSession":
        let sessionMessages = []
        response = await client.db(chatDatabase).collection(messagesCollection).find({
          "session": parseInt(body.session),
          $or: [{ "sender": body.name }, { "reciever": body.name }]
        }).toArray()
        console.log(response)
        response.forEach(function (x) {
          if (x.sender == "customerRep" || x.sender == "chat-bot") {
            sessionMessages.push(`from247|${x.messageSent}`)
          } else {
            sessionMessages.push(x.messageSent)
          }
        })
        res.json(sessionMessages);
        break;
      default:
        res.status(400).send('Invalid request');
    }
  } catch (error) {
    console.error('Error handling request:', error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Slack Integration Route
app.post('/send-message', async (req, res) => {
  const { type } = req.body;

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
    res.status(200).send('Message sent');
  } catch (error) {
    console.error(error);
    res.status(500).send('Error sending message');
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Chatbot and Slack integration listening on port ${port}`);
});
