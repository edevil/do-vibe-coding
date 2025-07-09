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
    acceptWebSocket(webSocket: WebSocket, metadata?: string[]): void;
    getWebSockets(): WebSocket[];
  }
  
  interface DurableObjectNamespace {
    idFromName(name: string): DurableObjectId;
    idFromString(id: string): DurableObjectId;
    get(id: DurableObjectId): DurableObjectStub;
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
const mockCrypto: Crypto = {
  randomUUID: () => 'test-uuid-' + Math.random().toString(36).substr(2, 9) as `${string}-${string}-${string}-${string}-${string}`,
  subtle: {} as SubtleCrypto,
  getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
    if (array && array instanceof Uint8Array) {
      for (let i = 0; i < array.length; i++) {
        array[i] = Math.floor(Math.random() * 256);
      }
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
interface WebSocketConstructor {
  new (url: string | URL, protocols?: string | string[]): WebSocket;
  prototype: WebSocket;
  readonly CONNECTING: 0;
  readonly OPEN: 1;
  readonly CLOSING: 2;
  readonly CLOSED: 3;
}
globalThis.WebSocket = MockWebSocket as WebSocketConstructor;
// MockWebSocketPair class that creates connected WebSocket pairs
class MockWebSocketPairClass {
  constructor() {
    const ws1 = new MockWebSocket('');
    const ws2 = new MockWebSocket('');
    return [ws1, ws2];
  }
}
// Add WebSocketPair to global
(globalThis as unknown as { WebSocketPair: typeof MockWebSocketPairClass }).WebSocketPair = MockWebSocketPairClass;

// Mock DurableObject for testing
class MockDurableObject {
  constructor(state: DurableObjectState, env: unknown) {}
}

// Mock cloudflare:workers module
vi.mock('cloudflare:workers', () => ({
  DurableObject: MockDurableObject
}));
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
interface SetTimeoutMock {
  (fn: Function, delay: number): number;
  __promisify__: <T = void>(delay?: number, value?: T, options?: { signal?: AbortSignal }) => Promise<T>;
}
// Create a proper setTimeout mock with __promisify__
const setTimeoutMock = vi.fn((fn: Function, delay: number) => {
  return Number(setImmediate(() => fn()));
});
// Add the promisify method directly to the mock function
const mockWithPromise = setTimeoutMock as unknown as typeof setTimeoutMock & { __promisify__: typeof setTimeout.__promisify__ };
mockWithPromise.__promisify__ = <T = void>(delay?: number, value?: T, options?: { signal?: AbortSignal }) => 
  Promise.resolve(value as T);
globalThis.setTimeout = mockWithPromise as unknown as typeof setTimeout;
interface ClearTimeoutMock {
  (id: number | undefined): void;
  (timeoutId: number | null): void;
  (timeout: string | number | undefined): void;
}
globalThis.clearTimeout = vi.fn((id: string | number | null | undefined) => {
  if (typeof id === 'number') {
    // Type assertion for clearImmediate compatibility
    clearImmediate(id as unknown as NodeJS.Immediate);
  }
}) as unknown as typeof clearTimeout;