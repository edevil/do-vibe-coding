import { vi } from 'vitest';

// Mock Cloudflare Workers types
declare global {
  interface DurableObjectState {
    get<T>(key: string): Promise<T | undefined>;
    put<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;
    list<T>(options?: { prefix?: string }): Promise<Map<string, T>>;
    setAlarm(scheduledTime: number | Date): Promise<void>;
    getAlarm(): Promise<number | null>;
    deleteAlarm(): Promise<void>;
    acceptWebSocket(webSocket: WebSocket, metadata?: any): void;
    getWebSockets(): WebSocket[];
  }
  
  interface DurableObjectNamespace {
    idFromName(name: string): any;
    idFromString(id: string): any;
    get(id: any): any;
  }
}

// Mock WebSocket for testing
class MockWebSocket {
  url: string;
  readyState: number = 1; // OPEN
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  
  constructor(url: string) {
    this.url = url;
  }
  
  send(data: string) {
    // Mock implementation
  }
  
  close() {
    this.readyState = 3; // CLOSED
    if (this.onclose) {
      this.onclose({} as CloseEvent);
    }
  }
}

// Mock crypto for testing
const mockCrypto = {
  randomUUID: () => 'test-uuid-' + Math.random().toString(36).substr(2, 9),
  subtle: {} as SubtleCrypto,
  getRandomValues: (array: any) => {
    for (let i = 0; i < array.length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
    return array;
  }
};

// Mock WebSocketPair for Cloudflare Workers
class MockWebSocketPair {
  [0]: MockWebSocket;
  [1]: MockWebSocket;
  
  constructor() {
    this[0] = new MockWebSocket('ws://mock1');
    this[1] = new MockWebSocket('ws://mock2');
  }
}

// Setup global mocks
globalThis.WebSocket = MockWebSocket as any;
globalThis.WebSocketPair = MockWebSocketPair as any;
// Don't override crypto if it already exists
if (!globalThis.crypto) {
  globalThis.crypto = mockCrypto;
}
globalThis.Response = Response;
globalThis.Request = Request;
globalThis.Headers = Headers;
globalThis.URL = URL;
globalThis.URLSearchParams = URLSearchParams;
globalThis.console = console;

// Mock fetch for testing
globalThis.fetch = vi.fn(() => 
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
  } as Response)
);

// Mock setTimeout and clearTimeout
globalThis.setTimeout = vi.fn((fn: Function, delay: number) => {
  return Number(setImmediate(fn));
});
globalThis.clearTimeout = vi.fn((id: number) => {
  clearImmediate(id);
});