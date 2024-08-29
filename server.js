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

// Slack configuration
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
const helpDeskChannel = process.env.HELP_DESK_CHANNEL;
const channels = [
  process.env.REBECCA_SUPPORT_1,
  process.env.REBECCA_SUPPORT_2,
  process.env.REBECCA_SUPPORT_3,
  process.env.REBECCA_SUPPORT_4,
  process.env.REBECCA_SUPPORT_5,
];
const channelOccupied = [false, false, false, false, false];
const connectedClients = [];
const waitingSockets = [];

// Define ClientConnection class
function ClientConnection(ws, channelIndex) {
  this.websocket = ws;
  this.channelIndex = channelIndex;
}

// WebSocket server setup (listen to port 2000)
const wss = new WebSocket.Server({ port: 2000 });

wss.on('connection', (ws) => {
  console.log('New WebSocket connection established');

  ws.on('message', async (message) => {
    try {
      const incomingMessage = message.toString();
      console.log('Message Received:', incomingMessage);

      // Split incoming message to get channel ID and message content
      let [channelId, ...msgs] = incomingMessage.split(':');
      let msg = msgs.join('');

      // Check if message came from a client
      if (!channels.includes(channelId) && channelId !== helpDeskChannel) {
        if (isConnected(ws)) {
          let channelIndex = findChannelIndex(ws);
          if (channelIndex === -1) return;

          channelId = channels[channelIndex];
          await send_to_slack_api(channelId, msg);
        } else {
          attemptToConnect(ws);
          if (isConnected(ws)) {
            let clientIndex = getClientIndex(ws);
            let client = connectedClients[clientIndex];
            channelId = channels[client.channelIndex];

            await send_to_slack_api(channelId, msg);
            let notificationMessage = `<!channel> We have a new chat in room: <%23${channelId}|>`;
            await send_to_slack_api(helpDeskChannel, notificationMessage);
          }
        }
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
    }
  });

  ws.on('close', () => {
    handleClientDisconnection(ws);
  });
});

// Slack event handler
slackClient.on('message', async (event) => {
  // Handle only messages sent in the monitored channels
  if (channels.includes(event.channel)) {
    let channelIndex = channels.indexOf(event.channel);
    let connectedClient = connectedClients.find(
      (client) => client.channelIndex === channelIndex
    );

    if (connectedClient && connectedClient.websocket.readyState === WebSocket.OPEN) {
      // Send the received Slack message back to the client
      connectedClient.websocket.send(event.text);
      console.log('Successfully sent to client:', event.text);
    }
  }
});

// Function to send messages to Slack
async function send_to_slack_api(channelId, msg) {
  try {
    const result = await slackClient.chat.postMessage({
      channel: channelId,
      text: msg,
    });

    console.log('Message Sent to Slack channel:', channelId);
    console.log('Message content:', msg);

    // Check if a reply is required and handle it as needed
    if (result.message && result.message.text) {
      // Handle the Slack message if it needs to be processed further
    }
  } catch (error) {
    console.error('Error sending message to Slack:', error);
  }
}

// Helper function to handle client disconnection
function handleClientDisconnection(ws) {
  if (isConnected(ws)) {
    let index = getClientIndex(ws);
    if (index !== -1) {
      let channelIndex = findChannelIndex(ws);
      connectedClients.splice(index, 1);

      if (waitingSockets.length > 0) {
        let waitingSocket = waitingSockets.shift();
        let newClient = new ClientConnection(waitingSocket, channelIndex);
        connectedClients.push(newClient);
        console.log('Waiting user connected');
      } else {
        channelOccupied[channelIndex] = false;
      }
    }
  } else {
    let index = waitingSockets.indexOf(ws);
    if (index !== -1) {
      waitingSockets.splice(index, 1);
      console.log('Waiting user disconnected');
    }
  }
}

// Helper function to check if a client is connected
function isConnected(ws) {
  return connectedClients.some((client) => client.websocket === ws);
}

// Function to connect the WebSocket client
function attemptToConnect(ws) {
  for (let i = 0; i < channelOccupied.length; i++) {
    if (!channelOccupied[i]) {
      let clientConnection = new ClientConnection(ws, i);
      connectedClients.push(clientConnection);
      channelOccupied[i] = true;
      console.log('Successfully connected socket to channel');
      return;
    }
  }
  waitingSockets.push(ws);
  console.log('Socket pushed to waiting list');
}

// Function to find the channel index for a WebSocket
function findChannelIndex(ws) {
  let client = connectedClients.find((client) => client.websocket === ws);
  return client ? client.channelIndex : -1;
}

// Function to get the client index for a WebSocket
function getClientIndex(ws) {
  return connectedClients.findIndex((client) => client.websocket === ws);
}



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
            case "live-support-session":
              try {
                const { messagesFromRebecca } = body;
            
                // Ensure messagesFromRebecca is in the correct format for Slack
                const text = Array.isArray(messagesFromRebecca)
                  ? messagesFromRebecca.join('\n')
                  : messagesFromRebecca;
            
                // Log the message to be sent to Slack
                console.log('Messages to Slack:', text);
            
                // Attempt to connect and send a message to an available channel
                attemptToConnect(global.wss); // This will connect WebSocket if not already connected
            
                // Find an available channel and send the message
                const availableChannelIndex = global.channelOccupied.indexOf(false);
                if (availableChannelIndex !== -1) {
                  const availableChannel = slackChannels[availableChannelIndex];
                  send_to_slack_api(availableChannel, text);
                  console.log(`Message sent to available Slack channel: ${availableChannel}`);
                } else {
                  console.log('No available channels. Adding to waiting queue.');
                }
            
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
