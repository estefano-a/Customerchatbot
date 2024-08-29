require('dotenv').config();
const http = require('http');
const { MongoClient } = require('mongodb');
const { OpenAI } = require('openai');
const { App } = require('@slack/bolt');
const { WebClient } = require('@slack/web-api');
const WebSocket = require('ws');
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

async function callChatBot(str) {
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
          /*const formattedResponse = cleanedResponse.replace(
            /http(s)?:\/\/\S+/g,
            (url) => `[${url}](${url})`
          );

          //console.log(formattedResponse);*/
          return cleanedResponse;
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

// async function obtainSession(name) {
//   const result = await client
//     .db(chatDatabase)
//     .collection(namesAndEmailsCollection)
//     .findOne({
//       username: name,
//     });
//   if (!result) {
//     console.error("No user found with the username:", name);
//     return null; // or handle the absence of the user appropriately
//   }
//   return parseInt(result.sessionNumber);
// }

function updateStatus(name, status) {
  client
    .db(chatDatabase)
    .collection(namesAndEmailsCollection)
    .findOneAndUpdate(
      {
        username: name,}
      //},
      // { $set: { sessionStatus: status } }
    );
}

async function addNameAndEmail(name, email) {
  client.db(chatDatabase).collection(namesAndEmailsCollection).insertOne({
    username: name,
    userEmail: email,
    // sessionNumber: 1,
    // sessionStatus: 'default',
  });
}

async function addMessage(name, message, recipient) {
  if (name == 'customerRep' || name == 'chat-bot') {
    // const session = await obtainSession(recipient);
    client.db(chatDatabase).collection(messagesCollection).insertOne({
      sender: name,
      reciever: recipient,
      time: currentTime(),
      //session: session,
      messageSent: message,
    });
  } else {
    // const session = await obtainSession(name);
    client.db(chatDatabase).collection(messagesCollection).insertOne({
      sender: name,
      reciever: recipient,
      time: currentTime(),
      //session: session,
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

//Websocket code added 8/29/24

// Define Slack channels and WebSocket connections
const channels = {
  [process.env.REBECCA_SUPPORT_1]: null,
  [process.env.REBECCA_SUPPORT_2]: null,
  [process.env.REBECCA_SUPPORT_3]: null,
  [process.env.REBECCA_SUPPORT_4]: null,
  [process.env.REBECCA_SUPPORT_5]: null,
};

// Set up the WebSocket server
const wss = new WebSocket.Server({ port: 2000 });

wss.on('connection', (ws) => {
  console.log('New WebSocket connection established');

  ws.on('message', (message) => {
    console.log('Message received from client:', message.toString());

    // Handle client connecting to a channel
    if (message.toString().startsWith('connect:')) {
      const channelId = message.toString().split(':')[1];

      // Associate this WebSocket client with the Slack channel
      if (channels[channelId] !== undefined) {
        channels[channelId] = ws;
        console.log(`WebSocket client associated with Slack channel: ${channelId}`);
      }
    }
  });

  ws.on('close', () => {
    // Handle WebSocket disconnection
    Object.keys(channels).forEach((channelId) => {
      if (channels[channelId] === ws) {
        channels[channelId] = null;
        console.log(`WebSocket client disconnected from Slack channel: ${channelId}`);
      }
    });
  });
});

// Slack event handler to listen for messages in channels
slackApp.message(async ({ message, say }) => {
  try {
    const { text, channel } = message;

    // Check if the message is from one of the monitored channels
    if (channels[channel]) {
      const wsClient = channels[channel];

      // Ensure the WebSocket client is connected
      if (wsClient && wsClient.readyState === WebSocket.OPEN) {
        // Send the Slack message to the WebSocket client
        wsClient.send(`Slack says: ${text}`);
        console.log(`Message sent to WebSocket client for channel ${channel}: ${text}`);
      } else {
        console.log(`No WebSocket client connected for channel ${channel}`);
      }
    }
  } catch (error) {
    console.error('Error handling Slack message event:', error);
  }
});



// End of Websocket code




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

            // Updated case "live-support-session" 8/29/24
            
        // Updated case "live-support-session"
        case 'live-support-session':
          try {
            const { messagesFromRebecca } = body;
        
            // Ensure messagesFromRebecca is in the correct format for Slack
            const text = Array.isArray(messagesFromRebecca)
              ? messagesFromRebecca.join('\n')
              : messagesFromRebecca;
        
            // Log the message to be sent to Slack
            console.log('Messages to Slack:', text);
        
            // Find an available Slack channel to connect to
            const availableChannel = Object.keys(channels).find(
              (channelId) => channels[channelId] === null
            );
        
            if (availableChannel) {
              // Send the message to Slack
              await slackApp.client.chat.postMessage({
                token: process.env.SLACK_BOT_TOKEN,
                channel: availableChannel,
                text: text,
              });
        
              // Send a notification to the SLACK_CHANNEL to alert about the new session
              const notificationMessage = `We have a new chat in room: <#${availableChannel}>.`;
              await slackApp.client.chat.postMessage({
                token: process.env.SLACK_BOT_TOKEN,
                channel: process.env.SLACK_CHANNEL, // Use the environment variable for the notification channel
                text: notificationMessage,
              });
        
              // Connect the WebSocket client to this channel
              if (wss.clients.size > 0) {
                // Send a connection command to all clients
                wss.clients.forEach((client) => {
                  if (client.readyState === WebSocket.OPEN) {
                    client.send(`connect:${availableChannel}`);
                    channels[availableChannel] = client; // Link the WebSocket client to the Slack channel
                    console.log(`Client connected to channel: ${availableChannel}`);
                  }
                });
              }
        
              res.end(JSON.stringify({ status: 'Message sent and client connected' }));
            } else {
              console.log('No available channels. Adding to waiting queue.');
              res.end(JSON.stringify({ status: 'No available channels' }));
            }
          } catch (error) {
            console.error('Error handling live-support-session:', error);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Error sending message' }));
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

// Start Slack Bolt app
(async () => {
  await slackApp.start(process.env.PORT || 3000);
  console.log('⚡️ Slack Bolt app is running!');
})();
