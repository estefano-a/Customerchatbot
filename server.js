require('dotenv').config();
const http = require('http');
const { MongoClient } = require('mongodb');
const { OpenAI } = require('openai');
const { App } = require('@slack/bolt');
const WebSocket = require('ws');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const port = process.env.PORT || 10000;

const slackApp = new App({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  token: process.env.SLACK_BOT_TOKEN,
});

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
  });
}

async function addMessage(name, message, recipient) {
  client.db(chatDatabase).collection(messagesCollection).insertOne({
    sender: name,
    reciever: recipient,
    time: currentTime(),
    messageSent: message,
  });
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

// WebSocket handling logic
function handleLiveSupportSession(ws) {
  console.log('WebSocket connection established');

  const slackChannels = [
    process.env.REBECCA_SUPPORT_1,
    process.env.REBECCA_SUPPORT_2,
    process.env.REBECCA_SUPPORT_3,
    process.env.REBECCA_SUPPORT_4,
    process.env.REBECCA_SUPPORT_5,
  ];

  ws.on('message', function (message) {
    console.log('Message Received:', message);
    let [channelId, ...msgs] = message.split(':');
    let msg = msgs.join('');

    if (!slackChannels.includes(channelId) && channelId !== process.env.SLACK_CHANNEL) {
      if (isConnected(ws)) {
        let channelIndex = findChannelIndex(ws);
        if (channelIndex === -1) return;

        channelId = slackChannels[channelIndex];
        send_to_slack_api(channelId, msg);
        console.log('Successfully sent to Slack channel');
      } else {
        attemptToConnect(ws);
        if (isConnected(ws)) {
          let clientIndex = getClientIndex(ws);
          let client = global.connectedClients[clientIndex];
          channelId = slackChannels[client.channelIndex];

          send_to_slack_api(channelId, msg);

          let notificationMessage = `<!channel> New chat in room: <%23${channelId}|>`;
          send_to_slack_api(process.env.SLACK_CHANNEL, notificationMessage);
        }
      }
    } else {
      for (let i = 0; i < global.connectedClients.length; i++) {
        let client = global.connectedClients[i];
        if (channelId === slackChannels[client.channelIndex]) {
          client.websocket.send(msg);
          console.log('Successfully sent to client');
        }
      }
    }
  });

  ws.on('close', function () {
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

  ws.send(JSON.stringify({ message: 'Connection established successfully' }));

}

const server = http.createServer(async function (req, res) {
  if (req.method === 'POST') {
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
          // Your existing HTTP request handlers...
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

server.on('upgrade', function upgrade(request, socket, head) {
  if (request.headers['upgrade'] !== 'websocket') {
    socket.destroy();
    return;
  }

  global.wss.handleUpgrade(request, socket, head, function done(ws) {
    global.wss.emit('connection', ws, request);
    handleLiveSupportSession(ws);
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
server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
