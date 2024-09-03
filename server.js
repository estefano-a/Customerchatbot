require('dotenv').config();
const http = require('http');
const { MongoClient } = require('mongodb');
const { OpenAI } = require('openai');
const { App } = require('@slack/bolt');
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
          const formattedResponse = cleanedResponse.replace(
            /http(s)?:\/\/\S+/g,
            (url) => `[${url}](${url})`
          );

          //console.log(formattedResponse);
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

// Define the available Slack channels using environment variables
// const slackChannels = [
//   process.env.REBECCA_SUPPORT_1,
//   process.env.REBECCA_SUPPORT_2,
//   process.env.REBECCA_SUPPORT_3,
//   process.env.REBECCA_SUPPORT_4,
//   process.env.REBECCA_SUPPORT_5,
// ];

// function ClientConnection(ws, channelIndex) {
//   this.websocket = ws; // WebSocket connection object
//   this.channelIndex = channelIndex; // Index of the channel assigned to this connection
// }

// // Initialize WebSocket server and related arrays if not already initialized
// if (!global.wss) {
//   global.wss = new WebSocket.Server({ port: 443 });
//   global.connectedClients = [];
//   global.waitingSockets = [];
//   global.channelOccupied = Array(slackChannels.length).fill(false);

//   // WebSocket connection handler
//   global.wss.on('connection', function connection(ws) {
//     // Handle incoming WebSocket messages
//     ws.onmessage = function (e) {
//       const incomingMessage = e.data;
//       console.log('Message Received:', incomingMessage);

//       // Split incoming message to get channel ID and message content
//       let [channelId, ...msgs] = incomingMessage.split(':');
//       let msg = msgs.join('');

//       // Check if message came from Slack or a client
//       if (!slackChannels.includes(channelId) && channelId !== process.env.SLACK_CHANNEL) {
//         // Message from a client
//         if (isConnected(ws)) {
//           // Client already connected
//           let channelIndex = findChannelIndex(ws);
//           if (channelIndex === -1) return;

//           channelId = slackChannels[channelIndex];
//           send_to_slack_api(channelId, msg);
//           console.log('Successfully sent to Slack channel');
//         } else {
//           // Attempt to connect the client
//           attemptToConnect(ws);
//           if (isConnected(ws)) {
//             let clientIndex = getClientIndex(ws);
//             let client = global.connectedClients[clientIndex];
//             channelId = slackChannels[client.channelIndex];

//             send_to_slack_api(channelId, msg);

//             // Notify the help desk channel
//             let notificationMessage = `<!channel> New chat in room: <%23${channelId}|>`;
//             send_to_slack_api(process.env.HELP_DESK_CHANNEL, notificationMessage);
//           }
//         }
//       } else {
//         // Message from Slack
//         for (let i = 0; i < global.connectedClients.length; i++) {
//           let client = global.connectedClients[i];
//           if (channelId === slackChannels[client.channelIndex]) {
//             client.websocket.send(msg);
//             console.log('Successfully sent to client');
//           }
//         }
//       }
//     };

//     // Handle WebSocket disconnection
//     ws.on('close', function () {
//       if (isConnected(ws)) {
//         let index = getClientIndex(ws);
//         if (index !== -1) {
//           let channelIndex = findChannelIndex(ws);
//           global.connectedClients.splice(index, 1);

//           // Connect waiting socket if available
//           if (global.waitingSockets.length > 0) {
//             let waitingSocket = global.waitingSockets.shift();
//             let newClient = new ClientConnection(waitingSocket, channelIndex);
//             global.connectedClients.push(newClient);
//             console.log('Waiting user connected');
//           } else {
//             global.channelOccupied[channelIndex] = false;
//           }
//         }
//       } else {
//         // Handle waiting socket disconnection
//         let index = global.waitingSockets.indexOf(ws);
//         if (index !== -1) {
//           global.waitingSockets.splice(index, 1);
//           console.log('Waiting user disconnected');
//         }
//       }
//     });
//   });
// }

// // Helper function definitions
// function isConnected(ws) {
//   return global.connectedClients.some(client => client.websocket === ws);
// }

// function attemptToConnect(ws) {
//   for (let i = 0; i < global.channelOccupied.length; i++) {
//     if (!global.channelOccupied[i]) {
//       let clientConnection = new ClientConnection(ws, i);
//       global.connectedClients.push(clientConnection);
//       global.channelOccupied[i] = true;
//       console.log('Successfully connected socket to channel');
//       return;
//     }
//   }
//   global.waitingSockets.push(ws);
//   console.log('Socket pushed to waiting list');
// }

// function findChannelIndex(ws) {
//   let client = global.connectedClients.find(client => client.websocket === ws);
//   return client ? client.channelIndex : -1;
// }

// function getClientIndex(ws) {
//   return global.connectedClients.findIndex(client => client.websocket === ws);
// }

// function send_to_slack_api(channelId, msg) {
//   slackApp.client.chat.postMessage({
//     token: process.env.SLACK_BOT_TOKEN,
//     channel: channelId,
//     text: msg,
//   }).then(() => {
//     console.log('Message Sent to channel:', channelId);
//     console.log('Message content:', msg);
//   }).catch(error => {
//     console.error('Error sending message to Slack:', error);
//   });
// }



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
                //attemptToConnect(global.wss); // This will connect WebSocket if not already connected
            
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
