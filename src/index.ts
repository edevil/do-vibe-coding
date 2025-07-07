import { Room } from './room';
import { LoadBalancer } from './loadBalancer';

// Export Durable Object classes for Cloudflare Workers
export { Room, LoadBalancer };

/**
 * Environment bindings for Cloudflare Workers.
 * These are configured in wrangler.toml and provide access to Durable Objects.
 */
export interface Env {
  ROOMS: DurableObjectNamespace; // Room Durable Object namespace
  LOAD_BALANCER: DurableObjectNamespace; // LoadBalancer Durable Object namespace
}

/**
 * Main Cloudflare Worker entry point.
 * Routes requests to appropriate handlers:
 * - GET / : Serves the chat application HTML
 * - GET /ws : WebSocket connection (routed through LoadBalancer)  
 * - GET /api/stats : System statistics and monitoring
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    // Serve the chat application frontend
    if (url.pathname === '/') {
      return new Response(getHTML(), {
        headers: { 'Content-Type': 'text/html' }
      });
    }
    
    // Handle WebSocket connections via LoadBalancer
    if (url.pathname === '/ws') {
      return handleWebSocket(request, env);
    }
    
    // Provide system statistics for monitoring
    if (url.pathname === '/api/stats') {
      return handleStats(env);
    }
    
    // Provide room list for UI
    if (url.pathname === '/api/rooms') {
      return handleRoomList(env);
    }
    
    return new Response('Not Found', { status: 404 });
  }
};

/**
 * Handles WebSocket connection requests by routing them through the LoadBalancer.
 * Extracts connection parameters and forwards to LoadBalancer for room assignment.
 * 
 * @param request - The incoming WebSocket upgrade request
 * @param env - Cloudflare Workers environment with Durable Object bindings
 * @returns Response with WebSocket upgrade or error
 */
async function handleWebSocket(request: Request, env: Env): Promise<Response> {
  console.log('Main handleWebSocket called');
  
  // Validate WebSocket upgrade headers
  const upgradeHeader = request.headers.get('Upgrade');
  if (!upgradeHeader || upgradeHeader !== 'websocket') {
    console.log('Missing or invalid Upgrade header:', upgradeHeader);
    return new Response('Expected Upgrade: websocket', { status: 426 });
  }
  
  // Extract connection parameters from URL
  const url = new URL(request.url);
  const roomId = url.searchParams.get('room') || 'general';
  const userId = url.searchParams.get('userId') || crypto.randomUUID();
  const username = url.searchParams.get('username') || 'User' + Math.floor(Math.random() * 1000);
  
  console.log('WebSocket params from URL:', { roomId, userId, username });
  
  // Get singleton LoadBalancer instance
  const loadBalancerId = env.LOAD_BALANCER.idFromName('singleton');
  const loadBalancer = env.LOAD_BALANCER.get(loadBalancerId);
  
  console.log('About to create request for LoadBalancer');
  
  // Prepare request for LoadBalancer with connection parameters
  const loadBalancerUrl = new URL(request.url);
  loadBalancerUrl.pathname = '/';
  
  // Pass connection details as URL parameters
  loadBalancerUrl.searchParams.set('room', roomId);
  loadBalancerUrl.searchParams.set('userId', userId);
  loadBalancerUrl.searchParams.set('username', username);
  
  // Forward WebSocket headers required for upgrade
  const loadBalancerRequest = new Request(loadBalancerUrl.toString(), {
    method: 'GET',
    headers: {
      'Upgrade': request.headers.get('Upgrade') || '',
      'Connection': request.headers.get('Connection') || '',
      'Sec-WebSocket-Key': request.headers.get('Sec-WebSocket-Key') || '',
      'Sec-WebSocket-Version': request.headers.get('Sec-WebSocket-Version') || ''
    }
  });
  
  // Delegate to LoadBalancer for room assignment and connection handling
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

/**
 * Provides system statistics by querying the LoadBalancer.
 * Used for monitoring room capacity, user counts, and system health.
 * 
 * @param env - Environment with Durable Object bindings
 * @returns JSON response with aggregated statistics
 */
async function handleStats(env: Env): Promise<Response> {
  const loadBalancerId = env.LOAD_BALANCER.idFromName('singleton');
  const loadBalancer = env.LOAD_BALANCER.get(loadBalancerId);
  
  const response = await loadBalancer.fetch(new Request('https://loadbalancer/stats'));
  return response;
}

/**
 * Provides a list of available rooms with their basic information.
 * Used by the UI to display room selection options.
 * 
 * @param env - Environment with Durable Object bindings  
 * @returns JSON response with room list and metadata
 */
async function handleRoomList(env: Env): Promise<Response> {
  const loadBalancerId = env.LOAD_BALANCER.idFromName('singleton');
  const loadBalancer = env.LOAD_BALANCER.get(loadBalancerId);
  
  // Get stats which contain room information
  const response = await loadBalancer.fetch(new Request('https://loadbalancer/stats'));
  const stats = await response.json() as any;
  
  // Transform room stats into a simplified room list
  const rooms = Object.entries(stats.roomStats || {}).map(([roomId, roomData]: [string, any]) => ({
    id: roomId,
    name: roomId.charAt(0).toUpperCase() + roomId.slice(1), // Capitalize first letter
    userCount: roomData.userCount || 0,
    isActive: roomData.userCount > 0
  }));
  
  // Add some default/popular rooms if no rooms exist
  if (rooms.length === 0) {
    rooms.push(
      { id: 'general', name: 'General', userCount: 0, isActive: false },
      { id: 'random', name: 'Random', userCount: 0, isActive: false },
      { id: 'help', name: 'Help', userCount: 0, isActive: false }
    );
  }
  
  return new Response(JSON.stringify({ rooms }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Generates the complete HTML for the chat application frontend.
 * Includes CSS styling, JavaScript client code, and WebSocket handling.
 * 
 * Features:
 * - Real-time messaging with WebSocket
 * - User presence indicators and typing status
 * - Random username generation on page load
 * - Smart connection toggle button
 * - Live statistics display
 * 
 * @returns Complete HTML document as string
 */
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
    '        .room-list { border: 1px solid #ccc; padding: 10px; margin-bottom: 10px; }',
    '        .room-item { padding: 8px; margin: 2px 0; cursor: pointer; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; }',
    '        .room-item:hover { background-color: #f0f0f0; }',
    '        .room-item.active { background-color: #e3f2fd; }',
    '        .room-item.current { background-color: #2196F3; color: white; }',
    '        .room-name { font-weight: bold; }',
    '        .room-count { font-size: 12px; color: #666; background: #eee; padding: 2px 6px; border-radius: 10px; }',
    '        .room-item.current .room-count { background: rgba(255,255,255,0.2); color: white; }',
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
    '                <input type="text" id="username" value="" />',
    '                <label>Room: </label>',
    '                <input type="text" id="room" value="general" />',
    '                <button id="connection-btn" onclick="toggleConnection()">Connect</button>',
    '            </div>',
    '            <div id="chat-box" class="chat-box"></div>',
    '            <div id="typing-indicator" class="typing-indicator"></div>',
    '            <div class="input-container">',
    '                <input type="text" id="message-input" placeholder="Type your message..." onkeypress="handleKeyPress(event)" oninput="handleTyping()" />',
    '                <button onclick="sendMessage()">Send</button>',
    '            </div>',
    '        </div>',
    '        <div class="sidebar">',
    '            <div class="room-list">',
    '                <h3>Rooms</h3>',
    '                <div id="room-list"></div>',
    '            </div>',
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
    '        let currentRoom = "general";',
    '        let availableRooms = [];',
    '        let isConnecting = false; // Prevent concurrent connections',
    '        let connectionId = 0; // Track current connection to ignore old events',
    '        function generateRandomUsername() {',
    '            const adjectives = ["Swift", "Brave", "Clever", "Bright", "Cool", "Wise", "Kind", "Bold", "Quick", "Smart", "Sharp", "Fast", "Strong", "Wild", "Free"];',
    '            const animals = ["Fox", "Eagle", "Tiger", "Wolf", "Bear", "Lion", "Hawk", "Owl", "Deer", "Rabbit", "Falcon", "Lynx", "Puma", "Otter", "Raven"];',
    '            const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];',
    '            const animal = animals[Math.floor(Math.random() * animals.length)];',
    '            const number = Math.floor(Math.random() * 100);',
    '            return adjective + animal + number;',
    '        }',
    '        async function loadRoomList() {',
    '            try {',
    '                const response = await fetch("/api/rooms");',
    '                const data = await response.json();',
    '                availableRooms = data.rooms;',
    '                updateRoomList();',
    '            } catch (error) {',
    '                console.error("Failed to load room list:", error);',
    '            }',
    '        }',
    '        function updateRoomList() {',
    '            const roomListDiv = document.getElementById("room-list");',
    '            roomListDiv.innerHTML = "";',
    '            availableRooms.forEach(room => {',
    '                const roomDiv = document.createElement("div");',
    '                roomDiv.className = "room-item" + (room.id === currentRoom ? " current" : (room.isActive ? " active" : ""));',
    '                roomDiv.onclick = () => {',
    '                    console.log("Room clicked:", room.id);',
    '                    switchRoom(room.id);',
    '                };',
    '                const nameSpan = document.createElement("span");',
    '                nameSpan.className = "room-name";',
    '                nameSpan.textContent = room.name;',
    '                const countSpan = document.createElement("span");',
    '                countSpan.className = "room-count";',
    '                countSpan.textContent = room.userCount.toString();',
    '                roomDiv.appendChild(nameSpan);',
    '                roomDiv.appendChild(countSpan);',
    '                roomListDiv.appendChild(roomDiv);',
    '            });',
    '        }',
    '        function switchRoom(roomId) {',
    '            console.log("switchRoom called with:", roomId);',
    '            console.log("currentRoom before:", currentRoom);',
    '            if (roomId === currentRoom) {',
    '                console.log("Already in this room, ignoring");',
    '                return;',
    '            }',
    '            const wasConnected = ws && ws.readyState === WebSocket.OPEN;',
    '            console.log("Was connected:", wasConnected);',
    '            if (wasConnected) {',
    '                disconnect();',
    '            }',
    '            currentRoom = roomId;',
    '            document.getElementById("room").value = roomId;',
    '            console.log("currentRoom after update:", currentRoom);',
    '            console.log("room input field value:", document.getElementById("room").value);',
    '            document.getElementById("chat-box").innerHTML = "";',
    '            updateRoomList();',
    '            if (wasConnected) {',
    '                // Add small delay to ensure disconnect completes',
    '                setTimeout(() => connect(), 250);',
    '            }',
    '        }',
    '        function toggleConnection() {',
    '            if (ws && ws.readyState === WebSocket.OPEN) {',
    '                disconnect();',
    '            } else {',
    '                connect();',
    '            }',
    '        }',
    '        function connect() {',
    '            // Prevent concurrent connections',
    '            if (isConnecting) {',
    '                console.log("Already connecting, ignoring duplicate connect call");',
    '                return;',
    '            }',
    '            isConnecting = true;',
    '            connectionId++; // Increment connection ID for this attempt',
    '            const currentConnectionId = connectionId;',
    '            const username = document.getElementById("username").value;',
    '            const roomInputValue = document.getElementById("room").value;',
    '            // Always use the input field value and sync currentRoom',
    '            currentRoom = roomInputValue;',
    '            const room = currentRoom;',
    '            console.log("connect() called, connectionId:", currentConnectionId);',
    '            console.log("room input field:", roomInputValue);',
    '            console.log("currentRoom synced to:", currentRoom);',
    '            console.log("Final room value used for connection:", room);',
    '            const btn = document.getElementById("connection-btn");',
    '            if (ws) { ',
    '                ws.close(); ',
    '                ws = null;',
    '            }',
    '            btn.textContent = "Connecting...";',
    '            btn.disabled = true;',
    '            const protocol = location.protocol === "https:" ? "wss:" : "ws:";',
    '            const wsUrl = protocol + "//" + location.host + "/ws?room=" + room + "&userId=" + userId + "&username=" + username;',
    '            ws = new WebSocket(wsUrl);',
    '            ws.onopen = () => { ',
    '                // Only process if this is still the current connection',
    '                if (currentConnectionId !== connectionId) {',
    '                    console.log("Ignoring onopen for old connection");',
    '                    return;',
    '                }',
    '                isConnecting = false; // Connection successful',
    '                addMessage("Connected to room: " + room, "system"); ',
    '                btn.textContent = "Disconnect";',
    '                btn.disabled = false;',
    '                ws.send(JSON.stringify({ type: "requestUserList" }));',
    '                // Update room list to reflect current connection',
    '                updateRoomList();',
    '                // Refresh room list to make sure new room appears if it did not exist',
    '                loadRoomList();',
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
    '            ws.onclose = () => { ',
    '                // Only process if this is still the current connection',
    '                if (currentConnectionId !== connectionId) {',
    '                    console.log("Ignoring onclose for old connection");',
    '                    return;',
    '                }',
    '                isConnecting = false; // Reset connection state',
    '                addMessage("Disconnected", "system"); ',
    '                btn.textContent = "Connect";',
    '                btn.disabled = false;',
    '            };',
    '            ws.onerror = (error) => { ',
    '                // Only process if this is still the current connection',
    '                if (currentConnectionId !== connectionId) {',
    '                    console.log("Ignoring onerror for old connection");',
    '                    return;',
    '                }',
    '                isConnecting = false; // Reset connection state on error',
    '                addMessage("Error: " + error, "system"); ',
    '                btn.textContent = "Connect";',
    '                btn.disabled = false;',
    '            };',
    '        }',
    '        function disconnect() { ',
    '            if (ws) { ',
    '                const btn = document.getElementById("connection-btn");',
    '                isConnecting = false; // Reset connection state',
    '                ws.close(); ',
    '                ws = null; ',
    '                btn.textContent = "Connect";',
    '                btn.disabled = false;',
    '                addMessage("Disconnected", "system");',
    '            }',
    '        }',
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
    '            const currentUsername = document.getElementById("username").value;',
    '            // Filter out the current user from typing indicators',
    '            const otherTypingUsers = typingUsers.filter(username => username !== currentUsername);',
    '            if (otherTypingUsers.length === 0) {',
    '                indicator.textContent = "";',
    '            } else if (otherTypingUsers.length === 1) {',
    '                indicator.textContent = otherTypingUsers[0] + " is typing...";',
    '            } else {',
    '                indicator.textContent = otherTypingUsers.join(", ") + " are typing...";',
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
    '                // Also refresh room list',
    '                await loadRoomList();',
    '            } catch (error) { console.error("Failed to load stats:", error); }',
    '        }, 5000);',
    '        // Initialize page on load',
    '        document.addEventListener("DOMContentLoaded", async function() {',
    '            document.getElementById("username").value = generateRandomUsername();',
    '            // Set initial room from input field',
    '            currentRoom = document.getElementById("room").value;',
    '            await loadRoomList();',
    '        });',
    '    </script>',
    '</body>',
    '</html>'
  ];
  
  return htmlParts.join('\n');
}