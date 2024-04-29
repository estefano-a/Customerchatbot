const http = require('http');
const {MongoClient} = require('mongodb');
const OpenAI = require("openai");

//databases
var nameAndEmail = []
var messages = []
var unreadMessages = []

//MongoDB databases
const uri = "mongodb+srv://circlespace:NMUp4QxJCh9vcmy0@chatbot-widget.tkmifse.mongodb.net/?retryWrites=true&w=majority&appName=chatbot-widget";
const client = new MongoClient(uri);
const chatDatabase = "chatdb";
const namesAndEmailsCollection = "namesAndEmails";
const messagesCollection = "messages";

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
  try{
    await client.connect();
    for await (const doc of client.db(chatDatabase).collection(namesAndEmailsCollection).findOne({
    $or: [{username: name}, {userEmail: email}]}
    )){
      result = JSON.stringify(doc);
      console.log('session obtained ', result)
    }
    return result;
  } catch(e){
      console.error(e);
  } finally{
      await client.close();
  }
  // for (let i = 0; i < nameAndEmail.length; i++) {
  //   if (nameAndEmail[i][0] == name) {
  //     console.log("Session obtained: " + nameAndEmail[i][2])
  //     return nameAndEmail[i][2]
  //   }
  // }
}

async function updateSession(name, email){
  try{
    await client.connect();
    const result = await client.db(chatDatabase).collection(namesAndEmailsCollection).updateOne({
    $or: [{username: name}, {userEmail: email}]},
    {$inc: {sessionNumber: 1}});
    console.log(JSON.stringify(result));
  } catch(e){
      console.error(e);
  } finally{
      await client.close();
  }
}

async function updateStatus(name, email, status) {
  for (let i = 0; i < nameAndEmail.length; i++) {
    if (nameAndEmail[i][0] == name) {
      nameAndEmail[i][3] = status
      try{
        await client.connect();
        const result = await client.db(chatDatabase).collection(namesAndEmailsCollection).updateOne({
        $or: [{username: name}, {userEmail: email}]},
        {$set: {sessionStatus: status}});
        console.log(JSON.stringify(result));
      } catch(e){
          console.error(e);
      } finally{
          await client.close();
      }
      console.log("Status obtained: " + nameAndEmail[i][3])
    }
  }
}

async function addNameAndEmail(name, email) {
  nameAndEmail.push([name, email, 1, "default"])
  try{
    await client.connect();
    const result = await client.db(chatDatabase).collection(namesAndEmailsCollection).updateOne({
      $and: [{username: name}, {userEmail: email}]
    },{
    $set: {username: name},
    $set: {userEmail: email},
    $inc: {sessionNumber: 1},
    $set: {sessionStatus: "default"}
    }, {upsert: true});
    console.log('New listing created in '+ namesAndEmailsCollection+ ' with the following id:' + result.insertedId);
  } catch(e){
      console.error(e);
  } finally{
      await client.close();
  }
}

async function addMessage(name, message, recipient) {
  if (name == "customerRep" || name == "chat-bot") {
    messages.push([name, message, recipient, currentTime(), await obtainSession(recipient)])
    try{
      await client.connect();
      const result = await client.db(chatDatabase).collection(messagesCollection).insertOne({
        sender: name,
        reciever: recipient,
        time: currentTime(),
        session: await obtainSession(recipient),
        messageSent: message
      });
      console.log('New listing created in '+ messagesCollection + ' with the following id:' + result.insertedId);
    } catch(e){
        console.error(e);
    } finally{
        await client.close();
    }
  } else {
    messages.push([name, message, recipient, currentTime(), await obtainSession(name)])
    try{
      await client.connect();
      const result = await client.db(chatDatabase).collection(messagesCollection).insertOne({
        sender: name,
        reciever: recipient,
        time: currentTime(),
        session: await obtainSession(name),
        messageSent: message
      });
      console.log('New listing created in '+ messagesCollection + ' with the following id:' + result.insertedId);
    } catch(e){
        console.error(e);
    } finally{
        await client.close();
    }
  }
  unreadMessages.push([name, message, recipient])
}

// Testing Server
http.createServer(function (req, res) {
  let body = ''
  req.on('data', chunk => {
    body += chunk.toString()
  })
  req.on('end', async () => {
    body = JSON.parse(body)
    res.writeHead(
      200,
      {'Content-Type': 'text/html'},
      {"Access-Control-Allow-Origin": "*"},
    )
    switch (body.request) {
      case "addUser":
        await addNameAndEmail(body.name, body.email);
        break;
      case "message":
        if (body.message == "A customer service representative has taken your call") {
          await updateStatus(body.recipient, body.email, "taken")
        }
        await addMessage(body.name, body.message, body.recipient);
        break
      case "getSession":
        res.write(await obtainSession(body.name).toString())
        break
      case "callChatBot":
        await addMessage(body.name, body.message, 'chat-bot')
        response = await callChatBot(body.message)
        await addMessage('chat-bot', response, body.name)
        res.write(response)
        break
      case "reloadUsers":
        let updatedPage = [[], [], []]
        nameAndEmail.forEach((i) => {
          switch (i[3]) {
            case "live":
              updatedPage[0].push([i[0], i[1]])
              setTimeout(() => {i[3] = "default"}, 990)
              break
            case "taken":
              updatedPage[1].push(i[0])
              setTimeout(() => {i[3] = "default"}, 4000)
              break
            case "closed":
              updatedPage[2].push(i[0])
              setTimeout(() => {i[3] = "default"}, 990)
              break
          }
        })
        await updateStatus(i[0], i[1], "default");
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
        await updateStatus(body.name, body.email, "live")
        break
      case "removeUser":
        for (let i = 0; i < nameAndEmail.length; i++) {
          if (nameAndEmail[i][0] == body.name) {
            await updateStatus(body.name, body.email, "closed")
            await updateSession(body.name, body.email)
            nameAndEmail[i][2] += 1
            nameAndEmail[i][3] = "closed"
          }
        }
        break
      case "getMessagesDuringSession":
        let sessionMessages = []
        messages.forEach((i) => {
          if (i[4] == body.session) {
            if (i[0] == body.name) {
              sessionMessages.push(i[1])
            } else if (i[2] == body.name) {
              sessionMessages.push(`from247|${i[1]}\n`)
            }
          }
        })
        res.write(JSON.stringify(sessionMessages))
        break
    }
    res.end()
  })
}).listen(8080)