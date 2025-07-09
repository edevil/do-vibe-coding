import { vi } from 'vitest';
import { User, Message, WebSocketSession, WebSocketMetadata } from './types';

// Mock Durable Object State
export class MockDurableObjectState {
  private storageMap = new Map<string, any>();
  private alarms = new Map<string, number>();
  
  // Add storage property that the Room class expects
  public storage = {
    get: async <T>(key: string): Promise<T | undefined> => {
      return this.storageMap.get(key);
    },
    put: async <T>(key: string, value: T): Promise<void> => {
      this.storageMap.set(key, value);
    },
    delete: async (key: string): Promise<void> => {
      this.storageMap.delete(key);
    },
    list: async <T>(options?: { prefix?: string }): Promise<Map<string, T>> => {
      const result = new Map<string, T>();
      for (const [key, value] of this.storageMap) {
        if (!options?.prefix || key.startsWith(options.prefix)) {
          result.set(key, value);
        }
      }
      return result;
    },
    setAlarm: async (time: number): Promise<void> => {
      this.alarms.set('alarm', time);
    },
    getAlarm: async (): Promise<number | null> => {
      return this.alarms.get('alarm') || null;
    },
    deleteAlarm: async (): Promise<void> => {
      this.alarms.delete('alarm');
    }
  };
  
  async get<T>(key: string): Promise<T | undefined> {
    return this.storageMap.get(key);
  }
  
  async put<T>(key: string, value: T): Promise<void> {
    this.storageMap.set(key, value);
  }
  
  async delete(key: string): Promise<void> {
    this.storageMap.delete(key);
  }
  
  async list<T>(options?: { prefix?: string }): Promise<Map<string, T>> {
    const result = new Map<string, T>();
    for (const [key, value] of this.storageMap) {
      if (!options?.prefix || key.startsWith(options.prefix)) {
        result.set(key, value);
      }
    }
    return result;
  }
  
  async setAlarm(scheduledTime: number | Date): Promise<void> {
    const timestamp = typeof scheduledTime === 'number' ? scheduledTime : scheduledTime.getTime();
    this.alarms.set('main', timestamp);
  }
  
  async getAlarm(): Promise<number | null> {
    return this.alarms.get('main') || null;
  }
  
  async deleteAlarm(): Promise<void> {
    this.alarms.delete('main');
  }
  
  acceptWebSocket(webSocket: WebSocket, metadata?: WebSocketMetadata): void {
    // Mock implementation
  }
  
  getWebSockets(): WebSocket[] {
    return [];
  }
  
  clear(): void {
    this.storageMap.clear();
    this.alarms.clear();
  }
}

// Mock WebSocket for testing
export class MockWebSocket {
  url: string;
  readyState: number = 1; // OPEN
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  
  private messageQueue: string[] = [];
  
  constructor(url: string) {
    this.url = url;
  }
  
  send(data: string): void {
    this.messageQueue.push(data);
  }
  
  close(): void {
    this.readyState = 3; // CLOSED
    if (this.onclose) {
      this.onclose({} as CloseEvent);
    }
  }
  
  // Test helper methods
  getMessages(): string[] {
    return [...this.messageQueue];
  }
  
  clearMessages(): void {
    this.messageQueue = [];
  }
  
  simulateMessage(data: string): void {
    if (this.onmessage) {
      this.onmessage({ data } as MessageEvent);
    }
  }
}

// Mock Environment
export interface MockEnv {
  ROOMS: MockDurableObjectNamespace;
  LOAD_BALANCER: MockDurableObjectNamespace;
}

export class MockDurableObjectNamespace {
  private objects = new Map<string, any>();
  
  idFromName(name: string): MockDurableObjectId {
    return new MockDurableObjectId(name);
  }
  
  idFromString(id: string): MockDurableObjectId {
    return new MockDurableObjectId(id);
  }
  
  get(id: MockDurableObjectId): any {
    if (!this.objects.has(id.toString())) {
      this.objects.set(id.toString(), new MockDurableObjectStub(id));
    }
    return this.objects.get(id.toString());
  }
  
  clear(): void {
    this.objects.clear();
  }
}

export class MockDurableObjectId {
  private name: string;
  
  constructor(name: string) {
    this.name = name;
  }
  
  toString(): string {
    return this.name;
  }
  
  equals(other: MockDurableObjectId): boolean {
    return this.name === other.name;
  }
}

export class MockDurableObjectStub {
  private id: MockDurableObjectId;
  private responses = new Map<string, Response>();
  
  constructor(id: MockDurableObjectId) {
    this.id = id;
    // Set up default responses for common endpoints
    this.setupDefaultResponses();
  }
  
  private setupDefaultResponses(): void {
    // Default LoadBalancer responses - use 503 instead of 101 for Node.js compatibility
    this.responses.set('/', new Response(null, {
      status: 503
    }));
    
    this.responses.set('/stats', new Response(JSON.stringify({
      totalRooms: 0,
      totalUsers: 0,
      roomStats: {}
    }), {
      headers: { 'Content-Type': 'application/json' }
    }));
    
    this.responses.set('/health', new Response(JSON.stringify({
      status: 'healthy',
      timestamp: new Date().toISOString()
    }), {
      headers: { 'Content-Type': 'application/json' }
    }));
    
    this.responses.set('/metrics', new Response(JSON.stringify({
      loadBalancer: {
        totalRooms: 0,
        totalUsers: 0
      },
      protection: {
        circuitBreaker: { state: 'CLOSED', failures: 0 },
        rateLimiter: { activeIdentifiers: 0 },
        connectionMonitor: { status: 'healthy', connections: 0, requests: 0, issues: [] }
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    }));
  }
  
  async fetch(request: Request | string): Promise<Response> {
    const url = typeof request === 'string' ? request : request.url;
    const pathname = new URL(url).pathname;
    
    if (this.responses.has(pathname)) {
      return this.responses.get(pathname)!;
    }
    
    // Default response
    return new Response(JSON.stringify({ status: 'ok' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  setResponse(pathname: string, response: Response): void {
    this.responses.set(pathname, response);
  }
  
  getId(): MockDurableObjectId {
    return this.id;
  }
}

// Test data factories
export function createMockUser(overrides: Partial<User> = {}): User {
  return {
    id: 'test-user-id',
    username: 'TestUser',
    connectedAt: Date.now(),
    lastSeen: Date.now(),
    status: 'online',
    isTyping: false,
    ...overrides
  };
}

export function createMockMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'test-message-id',
    roomId: 'test-room',
    userId: 'test-user-id',
    username: 'TestUser',
    content: 'Test message',
    timestamp: Date.now(),
    type: 'message',
    ...overrides
  };
}

export function createMockWebSocketSession(overrides: Partial<WebSocketSession> = {}): WebSocketSession {
  return {
    websocket: new MockWebSocket('ws://test') as any,
    userId: 'test-user-id',
    username: 'TestUser',
    roomId: 'test-room',
    lastPing: Date.now(),
    connectedAt: Date.now(),
    ...overrides
  };
}

export function createMockEnv(): MockEnv {
  return {
    ROOMS: new MockDurableObjectNamespace(),
    LOAD_BALANCER: new MockDurableObjectNamespace()
  };
}

// Helper to create mock Request with proper headers
export function createMockRequest(url: string, options: RequestInit = {}): Request {
  return new Request(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  });
}

// Helper to create WebSocket upgrade request
export function createWebSocketRequest(url: string): Request {
  return new Request(url, {
    headers: {
      'Upgrade': 'websocket',
      'Connection': 'Upgrade',
      'Sec-WebSocket-Key': 'test-key',
      'Sec-WebSocket-Version': '13'
    }
  });
}

// Helper to wait for async operations
export function waitFor(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}