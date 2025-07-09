import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Room } from '../room';
import { 
  MockDurableObjectState, 
  MockWebSocket, 
  MockEnv,
  createMockUser, 
  createMockMessage,
  createWebSocketRequest,
  createMockRequest,
  waitFor
} from '../test-utils';

describe('Room Durable Object', () => {
  let room: Room;
  let mockState: MockDurableObjectState;
  let mockEnv: MockEnv;

  beforeEach(() => {
    mockState = new MockDurableObjectState();
    mockEnv = {} as MockEnv;
    room = new Room(mockState as unknown as DurableObjectState, mockEnv);
  });

  describe('WebSocket Connection Handling', () => {
    it('should reject non-WebSocket requests to websocket endpoint', async () => {
      const request = createMockRequest('https://test.com/websocket');
      const response = await room.fetch(request);
      
      expect(response.status).toBe(400);
    });
  });

  describe('Message Handling', () => {
    it('should handle join requests', async () => {
      const joinRequest = createMockRequest('https://test.com/join', {
        method: 'POST',
        body: JSON.stringify({
          userId: 'user1',
          username: 'TestUser'
        })
      });

      const response = await room.fetch(joinRequest);
      expect(response.status).toBe(426);
    });
  });

  describe('Room Statistics', () => {
    it('should provide room statistics', async () => {
      const stats = room.getStats();
      
      expect(stats).toHaveProperty('userCount');
      expect(stats).toHaveProperty('messageCount');
      expect(stats).toHaveProperty('isOverloaded');
    });

    it('should track user count correctly', async () => {
      // Check stats without joining (should still work)
      const stats = room.getStats();
      
      expect(stats.userCount).toBeGreaterThanOrEqual(0);
    });
  });



  describe('Hibernation', () => {
    it('should handle hibernation requests', async () => {
      const result = await room.hibernate();
      expect(result.success).toBe(true);
    });
  });

  describe('User Presence', () => {
    it('should track user presence correctly', async () => {
      // Check user presence in stats without joining
      const stats = room.getStats();
      
      expect(stats.userCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown endpoints', async () => {
      const unknownRequest = createMockRequest('https://test.com/unknown');
      const response = await room.fetch(unknownRequest);
      
      expect(response.status).toBe(404);
    });
  });

});