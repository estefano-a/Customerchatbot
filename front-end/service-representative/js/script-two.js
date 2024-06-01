import {sendMessage, requestUpdate, requestMessageUpdate, requestMessageHistory, openSession, namesAndEmails, getCurrentSession} from "./exports-service.js";

var inFocusPerson = "";
var currentPeople = [];

function closeOtherChats() {
  document.querySelectorAll(".chat-content, .customer-profile").forEach(function(elem) {
    elem.style.display = "none";
  })
}


function addPerson(name) {
  sendMessage("A customer service representative has taken your call", name)
  getCurrentSession(name);
  closeOtherChats();
  const newPerson = document.querySelector("#current-chats").children[0].cloneNode(true);
  newPerson.children[0].innerText = name;
  newPerson.style.display = "inline-block";
  newPerson.className += ` user-${name.replace(" ", "-")}`
  document.querySelector("#current-chats").append(newPerson);
  const newText = document.querySelector("#open-chats").children[0].cloneNode(true);
  newText.children[0].innerText = name;
  newText.children[1].children[0].innerText = `This is the start of your chat with ${name}`
  newText.className += ` user-${name.replace(" ", "-")}`
  newText.style.display = "block";
  document.querySelector("#open-chats").append(newText);
  const newProfile = document.querySelector("#profile").children[1].cloneNode(true);
  newProfile.children[0].innerText = name;
  namesAndEmails.forEach((i) => {
    if (i[0] == name) {
      newProfile.children[1].innerText = i[1]
    }
  })
  newProfile.children[4].style.display = "none";
  newProfile.className += ` user-${name.replace(" ", "-")}`
  newProfile.style.display = "block";
  document.querySelector("#profile").append(newProfile)
}

function updatePerson() {
  if (document.querySelector(`.user-${inFocusPerson.replace(" ", "-")}`) == null) {
    inFocusPerson = "";
  }
  for (let i = 0; i < currentPeople.length; i++) {
    if (document.querySelector(`.user-${currentPeople[i].replace(" ", "-")}`) == null) {
      currentPeople.splice(currentPeople.indexOf(currentPeople[i]), 1)
    }
  }
  document.querySelectorAll(".chat").forEach(function(elem) {
    elem.onclick = function() {
      console.log(elem.style.backgroundColor)
      if (elem.style.backgroundColor != "rgb(204, 116, 90)") {
        inFocusPerson = elem.innerText;
        if (! currentPeople.includes(inFocusPerson)) {
          currentPeople.push(inFocusPerson)
          addPerson(inFocusPerson)
        }
      }
    }
  })
  document.querySelectorAll(".chat-link").forEach(function(elem) {
    elem.onclick = function() {
      inFocusPerson = elem.innerText;
      closeOtherChats();
      document.querySelectorAll(`.user-${inFocusPerson.replace(" ", "-")}`).forEach(function(elem) {
        if (elem.classList.contains(`customer-profile`) || elem.classList.contains(`chat-content`)) {
          elem.style.display = "block";
        }
      })
    }
  })
  document.querySelectorAll(".close-chat").forEach(function(elem) {
    elem.onclick = function() {
      document.querySelectorAll(`.user-${elem.parentElement.children[0].innerText.replace(" ", "-")}`).forEach(function(otherElem) {
        if (! otherElem.classList.contains(`chat`)) {
          otherElem.remove()
        }
      })
      currentPeople.splice(currentPeople.indexOf(elem.parentElement.children[0].innerText.replace(" ", "-")), 1)
    }
  })
  document.querySelectorAll(".customer-profile").forEach(function(elem) {
    elem.children[3].onclick = function() {
      const chatBlock = elem.children[4]
      if (chatBlock.style.display == "none") {
        requestMessageHistory(inFocusPerson, chatBlock);
        chatBlock.style.display = "block";
      } else {
        chatBlock.style.display = "none";
      }
    }
  })
  document.querySelectorAll(".chat-history button").forEach(function(elem) {
    elem.onclick = function() {
      if (elem.innerText == "Current Session") {
        openSession("current", inFocusPerson)
      } else {
        openSession(elem.innerText.slice(8), inFocusPerson)
      }
    }
  })
}

function requestMessages() {
  if (inFocusPerson != "") {
    requestMessageUpdate(inFocusPerson)
  }
}

window.onload = function() {
  requestUpdate();
  setInterval(requestUpdate, 1000);
  requestMessages();
  setInterval(requestMessages, 1000);
  updatePerson();
  setInterval(updatePerson, 1000)
  document.querySelector("button[type='submit']").onclick = function() {
    const newTextBox = document.createElement("p");
    const answer = document.querySelector("#answer").value;
    const img = document.createElement("img");
    img.src = "../customer-facing/New Images/orangelogo.png";
    img.alt = "twenty-four-seven-teach-icon"
    img.style.width = "30px"
    newTextBox.textContent = answer;
    newTextBox.style.height = "min-content";
    document.querySelector("#answer").value = "";
    document.querySelector(`.user-${inFocusPerson.replace(" ", "-")} .messages .messages-grid`).append(img, newTextBox);
    sendMessage(answer, inFocusPerson);
  }
};
