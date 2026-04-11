(function () {
  "use strict";

  const vscode = acquireVsCodeApi();
  const messagesEl = document.getElementById("messages");
  const inputEl = document.getElementById("input");
  const sendBtn = document.getElementById("sendBtn");
  const addContextBtn = document.getElementById("addContextBtn");
  const tokenUsageBtn = document.getElementById("tokenUsageBtn");
  const stopBtn = document.getElementById("stopBtn");
  const newChatBtn = document.getElementById("newChatBtn");
  const attachedFilesEl = document.getElementById("attachedFiles");

  let attachedFiles = [];
  let totalTokensUsed = 0;
  let sessionMessages = 0;
  let currentAssistantDiv = null;

  // ---- Helpers ----

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addMessage(html, className) {
    const div = document.createElement("div");
    div.className = "message " + className;
    div.innerHTML = html;
    messagesEl.appendChild(div);
    scrollToBottom();
    return div;
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function renderMarkdown(text) {
    return text
      .replace(/```(\w*)\n([\s\S]*?)\n```/g, "<pre><code>$2</code></pre>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\n/g, "<br>");
  }

  function extractCode(text) {
    var match = text.match(/```\w*\n([\s\S]*?)\n```/);
    return match ? match[1] : null;
  }

  // ---- Send message ----

  function sendMessage() {
    var text = inputEl.value.trim();
    if (!text) return;

    if (attachedFiles.length > 0) {
      text += "\n\n[Context files attached:";
      attachedFiles.forEach(function (f) { text += "\n- " + f; });
      text += "]";
      vscode.postMessage({ type: "attachFiles", files: attachedFiles });
      attachedFiles = [];
      renderAttachedFiles();
    }

    var welcome = document.getElementById("welcome");
    if (welcome) welcome.style.display = "none";

    addMessage(escapeHtml(text), "user-msg");
    inputEl.value = "";
    inputEl.style.height = "auto";
    sessionMessages++;
    vscode.postMessage({ type: "sendMessage", text: text });
  }

  // ---- Quick actions ----

  function sendQuick(text) {
    inputEl.value = text;
    sendMessage();
  }

  function bindQuickActions(container) {
    var buttons = container.querySelectorAll("[data-action]");
    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        sendQuick(btn.getAttribute("data-action") || "");
      });
    });
  }

  // Bind initial quick actions
  bindQuickActions(document);

  // ---- Attached files ----

  function renderAttachedFiles() {
    attachedFilesEl.innerHTML = "";
    attachedFiles.forEach(function (f, i) {
      var chip = document.createElement("span");
      chip.className = "attached-file";
      var parts = f.split(/[/\\]/);
      chip.textContent = parts[parts.length - 1];
      var removeBtn = document.createElement("button");
      removeBtn.textContent = "\u00D7";
      removeBtn.addEventListener("click", function () {
        attachedFiles.splice(i, 1);
        renderAttachedFiles();
      });
      chip.appendChild(removeBtn);
      attachedFilesEl.appendChild(chip);
    });
  }

  // ---- Event listeners ----

  // Send on Enter
  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      sendMessage();
    }
  });

  // Auto-resize textarea
  inputEl.addEventListener("input", function () {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 150) + "px";
  });

  // Send button
  sendBtn.addEventListener("click", function () {
    sendMessage();
  });

  // Attach file
  addContextBtn.addEventListener("click", function () {
    vscode.postMessage({ type: "pickFile" });
  });

  // Token usage
  tokenUsageBtn.addEventListener("click", function () {
    var existing = document.querySelector(".token-usage");
    if (existing) { existing.remove(); return; }
    var div = document.createElement("div");
    div.className = "token-usage";
    div.innerHTML =
      "<h4>Token Usage</h4>" +
      "<div>Tokens used: <strong>" + totalTokensUsed.toLocaleString() + "</strong></div>" +
      "<div>Messages: <strong>" + sessionMessages + "</strong></div>" +
      '<div style="margin-top:8px;font-size:11px">' +
      '<a href="https://platform.xiaomimimo.com/#/console/plan-manage" ' +
      'style="color:var(--vscode-textLink-foreground)">View quota on MiMo Platform</a></div>';
    messagesEl.insertBefore(div, messagesEl.firstChild);
  });

  // Stop
  stopBtn.addEventListener("click", function () {
    vscode.postMessage({ type: "stopProcessing" });
    stopBtn.style.display = "none";
    addMessage("Stopped by user.", "assistant-msg");
  });

  // New chat
  var welcomeTemplate = "";
  var welcomeEl = document.getElementById("welcome");
  if (welcomeEl) welcomeTemplate = welcomeEl.innerHTML;

  newChatBtn.addEventListener("click", function () {
    messagesEl.innerHTML = "";
    vscode.postMessage({ type: "clearHistory" });
    var w = document.createElement("div");
    w.className = "welcome";
    w.id = "welcome";
    w.innerHTML = welcomeTemplate;
    messagesEl.appendChild(w);
    bindQuickActions(w);
  });

  // ---- Messages from extension host ----

  window.addEventListener("message", function (e) {
    var msg = e.data;
    switch (msg.type) {
      case "filePicked":
        attachedFiles.push(msg.path);
        renderAttachedFiles();
        break;

      case "startStreaming":
        currentAssistantDiv = addMessage("", "assistant-msg");
        stopBtn.style.display = "flex";
        break;

      case "assistantMessage":
        if (currentAssistantDiv) {
          currentAssistantDiv.innerHTML = renderMarkdown(msg.text);
          var code = extractCode(msg.text);
          if (code) {
            var btn = document.createElement("button");
            btn.className = "insert-btn";
            btn.textContent = "Insert into editor";
            btn.onclick = function () { vscode.postMessage({ type: "insertCode", code: code }); };
            currentAssistantDiv.appendChild(btn);
          }
        }
        scrollToBottom();
        break;

      case "stream":
        if (currentAssistantDiv) {
          currentAssistantDiv.innerHTML += renderMarkdown(msg.text);
        } else {
          currentAssistantDiv = addMessage(renderMarkdown(msg.text), "assistant-msg");
        }
        scrollToBottom();
        break;

      case "toolCall":
        addMessage(escapeHtml(msg.args), "tool-msg");
        break;

      case "toolResult":
        addMessage('<div class="tool-result">' + escapeHtml(msg.result) + "</div>", "tool-msg");
        break;

      case "error":
        addMessage(escapeHtml(msg.text), "error-msg");
        break;

      case "tokenUsage":
        totalTokensUsed += msg.total;
        break;

      case "streamEnd":
        currentAssistantDiv = null;
        stopBtn.style.display = "none";
        inputEl.focus();
        break;

      case "historyCleared":
        totalTokensUsed = 0;
        sessionMessages = 0;
        break;
    }
  });
})();
