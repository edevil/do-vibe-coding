# Durable Objects Chat Application

## Project Overview
Real-time multi-room chat application built with Cloudflare Durable Objects, featuring WebSocket hibernation API, load balancing, and comprehensive overload protection.

## Architecture

### Core Components
- **Main Worker** (`src/index.ts`) - Entry point, serves HTML frontend and routes WebSocket connections
- **LoadBalancer DO** (`src/loadBalancer.ts`) - Routes connections to appropriate room instances  
- **Room DO** (`src/room.ts`) - Manages individual chat rooms with persistence and real-time features
- **Overload Protection** (`src/overloadProtection.ts`) - Circuit breaker, rate limiting, and resource monitoring

### Key Features Implemented
- **Multi-room chat** with proper isolation (each room = separate Durable Object instance)
- **Real-time typing indicators** with auto-timeout and self-filtering
- **User presence tracking** (online/away/offline status)
- **WebSocket hibernation API** for persistent connections across isolate restarts
- **Message persistence** with Durable Object storage (last 100 messages)
- **Room discovery UI** with live user counts and activity indicators
- **Overload protection** with rate limiting (20 msg/min per user, 10KB max message size)
- **Random username generation** on page load
- **Smart connection management** to prevent race conditions
- **Comprehensive monitoring** with health checks and detailed metrics
- **Automatic cleanup scheduling** to prevent memory leaks

## Technical Implementation Details

### WebSocket Hibernation API
Uses Cloudflare's hibernation API (`state.acceptWebSocket`) to maintain connections across isolate restarts:
- Connections persist even when Durable Object hibernates
- Metadata attached to connections for context restoration
- Event handlers: `webSocketMessage`, `webSocketClose`, `webSocketError`

### Room Isolation Strategy
- Each room name maps to unique Durable Object instance via `ROOMS.idFromName(roomId)`
- LoadBalancer changed from load-balancing logic to direct room mapping for proper isolation
- Room switching clears chat history and establishes new isolated connection

### Overload Protection Layers
1. **Circuit Breaker** - Prevents cascading failures (10 failure threshold, 1min recovery)
2. **Rate Limiter** - 200 requests/minute per user, sliding window
3. **Connection Monitor** - Tracks active connections (500 max)
4. **Message Limits** - 20 messages/minute per user, 10KB max size

### Connection Race Condition Fixes
- **Connection state guard** (`isConnecting` flag) prevents concurrent connections
- **Connection ID tracking** filters out stale WebSocket events from old connections
- **Proper cleanup** in all event handlers to prevent interference
- **Delayed reconnection** (250ms) for clean room switching

### RPC Communication Architecture
**Production-Ready RPC Implementation** - Durable Objects now use Cloudflare's RPC system for inter-object communication:
- **DurableObject Extension**: Both Room and LoadBalancer classes extend `DurableObject` from `cloudflare:workers`
- **Type-Safe RPC Calls**: All inter-object calls use strongly-typed RPC interfaces instead of HTTP fetch
- **JSON Serialization Safety**: All RPC methods ensure proper JSON serialization via `JSON.parse(JSON.stringify())`
- **Async/Await Pattern**: Proper async handling prevents Promise serialization issues
- **Performance Benefits**: Direct RPC calls eliminate HTTP overhead and improve response times

#### RPC Method Implementations:
- **LoadBalancer RPC Methods**: `getStats()`, `getHealth()`, `getMetrics()`, `updateStats()`
- **Room RPC Methods**: `getStats()`, `hibernate()`
- **Serialization Fixes**: Non-serializable properties (like `typingTimeout`) properly excluded from responses
- **Error Handling**: Comprehensive error handling for RPC call failures

## API Endpoints

### Public Endpoints
- `GET /` - Serves chat application HTML frontend
- `GET /ws` - WebSocket connection endpoint (routes through LoadBalancer)
- `GET /api/stats` - System statistics for monitoring
- `GET /api/rooms` - Available rooms with user counts for UI
- `GET /api/health` - System health check with protection status
- `GET /api/metrics` - **⚠️ SENSITIVE** Detailed load metrics and system performance

### Internal Durable Object Communication
- **LoadBalancer RPC Methods**: `getStats()`, `getHealth()`, `getMetrics()`, `updateStats()`
- **Room RPC Methods**: `getStats()`, `hibernate()`
- **HTTP Endpoints**: `GET /` (room assignment), `GET /websocket` (WebSocket upgrade), `POST /join`
- **Migration Complete**: Statistics and health checks now use RPC instead of HTTP for better performance

## Known Issues Resolved

### Issue: Typing Indicator Self-Notification
**Problem**: Users saw their own typing indicators
**Solution**: Filter current username from typing indicator display on frontend

### Issue: Room User Counts Not Updating  
**Problem**: Map serialization to JSON not working properly
**Solution**: Convert Map to Object using `Object.fromEntries()` in LoadBalancer stats

### Issue: Always Connecting to "General" Room
**Problem**: `connect()` function used `currentRoom` variable instead of input field
**Solution**: Always read input field value and sync `currentRoom` variable

### Issue: Cross-Room Message Visibility
**Problem**: LoadBalancer was using load-balancing logic instead of room isolation
**Solution**: Direct room name mapping - each room gets its own Durable Object instance

### Issue: "Disconnected" Messages in Wrong Rooms
**Problem**: Old WebSocket connections closing after room switches
**Solution**: Connection ID tracking to filter out stale connection events

### Issue: WebSocket Connection Race Conditions
**Problem**: Multiple concurrent connections causing "Canceled" requests
**Solution**: Connection state management with `isConnecting` flag and proper cleanup

### Issue: RPC Serialization DataCloneError
**Problem**: `DataCloneError: Could not serialize object of type "RpcProperty"` on API endpoints
**Root Cause**: Missing `await` in `refreshRoomStats()` causing Promise objects to be stored instead of data
**Solution**: 
- Added proper `await` to all RPC calls in LoadBalancer methods
- Added `JSON.parse(JSON.stringify())` to all RPC methods for serialization safety
- Excluded non-serializable properties (like `typingTimeout`) from Room user objects
- Updated all Durable Object classes to extend `DurableObject` from `cloudflare:workers`

## Frontend Features

### Room Management
- **Clickable room list** with visual indicators (current room highlighted in blue)
- **Manual room entry** via input field
- **Real-time user counts** and activity status
- **Automatic room discovery** - new rooms appear in list after creation

### User Experience
- **Random username generation** (AdjectiveAnimal## format)
- **Smart connection toggle** - single button that adapts (Connect/Connecting.../Disconnect)
- **Typing indicators** with 2-second timeout and self-filtering
- **Live statistics** updated every 5 seconds
- **Clean room switching** with chat history clearing

## Deployment
- **Platform**: Cloudflare Workers with Durable Objects
- **URL**: https://durable-objects-chat.edevil.workers.dev
- **Configuration**: `wrangler.toml` configured for Wrangler 4
- **Bindings**: `ROOMS` and `LOAD_BALANCER` Durable Object namespaces

## Development Notes
- **TypeScript**: Full type safety with strict compilation - NO `any` or `unknown` types allowed
- **Error Handling**: Comprehensive error management with user-friendly messages  
- **Logging**: Extensive console logging for debugging (can be reduced for production)
- **Git History**: Detailed commit messages explaining each feature and fix
- **Code Documentation**: JSDoc comments throughout for maintainability
- **Code Quality**: All unused functions removed, clean codebase with only necessary code
- **Monitoring**: Production-ready health checks and metrics endpoints
- **Operational**: Automatic cleanup prevents resource leaks

## TypeScript Strict Typing Guidelines

**IMPORTANT**: This codebase maintains strict type safety. The following types are PROHIBITED:

### Prohibited Types
- `any` - Never use `any` type for any purpose
- `unknown` - Never use `unknown` type for any purpose

### Required Practices
- **Explicit Interfaces**: Define proper interfaces for all data structures
- **Type Assertions**: Use explicit type assertions with proper interfaces instead of `any`
- **Generic Functions**: Use generics with proper constraints instead of loose typing
- **Environment Types**: Use the `Env` interface for all environment bindings
- **Timer Types**: Use `ReturnType<typeof setTimeout>` and `ReturnType<typeof setInterval>` for timers
- **Mock Types**: Test mocks must implement proper interfaces with type compatibility
- **RPC Type Safety**: All Durable Object classes must extend `DurableObject` from `cloudflare:workers`
- **RPC Interfaces**: Define strongly-typed interfaces for all RPC method calls
- **JSON Serialization**: All RPC methods must return JSON-serializable data only

### Examples of Proper Typing
```typescript
// ✅ Good: Explicit interface
interface RoomData {
  roomId: string;
  maxCapacity: number;
  lastActivity: number;
}

// ✅ Good: Proper type assertion
const data = roomData as RoomData;

// ✅ Good: Generic with constraints
async function get<T>(key: string): Promise<T | undefined> {
  return this.storageMap.get(key) as T | undefined;
}

// ✅ Good: Environment typing
constructor(state: DurableObjectState, env: Env) {
  this.state = state;
  this.env = env;
}

// ✅ Good: RPC interface with proper typing
interface LoadBalancerStatsRPC extends DurableObjectStub {
  getStats(): Promise<Record<string, StatsValue>>;
}

// ✅ Good: RPC call with proper await and type safety
const stats = await (loadBalancer as LoadBalancerStatsRPC).getStats();

// ✅ Good: RPC method with JSON serialization safety
public async getStats() {
  const result = { /* ... */ };
  return JSON.parse(JSON.stringify(result)); // Ensure JSON serializability
}
```

### Test Mock Requirements
- All mocks must implement proper interfaces
- Use `as unknown as TargetType` for necessary type conversions
- Mock methods must match exact signatures of real implementations
- Storage mocks must handle generics properly with type assertions

## Security Considerations

### Endpoint Protection Recommendations
- **`/api/metrics`** - **HIGH SENSITIVITY** - Should be protected with API keys or IP allowlisting
  - Exposes detailed system performance, circuit breaker states, and protection metrics
  - Could reveal system vulnerabilities and capacity information
- **`/api/stats`** - **MEDIUM SENSITIVITY** - Consider protection for production
  - Shows room names, user counts, and activity patterns
  - Could be used for reconnaissance or competitive analysis
- **`/api/health`** - **PUBLIC OK** - Standard practice for load balancer health checks
- **`/api/rooms`** - **PUBLIC OK** - Filtered room list needed for UI functionality

### Production Security Checklist
- [ ] Implement API key authentication for sensitive endpoints
- [ ] Configure IP allowlisting for monitoring systems
- [ ] Enable Cloudflare security features (DDoS protection, rate limiting)
- [ ] Review and reduce logging verbosity
- [ ] Consider adding request size limits beyond current 10KB message limit
- [ ] Monitor for abuse patterns via overload protection metrics

## Future Enhancement Ideas
- Message encryption for privacy
- File/image sharing capabilities
- User authentication and persistent profiles
- Room moderation features
- Message search and history export
- Mobile-responsive UI improvements
- Push notifications for mentions
- Enhanced endpoint security with role-based access