import { vi } from 'vitest';
import { User, Message, WebSocketSession, WebSocketMetadata } from './types';

type DurableObjectJurisdiction = 'eu' | 'fedramp';
type StorageValue = string | number | boolean | object | null;

interface WebSocketRequestResponsePair {
  request: Request;
  response: Response;
}

interface DurableObjectTransaction {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  list<T>(options?: { prefix?: string }): Promise<Map<string, T>>;
  rollback(): void;
}

type SqlValue = string | number | boolean | null | ArrayBuffer;

interface SqlStorageResult {
  results: SqlRow[];
  success: boolean;
  meta: {
    duration: number;
  };
}

interface SqlRow {
  [key: string]: SqlValue;
}

interface WebSocketSerializedAttachment {
  [key: string]: string | number | boolean | null;
}

interface DurableObjectGetOptions {
  allowConcurrency?: boolean;
  noCache?: boolean;
}

interface DurableObjectPutOptions {
  allowConcurrency?: boolean;
  allowUnconfirmed?: boolean;
  noCache?: boolean;
}

// Mock Durable Object State
export class MockDurableObjectState {
  private storageMap = new Map<string, StorageValue>();
  private alarms = new Map<string, number>();

  // Required DurableObjectState properties
  id = { 
    toString: () => 'mock-id',
    equals: (other: DurableObjectId) => other.toString() === 'mock-id'
  };
  
  waitUntil(promise: Promise<void>): void {
    // Mock implementation
  }
  
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
    return callback();
  }
  
  setWebSocketAutoResponse(requestResponsePair?: WebSocketRequestResponsePair): void {
    // Mock implementation
  }
  
  getWebSocketAutoResponse(): WebSocketRequestResponsePair | null {
    return null;
  }
  
  getWebSocketAutoResponseTimestamp(ws: WebSocket): Date | null {
    return null;
  }
  
  getTags(ws: WebSocket): string[] {
    return [];
  }
  
  abort(reason?: string): void {
    // Mock implementation
  }
  
  setHibernatableWebSocketEventTimeout(timeoutMs?: number): void {
    // Mock implementation
  }
  
  getHibernatableWebSocketEventTimeout(): number | null {
    return null;
  }
  
  // Add storage property that the Room class expects
  public storage = {
    get: async <T>(keyOrKeys: string | string[], options?: DurableObjectGetOptions): Promise<T | undefined> => {
      if (Array.isArray(keyOrKeys)) {
        // Handle array of keys case
        const result = new Map<string, T>();
        for (const key of keyOrKeys) {
          const value = this.storageMap.get(key);
          if (value !== undefined) {
            result.set(key, value as T);
          }
        }
        return result as T;
      } else {
        // Handle single key case
        return this.storageMap.get(keyOrKeys) as T | undefined;
      }
    },
    put: async <T>(keyOrEntries: string | Record<string, T>, valueOrOptions?: T | DurableObjectPutOptions, options?: DurableObjectPutOptions): Promise<void> => {
      if (typeof keyOrEntries === 'string') {
        // Handle single key-value case
        this.storageMap.set(keyOrEntries, valueOrOptions as StorageValue);
      } else {
        // Handle multiple entries case
        for (const [key, value] of Object.entries(keyOrEntries)) {
          this.storageMap.set(key, value as StorageValue);
        }
      }
    },
    delete: async (key: string): Promise<void> => {
      this.storageMap.delete(key);
    },
    list: async <T>(options?: { prefix?: string }): Promise<Map<string, T>> => {
      const result = new Map<string, T>();
      for (const [key, value] of this.storageMap) {
        if (!options?.prefix || key.startsWith(options.prefix)) {
          result.set(key, value as T);
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
    },
    // Add missing DurableObjectStorage methods
    deleteAll: async (): Promise<void> => {
      this.storageMap.clear();
    },
    transaction: async <T>(closure: (txn: DurableObjectTransaction) => Promise<T>): Promise<T> => {
      // Mock transaction - just execute the closure
      const mockTxn = {} as DurableObjectTransaction;
      return await closure(mockTxn);
    },
    sync: async (): Promise<void> => {
      // Mock sync - no-op
    },
    sql: {
      exec: async (query: string, ...params: SqlValue[]): Promise<SqlStorageResult> => {
        return { results: [], success: true, meta: { duration: 0 } };
      }
    },
    getCurrentBookmark: (): string | null => null,
    getBookmarkForTime: (timestamp: number): string | null => null,
    onNextSessionRestoreBookmark: (bookmark: string): void => {},
    getCurrentSerial: (): number => 0,
    transactionSync: <T>(closure: (txn: DurableObjectTransaction) => T): T => {
      const mockTxn = {} as DurableObjectTransaction;
      return closure(mockTxn);
    }
  };
  
  async get<T>(key: string): Promise<T | undefined> {
    return this.storageMap.get(key) as T | undefined;
  }
  
  async put<T>(key: string, value: T): Promise<void> {
    this.storageMap.set(key, value as StorageValue);
  }
  
  async delete(key: string): Promise<void> {
    this.storageMap.delete(key);
  }
  
  async list<T>(options?: { prefix?: string }): Promise<Map<string, T>> {
    const result = new Map<string, T>();
    for (const [key, value] of this.storageMap) {
      if (!options?.prefix || key.startsWith(options.prefix)) {
        result.set(key, value as T);
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
  
  acceptWebSocket(webSocket: WebSocket, metadata?: string[]): void {
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
      this.onclose({ type: 'close' } as CloseEvent);
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
      this.onmessage({ data, type: 'message' } as MessageEvent);
    }
  }
}

// Mock Environment
export interface MockEnv {
  ROOMS: MockDurableObjectNamespace;
  LOAD_BALANCER: MockDurableObjectNamespace;
}

export class MockDurableObjectNamespace {
  private objects = new Map<string, MockDurableObjectStub>();
  
  idFromName(name: string): MockDurableObjectId {
    return new MockDurableObjectId(name);
  }
  
  idFromString(id: string): MockDurableObjectId {
    return new MockDurableObjectId(id);
  }
  
  get(id: MockDurableObjectId): MockDurableObjectStub {
    if (!this.objects.has(id.toString())) {
      this.objects.set(id.toString(), new MockDurableObjectStub(id));
    }
    return this.objects.get(id.toString())!;
  }
  
  // Add missing methods for DurableObjectNamespace interface
  newUniqueId(): MockDurableObjectId {
    return new MockDurableObjectId('unique-' + Math.random().toString(36).substr(2, 9));
  }
  
  jurisdiction(jurisdiction: DurableObjectJurisdiction): MockDurableObjectNamespace {
    return new MockDurableObjectNamespace();
  }
  
  clear(): void {
    this.objects.clear();
  }
}

export class MockDurableObjectId {
  public name: string;
  
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
  public readonly id: MockDurableObjectId;
  public readonly name?: string;
  private responses = new Map<string, Response>();
  
  constructor(id: MockDurableObjectId) {
    this.id = id;
    this.name = id.toString();
    // Set up default responses for common endpoints
    this.setupDefaultResponses();
  }
  
  private setupDefaultResponses(): void {
    // Default LoadBalancer responses - use 200 for testing (Node.js doesn't support 101)
    this.responses.set('/', new Response(null, {
      status: 200
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

  // Mock connect method for DurableObjectStub interface
  connect(): never {
    throw new Error('Mock connect not implemented');
  }

  // RPC Methods for LoadBalancer DO
  async getStats() {
    return {
      totalRooms: 0,
      totalUsers: 0,
      roomStats: {}
    };
  }

  getHealth() {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      loadBalancer: {
        totalRooms: 0,
        totalUsers: 0,
        overloadedRooms: 0
      },
      protection: {
        circuitBreaker: { state: 'CLOSED', failures: 0 },
        rateLimiter: { activeIdentifiers: 0 },
        connectionMonitor: { status: 'healthy', connections: 0, requests: 0, issues: [] }
      },
      uptime: 0
    };
  }

  async getMetrics() {
    return {
      timestamp: new Date().toISOString(),
      loadMetrics: {
        averageLoad: 0,
        overloadedRooms: 0,
        totalCapacity: 0,
        utilizationRate: 0
      },
      protection: {
        circuitBreaker: { state: 'CLOSED', failures: 0 },
        rateLimiter: { activeIdentifiers: 0 },
        connectionMonitor: { status: 'healthy', connections: 0, requests: 0, issues: [] }
      },
      rooms: {},
      system: {
        totalRooms: 0,
        totalUsers: 0,
        averageRoomSize: 0,
        utilizationRate: 0
      }
    };
  }

  updateStats(roomId: string, userCount: number, isOverloaded: boolean) {
    return { success: true };
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
  // Create a proper WebSocket-like mock with all required properties
  const mockWebSocket = new MockWebSocket('ws://test');
  
  // Create a complete WebSocket interface implementation
  const completeWebSocket: WebSocket = {
    // Copy existing MockWebSocket properties
    url: mockWebSocket.url,
    readyState: mockWebSocket.readyState,
    onopen: mockWebSocket.onopen,
    onclose: mockWebSocket.onclose,
    onmessage: mockWebSocket.onmessage,
    onerror: mockWebSocket.onerror,
    send: mockWebSocket.send.bind(mockWebSocket),
    close: mockWebSocket.close.bind(mockWebSocket),
    
    // Add required WebSocket properties
    binaryType: 'blob',
    bufferedAmount: 0,
    extensions: '',
    protocol: '',
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    
    // Add Cloudflare-specific WebSocket properties
    accept: (): void => {},
    serializeAttachment: (attachment: WebSocketSerializedAttachment): string => '',
    deserializeAttachment: (): WebSocketSerializedAttachment => ({})
  };
  
  return {
    websocket: completeWebSocket,
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