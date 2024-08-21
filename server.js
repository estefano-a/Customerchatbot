require("dotenv").config();
const http = require("http");
const { MongoClient } = require("mongodb");
const { OpenAI } = require("openai");
const { App } = require("@slack/bolt");
const WebSocket = require('ws');
const fs = require("fs");
const https = require('https');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const port = process.env.PORT || 10000;

let wss; 
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

// Flag to control AI vs. Live Support mode
let isLiveSupportMode = false;

async function callChatBot(str) {
  if (isLiveSupportMode) {
    console.log("AI responses are disabled. Currently in live support mode.");
    return "Live support is active. Please wait for a response.";
  }

  try {
    const run = await openai.beta.threads.createAndRun({
      assistant_id: process.env.OPENAI_ASSISTANT_ID,
      thread: {
        messages: [{ role: "user", content: str }],
      },
    });

    console.log("run status: ", run.status);

    while (
      (await openai.beta.threads.runs.retrieve(run.thread_id, run.id).status) !=
      "failed"
    ) {
      const result = await openai.beta.threads.runs.retrieve(
        run.thread_id,
        run.id,
      );

      if (result.status == "completed") {
        const threadMessages = await openai.beta.threads.messages.list(
          run.thread_id,
        );

        const response = threadMessages.data[0].content[0].text.value;
        const cleanedResponse = response.replace(/【\d+:\d+†source】/g, "");
        
        return cleanedResponse;
      }
    }
  } catch (error) {
    console.error("An error occurred:", error);
    return "";
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
      { $set: { sessionStatus: status } },
    );
}

async function addNameAndEmail(name, email) {
  client.db(chatDatabase).collection(namesAndEmailsCollection).insertOne({
    username: name,
    userEmail: email,
    sessionNumber: 1,
    sessionStatus: "default",
  });
}

async function addMessage(name, message, recipient) {
  if (name == "customerRep" || name == "chat-bot") {
    const session = await obtainSession(recipient);
    client.db(chatDatabase).collection(messagesCollection).insertOne({
      sender: name,
      reciever: recipient,
      time: currentTime(),
      session: session,
      messageSent: message,
    });
  } else {
    const session = await obtainSession(name);
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
      sender: "chat-bot",
    })
    .sort({ time: -1 })
    .limit(1)
    .toArray();

  return result.length > 0 ? result[0].messageSent : null;
}



http
  .createServer(async function (req, res) {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", async () => {
      try {
        body = JSON.parse(body);
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE",
          "Access-Control-Allow-Headers": "Content-Type",
        });

        switch (body.request) {
          case "send-message":
            const { type } = body;
            const { latestMessage } = body;
            let feedbackText;
            if (type === "like") {
              feedbackText = "Our user gave a 👍 on Rebecca's performance.";
            } else if (type === "dislike") {
              feedbackText = "Our user gave a 👎 on Rebecca's performance.";
            }

            try {
              const text = latestMessage
                ? `${feedbackText}\nLatest response from Rebecca: ${latestMessage}`
                : feedbackText;

              await slackApp.client.chat.postMessage({
                token: process.env.SLACK_BOT_TOKEN,
                channel: process.env.SLACK_CHANNEL,
                text: text,
              });
              res.end(JSON.stringify({ status: "Message sent" }));
            } catch (error) {
              console.error(error);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: "Error sending message" }));
            }
            break;
          case "get-latest-message":
            try {
              const { name } = body;
              const latestMessage = await getLatestMessage(name);
              res.end(JSON.stringify({ latestMessage: latestMessage || "" }));
            } catch (error) {
              console.error("Error fetching latest message:", error);
              res.statusCode = 500;
              res.end(
                JSON.stringify({ error: "Error fetching latest message" }),
              );
            }
            break;
          case "addUser":
            await addNameAndEmail(body.name, body.email);
            res.end(JSON.stringify({ status: "success" }));
            break;
          case "message":
            if (
              body.message ==
              "A customer service representative has taken your call"
            ) {
              updateStatus(body.recipient, "taken");
            }
            await addMessage(body.name, body.message, body.recipient);
            res.end(JSON.stringify({ status: "success" }));
            break;
          case "getSession":
            const session = await obtainSession(body.name);
            res.end(session.toString());
            break;
          case "callChatBot":
            await addMessage(body.name, body.message, "chat-bot");
            const response = await callChatBot(body.message);
            await addMessage("chat-bot", response, body.name);
            res.end(response);
            break;
          case "reloadUsers":
            let updatedPage = [[], [], []];
            let liveResponse = await client
              .db(chatDatabase)
              .collection(namesAndEmailsCollection)
              .find({
                sessionStatus: "live",
              })
              .toArray();
            liveResponse.forEach(function (x) {
              updatedPage[0].push([x.username, x.userEmail]);
              setTimeout(function () {
                updateStatus(x.username, "default");
              }, 990);
            });
            let takenResponse = await client
              .db(chatDatabase)
              .collection(namesAndEmailsCollection)
              .find({
                sessionStatus: "taken",
              })
              .toArray();
            takenResponse.forEach(function (x) {
              updatedPage[1].push(x.username);
              setTimeout(function () {
                updateStatus(x.username, "default");
              }, 4000);
            });
            let closedResponse = await client
              .db(chatDatabase)
              .collection(namesAndEmailsCollection)
              .find({
                sessionStatus: "closed",
              })
              .toArray();
            closedResponse.forEach(function (x) {
              updatedPage[2].push(x.username);
              setTimeout(function () {
                updateStatus(x.username, "default");
              }, 990);
            });
            res.end(JSON.stringify(updatedPage));
            break;
          case "reloadMessages":
            let updatedMessages = [];
            unreadMessages.forEach((i) => {
              if (i[0] == body.recipient && i[2] == body.name) {
                updatedMessages.push(i[1]);
                unreadMessages.splice(unreadMessages.indexOf(i), 1);
              }
            });
            res.end(JSON.stringify(updatedMessages));
            break;
          case "addUserToLiveChat":
            updateStatus(body.name, "live");
            res.end(JSON.stringify({ status: "success" }));
            break;
          case "removeUser":
            await client
              .db(chatDatabase)
              .collection(namesAndEmailsCollection)
              .findOneAndUpdate(
                {
                  username: body.name,
                },
                {
                  $inc: { sessionNumber: 1 },
                  $set: { sessionStatus: "closed" },
                },
              );
            unreadMessages.forEach((i) => {
              if (i[0] == body.name || i[2] == body.name) {
                unreadMessages.splice(unreadMessages.indexOf(i), 1);
              }
            });
            res.end(JSON.stringify({ status: "success" }));
            break;
          case "getMessagesDuringSession":
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
              if (x.sender == "customerRep" || x.sender == "chat-bot") {
                sessionMessages.push(`from247|${x.messageSent}`);
              } else {
                sessionMessages.push(x.messageSent);
              }
            });
            res.end(JSON.stringify(sessionMessages));
            break;
            case "start-websocket-session":
            // Set the flag to true to disable AI responses and switch to live support
            
            const { messages } = body;
            console.log(`${messages}`);




            
            isLiveSupportMode = true;
            //res.end(JSON.stringify({ status: "WebSocket session started" }));

            //Code to connect Rebecca to live support - Aug 15, 2024
// Set up WebSocket server

            try {
  wss = new WebSocket.Server({ port: 443 });
              console.log("WebSocket connection successful");
} catch (error) {
  console.error('WebSocket server setup failed:', error);
}

// let connectedClients = []; 
// const slackChannels = ['C07GQG61SUF', 'C07GQGFGYNB', 'C07HHNWQA1F', 'C07H26MKCG5', 'C07H53CELUS']; // Rebecca Support Slack channels

// // Client connection object constructor
function ClientConnection(ws, channelIndex) {
  this.websocket = ws;
  this.channelIndex = channelIndex;
  console.log(`${this.channelIndex} Erin`);
}

// Handle WebSocket connections
// wss.on('connection', function connection(ws) {
//   ws.on('messages', async function incoming(message) {
//     console.log('received:', message);

//     // Parse the message from the client
//     let [channelId, ...msgParts] = message.split(":");
//     let msg = msgParts.join(":").trim();
//     let channelIndex = slackChannels.indexOf(channelId);

//     if (channelIndex === -1) {
//       // Handle the case where the message does not specify a channel ID
//       console.log("Message does not match any Slack channel ID. Ignoring.");
//       return;
//     }

//     // Store the client connection
//     connectedClients.push(new ClientConnection(ws, channelIndex));

//     // Send the message to the corresponding Slack channel
//     await sendMessageToSlack(channelId, msg);
//   });

//   // Handle WebSocket closure
//   ws.on('close', function () {
//     console.log('Client disconnected');
//     // Remove the client from the connectedClients array
//     connectedClients = connectedClients.filter(client => client.websocket !== ws);
//   });
//   wss.close(function() {
//     console.log('WebSocket server closed');
// });
// });

// Send message to Slack channel
// async function sendMessageToSlack(channelId, message) {
//   try {
//     await slackApp.client.chat.postMessage({
//       token: process.env.SLACK_BOT_TOKEN,
//       channel: channelId,
//       text: message,
//     });
//     console.log('Message sent to Slack:', message);
//   } catch (error) {
//     console.error('Error sending message to Slack:', error);
//   }
// }

// Listen for Slack messages and forward them to the appropriate WebSocket client
// slackApp.message(async ({ message, say }) => {
//   const channelId = message.channel;
//   const text = message.text;

//   // Find the corresponding WebSocket client
//   const client = connectedClients.find(client => slackChannels[client.channelIndex] === channelId);
//   if (client) {
//     client.websocket.send(text);
//     console.log('Message forwarded to WebSocket client:', text);
//   }
// });





            // check if channel is occupied
// const channelOccupied = [false, false, false, false, false];


// url of flask api (to send messages to slack)
//const slack_api_send_msg_url = "https://live-chat-api-ejiw.onrender.com/send-message";


// when someone connects to the websocket server
// wss.on('connection', function connection(ws) {
//     // when the server receives a message
//     ws.onmessage = function (e) {
//         console.log("===========================Channel Status===========================");
//         for(let i = 0; i < channels.length; i++){
//             console.log(String(channels[i]) + ": " + String(channelOccupied[i]));
//         }
        
//         const incomingMessage = e.data;
//         console.log("Message Received: " + incomingMessage);

//         // separates message from channelId (if it has one)
//         let [channelId, ...msgs] = incomingMessage.split(":");
//         console.log("Channel ID: " + String(channelId))

//         // locate the channel in the channels array
//         let channelIndex = channels.indexOf(channelId);

//         // put the message together
//         let msg = msgs.join("");
//         console.log("Message: " + String(msg));

//         // message was sent by client (if channel id is not available)
//         if (channelIndex === -1 && channelId !== helpDeskChannel) {
//             console.log("Message sent from a client");
            
//             // check to see if they are connected
//             if (isConnected(ws)) {
//                 console.log("Client is connected already");
                
//                 // find the channel 
//                 channelIndex = findChannelIndex(ws);

//                 // could not find the channel index
//                 if (channelIndex === -1) return;

//                 // store the id of the channel to send to the slack channel
//                 channelId = channels[channelIndex];

//                 // send message to slack
//                 send_to_slack_api(channelId, msg);
//                 console.log("Successfully sent to slack channel");

//             }else {
//                 // not connected yet
//                 attemptToConnect(ws);

//                 // check to see if it was connected
//                 if (isConnected(ws)) {
//                     // get client index
//                     let clientIndex = getClientIndex(ws);

//                     // retrieve client object
//                     let client = connectedClients[clientIndex];

//                     // send the message to channel id (through api)
//                     channelId = channels[client.channelIndex];

//                     // send message to slack
//                     send_to_slack_api(channelId, msg);

//                     // alert help desk that there is a person waiting to get a response
//                     let notificationMessage = `<!channel> We have a new chat in room: <%23${channelId}|>`;
//                     // `<@${helpDeskChannel}> We have a new chat in room: <@${channelId}>`

//                     send_to_slack_api(helpDeskChannel, notificationMessage);
//                 }
//             }
//         } else {
//             // message was sent from slack
//             console.log("Message came from slack");
            
//             // find the websocket and send the data to it
//             console.log("Connected Users: " + String(connectedClients.length));
//             for (let i = 0; i < connectedClients.length; i++) {
//                 let client = connectedClients[i];
//                 console.log("Client has channel: " + String(channels[client.channelIndex]));
//                 if (channelId === channels[client.channelIndex]) {
//                     client.websocket.send(msg);
//                     console.log("Succesfully sent to client");
//                 }
//             }
//         }
//     };

//     // when user disconnects from the chat server
//     ws.on('close', function () {
//         // console.log("user disconnected-setting channel occupied to false");
//         // channelOccupied[0] = false;

//         // check to see if is connected
//         if(isConnected(ws)){
//             let index = getClientIndex(ws);
//             if(index != -1){
//                 // get channel id 
//                 let channelIndex = findChannelIndex(ws);

//                 // remove user from the list
//                 connectedClients.splice(index, 1);
//                 console.log("Connected user disconnected");

//                 // attempt to connect the most recent waiting user
//                 if(waitingSockets.length > 0){
//                     let waitingSocket = waitingSockets[0];
//                     let newClient = new ClientConnection(waitingSocket, channelIndex);
//                     connectedClients.push(newClient);
//                     console.log("waitint user connected");
                    
//                     // splice the waiting list so that it moves up one
//                     waitingSockets.splice(0, 1);
//                     console.log("waiting list moved up");
//                 }else{
//                     // update the status to false
//                     channelOccupied[channelIndex] = false; // N: I'm thinking that we don't update this so that we can replace it with someone waiting which prevents a random user that has a chance of taking its spot randomly
//                 }

//             }
//         }else{
//             // person waiting disconnected
//             let index = waitingSockets.indexOf(ws);
//             if(index != -1){
//                 waitingSockets.splice(index, 1);
//                 console.log("Waiting user disconnected");
//             }
//         }
//     });
//   wss.close(function() {
//     console.log('WebSocket server closed');
// });
// });

// // Perform API call to send a message to the channel with the passed in channel id
// function send_to_slack_api(channelId, msg) {
//   // Create the full URL with query parameters
//   const fullUrl = `${slack_api_send_msg_url}?channelId=${channelId}&message=${msg}`;
//   console.log(`Full URL: ${fullUrl}`);
  
//   // Parse the URL to extract the hostname and path
//   const url = new URL(fullUrl);

//   // Set up the options for the HTTPS request
//   const options = {
//     hostname: url.hostname,
//     path: url.pathname + url.search,
//     method: 'GET',
//   };

//   // Make the GET request to the API endpoint
//   const req = https.request(options, (res) => {
//     let data = '';

//     // A chunk of data has been received.
//     res.on('data', (chunk) => {
//       data += chunk;
//     });

//     // The whole response has been received.
//     res.on('end', () => {
//       if (res.statusCode === 200) {
//         console.log('Message Sent to channel: ' + String(channelId));
//         console.log(`Message content: ${msg}`);
//       } else {
//         console.error('Error:', res.statusCode, res.statusMessage);
//       }
//     });
//   });

//   req.on('error', (error) => {
//     console.error('Request failed:', error);
//   });

//   req.end();
// }



// // returns the status whether the websocket is connected or not
// function isConnected(ws) {
//     // console.log(connectedClients.length);
//     for (let i = 0; i < connectedClients.length; i++) {
//         let clientConnection = connectedClients[i];
//         // console.log(clientConnection.websocket);
//         if (ws === clientConnection.websocket) {
//             console.log("Socket is connected already");
//             return true;
//         }
//     }

//     console.log("Socket has not yet connected");
//     return false;
// }

// returns status whether the websocket is waiting or not
// function isWaiting(ws) {
//     for (let i = 0; i < waitingSockets.length; i++) {
//         let socket = waitingSockets[i];
//         if (ws === socket.websocket) {
//             console.log("Socket is waiting");
//             return true;
//         }
//     }
//     console.log("Socket is not waiting");
//     return false;
// }

// function attemptToConnect(ws) {
//     console.log("Attempting to connect client...");
//     for (let i = 0; i < channelOccupied.length; i++) {
//         // connect websocket
//         if (!channelOccupied[i]) {
//             // create a client connection object with ws and channel index
//             let clientConnection = new ClientConnection(ws, i);

//             // push to connected socket
//             connectedClients.push(clientConnection);

//             // update room status
//             channelOccupied[i] = true;

//             console.log("Successfully connected socket to channel");

//             // don't need to check to see if other channels are free if they found an available one
//             return;
//         }
//     }

//     // all channels are occupied so we put them in the waiting list
//     console.log("Socket pushed to waiting list");
//     waitingSockets.push(ws)
// }

// // returns the channel index that the websocket is currently occupying
// function findChannelIndex(ws) {
//     for (let i = 0; i < connectedClients.length; i++) {
//         let socket = connectedClients[i];
//         if (ws === socket.websocket) {
//             return socket.channelIndex;
//         }
//     }

//     // does not have channel index (impossible)
//     console.log("Channel Index not found");
//     return -1;
// }

// // takes in a websocket object to find the client object that is connected
// function getClientIndex(ws) {
//     for (let i = 0; i < connectedClients.length; i++) {
//         let client = connectedClients[i];
//         if (ws === client.websocket) {
//             return i;
//         }
//     }

//     // could not find
//     console.log("Could not find Client Index");
//     return -1;
// }
//End of Live Support code





            
            break;
          // case "live-support-session":
          //   //For the submit button to continue getting messages to slack
          //   const { messagesFromRebecca } = body;
          //   console.log(`${messagesFromRebecca}`);
          //   try {
          //     const text = messagesFromRebecca;
              
          //     await slackApp.client.chat.postMessage({
          //       token: process.env.SLACK_BOT_TOKEN,
          //       channel: process.env.SLACK_CHANNEL,
          //       text: text,
          //     });
          //     res.end(JSON.stringify({ status: "Message sent" }));
          //   } catch (error) {
          //     console.error(error);
          //     res.statusCode = 500;
          //     res.end(JSON.stringify({ error: "Error sending message" }));
          //   }
          //   break;
          default:
            res.end(JSON.stringify({ error: "Invalid request" }));
            break;
        }
      } catch (error) {
        console.error("Error handling request:", error);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal Server Error" }));
        } else {
          res.end();
        }
      }
    });
  })
  .listen(port, () => {
    console.log(`Chatbot and Slack integration listening on port ${port}`);
  });
