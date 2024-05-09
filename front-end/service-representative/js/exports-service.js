var namesAndEmails = []

function notification(message) {
  document.querySelector("#notification").innerText = message
  document.querySelector("#notification").style.display = "block";
  setTimeout(() => {document.querySelector("#notification").style.display = "none"}, 5000)
}

function updatePage(response) {
  for (let i = 0; i < response[0].length; i++) {
    if (document.querySelector(`#pending-chats .user-${response[0][i][0].replace(" ", "-")}`) != null) {
      break;
    }
    namesAndEmails.push(response[0][i])
    const newPerson = document.querySelector(".chat").cloneNode(true);
    newPerson.children[0].innerText = response[0][i][0];
    newPerson.style.display = "block";
    newPerson.classList.add(`user-${response[0][i][0].replace(" ", "-")}`)
    document.querySelector("#pending-chats").append(newPerson);
  }
  for (let i = 0; i < response[1].length; i++) {
    if (document.querySelector(`#pending-chats .user-${response[1][i].replace(" ", "-")}`).style.backgroundColor == "#CC745A" || document.querySelector(`#current-chats .user-${response[1][i].replace(" ", "-")}`) != null) {
      break;
    } else {
      document.querySelectorAll(`.user-${response[1][i].replace(" ", "-")}`).forEach(function(elem) {
        if (elem.classList.contains("chat")) {
          elem.style.backgroundColor = "#CC745A"
        } else {
          elem.remove();
        }
      })
      notification(`${response[1][i]} has been taken by another customer service representative`)
    }
  }
  for (let i = 0; i < response[2].length; i++) {
    if (document.querySelector(`.user-${response[2][i].replace(" ", "-")}`) != null) {
      document.querySelectorAll(`.user-${response[2][i].replace(" ", "-")}`).forEach(function(elem) {
        elem.remove()
      })
      notification(`${response[2][i]} has closed their connection`)
      namesAndEmails.forEach((name) => {
        if (name[0] == response[2][i]) {
          namesAndEmails.splice(namesAndEmails.indexOf(name), 1)
        }
      })
    }
  }
}

function updateMessages(response, name) {
  for (let i = 0; i < response.length; i++) {
    const img = document.createElement("img");
    img.src = "images/user-icon.png";
    img.alt = "user-icon"
    img.style.width = "30px"
    const message = document.querySelectorAll(`.user-${name.replace(" ", "-")} .messages p`)[0].cloneNode();
    message.innerText = response[i];
    document.querySelector(`.user-${name.replace(" ", "-")} .messages .scurrent`).append(img, message);
  }
}

function sendMessage(str, name) {
  const message = new XMLHttpRequest();
  message.open("POST", "https://customerchatbot.onrender.com")
  const object = {request: "message", name: "customerRep", message: str, recipient: name}
  message.send(JSON.stringify(object))
}

function requestUpdate() {
  const message = new XMLHttpRequest();
  message.onload = function() {
    updatePage(JSON.parse(this.responseText))
  }
  message.open("POST", "https://customerchatbot.onrender.com")
  const object = {request: "reloadUsers"}
  message.send(JSON.stringify(object))
}

function requestMessageUpdate(name) {
  const message = new XMLHttpRequest();
  message.onload = function() {
    updateMessages(JSON.parse(this.responseText), name);
  }
  message.open("POST", "https://customerchatbot.onrender.com");
  const object = {request: "reloadMessages",  name: "customerRep", recipient: name}
  message.send(JSON.stringify(object))
}

function openSession(session, name) {
  document.querySelectorAll(`.user-${name.replace(" ", "-")} .messages section`).forEach(function(node) {
    node.style.display = "none";
  })
  if (document.querySelector(`.user-${name.replace(" ", "-")} .messages .s${session}`) != null) {
    document.querySelector(`.user-${name.replace(" ", "-")} .messages .s${session}`).style.display = "grid";
  } else {
    requestMessagesAtTime(session, name)
  }
  if (session != "current") {
    document.querySelector("#open-chats form").style.display = "none";
  } else {
    document.querySelector("#open-chats form").style.display = "block";
  }
}

function requestMessagesAtTime(session, name) {
  const message = new XMLHttpRequest();
  message.onload = function() {
    const section = document.querySelector(`.user-${name.replace(" ", "-")} .messages`).children[1].cloneNode()
    section.innerHTML = "";
    section.classList.remove("current")
    section.classList.add(`s${session}`)
    console.log(JSON.parse(this.responseText));
    console.log("Received response:", this.responseText);
    if (this.responseText && this.responseText.trim().startsWith('{')) {
      try {
        const messages = JSON.parse(this.responseText);
        for (let i in messages) {
          const img = document.createElement("img");
          if (messages[i].slice(0, 8) == "from247|") {
            img.src = "images/twenty-four-seven-teach-logo.png";
            img.alt = "twenty-four-seven-teach-logo"
            messages[i] = messages[i].slice(8)
          } else {
            img.src = "images/user-icon.png";
            img.alt = "user-icon"
          }
          img.style.width = "30px"
          const textBox = document.querySelector(`.user-${name.replace(" ", "-")} .messages`).children[0].cloneNode();
          textBox.innerText = messages[i];
          section.append(img, textBox)
        }
        document.querySelector(`.user-${name.replace(" ", "-")} .messages`).append(section);
        openSession(session, name)
      } catch (e) {
          console.error("Failed to parse JSON response:", e, this.responseText);
        }
      } else {
        console.error("Invalid or empty response received:", this.responseText);
      }
    }
  message.open("POST", "https://customerchatbot.onrender.com");
  const object = {request: "getMessagesDuringSession", name: name, session: session}
  message.send(JSON.stringify(object))
}

function requestMessageHistory(name, node) {
  const message = new XMLHttpRequest();
  message.onload = function() {
    let times = parseInt(this.responseText);
    for (let i = node.childElementCount - 1; i < times - 1; i++) {
      const button = node.children[0].cloneNode();
      button.innerText = `Session ${i + 1}`;
      button.style.display = 'block';
      node.append(button);
    }
  }
  message.open("POST", "https://customerchatbot.onrender.com");
  const object = {request: "getSession", name: name}
  message.send(JSON.stringify(object))
}

function getCurrentSession(name) {
  const message = new XMLHttpRequest();
  message.onload = function() {
    let currentSession = this.responseText
    const otherMessage = new XMLHttpRequest();
    otherMessage.onload = function() {
      let messages = JSON.parse(this.responseText)
      for (let i in messages) {
        const img = document.createElement("img");
        if (messages[i].slice(0, 8) == "from247|") {
          img.src = "images/twenty-four-seven-teach-logo.png";
          img.alt = "twenty-four-seven-teach-logo"
          messages[i] = messages[i].slice(8)
        } else {
          img.src = "images/user-icon.png";
          img.alt = "user-icon"
        }
        img.style.width = "30px"
        const textBox = document.querySelector(`.user-${name.replace(" ", "-")} .messages`).children[0].cloneNode();
        textBox.innerText = messages[i];
        document.querySelector(`.user-${name.replace(" ", "-")} .messages .scurrent`).append(img, textBox)
      }
    }
    otherMessage.open("POST", "https://customerchatbot.onrender.com");
    const objectTwo = {request: "getMessagesDuringSession", name: name, session: currentSession}
    otherMessage.send(JSON.stringify(objectTwo))
  }
  message.open("POST", "https://customerchatbot.onrender.com");
  const object = {request: "getSession", name: name}
  message.send(JSON.stringify(object))
}

export {sendMessage, requestUpdate, requestMessageUpdate, requestMessageHistory, openSession, getCurrentSession, namesAndEmails}
