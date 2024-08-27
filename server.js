require('dotenv').config();
const http = require('http');
const { MongoClient } = require('mongodb');
const { OpenAI } = require('openai');
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
const chatDatabase = 'chatdb';
const namesAndEmailsCollection = 'namesAndEmails';
const messagesCollection = 'messages';
client.connect();

// Flag to control AI vs. Live Support mode
//let isLiveSupportMode = false;

async function callChatBot(str) {
  // if (isLiveSupportMode) {
  //   console.log('AI responses are disabled. Currently in live support mode.');
  //   return 'Live support is active. Please wait for a response.';
  // }

  try {
    const run = await openai.beta.threads.createAndRun({
      assistant_id: process.env.OPENAI_ASSISTANT_ID,
      thread: {
        messages: [{ role: 'user', content: str }],
      },
    });

    console.log('run status: ', run.status);

    let result;
    do {
      // Adding a delay to prevent hitting rate limits
      await new Promise((resolve) => setTimeout(resolve, 2000));

      result = await openai.beta.threads.runs.retrieve(run.thread_id, run.id);

      if (result.status === 'completed') {
        const threadMessages = await openai.beta.threads.messages.list(
          run.thread_id
        );
        const response = threadMessages.data[0]?.content[0]?.text?.value;

        if (response) {
          const cleanedResponse = response.replace(/【\d+:\d+†source】/g, '');

          // Format hyperlinks for Markdown
          const formattedResponse = cleanedResponse.replace(
            /http(s)?:\/\/\S+/g,
            (url) => `[${url}](${url})`
          );

          //console.log(formattedResponse);
          return formattedResponse;
        } else {
          throw new Error('Response structure not as expected.');
        }
      }
      
    } while (result.status !== 'failed');

    console.error('The process failed.');
    return '';
  } catch (error) {
    console.error('An error occurred:', error);
    return '';
  }
}

function currentTime() {
  let d = new Date();
  return d.toString();
}

async function obtainSession(name) {
  const result = await client
    .db(chatDatabase)
    .collection(namesAndEmailsCollection)
    .findOne({
      username: name,
    });
  if (!result) {
    console.error("No user found with the username:", name);
    return null; // or handle the absence of the user appropriately
  }
  return parseInt(result.sessionNumber);
}

function updateStatus(name, status) {
  client
    .db(chatDatabase)
    .collection(namesAndEmailsCollection)
    .findOneAndUpdate(
      {
        username: name,
      },
      { $set: { sessionStatus: status } }
    );
}

async function addNameAndEmail(name, email) {
  client.db(chatDatabase).collection(namesAndEmailsCollection).insertOne({
    username: name,
    userEmail: email,
    sessionNumber: 1,
    sessionStatus: 'default',
  });
}

async function addMessage(name, message, recipient) {
  if (name == 'customerRep' || name == 'chat-bot') {
    // const session = await obtainSession(recipient);
    client.db(chatDatabase).collection(messagesCollection).insertOne({
      sender: name,
      reciever: recipient,
      time: currentTime(),
      session: session,
      messageSent: message,
    });
  } else {
    // const session = await obtainSession(name);
    client.db(chatDatabase).collection(messagesCollection).insertOne({
      sender: name,
      reciever: recipient,
      time: currentTime(),
      session: session,
      messageSent: message,
    });
  }
  unreadMessages.push([name, message, recipient]);
}

async function getLatestMessage(name) {
  const result = await client
    .db(chatDatabase)
    .collection(messagesCollection)
    .find({
      reciever: name,
      sender: 'chat-bot',
    })
    .sort({ time: -1 })
    .limit(1)
    .toArray();

  return result.length > 0 ? result[0].messageSent : null;
}

http
  .createServer(async function (req, res) {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      try {
        body = JSON.parse(body);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
          'Access-Control-Allow-Headers': 'Content-Type',
        });

        switch (body.request) {
          case 'send-message':
            const { type } = body;
            const { latestMessage } = body;
            let feedbackText;
            if (type === 'like') {
              feedbackText = "Our user gave a 👍 on Rebecca's performance.";
            } else if (type === 'dislike') {
              feedbackText = "Our user gave a 👎 on Rebecca's performance.";
            }

            try {
              // const latestMessage = await getLatestMessage(body.name);
              const text = latestMessage
                ? `${feedbackText}\nLatest response from Rebecca: ${latestMessage}`
                : feedbackText;

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
          case 'get-latest-message':
            try {
              const { name } = body;
              const latestMessage = await getLatestMessage(name);
              res.end(JSON.stringify({ latestMessage: latestMessage || '' }));
            } catch (error) {
              console.error('Error fetching latest message:', error);
              res.statusCode = 500;
              res.end(
                JSON.stringify({ error: 'Error fetching latest message' })
              );
            }
            break;
          case 'addUser':
            await addNameAndEmail(body.name, body.email);
            res.end(JSON.stringify({ status: 'success' }));
            break;
          case 'message':
            if (
              body.message ==
              'A customer service representative has taken your call'
            ) {
              updateStatus(body.recipient, 'taken');
            }
            await addMessage(body.name, body.message, body.recipient);
            res.end(JSON.stringify({ status: 'success' }));
            break;
          // case "getSession":
          //   const session = await obtainSession(body.name);
          //   res.end(session.toString());
          //   break;
          case 'callChatBot':
            await addMessage(body.name, body.message, 'chat-bot');
            const response = await callChatBot(body.message);
            await addMessage('chat-bot', response, body.name);
            res.end(response);
            break;
          case 'reloadUsers':
            let updatedPage = [[], [], []];
            let liveResponse = await client
              .db(chatDatabase)
              .collection(namesAndEmailsCollection)
              .find({
                sessionStatus: 'live',
              })
              .toArray();
            liveResponse.forEach(function (x) {
              updatedPage[0].push([x.username, x.userEmail]);
              setTimeout(function () {
                updateStatus(x.username, 'default');
              }, 990);
            });
            let takenResponse = await client
              .db(chatDatabase)
              .collection(namesAndEmailsCollection)
              .find({
                sessionStatus: 'taken',
              })
              .toArray();
            takenResponse.forEach(function (x) {
              updatedPage[1].push(x.username);
              setTimeout(function () {
                updateStatus(x.username, 'default');
              }, 4000);
            });
            let closedResponse = await client
              .db(chatDatabase)
              .collection(namesAndEmailsCollection)
              .find({
                sessionStatus: 'closed',
              })
              .toArray();
            closedResponse.forEach(function (x) {
              updatedPage[2].push(x.username);
              setTimeout(function () {
                updateStatus(x.username, 'default');
              }, 990);
            });
            res.end(JSON.stringify(updatedPage));
            break;
          case 'reloadMessages':
            let updatedMessages = [];
            unreadMessages.forEach((i) => {
              if (i[0] == body.recipient && i[2] == body.name) {
                updatedMessages.push(i[1]);
                unreadMessages.splice(unreadMessages.indexOf(i), 1);
              }
            });
            res.end(JSON.stringify(updatedMessages));
            break;
          case 'addUserToLiveChat':
            updateStatus(body.name, 'live');
            res.end(JSON.stringify({ status: 'success' }));
            break;
          case 'removeUser':
            await client
              .db(chatDatabase)
              .collection(namesAndEmailsCollection)
              .findOneAndUpdate(
                {
                  username: body.name,
                },
                {
                  $inc: { sessionNumber: 1 },
                  $set: { sessionStatus: 'closed' },
                }
              );
            unreadMessages.forEach((i) => {
              if (i[0] == body.name || i[2] == body.name) {
                unreadMessages.splice(unreadMessages.indexOf(i), 1);
              }
            });
            res.end(JSON.stringify({ status: 'success' }));
            break;
          case 'getMessagesDuringSession':
            let sessionMessages = [];
            const messagesResponse = await client
              .db(chatDatabase)
              .collection(messagesCollection)
              .find({
                session: parseInt(body.session),
                $or: [{ sender: body.name }, { reciever: body.name }],
              })
              .toArray();
            messagesResponse.forEach(function (x) {
              if (x.sender == 'customerRep' || x.sender == 'chat-bot') {
                sessionMessages.push(`from247|${x.messageSent}`);
              } else {
                sessionMessages.push(x.messageSent);
              }
            });
            res.end(JSON.stringify(sessionMessages));
            break;

            case "live-support-session":
              //isLiveSupportMode = true;
              try {
                const { messagesFromRebecca } = body;
            
                // Ensure messagesFromRebecca is in the correct format for Slack
                const text = Array.isArray(messagesFromRebecca)
                  ? messagesFromRebecca.join('\n')
                  : messagesFromRebecca;
            
                // Log the message to be sent to Slack
                console.log('Messages to Slack:', text);
            
                // Send the message to Slack
                await slackApp.client.chat.postMessage({
                  token: process.env.SLACK_BOT_TOKEN,
                  channel: process.env.SLACK_CHANNEL,
                  text: text,
                });
            
                // Respond with success
                res.end(JSON.stringify({ status: "Message sent" }));
              } catch (error) {
                console.error('Error sending message to Slack:', error);
            
                // Respond with error
                res.statusCode = 500;
                res.end(JSON.stringify({ error: "Error sending message" }));
              }
              break;

          default:
            res.end(JSON.stringify({ error: 'Invalid request' }));
            break;
        }
      } catch (error) {
        console.error('Error handling request:', error);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal Server Error' }));
        } else {
          res.end();
        }
      }
    });
  })
  .listen(port, () => {
    console.log(`Chatbot and Slack integration listening on port ${port}`);
  });
