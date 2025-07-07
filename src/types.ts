/**
 * Chat message structure used for all communication types.
 * Supports different message types for various chat features.
 */
export interface Message {
  id: string; // Unique message identifier
  roomId: string; // Room this message belongs to
  userId: string; // ID of user who sent the message
  username: string; // Display name of sender
  content: string; // Message content (text or JSON data)
  timestamp: number; // Unix timestamp when message was created
  type: 'message' | 'join' | 'leave' | 'typing' | 'presence' | 'userList'; // Message category
}

/**
 * User data structure with presence tracking and typing state.
 * Persisted in Durable Object storage for room history.
 */
export interface User {
  id: string; // Unique user identifier
  username: string; // Display name
  connectedAt: number; // When user first joined this room
  lastSeen: number; // Last activity timestamp for presence detection
  status: 'online' | 'away' | 'offline'; // Current presence status
  isTyping: boolean; // Whether user is currently typing
  typingTimeout?: number; // Timer ID for auto-stopping typing indicator
}

/**
 * Room performance and capacity metrics for load balancing.
 * Used by LoadBalancer to make routing decisions.
 */
export interface RoomStats {
  id: string; // Room identifier
  userCount: number; // Current active connections
  maxCapacity: number; // Maximum allowed connections
  isOverloaded: boolean; // Whether room is experiencing issues
  lastActivity: number; // Last message or connection timestamp
}

/**
 * Aggregated statistics across all rooms managed by LoadBalancer.
 * Provides system-wide overview for monitoring and scaling.
 */
export interface LoadBalancerStats {
  totalRooms: number; // Number of active rooms
  totalUsers: number; // Sum of users across all rooms
  roomStats: Map<string, RoomStats>; // Per-room detailed stats
}

/**
 * Active WebSocket connection data for a user session.
 * Tracks connection state and metadata for the Room DO.
 */
export interface WebSocketSession {
  websocket: WebSocket; // The actual WebSocket connection
  userId: string; // User ID for this session
  username: string; // Display name for this session
  roomId: string; // Room this session is connected to
  lastPing: number; // Last ping/heartbeat timestamp
  connectedAt: number; // When this session was established
}

/**
 * Metadata attached to hibernated WebSocket connections.
 * Used by Cloudflare's hibernation API to restore session context.
 */
export interface WebSocketMetadata {
  userId: string; // User ID to restore
  username: string; // Display name to restore
  roomId: string; // Room to restore session in
  connectedAt: number; // Original connection timestamp
}