import { DurableObject } from 'cloudflare:workers';
import { RoomStats, LoadBalancerStats, Env } from './types';
import { OverloadProtectionManager } from './overloadProtection';

interface RoomStatsResponse {
  userCount?: number;
  maxCapacity?: number;
  isOverloaded?: boolean;
  lastActivity?: number;
}

/**
 * LoadBalancer Durable Object - Manages room assignment and capacity distribution.
 * 
 * Responsibilities:
 * - Routes new connections to optimal rooms based on capacity and load
 * - Tracks room statistics and health across the system
 * - Creates new rooms when existing ones reach capacity
 * - Implements overload protection for the routing layer
 * - Provides system-wide statistics and monitoring
 */
export class LoadBalancer extends DurableObject {
  // Core Durable Object infrastructure  
  private state: DurableObjectState;
  protected env: Env;
  
  // Room tracking and statistics
  private roomStats: Map<string, RoomStats> = new Map(); // Real-time room metrics
  private lastStatsUpdate: number = 0; // Last time we refreshed stats from rooms
  private statsUpdateInterval: number = 5000; // How often to poll room stats (5 sec)
  
  // Capacity management
  private maxRoomsPerInstance: number = 10; // Maximum rooms this LB can manage
  private maxUsersPerRoom: number = 100; // Room capacity limit
  
  // Protection systems
  private overloadProtection: OverloadProtectionManager; // Rate limiting and circuit breaker

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.state = state;
    this.env = env;
    this.overloadProtection = new OverloadProtectionManager();
    
    // Start cleanup scheduler to prevent memory leaks
    this.scheduleCleanup();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    console.log('LoadBalancer fetch called:', { method: request.method, pathname: url.pathname });
    
    if ((request.method === 'POST' || request.method === 'GET') && url.pathname === '/') {
      return this.handleRoomAssignment(request);
    }
    
    
    console.log('LoadBalancer: No route matched, returning 404');
    return new Response('Not Found', { status: 404 });
  }

  private async handleRoomAssignment(request: Request): Promise<Response> {
    console.log('LoadBalancer handleRoomAssignment called');
    
    let roomId: string, userId: string, username: string;
    
    if (request.method === 'POST') {
      const body = await request.json() as { roomId: string; userId: string; username: string };
      ({ roomId, userId, username } = body);
    } else {
      // GET request - extract from URL params  
      const url = new URL(request.url);
      roomId = url.searchParams.get('room') || 'general';
      userId = url.searchParams.get('userId') || crypto.randomUUID();
      username = url.searchParams.get('username') || 'User' + Math.floor(Math.random() * 1000);
    }
    
    console.log('Assignment params:', { roomId, userId, username });
    console.log('Creating Durable Object ID for room:', roomId);
    
    // Apply overload protection to room assignment
    try {
      return await this.overloadProtection.executeWithProtection(userId, async () => {
        await this.refreshRoomStats();
        
        // For chat rooms, each room name should map to its own Durable Object instance
        // Don't use load balancing logic - just use the requested room directly
        const targetRoomId = roomId;
        
        const roomObjectId = this.env.ROOMS.idFromName(targetRoomId);
        const roomObject = this.env.ROOMS.get(roomObjectId);
        
        // Ensure this room is tracked in our stats
        if (!this.roomStats.has(targetRoomId)) {
          const newRoom: RoomStats = {
            id: targetRoomId,
            userCount: 0,
            maxCapacity: this.maxUsersPerRoom,
            isOverloaded: false,
            lastActivity: Date.now()
          };
          this.roomStats.set(targetRoomId, newRoom);
        }
        
        const upgradeHeader = request.headers.get('Upgrade');
        if (upgradeHeader !== 'websocket') {
          return new Response('Expected Upgrade: websocket', { status: 426 });
        }
        
        const url = new URL(request.url);
        url.pathname = '/websocket';
        url.searchParams.set('userId', userId);
        url.searchParams.set('username', username);
        url.searchParams.set('roomId', targetRoomId);
        
        const roomRequest = new Request(url.toString(), {
          method: 'GET',
          headers: request.headers
        });
        
        const response = await roomObject.fetch(roomRequest);
        
        if (response.status === 101) {
          this.updateRoomUserCount(targetRoomId, 1);
        }
        
        return response;
      });
    } catch (error) {
      console.error('Room assignment rejected by overload protection:', error);
      return new Response(JSON.stringify({
        error: 'Assignment rejected',
        message: error instanceof Error ? error.message : 'Load balancer is currently overloaded'
      }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    }
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
        
        // Use RPC call instead of fetch
        interface RoomStatsRPC extends DurableObjectStub {
          getStats(): RoomStatsResponse;
        }
        const stats = await (roomObject as RoomStatsRPC).getStats();
        
        const roomStat: RoomStats = {
          id: roomId,
          userCount: stats.userCount || 0,
          maxCapacity: stats.maxCapacity || this.maxUsersPerRoom,
          isOverloaded: stats.isOverloaded || false,
          lastActivity: stats.lastActivity || now
        };
        
        this.roomStats.set(roomId, roomStat);
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

  // RPC Methods - can be called directly without HTTP requests

  /**
   * Get load balancer statistics via RPC
   * @returns LoadBalancer statistics
   */
  public async getStats() {
    await this.refreshRoomStats();
    
    // Convert Map to plain object for JSON serialization
    const roomStatsObject = Object.fromEntries(this.roomStats.entries());
    
    const result = {
      totalRooms: this.roomStats.size,
      totalUsers: Array.from(this.roomStats.values()).reduce((sum, room) => sum + room.userCount, 0),
      roomStats: roomStatsObject
    };
    
    // Ensure JSON serialization by round-trip through JSON
    return JSON.parse(JSON.stringify(result));
  }

  /**
   * Get health status via RPC
   * @returns Health information
   */
  public async getHealth() {
    const protectionStatus = this.overloadProtection.getProtectionStatus();
    const isHealthy = this.overloadProtection.isSystemHealthy();
    
    const result = {
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      loadBalancer: {
        totalRooms: this.roomStats.size,
        totalUsers: Array.from(this.roomStats.values()).reduce((sum, room) => sum + room.userCount, 0),
        overloadedRooms: Array.from(this.roomStats.values()).filter(room => room.isOverloaded).length
      },
      protection: protectionStatus,
      uptime: Date.now() - this.lastStatsUpdate
    };
    
    // Ensure JSON serialization by round-trip through JSON
    return JSON.parse(JSON.stringify(result));
  }

  /**
   * Get detailed metrics via RPC
   * @returns Detailed system metrics
   */
  public async getMetrics() {
    await this.refreshRoomStats();
    
    const loadMetrics = this.getRoomLoadMetrics();
    const protectionStatus = this.overloadProtection.getProtectionStatus();
    
    const result = {
      timestamp: new Date().toISOString(),
      loadMetrics,
      protection: protectionStatus,
      rooms: Object.fromEntries(this.roomStats.entries()),
      system: {
        totalRooms: this.roomStats.size,
        totalUsers: Array.from(this.roomStats.values()).reduce((sum, room) => sum + room.userCount, 0),
        averageRoomSize: this.roomStats.size > 0 ? 
          Array.from(this.roomStats.values()).reduce((sum, room) => sum + room.userCount, 0) / this.roomStats.size : 0,
        utilizationRate: this.getRoomLoadMetrics().utilizationRate,
        oldestRoom: this.roomStats.size > 0 ? 
          Math.min(...Array.from(this.roomStats.values()).map(room => room.lastActivity)) : 0
      }
    };
    
    // Ensure JSON serialization by round-trip through JSON
    return JSON.parse(JSON.stringify(result));
  }

  /**
   * Update room stats via RPC
   * @param roomId Room identifier
   * @param userCount Current user count
   * @param isOverloaded Whether room is overloaded
   * @returns Success status
   */
  public updateStats(roomId: string, userCount: number, isOverloaded: boolean) {
    const roomStat: RoomStats = {
      id: roomId,
      userCount,
      maxCapacity: this.maxUsersPerRoom,
      isOverloaded,
      lastActivity: Date.now()
    };
    
    this.roomStats.set(roomId, roomStat);
    
    return { success: true };
  }
}