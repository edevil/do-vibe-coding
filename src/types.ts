export interface Message {
  id: string;
  roomId: string;
  userId: string;
  username: string;
  content: string;
  timestamp: number;
  type: 'message' | 'join' | 'leave' | 'typing';
}

export interface User {
  id: string;
  username: string;
  connectedAt: number;
}

export interface RoomStats {
  id: string;
  userCount: number;
  maxCapacity: number;
  isOverloaded: boolean;
  lastActivity: number;
}

export interface LoadBalancerStats {
  totalRooms: number;
  totalUsers: number;
  roomStats: Map<string, RoomStats>;
}

export interface WebSocketSession {
  websocket: WebSocket;
  userId: string;
  username: string;
  roomId: string;
  lastPing: number;
}