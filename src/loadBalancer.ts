import { RoomStats, LoadBalancerStats } from './types';

export class LoadBalancer {
  private state: DurableObjectState;
  private env: any;
  private roomStats: Map<string, RoomStats> = new Map();
  private lastStatsUpdate: number = 0;
  private statsUpdateInterval: number = 5000; // 5 seconds
  private maxRoomsPerInstance: number = 10;
  private maxUsersPerRoom: number = 100;

  constructor(state: DurableObjectState, env: any) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    if (request.method === 'POST' && url.pathname === '/') {
      return this.handleRoomAssignment(request);
    }
    
    if (request.method === 'GET' && url.pathname === '/stats') {
      return this.handleGetStats();
    }
    
    if (request.method === 'POST' && url.pathname === '/update-stats') {
      return this.handleUpdateStats(request);
    }
    
    return new Response('Not Found', { status: 404 });
  }

  private async handleRoomAssignment(request: Request): Promise<Response> {
    const body = await request.json() as { roomId: string; userId: string; username: string };
    const { roomId, userId, username } = body;
    
    await this.refreshRoomStats();
    
    const targetRoomId = this.selectOptimalRoom(roomId);
    
    if (!targetRoomId) {
      return new Response(JSON.stringify({
        error: 'No available rooms',
        message: 'All rooms are at capacity'
      }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const roomObjectId = this.env.ROOMS.idFromName(targetRoomId);
    const roomObject = this.env.ROOMS.get(roomObjectId);
    
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 426 });
    }
    
    const roomRequest = new Request(`${request.url}join`, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify({ userId, username, roomId: targetRoomId })
    });
    
    try {
      const response = await roomObject.fetch(roomRequest);
      
      if (response.status === 101) {
        this.updateRoomUserCount(targetRoomId, 1);
      }
      
      return response;
    } catch (error) {
      console.error('Error connecting to room:', error);
      return new Response(JSON.stringify({
        error: 'Failed to connect to room',
        message: 'Internal server error'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  private async handleGetStats(): Promise<Response> {
    await this.refreshRoomStats();
    
    const stats: LoadBalancerStats = {
      totalRooms: this.roomStats.size,
      totalUsers: Array.from(this.roomStats.values()).reduce((sum, room) => sum + room.userCount, 0),
      roomStats: this.roomStats
    };
    
    return new Response(JSON.stringify(stats), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private async handleUpdateStats(request: Request): Promise<Response> {
    const body = await request.json() as { roomId: string; userCount: number; isOverloaded: boolean };
    const { roomId, userCount, isOverloaded } = body;
    
    const roomStat: RoomStats = {
      id: roomId,
      userCount,
      maxCapacity: this.maxUsersPerRoom,
      isOverloaded,
      lastActivity: Date.now()
    };
    
    this.roomStats.set(roomId, roomStat);
    
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private selectOptimalRoom(preferredRoomId: string): string | null {
    const now = Date.now();
    
    if (preferredRoomId) {
      const preferredRoom = this.roomStats.get(preferredRoomId);
      if (preferredRoom && !this.isRoomOverloaded(preferredRoom)) {
        return preferredRoomId;
      }
    }
    
    const availableRooms = Array.from(this.roomStats.entries())
      .filter(([_, room]) => !this.isRoomOverloaded(room))
      .sort((a, b) => a[1].userCount - b[1].userCount);
    
    if (availableRooms.length > 0) {
      return availableRooms[0][0];
    }
    
    if (this.roomStats.size < this.maxRoomsPerInstance) {
      const newRoomId = preferredRoomId || this.generateRoomId();
      
      const newRoom: RoomStats = {
        id: newRoomId,
        userCount: 0,
        maxCapacity: this.maxUsersPerRoom,
        isOverloaded: false,
        lastActivity: now
      };
      
      this.roomStats.set(newRoomId, newRoom);
      return newRoomId;
    }
    
    return null;
  }

  private isRoomOverloaded(room: RoomStats): boolean {
    const capacityThreshold = room.maxCapacity * 0.9; // 90% capacity threshold
    return room.userCount >= capacityThreshold || room.isOverloaded;
  }

  private generateRoomId(): string {
    const adjectives = ['swift', 'bright', 'calm', 'bold', 'cool', 'wise', 'kind'];
    const nouns = ['river', 'mountain', 'forest', 'ocean', 'valley', 'peak', 'meadow'];
    
    const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const number = Math.floor(Math.random() * 1000);
    
    return `${adjective}-${noun}-${number}`;
  }

  private async refreshRoomStats(): Promise<void> {
    const now = Date.now();
    
    if (now - this.lastStatsUpdate < this.statsUpdateInterval) {
      return;
    }
    
    const activeRooms = Array.from(this.roomStats.keys());
    const statsPromises = activeRooms.map(async (roomId) => {
      try {
        const roomObjectId = this.env.ROOMS.idFromName(roomId);
        const roomObject = this.env.ROOMS.get(roomObjectId);
        
        const response = await roomObject.fetch('/stats');
        
        if (response.ok) {
          const stats = await response.json();
          
          const roomStat: RoomStats = {
            id: roomId,
            userCount: stats.userCount || 0,
            maxCapacity: stats.maxCapacity || this.maxUsersPerRoom,
            isOverloaded: stats.isOverloaded || false,
            lastActivity: stats.lastActivity || now
          };
          
          this.roomStats.set(roomId, roomStat);
        }
      } catch (error) {
        console.error(`Error fetching stats for room ${roomId}:`, error);
        
        const existingStat = this.roomStats.get(roomId);
        if (existingStat && now - existingStat.lastActivity > 60000) { // 1 minute
          this.roomStats.delete(roomId);
        }
      }
    });
    
    await Promise.allSettled(statsPromises);
    this.lastStatsUpdate = now;
  }

  private updateRoomUserCount(roomId: string, delta: number): void {
    const room = this.roomStats.get(roomId);
    if (room) {
      room.userCount = Math.max(0, room.userCount + delta);
      room.lastActivity = Date.now();
      this.roomStats.set(roomId, room);
    }
  }

  private async cleanupStaleRooms(): Promise<void> {
    const now = Date.now();
    const staleThreshold = 5 * 60 * 1000; // 5 minutes
    
    for (const [roomId, room] of this.roomStats.entries()) {
      if (now - room.lastActivity > staleThreshold && room.userCount === 0) {
        console.log(`Cleaning up stale room: ${roomId}`);
        this.roomStats.delete(roomId);
      }
    }
  }

  async scheduleCleanup(): Promise<void> {
    await this.cleanupStaleRooms();
    
    setTimeout(() => {
      this.scheduleCleanup();
    }, 60000); // Run every minute
  }

  getRoomLoadMetrics(): { 
    averageLoad: number; 
    overloadedRooms: number; 
    totalCapacity: number; 
    utilizationRate: number; 
  } {
    const rooms = Array.from(this.roomStats.values());
    
    if (rooms.length === 0) {
      return {
        averageLoad: 0,
        overloadedRooms: 0,
        totalCapacity: 0,
        utilizationRate: 0
      };
    }
    
    const totalUsers = rooms.reduce((sum, room) => sum + room.userCount, 0);
    const totalCapacity = rooms.reduce((sum, room) => sum + room.maxCapacity, 0);
    const overloadedRooms = rooms.filter(room => room.isOverloaded).length;
    
    return {
      averageLoad: totalUsers / rooms.length,
      overloadedRooms,
      totalCapacity,
      utilizationRate: totalCapacity > 0 ? (totalUsers / totalCapacity) * 100 : 0
    };
  }
}