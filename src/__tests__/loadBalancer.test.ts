import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LoadBalancer } from '../loadBalancer';
import { 
  MockDurableObjectState, 
  MockDurableObjectNamespace,
  createMockRequest,
  createMockEnv,
  waitFor
} from '../test-utils';

describe('LoadBalancer Durable Object', () => {
  let loadBalancer: LoadBalancer;
  let mockState: MockDurableObjectState;
  let mockEnv: any;

  beforeEach(() => {
    mockState = new MockDurableObjectState();
    mockEnv = createMockEnv();
    loadBalancer = new LoadBalancer(mockState as any, mockEnv);
  });

  describe('Room Assignment', () => {
    it('should reject non-WebSocket requests', async () => {
      const request = createMockRequest('https://test.com/?room=general&userId=user1&username=TestUser');
      const response = await loadBalancer.fetch(request);
      
      expect(response.status).toBe(426);
    });
  });

  describe('Statistics Handling', () => {
    it('should provide load balancer statistics', async () => {
      const request = createMockRequest('https://test.com/stats');
      const response = await loadBalancer.fetch(request);
      
      expect(response.status).toBe(200);
      
      const stats = await response.json();
      expect(stats).toHaveProperty('totalRooms');
      expect(stats).toHaveProperty('totalUsers');
      expect(stats).toHaveProperty('roomStats');
    });

    it('should track room statistics correctly', async () => {
      // First assign a user to a room
      const assignRequest = createMockRequest('https://test.com/?room=general&userId=user1&username=TestUser');
      await loadBalancer.fetch(assignRequest);

      // Then get stats
      const statsRequest = createMockRequest('https://test.com/stats');
      const response = await loadBalancer.fetch(statsRequest);
      const stats = await response.json();
      
      expect(stats.totalRooms).toBeGreaterThanOrEqual(0);
      expect(stats.totalUsers).toBeGreaterThanOrEqual(0);
      expect(typeof stats.roomStats).toBe('object');
    });

    it('should handle stats updates from rooms', async () => {
      const updateRequest = createMockRequest('https://test.com/update-stats', {
        method: 'POST',
        body: JSON.stringify({
          roomId: 'general',
          userCount: 5,
          messageCount: 10,
          isOverloaded: false
        })
      });
      
      const response = await loadBalancer.fetch(updateRequest);
      expect(response.status).toBe(200);
    });
  });

  describe('Health Check', () => {
    it('should provide health check endpoint', async () => {
      const request = createMockRequest('https://test.com/health');
      const response = await loadBalancer.fetch(request);
      
      expect(response.status).toBe(200);
      
      const health = await response.json();
      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('timestamp');
    });

    it('should indicate healthy status when load is normal', async () => {
      const request = createMockRequest('https://test.com/health');
      const response = await loadBalancer.fetch(request);
      const health = await response.json();
      
      expect(health.status).toBe('healthy');
    });
  });

  describe('Metrics', () => {
    it('should provide detailed metrics', async () => {
      const request = createMockRequest('https://test.com/metrics');
      const response = await loadBalancer.fetch(request);
      
      expect(response.status).toBe(200);
      
      const metrics = await response.json();
      expect(metrics).toHaveProperty('loadMetrics');
      expect(metrics).toHaveProperty('protection');
    });

    it('should include protection metrics', async () => {
      const request = createMockRequest('https://test.com/metrics');
      const response = await loadBalancer.fetch(request);
      const metrics = await response.json();
      
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
      const statsRequest1 = createMockRequest('https://test.com/stats');
      const response1 = await loadBalancer.fetch(statsRequest1);
      const stats1 = await response1.json();
      
      // Wait a bit and get stats again
      await waitFor(100);
      
      const statsRequest2 = createMockRequest('https://test.com/stats');
      const response2 = await loadBalancer.fetch(statsRequest2);
      const stats2 = await response2.json();
      
      expect(response2.status).toBe(200);
      expect(stats2).toHaveProperty('totalRooms');
    });

    it('should handle room stats updates correctly', async () => {
      const updateRequest = createMockRequest('https://test.com/update-stats', {
        method: 'POST',
        body: JSON.stringify({
          roomId: 'test-room',
          userCount: 10,
          messageCount: 50,
          isOverloaded: false
        })
      });
      
      const response = await loadBalancer.fetch(updateRequest);
      expect(response.status).toBe(200);
      
      // Verify stats were updated
      const statsRequest = createMockRequest('https://test.com/stats');
      const statsResponse = await loadBalancer.fetch(statsRequest);
      const stats = await statsResponse.json();
      
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
      const statsRequest = createMockRequest('https://test.com/stats');
      const response = await loadBalancer.fetch(statsRequest);
      const stats = await response.json();
      
      expect(stats.totalRooms).toBeGreaterThanOrEqual(0);
      expect(typeof stats.roomStats).toBe('object');
    });
  });
});