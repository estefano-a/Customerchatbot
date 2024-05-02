var globalName = "";

function updateGlobalName(value) {
  globalName = value;
}

function callChatBot(str) {
  const message = new XMLHttpRequest();
  message.onload = function() {
    const box = document.createElement("p");
    box.textContent = this.responseText;
    box.style.height = "min-content";
    document.querySelector("#messages").append(box)
  }
  message.open("POST", "https://customerchatbot.onrender.com");
  const object = {request: "callChatBot", name: globalName, message: str}
  message.send(JSON.stringify(object));
}

function callLiveRepresentative(str) {
  const message = new XMLHttpRequest();
  message.open("POST", "https://customerchatbot.onrender.com");
  const object = {request: "message", name: globalName, message: str, recipient: "customerRep"}
  message.send(JSON.stringify(object));
}

function sendUserInfo(name, email) {
  globalName = name;
  const message = new XMLHttpRequest();
  message.open("POST", "https://customerchatbot.onrender.com");
  const object = {request: "addUser", name: globalName, email: email} 
  message.send(JSON.stringify(object));
}

function addToLiveChat() {
  const message = new XMLHttpRequest()
  message.open("POST", "https://customerchatbot.onrender.com")
  const object = {request: "addUserToLiveChat", name: globalName}
  message.send(JSON.stringify(object))
}

function requestResponse() {
  const message = new XMLHttpRequest();
  message.onload = function() {
    const responses = JSON.parse(this.responseText)
    responses.forEach((i) => {
      const image = document.createElement("img");
      image.src = "images/twenty-four-seven-teach-logo.png";
      image.alt = "24/7-teach-logo";
      image.style.height = "30px";
      const paragraph = document.createElement("p");
      paragraph.textContent = i;
      paragraph.style.height = "min-content";
      document.querySelector("#messages").append(image, paragraph);
    })
  }
  message.open("POST", "https://customerchatbot.onrender.com");
  const object = {request: "reloadMessages", name: globalName, recipient: "customerRep"}
  message.send(JSON.stringify(object));
}

function closeWindow() {
  const message = new XMLHttpRequest();
  message.open("POST", "https://customerchatbot.onrender.com");
  const object = {request: "removeUser", name: globalName}
  message.send(JSON.stringify(object));
}

export {callChatBot, callLiveRepresentative, sendUserInfo, requestResponse, updateGlobalName, addToLiveChat, closeWindow};
