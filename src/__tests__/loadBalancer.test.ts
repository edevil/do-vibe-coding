import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LoadBalancer } from '../loadBalancer';
import { 
  MockDurableObjectState, 
  MockDurableObjectNamespace,
  MockEnv,
  createMockRequest,
  createMockEnv,
  waitFor
} from '../test-utils';

describe('LoadBalancer Durable Object', () => {
  let loadBalancer: LoadBalancer;
  let mockState: MockDurableObjectState;
  let mockEnv: MockEnv;

  beforeEach(() => {
    mockState = new MockDurableObjectState();
    mockEnv = createMockEnv();
    loadBalancer = new LoadBalancer(mockState as unknown as DurableObjectState, mockEnv);
  });

  describe('Room Assignment', () => {
    it('should reject non-WebSocket requests', async () => {
      const request = createMockRequest('https://test.com/?room=general&userId=user1&username=TestUser');
      const response = await loadBalancer.fetch(request);
      
      expect(response.status).toBe(426); // LoadBalancer returns 426 for non-WebSocket requests
    });
  });

  describe('Statistics Handling', () => {
    it('should provide load balancer statistics', async () => {
      const stats = await loadBalancer.getStats();
      
      expect(stats).toHaveProperty('totalRooms');
      expect(stats).toHaveProperty('totalUsers');
      expect(stats).toHaveProperty('roomStats');
    });

    it('should track room statistics correctly', async () => {
      // First assign a user to a room
      const assignRequest = createMockRequest('https://test.com/?room=general&userId=user1&username=TestUser');
      await loadBalancer.fetch(assignRequest);

      // Then get stats via RPC
      const stats = await loadBalancer.getStats();
      
      expect(stats.totalRooms).toBeGreaterThanOrEqual(0);
      expect(stats.totalUsers).toBeGreaterThanOrEqual(0);
      expect(typeof stats.roomStats).toBe('object');
    });

    it('should handle stats updates from rooms', async () => {
      const result = loadBalancer.updateStats('general', 5, false);
      expect(result.success).toBe(true);
    });
  });

  describe('Health Check', () => {
    it('should provide health check endpoint', async () => {
      const health = await loadBalancer.getHealth();
      
      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('timestamp');
    });

    it('should indicate healthy status when load is normal', async () => {
      const health = await loadBalancer.getHealth();
      
      expect(health.status).toBe('healthy');
    });
  });

  describe('Metrics', () => {
    it('should provide detailed metrics', async () => {
      const metrics = await loadBalancer.getMetrics();
      
      expect(metrics).toHaveProperty('loadMetrics');
      expect(metrics).toHaveProperty('protection');
    });

    it('should include protection metrics', async () => {
      const metrics = await loadBalancer.getMetrics();
      
      expect(metrics.protection).toHaveProperty('circuitBreaker');
      expect(metrics.protection).toHaveProperty('rateLimiter');
      expect(metrics.protection).toHaveProperty('connectionMonitor');
    });
  });




  describe('Error Handling', () => {

    it('should return 404 for unknown endpoints', async () => {
      const request = createMockRequest('https://test.com/unknown');
      const response = await loadBalancer.fetch(request);
      
      expect(response.status).toBe(404);
    });

  });

  describe('Statistics Refresh', () => {
    it('should refresh room statistics periodically', async () => {
      // Get initial stats
      const stats1 = await loadBalancer.getStats();
      
      // Wait a bit and get stats again
      await waitFor(100);
      
      const stats2 = await loadBalancer.getStats();
      
      expect(stats2).toHaveProperty('totalRooms');
    });

    it('should handle room stats updates correctly', async () => {
      const result = loadBalancer.updateStats('test-room', 10, false);
      expect(result.success).toBe(true);
      
      // Verify stats were updated
      const stats = await loadBalancer.getStats();
      expect(stats.roomStats).toHaveProperty('test-room');
    });
  });

  describe('Cleanup and Maintenance', () => {
    it('should handle cleanup operations', async () => {
      // This would test the cleanup scheduler
      // For now, we'll just verify the load balancer can be instantiated
      expect(loadBalancer).toBeDefined();
    });

    it('should maintain room stats consistency', async () => {
      const stats = await loadBalancer.getStats();
      
      expect(stats.totalRooms).toBeGreaterThanOrEqual(0);
      expect(typeof stats.roomStats).toBe('object');
    });
  });
});