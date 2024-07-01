import {callLiveRepresentative, callChatBot, sendUserInfo, requestResponse, updateGlobalName, addToLiveChat, closeWindow} from "./exports.js";
//comment

function setCookie(cname, cvalue, exdays) {
  const d = new Date();
  d.setTime(d.getTime() + (exdays * 24 * 60 * 60 * 1000));
  let expires = "expires="+ d.toUTCString();
  document.cookie = cname + "=" + cvalue + ";" + expires + ";path=/";
}

function getCookie(cname) {
  let name = cname + "=";
  let decodedCookie = decodeURIComponent(document.cookie);
  let ca = decodedCookie.split(';');
  for(let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) == ' ') {
      c = c.substring(1);
    }
    if (c.indexOf(name) == 0) {
      return c.substring(name.length, c.length);
    }
  }
  return "";
}

function updateForCookies() {
  if (getCookie("name") != "") {
    const form = document.querySelector("#messages");
    document.querySelector("#chat-bot-form").remove();
    document.querySelector("#chat-bot-text").style.display = "block";
    const image = document.createElement("img");
    image.src = "New images/orangelogo.png";
    image.alt = "24/7-teach-logo";
    image.style.height = "30px";
    const newTextBox = document.createElement("p");
    newTextBox.textContent = `Hello ${getCookie("name")}, we're glad to have you back`;
    newTextBox.height = "min-content";
    form.append(image, newTextBox);
    updateGlobalName(getCookie("name"))
  }
}

window.onload = function() {
  let liveChat = false;
  document.querySelector("#chat-bot-close").onclick = function(){
    document.querySelector("#open-form").style.display = "none";
    document.querySelector("#closed-form").style.display = "block";
  }
  document.querySelector("#closed-form").onclick = function(){
    this.style.display = "none";
    document.querySelector("#open-form").style.display = "block";
    document.querySelector("#chat-bot-drop-down-content").style.display = "none";
    if (! document.querySelector("#chat-bot-text").style.display == "block") {
      document.querySelector("#chat-bot-form").style.display = "block"
    }
  }
  document.querySelector("#start-chat-submit button[type='submit']").onclick = function(){
    const form = document.forms["start-chat-submit"];
    const name = form.elements[0].value;
    const email = form.elements[1].value;
    if (name != "" && email != "") {
      sendUserInfo(name, email)
      document.querySelector("#chat-bot-form").remove();
      document.querySelector("#chat-bot-text").style.display = "block"
      if (document.querySelector("#chat-bot-drop-down-content p") != null) {
        document.querySelector("#chat-bot-drop-down-content p").remove()
      }
      setCookie("name", name, 10);
    } else if (document.querySelector("#start-chat-submit p") == null) {
      const errorMessage = document.createElement("p");
      errorMessage.textContent = "Please submit a valid name and email";
      errorMessage.style.color = "red";
      form.replaceChild(errorMessage, form.childNodes[7]);
    }
  }
  document.querySelector("#question-submit button[type='submit']").onclick = function(){
    const newTextBox = document.createElement("p");
    const firstImage = document.createElement("img");
    firstImage.src = "images/user-icon.png";
    firstImage.alt = "user-icon"
    firstImage.style.width = "30px"
    const form = document.querySelector("#messages");
    const question = document.querySelector("#question-submit").elements[0].value;
    newTextBox.textContent = question;
    newTextBox.style.height = "min-content";
    newTextBox.style.color = "white";
    newTextBox.style.backgroundColor = "rgb(48, 69, 92)";
    const secondImage = document.createElement("img");
    secondImage.src = "New images/orangelogo.png";
    secondImage.alt = "24/7-teach-logo";
    secondImage.style.height = "30px";
    form.append(firstImage, newTextBox);
    if (! liveChat) {
      form.append(secondImage)
      callChatBot(question)
    } else {
      callLiveRepresentative(question);
    }
    document.querySelector("#question-submit").elements[0].value = "";
  }

  document.querySelector("#prompt1").onclick = function(){
    const newTextBox = document.createElement("p");
    const firstImage = document.createElement("img");
    firstImage.src = "images/user-icon.png";
    firstImage.alt = "user-icon"
    firstImage.style.width = "30px"
    const form = document.querySelector("#messages");
    const question = document.querySelector("#prompt1").value;
    newTextBox.textContent = question;
    newTextBox.style.height = "min-content";
    newTextBox.style.color = "white";
    newTextBox.style.backgroundColor = "rgb(48, 69, 92)";
    const secondImage = document.createElement("img");
    secondImage.src = "New images/orangelogo.png";
    secondImage.alt = "24/7-teach-logo";
    secondImage.style.height = "30px";
    form.append(firstImage, newTextBox);
    if (! liveChat) {
      form.append(secondImage)
      callChatBot(question)
    } else {
      callLiveRepresentative(question);
    }
  }

  document.querySelector("#prompt2").onclick = function(){
    const newTextBox = document.createElement("p");
    const firstImage = document.createElement("img");
    firstImage.src = "images/user-icon.png";
    firstImage.alt = "user-icon"
    firstImage.style.width = "30px"
    const form = document.querySelector("#messages");
    const question = document.querySelector("#prompt2").value;
    newTextBox.textContent = question;
    newTextBox.style.height = "min-content";
    newTextBox.style.color = "white";
    newTextBox.style.backgroundColor = "rgb(48, 69, 92)";
    const secondImage = document.createElement("img");
    secondImage.src = "New images/orangelogo.png";
    secondImage.alt = "24/7-teach-logo";
    secondImage.style.height = "30px";
    form.append(firstImage, newTextBox);
    if (! liveChat) {
      form.append(secondImage)
      callChatBot(question)
    } else {
      callLiveRepresentative(question);
    }
  }

  document.querySelector("#prompt3").onclick = function(){
    const newTextBox = document.createElement("p");
    const firstImage = document.createElement("img");
    firstImage.src = "images/user-icon.png";
    firstImage.alt = "user-icon"
    firstImage.style.width = "30px"
    const form = document.querySelector("#messages");
    const question = document.querySelector("#prompt3").value;
    newTextBox.textContent = question;
    newTextBox.style.height = "min-content";
    newTextBox.style.color = "white";
    newTextBox.style.backgroundColor = "rgb(48, 69, 92)";
    const secondImage = document.createElement("img");
    secondImage.src = "New images/orangelogo.png";
    secondImage.alt = "24/7-teach-logo";
    secondImage.style.height = "30px";
    form.append(firstImage, newTextBox);
    if (! liveChat) {
      form.append(secondImage)
      callChatBot(question)
    } else {
      callLiveRepresentative(question);
    }
  }

  

  // document.querySelector("#chat-bot-extra").onclick = function(){
  //   const dropDown = document.querySelector("#chat-bot-drop-down-content");
  //   if (dropDown.style.display == "block") {
  //     dropDown.style.display = "none";
  //   } else {
  //     dropDown.style.display = "block";
  //   };
  // }
  // document.querySelector("#live-chat-start").onclick = function(){
  //   if (document.querySelector("#chat-bot-drop-down-content p") == null && document.querySelector("#chat-bot-text").style.display != "block") {
  //     const errorMessage = document.createElement("p");
  //     errorMessage.textContent = "Please send the form first";
  //     errorMessage.style.cssText = `
  //       width: 100%;
  //       text-align: left;
  //       font-weight: 400;
  //       color: red;
  //     `;
  //     document.querySelector("#chat-bot-drop-down-content").appendChild(errorMessage);
  //   } else if (document.querySelector("#waiting-message") == null) {
  //     liveChat = true;
  //     addToLiveChat();
  //     requestResponse();
  //     setInterval(requestResponse, 1000);
  //     const image = document.createElement("img");
  //     image.src = "New images/orangelogo.png";
  //     image.alt = "24/7-teach-logo";
  //     image.style.height = "30px";
  //     const message = document.createElement("p");
  //     message.textContent = "Please wait while we get a customer service agent on call";
  //     message.id = "waiting-message";
  //     message.style.height = "min-content";
  //     document.querySelector("#messages").append(image, message);
  //   }
  // }
  updateForCookies();
};

window.onbeforeunload = function() {
  closeWindow();
}

// document.cookie = "name=YourName; path=/";
