window.onload = function() {

    function updateWebPage() {
      const messageTo = new XMLHttpRequest();
      // Replace this link with the 24/7 Teach server
      messageTo.open("POST", "http://localhost:8080")

      messageTo.send("Reload");
    }
    updateWebPage();
    setInterval(updateWebPage, 2 * 1000);
    
    document.querySelector("#answer-submit button[type='submit']").onclick = function(){
      const newTextBox = document.createElement("p");
      const firstImage = document.createElement("img");
      firstImage.src = "images/twenty-four-seven-teach-logo.png";
      firstImage.alt = "24/7-teach-logo"
      firstImage.style.width = "30px"
      const form = document.querySelector(".messages");
      const answer = document.querySelector("#answer-submit").elements[0].value;
      newTextBox.textContent = answer;
      newTextBox.style.height = "min-content";
      form.appendChild(firstImage);
      form.appendChild(newTextBox);
    }

    function openPage(pageName,element) {
      var i, chat_content, chat_links;

      chat_content = document.getElementsByClassName("chat-content");
      for (i = 0; i < chat_content.length; i++) {
        chat_content[i].style.display = "none";
      }

      chat_links = document.getElementsByClassName("chat-link");
      for (i = 0; i < chat_links.length; i++) {
        chat_links[i].className = chat_links[i].className.replace(" active", "");
      }

      document.getElementById(pageName).style.display = "block";
      element.currentTarget.className += " active";

    }
  };