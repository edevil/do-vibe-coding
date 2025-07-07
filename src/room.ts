import { Message, User, WebSocketSession, WebSocketMetadata } from './types';
import { OverloadProtectionManager } from './overloadProtection';

export class Room {
  private state: DurableObjectState;
  private env: any;
  private sessions: Map<string, WebSocketSession> = new Map();
  private users: Map<string, User> = new Map();
  private messages: Message[] = [];
  private maxCapacity: number = 100;
  private lastActivity: number = Date.now();
  private roomId: string = '';
  private overloadProtection: OverloadProtectionManager;
  private hibernationTimeout: number | null = null;
  private isHibernating: boolean = false;

  constructor(state: DurableObjectState, env: any) {
    this.state = state;
    this.env = env;
    this.overloadProtection = new OverloadProtectionManager();
    
    // Enable hibernation API for WebSockets
    this.state.acceptWebSocket = this.state.acceptWebSocket?.bind(this.state);
  }

  async loadPersistedState(): Promise<void> {
    try {
      // Load room metadata
      const roomData = await this.state.storage.get('roomData');
      if (roomData) {
        const data = roomData as any;
        this.roomId = data.roomId || '';
        this.maxCapacity = data.maxCapacity || 100;
        this.lastActivity = data.lastActivity || Date.now();
      }

      // Load message history
      const messageHistory = await this.state.storage.get('messages');
      if (messageHistory) {
        this.messages = messageHistory as Message[];
      }

      // Load user list (active users will reconnect)
      const userList = await this.state.storage.get('users');
      if (userList) {
        this.users = new Map(userList as [string, User][]);
      }

      console.log(`Room ${this.roomId} loaded state:`, {
        messageCount: this.messages.length,
        userCount: this.users.size,
        lastActivity: new Date(this.lastActivity)
      });
    } catch (error) {
      console.error('Error loading persisted state:', error);
    }
  }

  async saveRoomData(): Promise<void> {
    try {
      await this.state.storage.put('roomData', {
        roomId: this.roomId,
        maxCapacity: this.maxCapacity,
        lastActivity: this.lastActivity
      });
    } catch (error) {
      console.error('Error saving room data:', error);
    }
  }

  async saveMessages(): Promise<void> {
    try {
      // Keep only last 100 messages
      const messagesToSave = this.messages.slice(-100);
      await this.state.storage.put('messages', messagesToSave);
    } catch (error) {
      console.error('Error saving messages:', error);
    }
  }

  async saveUsers(): Promise<void> {
    try {
      await this.state.storage.put('users', Array.from(this.users.entries()));
    } catch (error) {
      console.error('Error saving users:', error);
    }
  }

  async fetch(request: Request): Promise<Response> {
    // Load persisted state on first request
    if (!this.roomId) {
      await this.loadPersistedState();
    }
    
    const url = new URL(request.url);
    
    if (request.method === 'GET' && url.pathname === '/websocket') {
      return this.handleWebSocket(request);
    }
    
    if (request.method === 'POST' && url.pathname === '/join') {
      return this.handleJoin(request);
    }
    
    if (request.method === 'GET' && url.pathname === '/stats') {
      return this.handleStats();
    }
    
    if (request.method === 'POST' && url.pathname === '/hibernate') {
      return this.handleHibernation();
    }
    
    return new Response('Not Found', { status: 404 });
  }

  private async handleWebSocket(request: Request): Promise<Response> {
    console.log('Room handleWebSocket called');
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');
    const username = url.searchParams.get('username');
    const roomId = url.searchParams.get('roomId');
    
    console.log('WebSocket params:', { userId, username, roomId });
    
    if (!userId || !username || !roomId) {
      console.log('Missing required parameters');
      return new Response('Missing required parameters', { status: 400 });
    }
    
    this.roomId = roomId;
    
    if (this.sessions.size >= this.maxCapacity) {
      return new Response('Room at capacity', { status: 503 });
    }
    
    // Wake from hibernation if needed
    if (this.isHibernating) {
      console.log(`Room ${this.roomId} waking from hibernation`);
      this.isHibernating = false;
    }
    
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    
    // Create metadata for hibernation
    const metadata: WebSocketMetadata = {
      userId,
      username,
      roomId,
      connectedAt: Date.now()
    };
    
    // Use hibernation API instead of server.accept()
    this.state.acceptWebSocket?.(server, [userId, JSON.stringify(metadata)]);
    
    const session: WebSocketSession = {
      websocket: server,
      userId,
      username,
      roomId,
      lastPing: Date.now(),
      connectedAt: metadata.connectedAt
    };
    
    this.sessions.set(userId, session);
    this.overloadProtection.updateConnectionCount(this.sessions.size);
    
    const user: User = {
      id: userId,
      username,
      connectedAt: Date.now()
    };
    this.users.set(userId, user);
    
    // Persist user list
    await this.saveUsers();
    
    this.broadcastUserJoined(user);
    this.sendRecentMessages(server);
    await this.updateActivity();
    
    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  private async handleJoin(request: Request): Promise<Response> {
    const body = await request.json() as { userId: string; username: string; roomId: string };
    const { userId, username, roomId } = body;
    
    this.roomId = roomId;
    
    if (this.sessions.size >= this.maxCapacity) {
      return new Response(JSON.stringify({ 
        error: 'Room at capacity',
        capacity: this.maxCapacity,
        current: this.sessions.size 
      }), { 
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 426 });
    }
    
    const url = new URL(request.url);
    url.searchParams.set('userId', userId);
    url.searchParams.set('username', username);
    url.searchParams.set('roomId', roomId);
    
    const newRequest = new Request(url.toString(), {
      method: 'GET',
      headers: request.headers
    });
    
    return this.handleWebSocket(newRequest);
  }

  private async handleStats(): Promise<Response> {
    return new Response(JSON.stringify({
      roomId: this.roomId,
      userCount: this.sessions.size,
      maxCapacity: this.maxCapacity,
      isOverloaded: this.sessions.size > this.maxCapacity * 0.8,
      lastActivity: this.lastActivity,
      users: Array.from(this.users.values()),
      messageCount: this.messages.length,
      isHibernating: this.isHibernating,
      persistedMessages: this.messages.length,
      activeConnections: this.sessions.size
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private async handleMessage(userId: string, data: string): Promise<void> {
    try {
      const parsedData = JSON.parse(data);
      const session = this.sessions.get(userId);
      
      if (!session) {
        console.error('Session not found for user:', userId);
        return;
      }
      
      if (parsedData.type === 'ping') {
        session.lastPing = Date.now();
        session.websocket.send(JSON.stringify({ type: 'pong' }));
        return;
      }
      
      if (parsedData.type === 'message') {
        const message: Message = {
          id: crypto.randomUUID(),
          roomId: this.roomId,
          userId,
          username: session.username,
          content: parsedData.content,
          timestamp: Date.now(),
          type: 'message'
        };
        
        this.messages.push(message);
        
        if (this.messages.length > 100) {
          this.messages = this.messages.slice(-100);
        }
        
        // Persist messages periodically
        if (this.messages.length % 10 === 0) {
          await this.saveMessages();
        }
        
        this.broadcastMessage(message);
        this.updateActivity();
      }
      
      if (parsedData.type === 'typing') {
        const typingMessage: Message = {
          id: crypto.randomUUID(),
          roomId: this.roomId,
          userId,
          username: session.username,
          content: '',
          timestamp: Date.now(),
          type: 'typing'
        };
        
        this.broadcastMessage(typingMessage, userId);
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  }

  private async handleDisconnect(userId: string): Promise<void> {
    const session = this.sessions.get(userId);
    if (session) {
      this.sessions.delete(userId);
      this.users.delete(userId);
      this.overloadProtection.updateConnectionCount(this.sessions.size);
      
      const leaveMessage: Message = {
        id: crypto.randomUUID(),
        roomId: this.roomId,
        userId,
        username: session.username,
        content: `${session.username} left the room`,
        timestamp: Date.now(),
        type: 'leave'
      };
      
      this.broadcastMessage(leaveMessage);
      await this.updateActivity();
      
      // Persist updated user list
      await this.saveUsers();
      
      // Start hibernation timer if room is empty
      if (this.sessions.size === 0) {
        this.resetHibernationTimer();
      }
    }
  }

  private broadcastMessage(message: Message, excludeUserId?: string): void {
    const messageStr = JSON.stringify(message);
    
    for (const [userId, session] of this.sessions.entries()) {
      if (excludeUserId && userId === excludeUserId) {
        continue;
      }
      
      try {
        // With hibernation API, we can send to any WebSocket state
        // Hibernated connections will automatically wake up
        session.websocket.send(messageStr);
      } catch (error) {
        console.error('Error sending message to user:', userId, error);
        this.handleDisconnect(userId).catch(console.error);
      }
    }
  }

  private broadcastUserJoined(user: User): void {
    const joinMessage: Message = {
      id: crypto.randomUUID(),
      roomId: this.roomId,
      userId: user.id,
      username: user.username,
      content: `${user.username} joined the room`,
      timestamp: Date.now(),
      type: 'join'
    };
    
    this.broadcastMessage(joinMessage);
  }

  private sendRecentMessages(websocket: WebSocket): void {
    const recentMessages = this.messages.slice(-10);
    
    for (const message of recentMessages) {
      try {
        // With hibernation API, we can send regardless of readyState
        websocket.send(JSON.stringify(message));
      } catch (error) {
        console.error('Error sending recent message:', error);
      }
    }
  }

  private async updateActivity(): Promise<void> {
    this.lastActivity = Date.now();
    await this.saveRoomData();
    this.resetHibernationTimer();
  }

  private resetHibernationTimer(): void {
    if (this.hibernationTimeout) {
      clearTimeout(this.hibernationTimeout);
    }
    
    // Set hibernation timer for 5 minutes of inactivity
    this.hibernationTimeout = setTimeout(() => {
      this.scheduleHibernation();
    }, 5 * 60 * 1000); // 5 minutes
  }

  private async scheduleHibernation(): Promise<void> {
    if (this.sessions.size === 0 && !this.isHibernating) {
      console.log(`Room ${this.roomId} entering hibernation after inactivity`);
      
      // Save final state
      await this.saveMessages();
      await this.saveUsers();
      await this.saveRoomData();
      
      // Set alarm to wake up if needed
      const now = Date.now();
      const wakeUpTime = now + (24 * 60 * 60 * 1000); // 24 hours
      await this.state.storage.setAlarm(wakeUpTime);
      
      this.isHibernating = true;
    }
  }

  private async handleHibernation(): Promise<Response> {
    if (this.sessions.size === 0) {
      await this.scheduleHibernation();
      return new Response(JSON.stringify({ hibernated: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(JSON.stringify({ hibernated: false, activeUsers: this.sessions.size }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Alarm handler for scheduled tasks
  async alarm(): Promise<void> {
    console.log(`Room ${this.roomId} alarm triggered`);
    
    // Clean up old messages (keep only last 50)
    if (this.messages.length > 50) {
      this.messages = this.messages.slice(-50);
      await this.saveMessages();
    }
    
    // Clean up inactive users
    const now = Date.now();
    const inactiveThreshold = 7 * 24 * 60 * 60 * 1000; // 7 days
    
    for (const [userId, user] of this.users.entries()) {
      if (now - user.connectedAt > inactiveThreshold) {
        this.users.delete(userId);
      }
    }
    
    await this.saveUsers();
    
    // Schedule next cleanup in 24 hours
    const nextAlarm = now + (24 * 60 * 60 * 1000);
    await this.state.storage.setAlarm(nextAlarm);
    
    console.log(`Room ${this.roomId} cleanup completed, next alarm at ${new Date(nextAlarm)}`);
  }

  // Hibernation API event handlers
  async webSocketMessage(ws: WebSocket, message: string): Promise<void> {
    
    // Get WebSocket metadata
    const tags = this.state.getTags?.(ws) || [];
    const userId = tags[0];
    const metadataStr = tags[1];
    
    if (!userId || !metadataStr) {
      console.error('Missing WebSocket metadata');
      return;
    }
    
    let metadata: WebSocketMetadata;
    try {
      metadata = JSON.parse(metadataStr);
    } catch (error) {
      console.error('Error parsing WebSocket metadata:', error);
      return;
    }
    
    // Ensure session exists
    if (!this.sessions.has(userId)) {
      const session: WebSocketSession = {
        websocket: ws,
        userId,
        username: metadata.username,
        roomId: metadata.roomId,
        lastPing: Date.now(),
        connectedAt: metadata.connectedAt
      };
      this.sessions.set(userId, session);
      
      const user: User = {
        id: userId,
        username: metadata.username,
        connectedAt: metadata.connectedAt
      };
      this.users.set(userId, user);
    }
    
    await this.handleMessage(userId, message);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    console.log('WebSocket closed via hibernation API:', { code, reason, wasClean });
    
    // Get WebSocket metadata
    const tags = this.state.getTags?.(ws) || [];
    const userId = tags[0];
    
    if (userId) {
      await this.handleDisconnect(userId);
    }
  }

  async webSocketError(ws: WebSocket, error: Error): Promise<void> {
    console.error('WebSocket error via hibernation API:', error);
    
    // Get WebSocket metadata
    const tags = this.state.getTags?.(ws) || [];
    const userId = tags[0];
    
    if (userId) {
      await this.handleDisconnect(userId);
    }
  }

  async cleanup(): Promise<void> {
    const now = Date.now();
    const staleTimeout = 30 * 1000; // 30 seconds
    
    for (const [userId, session] of this.sessions.entries()) {
      if (now - session.lastPing > staleTimeout) {
        console.log('Cleaning up stale session:', userId);
        await this.handleDisconnect(userId);
      }
    }
  }
}