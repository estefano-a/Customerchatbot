const http = require('http');
const {MongoClient} = require('mongodb');
const OpenAI = require("openai");
require('dotenv').config()
const port = process.env.PORT || 10000;

var unreadMessages = []

const uri = process.env.MONGOD_CONNECT_URI;
const client = new MongoClient(uri);
const chatDatabase = "chatdb";
const namesAndEmailsCollection = "namesAndEmails";
const messagesCollection = "messages";
client.connect();

async function callChatBot(str) {
  // const completion = await openai.chat.completions.create({
  //   messages: [{role: "system", content: str}],
  //   model: "gpt-3.5-turbo",
  // });
  // return completion.choices[0].message.content
  return "This works"
}

function currentTime() {
  let d = new Date()
  return d.toString()
}

async function obtainSession(name) {
  const result = await client.db(chatDatabase).collection(namesAndEmailsCollection).findOne({
    "username": name
  })
  return(parseInt(result.sessionNumber))
}

function updateStatus(name, status) {
  client.db(chatDatabase).collection(namesAndEmailsCollection).findOneAndUpdate({
      "username": name
    }, {$set: {"sessionStatus": status}}
  )
}

function addNameAndEmail(name, email) {
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

http.createServer(function (req, res) {
  let body = ""
   req.on('data', chunk => {
      //console.log('Received chunk: ', chunk.toString());
      body += chunk.toString();
    });
    req.on('end', async () => {
      //console.log('Final body string: ', body);
      try {
        body = JSON.parse(body);
        res.writeHead(200, {
        'Content-Type': 'text/html', 
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
        'Access-Control-Allow-Headers': 'Content-Type'
      })
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
            res.write(session.toString())
            break
          case "callChatBot":
            await addMessage(body.name, body.message, 'chat-bot')
            response = await callChatBot(body.message)
            await addMessage('chat-bot', response, body.name)
            res.write(response)
            break
          case "reloadUsers":
            let updatedPage = [[], [], []]
            response = await client.db(chatDatabase).collection(namesAndEmailsCollection).find({
              "sessionStatus": "live"
            }).toArray()
            response.forEach(function(x) {
              updatedPage[0].push([x.username, x.userEmail])
              setTimeout(function() {
                updateStatus(x.username, "default")
              }, 990)
            })
            response = await client.db(chatDatabase).collection(namesAndEmailsCollection).find({
              "sessionStatus": "taken"
            }).toArray()
            response.forEach(function(x) {
              updatedPage[1].push(x.username)
              setTimeout(function() {
                updateStatus(x.username, "default")
              }, 4000)
            })
            response = await client.db(chatDatabase).collection(namesAndEmailsCollection).find({
              "sessionStatus": "closed"
            }).toArray()
            response.forEach(function(x) {
              updatedPage[2].push(x.username)
              setTimeout(function() {
                updateStatus(x.username, "default")
              }, 990)
            })
            res.write(JSON.stringify(updatedPage));
            break;
          case "reloadMessages":
            let updatedMessages = [];
            unreadMessages.forEach((i) => {
              if (i[0] == body.recipient && i[2] == body.name) {
                updatedMessages.push(i[1])
                unreadMessages.splice(unreadMessages.indexOf(i), 1)
              }
            })
            res.write(JSON.stringify(updatedMessages))
            break;
          case "addUserToLiveChat":
            updateStatus(body.name, "live")
            break;
          case "removeUser":
            client.db(chatDatabase).collection(namesAndEmailsCollection).findOneAndUpdate({
                "username": body.name
              }, {
                $inc: {"sessionNumber": 1},
                $set: {"sessionStatus": "closed"}
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
              $or: [{"sender": body.name}, {"reciever": body.name}]
            }).toArray()
            console.log(response)
            response.forEach(function(x) {
              if (x.sender == "customerRep" || x.sender == "chat-bot") {
                sessionMessages.push(`from247|${x.messageSent}`)
              } else {
                sessionMessages.push(x.messageSent)
              }
            })
            res.write(JSON.stringify(sessionMessages))
            break
          }
          res.end();
        }  
      catch (error) {
          console.error('Error handling request:', error);
          if (!res.headersSent) {
            res.writeHead(500, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({ error: "Internal Server Error" }));
      } else {
        res.end();
      }
    }
  });
}).listen(port, () => {
  console.log(`Chatbot listening on port ${port}`);
})
