import { Room } from './room';
import { LoadBalancer } from './loadBalancer';

export { Room, LoadBalancer };

export interface Env {
  ROOMS: DurableObjectNamespace;
  LOAD_BALANCER: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    if (url.pathname === '/') {
      return new Response(getHTML(), {
        headers: { 'Content-Type': 'text/html' }
      });
    }
    
    if (url.pathname === '/ws') {
      return handleWebSocket(request, env);
    }
    
    if (url.pathname === '/api/stats') {
      return handleStats(env);
    }
    
    return new Response('Not Found', { status: 404 });
  }
};

async function handleWebSocket(request: Request, env: Env): Promise<Response> {
  console.log('Main handleWebSocket called');
  const upgradeHeader = request.headers.get('Upgrade');
  if (!upgradeHeader || upgradeHeader !== 'websocket') {
    console.log('Missing or invalid Upgrade header:', upgradeHeader);
    return new Response('Expected Upgrade: websocket', { status: 426 });
  }
  
  const url = new URL(request.url);
  const roomId = url.searchParams.get('room') || 'general';
  const userId = url.searchParams.get('userId') || crypto.randomUUID();
  const username = url.searchParams.get('username') || 'User' + Math.floor(Math.random() * 1000);
  
  console.log('WebSocket params from URL:', { roomId, userId, username });
  
  const loadBalancerId = env.LOAD_BALANCER.idFromName('singleton');
  const loadBalancer = env.LOAD_BALANCER.get(loadBalancerId);
  
  console.log('About to create request for LoadBalancer');
  
  const loadBalancerUrl = new URL(request.url);
  loadBalancerUrl.pathname = '/';
  
  // Add URL params for GET request  
  loadBalancerUrl.searchParams.set('room', roomId);
  loadBalancerUrl.searchParams.set('userId', userId);
  loadBalancerUrl.searchParams.set('username', username);
  
  const loadBalancerRequest = new Request(loadBalancerUrl.toString(), {
    method: 'GET',
    headers: {
      'Upgrade': request.headers.get('Upgrade') || '',
      'Connection': request.headers.get('Connection') || '',
      'Sec-WebSocket-Key': request.headers.get('Sec-WebSocket-Key') || '',
      'Sec-WebSocket-Version': request.headers.get('Sec-WebSocket-Version') || ''
    }
  });
  
  console.log('Calling loadBalancer.fetch');
  try {
    const response = await loadBalancer.fetch(loadBalancerRequest);
    console.log('LoadBalancer response status:', response.status);
    return response;
  } catch (error) {
    console.error('Error calling LoadBalancer:', error);
    throw error;
  }
}

async function handleStats(env: Env): Promise<Response> {
  const loadBalancerId = env.LOAD_BALANCER.idFromName('singleton');
  const loadBalancer = env.LOAD_BALANCER.get(loadBalancerId);
  
  const response = await loadBalancer.fetch(new Request('https://loadbalancer/stats'));
  return response;
}

function getHTML(): string {
  const htmlParts = [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '    <title>Durable Objects Chat</title>',
    '    <style>',
    '        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }',
    '        .container { max-width: 1000px; margin: 0 auto; display: flex; gap: 20px; }',
    '        .main-chat { flex: 1; }',
    '        .sidebar { width: 250px; }',
    '        .chat-box { border: 1px solid #ccc; height: 400px; overflow-y: auto; padding: 10px; margin-bottom: 10px; }',
    '        .input-container { display: flex; gap: 10px; }',
    '        input[type="text"] { flex: 1; padding: 10px; }',
    '        button { padding: 10px 20px; }',
    '        .message { margin: 5px 0; }',
    '        .system-message { color: #666; font-style: italic; }',
    '        .typing-indicator { color: #999; font-style: italic; margin: 5px 0; }',
    '        .user-list { border: 1px solid #ccc; padding: 10px; margin-bottom: 10px; }',
    '        .user-item { display: flex; align-items: center; margin: 5px 0; }',
    '        .status-dot { width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; }',
    '        .status-online { background-color: #4CAF50; }',
    '        .status-away { background-color: #FF9800; }',
    '        .status-offline { background-color: #9E9E9E; }',
    '        .typing-users { font-style: italic; color: #666; }',
    '        .stats { padding: 10px; background: #f5f5f5; }',
    '    </style>',
    '</head>',
    '<body>',
    '    <div class="container">',
    '        <div class="main-chat">',
    '            <h1>Durable Objects Chat Demo</h1>',
    '            <div>',
    '                <label>Username: </label>',
    '                <input type="text" id="username" value="User123" />',
    '                <label>Room: </label>',
    '                <input type="text" id="room" value="general" />',
    '                <button onclick="connect()">Connect</button>',
    '                <button onclick="disconnect()">Disconnect</button>',
    '            </div>',
    '            <div id="chat-box" class="chat-box"></div>',
    '            <div id="typing-indicator" class="typing-indicator"></div>',
    '            <div class="input-container">',
    '                <input type="text" id="message-input" placeholder="Type your message..." onkeypress="handleKeyPress(event)" oninput="handleTyping()" />',
    '                <button onclick="sendMessage()">Send</button>',
    '            </div>',
    '        </div>',
    '        <div class="sidebar">',
    '            <div class="user-list">',
    '                <h3>Users Online</h3>',
    '                <div id="user-list"></div>',
    '            </div>',
    '            <div class="stats">',
    '                <h3>Stats</h3>',
    '                <div id="stats-display"></div>',
    '            </div>',
    '        </div>',
    '    </div>',
    '    <script>',
    '        let ws = null;',
    '        let userId = crypto.randomUUID();',
    '        let users = new Map();',
    '        let isTyping = false;',
    '        let typingTimeout = null;',
    '        function connect() {',
    '            const username = document.getElementById("username").value;',
    '            const room = document.getElementById("room").value;',
    '            if (ws) { ws.close(); }',
    '            const protocol = location.protocol === "https:" ? "wss:" : "ws:";',
    '            const wsUrl = protocol + "//" + location.host + "/ws?room=" + room + "&userId=" + userId + "&username=" + username;',
    '            ws = new WebSocket(wsUrl);',
    '            ws.onopen = () => { ',
    '                addMessage("Connected to room: " + room, "system"); ',
    '                ws.send(JSON.stringify({ type: "requestUserList" }));',
    '            };',
    '            ws.onmessage = (event) => {',
    '                const message = JSON.parse(event.data);',
    '                if (message.type === "message") {',
    '                    addMessage(message.username + ": " + message.content, "message");',
    '                } else if (message.type === "userList") {',
    '                    updateUserList(JSON.parse(message.content));',
    '                } else if (message.type === "typing") {',
    '                    updateTypingIndicator(JSON.parse(message.content));',
    '                } else if (message.type === "join" || message.type === "leave") {',
    '                    addMessage(message.content, "system");',
    '                }',
    '            };',
    '            ws.onclose = () => { addMessage("Disconnected", "system"); };',
    '            ws.onerror = (error) => { addMessage("Error: " + error, "system"); };',
    '        }',
    '        function disconnect() { if (ws) { ws.close(); ws = null; } }',
    '        function sendMessage() {',
    '            const input = document.getElementById("message-input");',
    '            const message = input.value.trim();',
    '            if (message && ws && ws.readyState === WebSocket.OPEN) {',
    '                ws.send(JSON.stringify({ type: "message", content: message }));',
    '                input.value = "";',
    '                stopTyping();',
    '            }',
    '        }',
    '        function handleKeyPress(event) { if (event.key === "Enter") { sendMessage(); } }',
    '        function handleTyping() {',
    '            if (ws && ws.readyState === WebSocket.OPEN) {',
    '                if (!isTyping) {',
    '                    isTyping = true;',
    '                    ws.send(JSON.stringify({ type: "typing", isTyping: true }));',
    '                } else {',
    '                    // Send periodic typing updates to refresh server timeout',
    '                    ws.send(JSON.stringify({ type: "typing", isTyping: true }));',
    '                }',
    '                clearTimeout(typingTimeout);',
    '                typingTimeout = setTimeout(stopTyping, 1500);',
    '            }',
    '        }',
    '        function stopTyping() {',
    '            if (isTyping && ws && ws.readyState === WebSocket.OPEN) {',
    '                isTyping = false;',
    '                ws.send(JSON.stringify({ type: "typing", isTyping: false }));',
    '            }',
    '            clearTimeout(typingTimeout);',
    '        }',
    '        function updateUserList(userList) {',
    '            const userListDiv = document.getElementById("user-list");',
    '            userListDiv.innerHTML = "";',
    '            userList.forEach(user => {',
    '                const userDiv = document.createElement("div");',
    '                userDiv.className = "user-item";',
    '                const statusDot = document.createElement("div");',
    '                statusDot.className = "status-dot status-" + user.status;',
    '                const username = document.createElement("span");',
    '                username.textContent = user.username;',
    '                userDiv.appendChild(statusDot);',
    '                userDiv.appendChild(username);',
    '                userListDiv.appendChild(userDiv);',
    '            });',
    '        }',
    '        function updateTypingIndicator(typingUsers) {',
    '            const indicator = document.getElementById("typing-indicator");',
    '            if (typingUsers.length === 0) {',
    '                indicator.textContent = "";',
    '            } else if (typingUsers.length === 1) {',
    '                indicator.textContent = typingUsers[0] + " is typing...";',
    '            } else {',
    '                indicator.textContent = typingUsers.join(", ") + " are typing...";',
    '            }',
    '        }',
    '        function addMessage(content, type) {',
    '            const chatBox = document.getElementById("chat-box");',
    '            const messageDiv = document.createElement("div");',
    '            messageDiv.className = "message" + (type === "system" ? " system-message" : "");',
    '            messageDiv.textContent = content;',
    '            chatBox.appendChild(messageDiv);',
    '            chatBox.scrollTop = chatBox.scrollHeight;',
    '        }',
    '        setInterval(async () => {',
    '            try {',
    '                const response = await fetch("/api/stats");',
    '                const stats = await response.json();',
    '                document.getElementById("stats-display").innerHTML = "<pre>" + JSON.stringify(stats, null, 2) + "</pre>";',
    '            } catch (error) { console.error("Failed to load stats:", error); }',
    '        }, 5000);',
    '    </script>',
    '</body>',
    '</html>'
  ];
  
  return htmlParts.join('\n');
}