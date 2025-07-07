import { Message, User, WebSocketSession } from './types';
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

  constructor(state: DurableObjectState, env: any) {
    this.state = state;
    this.env = env;
    this.overloadProtection = new OverloadProtectionManager();
  }

  async fetch(request: Request): Promise<Response> {
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
    
    return new Response('Not Found', { status: 404 });
  }

  private async handleWebSocket(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');
    const username = url.searchParams.get('username');
    const roomId = url.searchParams.get('roomId');
    
    if (!userId || !username || !roomId) {
      return new Response('Missing required parameters', { status: 400 });
    }
    
    this.roomId = roomId;
    
    if (this.sessions.size >= this.maxCapacity) {
      return new Response('Room at capacity', { status: 503 });
    }
    
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    
    const session: WebSocketSession = {
      websocket: server,
      userId,
      username,
      roomId,
      lastPing: Date.now()
    };
    
    this.sessions.set(userId, session);
    this.overloadProtection.updateConnectionCount(this.sessions.size);
    
    const user: User = {
      id: userId,
      username,
      connectedAt: Date.now()
    };
    this.users.set(userId, user);
    
    server.accept();
    
    server.addEventListener('message', (event) => {
      this.handleMessage(userId, event.data);
    });
    
    server.addEventListener('close', () => {
      this.handleDisconnect(userId);
    });
    
    server.addEventListener('error', (event) => {
      console.error('WebSocket error:', event);
      this.handleDisconnect(userId);
    });
    
    this.broadcastUserJoined(user);
    this.sendRecentMessages(server);
    this.updateActivity();
    
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
      messageCount: this.messages.length
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private handleMessage(userId: string, data: string): void {
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

  private handleDisconnect(userId: string): void {
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
      this.updateActivity();
    }
  }

  private broadcastMessage(message: Message, excludeUserId?: string): void {
    const messageStr = JSON.stringify(message);
    
    for (const [userId, session] of this.sessions.entries()) {
      if (excludeUserId && userId === excludeUserId) {
        continue;
      }
      
      try {
        if (session.websocket.readyState === WebSocket.OPEN) {
          session.websocket.send(messageStr);
        }
      } catch (error) {
        console.error('Error sending message to user:', userId, error);
        this.handleDisconnect(userId);
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
        if (websocket.readyState === WebSocket.OPEN) {
          websocket.send(JSON.stringify(message));
        }
      } catch (error) {
        console.error('Error sending recent message:', error);
      }
    }
  }

  private updateActivity(): void {
    this.lastActivity = Date.now();
  }

  async cleanup(): Promise<void> {
    const now = Date.now();
    const staleTimeout = 30 * 1000; // 30 seconds
    
    for (const [userId, session] of this.sessions.entries()) {
      if (now - session.lastPing > staleTimeout) {
        console.log('Cleaning up stale session:', userId);
        this.handleDisconnect(userId);
      }
    }
  }
}