require('dotenv').config();
const http = require('http');
const { MongoClient } = require('mongodb');
const { OpenAI } = require('openai');
const { App } = require('@slack/bolt');
const WebSocket = require('ws');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const port = process.env.PORT || 10000;
const slackPort = process.env.SLACK_BOLT_PORT || 3000;

const slackApp = new App({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  token: process.env.SLACK_BOT_TOKEN,
});

var unreadMessages = [];

global.connectedClients = []; // Initialize as an empty array
global.waitingSockets = []; // Initialize as an empty array
global.channelOccupied = [false, false, false, false, false]; // Assuming 5 channels

function ClientConnection(ws, channelIndex) {
  this.websocket = ws;
  this.channelIndex = channelIndex;
}

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
      await new Promise((resolve) => setTimeout(resolve, 2000));

      result = await openai.beta.threads.runs.retrieve(run.thread_id, run.id);

      if (result.status === 'completed') {
        const threadMessages = await openai.beta.threads.messages.list(run.thread_id);
        const response = threadMessages.data[0]?.content[0]?.text?.value;

        if (response) {
          const cleanedResponse = response.replace(/【\d+:\d+†source】/g, '');
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
  return new Date().toString();
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
      { username: name },
      { $set: { sessionStatus: status } }
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
    .find({ reciever: name, sender: 'chat-bot' })
    .sort({ time: -1 })
    .limit(1)
    .toArray();

  return result.length > 0 ? result[0].messageSent : null;
}

const slackChannels = [
    process.env.REBECCA_SUPPORT_1,
    process.env.REBECCA_SUPPORT_2,
    process.env.REBECCA_SUPPORT_3,
    process.env.REBECCA_SUPPORT_4,
    process.env.REBECCA_SUPPORT_5,
  ];

// WebSocket handling logic
function handleLiveSupportSession(ws) {
  
      ws.on('message', function (e) {
    console.log("===========================Channel Status===========================");
    for (let i = 0; i < global.channelOccupied.length; i++) {
        console.log(String(slackChannels[i]) + ": " + String(global.channelOccupied[i]));
    }

    let incomingMessage;
    try {
        incomingMessage = e.toString(); // Convert the incoming message to a string
    } catch (error) {
        console.error('Failed to convert incoming message:', error);
        return;
    }

    // Check if the incoming message is in the expected format
    if (incomingMessage.includes(":")) {
        // Separates message from channelId (if it has one)
        let [channelId, ...msgs] = incomingMessage.split(":");
        console.log("Channel ID: " + String(channelId));

        // Locate the channel in the channels array
        let channelIndex = slackChannels.indexOf(channelId);

        // Put the message together
        let msg = msgs.join("");
        console.log("Message: " + String(msg));

        // Message was sent by client (if channel id is not available)
        if (channelIndex === -1 && channelId !== process.env.SLACK_CHANNEL) {
            console.log("Message sent from a client");

            // Check to see if they are connected
            if (isConnected(ws)) {
                console.log("Client is connected already");

                // Find the channel
                channelIndex = findChannelIndex(ws);

                // Could not find the channel index
                if (channelIndex === -1) return;

                // Store the id of the channel to send to the Slack channel
                channelId = slackChannels[channelIndex];

                // Send message to Slack
                send_to_slack_api(channelId, msg);
                console.log("Successfully sent to Slack channel");

            } else {
                // Not connected yet
                attemptToConnect(ws);

                // Check to see if it was connected
                if (isConnected(ws)) {
                    // Get client index
                    let clientIndex = getClientIndex(ws);

                    // Retrieve client object
                    let client = global.connectedClients[clientIndex];

                    // Send the message to channel id (through API)
                    channelId = slackChannels[client.channelIndex];

                    // Send message to Slack
                    console.log('Sending message to Slack:', msg);
                    send_to_slack_api(channelId, msg);

                    // Alert help desk that there is a person waiting to get a response
                    let notificationMessage = `<!channel> We have a new chat in room: <%23${channelId}|>`;
                    send_to_slack_api(process.env.SLACK_CHANNEL, notificationMessage);
                }
            }
        } else {
            // Message was sent from Slack
            console.log("Message came from Slack");

            // Find the WebSocket and send the data to it
            console.log("Connected Users: " + String(global.connectedClients.length));
            for (let i = 0; i < global.connectedClients.length; i++) {
                let client = global.connectedClients[i];
                console.log("Client has channel: " + String(slackChannels[client.channelIndex]));
                if (channelId === slackChannels[client.channelIndex]) {
                    client.websocket.send(msg);
                    console.log("Successfully sent to client");
                }
            }
        }
    } else {
        console.error('Unexpected message format:', incomingMessage);
    }
});

  // Retain existing handlers for 'close' and 'error'
  ws.on('close', function (code, reason) {
    console.log(`WebSocket closed. Code: ${code}, Reason: ${reason}`);
    if (isConnected(ws)) {
      let index = getClientIndex(ws);
      if (index !== -1) {
        let channelIndex = findChannelIndex(ws);
        global.connectedClients.splice(index, 1);

        if (global.waitingSockets.length > 0) {
          let waitingSocket = global.waitingSockets.shift();
          let newClient = new ClientConnection(waitingSocket, channelIndex);
          global.connectedClients.push(newClient);
          console.log('Waiting user connected');
        } else {
          global.channelOccupied[channelIndex] = false;
        }
      }
    } else {
      let index = global.waitingSockets.indexOf(ws);
      if (index !== -1) {
        global.waitingSockets.splice(index, 1);
        console.log('Waiting user disconnected');
      }
    }
  });

  ws.on('error', function (error) {
    console.error('WebSocket error:', error);
  });

  ws.send(JSON.stringify({ message: 'Connection established successfully. Please wait for a message from live support.' }));
}
// Slack event handling using Slack Bolt
slackApp.event('message', async ({ event, say, ack }) => {
  await ack();
  
  if (event.subtype && event.subtype === 'bot_message') {
    return; // Ignore messages from bots
  }

  console.log(`Message received from Slack: ${event.text}`);

  // Send the Slack message to the connected WebSocket client
  sendToClient(event.channel, event.text);
});

// Function to send message to WebSocket client
function sendToClient(channelId, message) {
  console.log('Connected Users:', global.connectedClients.length);
  for (let i = 0; i < global.connectedClients.length; i++) {
    let client = global.connectedClients[i];
    if (channelId === slackChannels[client.channelIndex]) {
      client.websocket.send(JSON.stringify({ message }));
      console.log('Message sent to client:', message);
    }
  }
}


const server = http.createServer(async function (req, res) {
  if (req.method === 'POST' && req.url === '/slack/events') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      try {
        const parsedBody = JSON.parse(body);

         // Handle URL verification request
        if (parsedBody.type === 'url_verification') {
          console.log('URL verification request received');
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end(parsedBody.challenge); // Respond with the challenge token
          return;
        }

        //Fake ack function
        const ack = () => {
          res.writeHead(200);
          res.end();
        }
         // Process other Slack events using Slack Bolt
        await slackApp.processEvent({ body: parsedBody, headers: req.headers, ack }, res);
      } catch (error) {
        console.error('Error processing request:', error);
        res.writeHead(400);
        res.end('Invalid request');
      }
    });
  } else if (req.method === 'POST') {
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
          // case 'message':
          //   if (
          //     body.message ==
          //     'A customer service representative has taken your call'
          //   ) {
          //     updateStatus(body.recipient, 'taken');
          //   }
          //   await addMessage(body.name, body.message, body.recipient);
          //   res.end(JSON.stringify({ status: 'success' }));
          //   break;
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
          case 'live-support-session':
            // This case won't need `res.end(...)` because the communication will move to WebSocket.
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
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Only POST requests are supported');
  }
});

global.wss = new WebSocket.Server({ noServer: true });

global.wss.on('connection', function (ws) {
  handleLiveSupportSession(ws);
});

server.on('upgrade', function upgrade(request, socket, head) {
  if (request.headers['upgrade'] !== 'websocket') {
    socket.destroy();
    return;
  }

  global.wss.handleUpgrade(request, socket, head, function done(ws) {
    global.wss.emit('connection', ws, request);
  });
});

// Helper function definitions
function isConnected(ws) {
  return global.connectedClients.some(client => client.websocket === ws);
}

function attemptToConnect(ws) {
  for (let i = 0; i < global.channelOccupied.length; i++) {
    if (!global.channelOccupied[i]) {
      let clientConnection = new ClientConnection(ws, i);
      global.connectedClients.push(clientConnection);
      global.channelOccupied[i] = true;
      console.log('Successfully connected socket to channel');
      return;
    }
  }
  global.waitingSockets.push(ws);
  console.log('Socket pushed to waiting list');
}

function findChannelIndex(ws) {
  let client = global.connectedClients.find(client => client.websocket === ws);
  return client ? client.channelIndex : -1;
}

function getClientIndex(ws) {
  return global.connectedClients.findIndex(client => client.websocket === ws);
}

function disconnectClient(ws) {
  if (isClientConnected(ws)) {
    let index = getClientIndex(ws);
    if (index !== -1) {
      let channelIndex = findChannelIndex(ws);
      global.connectedClients.splice(index, 1);
      global.channelOccupied[channelIndex] = false;
    }
  }
}

function send_to_slack_api(channelId, msg) {
  slackApp.client.chat.postMessage({
    token: process.env.SLACK_BOT_TOKEN,
    channel: channelId,
    text: msg,
  }).then(() => {
    console.log('Message Sent to channel:', channelId);
    console.log('Message content:', msg);
  }).catch(error => {
    console.error('Error sending message to Slack:', error);
  });
}

// Start the server on the primary port
(async () => {
  await slackApp.start(slackPort);
  console.log('Slack app is running!');
  
server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
})();
