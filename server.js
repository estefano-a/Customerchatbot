require('dotenv').config();
const http = require('http');
const https = require('https');
const { MongoClient } = require('mongodb');
const { OpenAI } = require('openai');
const { App } = require('@slack/bolt');
const { WebClient } = require('@slack/web-api');
const WebSocket = require('ws');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const httpPort = process.env.HTTP_PORT || 10000; // HTTP server port
const slackPort = process.env.SLACK_BOLT_PORT || 3000; // Slack Bolt app port

const slackApp = new App({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  token: process.env.SLACK_BOT_TOKEN,
});

const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

var unreadMessages = [];

// MongoDB constants
const uri = process.env.MONGOD_CONNECT_URI;
const client = new MongoClient(uri);
const chatDatabase = 'chatdb';
const namesAndEmailsCollection = 'namesAndEmails';
const messagesCollection = 'messages';
client.connect();

// Function to handle Slack messages
slackApp.message(async ({ message }) => {
  const slackMessage = message.text; // Get the text of the message from Slack

  // Broadcast the Slack message to all WebSocket clients
  if (wss.clients.size > 0) {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(slackMessage); // Send Slack message to all WebSocket clients
        console.log(`Message sent to client: ${slackMessage}`);
      }
    });
  }
});

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



// HTTP server setup
const server = http.createServer(async function (req, res) {
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

              await slackClient.chat.postMessage({
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
        
             const availableChannelIndex = channels.findIndex(
              (channelId, index) => !channelOccupied[index]
            );

            if (availableChannelIndex !== -1) {
              const availableChannel = channels[availableChannelIndex];

              await slackClient.chat.postMessage({
                channel: availableChannel,
                text: text,
              });
        
              // Send a notification to the SLACK_CHANNEL to alert about the new session
              const notificationMessage = `We have a new chat in room: <#${availableChannel}>.`;
              await slackClient.chat.postMessage({
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
  

// WebSocket and client connection management
const connectedClients = [];
const waitingSockets = [];
const channels = [
  process.env.REBECCA_SUPPORT_1,
  process.env.REBECCA_SUPPORT_2,
  process.env.REBECCA_SUPPORT_3,
  process.env.REBECCA_SUPPORT_4,
  process.env.REBECCA_SUPPORT_5,
];
const channelOccupied = [false, false, false, false, false];

const helpDeskChannel = process.env.SLACK_CHANNEL; // Slack help desk channel

// Define client connection constructor
function ClientConnection(ws, channelIndex) {
    this.websocket = ws;
    this.channelIndex = channelIndex;
}

// Set up the WebSocket server using the existing HTTP server
const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', function (request, socket, head) {
  wss.handleUpgrade(request, socket, head, function (ws) {
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', (ws) => {
    console.log('New WebSocket connection established');

    ws.on('message', (message) => {
        console.log('Message received from client:', message.toString());

        const incomingMessage = message.toString();
        let [channelId, ...msgs] = incomingMessage.split(":");
        console.log("Channel ID: " + String(channelId));

        let channelIndex = channels.indexOf(channelId);
        let msg = msgs.join("");

        if (channelIndex === -1 && channelId !== helpDeskChannel) {
            console.log("Message sent from a client");

            if (isConnected(ws)) {
                console.log("Client is connected already");
                channelIndex = findChannelIndex(ws);

                if (channelIndex === -1) return;
                channelId = channels[channelIndex];
                send_to_slack(channelId, msg);
                console.log("Successfully sent to slack channel");
            } else {
                attemptToConnect(ws);
                if (isConnected(ws)) {
                    let clientIndex = getClientIndex(ws);
                    let client = connectedClients[clientIndex];
                    channelId = channels[client.channelIndex];
                    send_to_slack(channelId, msg);
                    send_to_slack(helpDeskChannel, `<!channel> We have a new chat in room: <#${channelId}>`);
                }
            }
        } else {
            console.log("Message came from slack");
            for (let i = 0; i < connectedClients.length; i++) {
                let client = connectedClients[i];
                if (channelId === channels[client.channelIndex]) {
                    client.websocket.send(msg);
                    console.log("Successfully sent to client");
                }
            }
        }
    });

    ws.on('close', function () {
        console.log('WebSocket connection closed');
        if (isConnected(ws)) {
            let index = getClientIndex(ws);
            if (index !== -1) {
                let channelIndex = findChannelIndex(ws);
                connectedClients.splice(index, 1);
                console.log("Connected user disconnected");

                if (waitingSockets.length > 0) {
                    let waitingSocket = waitingSockets[0];
                    let newClient = new ClientConnection(waitingSocket, channelIndex);
                    connectedClients.push(newClient);
                    waitingSockets.splice(0, 1);
                    console.log("Waiting user connected");
                } else {
                    channelOccupied[channelIndex] = false;
                }
            }
        } else {
            let index = waitingSockets.indexOf(ws);
            if (index !== -1) {
                waitingSockets.splice(index, 1);
                console.log("Waiting user disconnected");
            }
        }
    });
  ws.on('error', function (error) {
        console.error('WebSocket error:', error);
    });
});

// Function to send a message to Slack using WebClient
async function send_to_slack(channelId, msg) {
  try {
    await slackClient.chat.postMessage({
      channel: channelId,
      text: msg,
    });
    console.log('Message Sent to channel: ' + String(channelId));
    console.log(`Message content: ${msg}`);
  } catch (error) {
    console.error('Error sending message to Slack:', error);
  }
}

function isConnected(ws) {
    for (let i = 0; i < connectedClients.length; i++) {
        let clientConnection = connectedClients[i];
        if (ws === clientConnection.websocket) {
            console.log("Socket is connected already");
            return true;
        }
    }
    console.log("Socket has not yet connected");
    return false;
}

function attemptToConnect(ws) {
    console.log("Attempting to connect client...");
    for (let i = 0; i < channelOccupied.length; i++) {
        if (!channelOccupied[i]) {
            let clientConnection = new ClientConnection(ws, i);
            connectedClients.push(clientConnection);
            channelOccupied[i] = true;
            console.log("Successfully connected socket to channel");
            return;
        }
    }
    console.log("Socket pushed to waiting list");
    waitingSockets.push(ws);
}

function findChannelIndex(ws) {
    for (let i = 0; i < connectedClients.length; i++) {
        let socket = connectedClients[i];
        if (ws === socket.websocket) {
            return socket.channelIndex;
        }
    }
    console.log("Channel Index not found");
    return -1;
}

function getClientIndex(ws) {
    for (let i = 0; i < connectedClients.length; i++) {
        let client = connectedClients[i];
        if (ws === client.websocket) {
            return i;
        }
    }
    console.log("Could not find Client Index");
    return -1;
}



// Graceful shutdown handling
process.on('SIGINT', () => {
  console.log('SIGINT received: closing servers...');
  server.close(() => {
    console.log('HTTP server closed');
    wss.close(() => {
      console.log('WebSocket server closed');
      client.close(false, () => {
        console.log('MongoDB connection closed');
        process.exit(0);
      });
    });
  });
});

// Start Slack Bolt app
(async () => {
  await slackApp.start(slackPort);
  console.log(`⚡️ Slack Bolt app is running on port ${slackPort}!`);
})();

server.listen(httpPort, () => {
    console.log(`Chatbot and Slack integration listening on port ${httpPort}`);
  });
