import { describe, it, expect, beforeEach, vi } from 'vitest';
import { 
  CircuitBreaker, 
  RateLimiter, 
  ConnectionMonitor, 
  OverloadProtectionManager 
} from '../overloadProtection';
import { waitFor } from '../test-utils';

describe('CircuitBreaker', () => {
  let circuitBreaker: CircuitBreaker;

  beforeEach(() => {
    circuitBreaker = new CircuitBreaker(3, 1000); // 3 failures, 1 second recovery
  });

  describe('Normal Operation', () => {
    it('should execute operations when circuit is closed', async () => {
      const operation = vi.fn().mockResolvedValue('success');
      
      const result = await circuitBreaker.execute(operation);
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledOnce();
      expect(circuitBreaker.getState()).toBe('CLOSED');
    });

    it('should handle successful operations', async () => {
      const operation = vi.fn().mockResolvedValue('success');
      
      await circuitBreaker.execute(operation);
      await circuitBreaker.execute(operation);
      
      expect(circuitBreaker.getState()).toBe('CLOSED');
      expect(circuitBreaker.getFailureCount()).toBe(0);
    });
  });

  describe('Failure Handling', () => {
    it('should count failures correctly', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Test error'));
      
      try {
        await circuitBreaker.execute(operation);
      } catch (error) {
        // Expected to fail
      }
      
      expect(circuitBreaker.getFailureCount()).toBe(1);
      expect(circuitBreaker.getState()).toBe('CLOSED');
    });

    it('should open circuit after threshold failures', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Test error'));
      
      // Cause 3 failures to open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(operation);
        } catch (error) {
          // Expected to fail
        }
      }
      
      expect(circuitBreaker.getState()).toBe('OPEN');
      expect(circuitBreaker.getFailureCount()).toBe(3);
    });

    it('should fail fast when circuit is open', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Test error'));
      
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(operation);
        } catch (error) {
          // Expected to fail
        }
      }
      
      // Now the circuit should be open
      const fastFailOperation = vi.fn().mockResolvedValue('success');
      
      await expect(circuitBreaker.execute(fastFailOperation)).rejects.toThrow('Circuit breaker is OPEN');
      expect(fastFailOperation).not.toHaveBeenCalled();
    });
  });

});

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    rateLimiter = new RateLimiter(3, 1000); // 3 requests per second
  });

  describe('Request Limiting', () => {
    it('should allow requests within limit', () => {
      expect(rateLimiter.isAllowed('user1')).toBe(true);
      expect(rateLimiter.isAllowed('user1')).toBe(true);
      expect(rateLimiter.isAllowed('user1')).toBe(true);
    });

    it('should deny requests over limit', () => {
      // Use up the limit
      for (let i = 0; i < 3; i++) {
        expect(rateLimiter.isAllowed('user1')).toBe(true);
      }
      
      // Next request should be denied
      expect(rateLimiter.isAllowed('user1')).toBe(false);
    });

    it('should handle different users independently', () => {
      // Use up limit for user1
      for (let i = 0; i < 3; i++) {
        expect(rateLimiter.isAllowed('user1')).toBe(true);
      }
      
      // user2 should still be allowed
      expect(rateLimiter.isAllowed('user2')).toBe(true);
      expect(rateLimiter.isAllowed('user1')).toBe(false);
    });
  });


});

describe('ConnectionMonitor', () => {
  let connectionMonitor: ConnectionMonitor;

  beforeEach(() => {
    connectionMonitor = new ConnectionMonitor(); // Uses default 500 max connections
  });

  describe('Connection Tracking', () => {
    it('should track connection count updates', () => {
      connectionMonitor.updateConnectionCount(10);
      const health = connectionMonitor.getHealthStatus();
      expect(health.connections).toBe(10);
    });

    it('should track request count', () => {
      connectionMonitor.incrementRequestCount();
      connectionMonitor.incrementRequestCount();
      const health = connectionMonitor.getHealthStatus();
      expect(health.requests).toBe(2);
    });

    it('should detect overload conditions', () => {
      connectionMonitor.updateConnectionCount(600); // Over 500 limit
      expect(connectionMonitor.isOverloaded()).toBe(true);
    });

    it('should not be overloaded under normal conditions', () => {
      connectionMonitor.updateConnectionCount(100);
      expect(connectionMonitor.isOverloaded()).toBe(false);
    });
  });

  describe('Health Status', () => {
    it('should provide healthy status under normal conditions', () => {
      connectionMonitor.updateConnectionCount(100);
      const health = connectionMonitor.getHealthStatus();
      expect(health.status).toBe('healthy');
      expect(health.issues).toEqual([]);
    });

    it('should provide warning status when connections are high', () => {
      connectionMonitor.updateConnectionCount(450); // 90% of 500
      const health = connectionMonitor.getHealthStatus();
      expect(health.status).toBe('warning');
      expect(health.issues.length).toBeGreaterThan(0);
    });

    it('should provide critical status when overloaded', () => {
      connectionMonitor.updateConnectionCount(600); // Over limit
      const health = connectionMonitor.getHealthStatus();
      expect(health.status).toBe('critical');
    });
  });
});


describe('OverloadProtectionManager', () => {
  let manager: OverloadProtectionManager;

  beforeEach(() => {
    manager = new OverloadProtectionManager();
  });

  describe('Integration', () => {
    it('should integrate all protection mechanisms', async () => {
      const operation = vi.fn().mockResolvedValue('success');
      
      const result = await manager.executeWithProtection('user1', operation);
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledOnce();
    });

    it('should enforce rate limiting', async () => {
      const operation = vi.fn().mockResolvedValue('success');
      
      // Execute many operations rapidly
      const promises = [];
      for (let i = 0; i < 250; i++) {
        promises.push(manager.executeWithProtection('user1', operation));
      }
      
      const results = await Promise.allSettled(promises);
      
      // Some should be rejected due to rate limiting
      const rejected = results.filter(r => r.status === 'rejected');
      expect(rejected.length).toBeGreaterThan(0);
    });

    it('should handle circuit breaker failures', async () => {
      const failingOperation = vi.fn().mockRejectedValue(new Error('Test error'));
      
      // Cause enough failures to open the circuit
      for (let i = 0; i < 15; i++) {
        try {
          await manager.executeWithProtection('user1', failingOperation);
        } catch (error) {
          // Expected to fail
        }
      }
      
      // Next operation should fail fast
      const fastFailOperation = vi.fn().mockResolvedValue('success');
      await expect(manager.executeWithProtection('user1', fastFailOperation)).rejects.toThrow();
    });
  });

  describe('Statistics', () => {
    it('should provide comprehensive statistics', () => {
      const stats = manager.getProtectionStatus();
      
      expect(stats).toHaveProperty('circuitBreaker');
      expect(stats).toHaveProperty('rateLimiter');
      expect(stats).toHaveProperty('connectionMonitor');
      expect(stats).toHaveProperty('isShuttingDown');
    });

    it('should track operation counts', async () => {
      const operation = vi.fn().mockResolvedValue('success');
      
      await manager.executeWithProtection('user1', operation);
      await manager.executeWithProtection('user2', operation);
      
      const stats = manager.getProtectionStatus();
      expect(stats.connectionMonitor.requests).toBeGreaterThan(0);
    });
  });

  describe('Health Check', () => {
    it('should provide health status', () => {
      const isHealthy = manager.isSystemHealthy();
      expect(typeof isHealthy).toBe('boolean');
    });

    it('should indicate healthy status under normal conditions', () => {
      const isHealthy = manager.isSystemHealthy();
      expect(isHealthy).toBe(true);
    });
  });

  describe('Connection Management', () => {
    it('should manage connection counts', () => {
      manager.updateConnectionCount(10);
      const stats = manager.getProtectionStatus();
      expect(stats.connectionMonitor.connections).toBe(10);
    });

    it('should detect overload conditions', () => {
      manager.updateConnectionCount(600); // Over 500 limit
      const stats = manager.getProtectionStatus();
      expect(stats.connectionMonitor.status).toBe('critical');
    });
  });
});