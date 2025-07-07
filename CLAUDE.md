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
- **Graceful shutdown** coordination across all Durable Objects
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

## API Endpoints

### Public Endpoints
- `GET /` - Serves chat application HTML frontend
- `GET /ws` - WebSocket connection endpoint (routes through LoadBalancer)
- `GET /api/stats` - System statistics for monitoring
- `GET /api/rooms` - Available rooms with user counts for UI
- `GET /api/health` - **NEW** System health check with protection status
- `GET /api/metrics` - **NEW** Detailed load metrics and system performance
- `POST /api/shutdown` - **NEW** Graceful shutdown coordination (production should protect this)

### Internal Durable Object Endpoints
- **LoadBalancer**: `GET /` (room assignment), `GET /stats`, `GET /health`, `GET /metrics`, `POST /shutdown`
- **Room**: `GET /websocket` (WebSocket upgrade), `POST /join`, `GET /stats`, `POST /hibernate`, `POST /shutdown`

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
- **TypeScript**: Full type safety with strict compilation
- **Error Handling**: Comprehensive error management with user-friendly messages  
- **Logging**: Extensive console logging for debugging (can be reduced for production)
- **Git History**: Detailed commit messages explaining each feature and fix
- **Code Documentation**: JSDoc comments throughout for maintainability
- **Code Quality**: All unused functions removed, clean codebase with only necessary code
- **Monitoring**: Production-ready health checks and metrics endpoints
- **Operational**: Graceful shutdown and automatic cleanup prevent resource leaks

## Future Enhancement Ideas
- Message encryption for privacy
- File/image sharing capabilities
- User authentication and persistent profiles
- Room moderation features
- Message search and history export
- Mobile-responsive UI improvements
- Push notifications for mentions