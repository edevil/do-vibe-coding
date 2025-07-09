import { describe, it, expect, beforeEach, vi } from 'vitest';
import worker from '../index';
import { Env } from '../types';
import { 
  createMockRequest,
  createWebSocketRequest,
  createMockEnv,
  MockDurableObjectStub,
  waitFor
} from '../test-utils';

describe('Main Worker', () => {
  let mockEnv: Env;

  beforeEach(() => {
    mockEnv = createMockEnv();
  });

  describe('Static File Serving', () => {
    it('should serve HTML for root path', async () => {
      const request = createMockRequest('https://test.com/');
      
      const response = await worker.fetch(request, mockEnv);
      
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/html');
    });

    it('should serve HTML for any path without extension', async () => {
      const request = createMockRequest('https://test.com/room/general');
      
      const response = await worker.fetch(request, mockEnv);
      
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/html');
    });
  });

  describe('WebSocket Handling', () => {
    it('should reject non-WebSocket requests to /ws', async () => {
      const request = createMockRequest('https://test.com/ws');
      
      const response = await worker.fetch(request, mockEnv);
      
      expect(response.status).toBe(426);
    });

    it('should handle WebSocket upgrade requests', async () => {
      const request = createWebSocketRequest('https://test.com/ws?roomId=general&userId=user1&username=TestUser');
      
      const response = await worker.fetch(request, mockEnv);
      
      expect(response.status).toBe(200); // Mock returns 200 instead of 101
    });
  });

  describe('API Endpoints', () => {
    describe('/api/rooms', () => {
      it('should return room list', async () => {
        const request = createMockRequest('https://test.com/api/rooms');
        
        const response = await worker.fetch(request, mockEnv);
        
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('application/json');
        
        interface RoomsResponse {
          rooms: Array<{ id: string; name: string; userCount: number; isActive: boolean }>;
        }
        const data = await response.json() as RoomsResponse;
        expect(data.rooms).toBeInstanceOf(Array);
        expect(data.rooms.length).toBeGreaterThan(0);
        expect(data.rooms[0]).toHaveProperty('id');
        expect(data.rooms[0]).toHaveProperty('name');
        expect(data.rooms[0]).toHaveProperty('userCount');
        expect(data.rooms[0]).toHaveProperty('isActive');
      });

      it('should provide default rooms when no rooms exist', async () => {
        const request = createMockRequest('https://test.com/api/rooms');
        
        const response = await worker.fetch(request, mockEnv);
        interface RoomsResponse {
          rooms: Array<{ id: string; name: string; userCount: number; isActive: boolean }>;
        }
        const data = await response.json() as RoomsResponse;
        
        expect(data.rooms).toBeInstanceOf(Array);
        expect(data.rooms.length).toBe(3); // Default rooms: general, random, help
        expect(data.rooms.find(r => r.id === 'general')).toBeDefined();
        expect(data.rooms.find(r => r.id === 'random')).toBeDefined();
        expect(data.rooms.find(r => r.id === 'help')).toBeDefined();
      });

      it('should format room names correctly', async () => {
        const request = createMockRequest('https://test.com/api/rooms');
        
        const response = await worker.fetch(request, mockEnv);
        interface RoomsResponse {
          rooms: Array<{ id: string; name: string; userCount: number; isActive: boolean }>;
        }
        const data = await response.json() as RoomsResponse;
        
        // Should have at least the default rooms with proper capitalization
        expect(data.rooms.find(r => r.name === 'General')).toBeDefined();
        expect(data.rooms.find(r => r.name === 'Random')).toBeDefined();
        expect(data.rooms.find(r => r.name === 'Help')).toBeDefined();
      });
    });

    describe('/api/health', () => {
      it('should provide health check', async () => {
        const request = createMockRequest('https://test.com/api/health');
        
        const response = await worker.fetch(request, mockEnv);
        
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('application/json');
      });
    });

    describe('/api/stats', () => {
      it('should provide system statistics', async () => {
        const request = createMockRequest('https://test.com/api/stats');
        
        const response = await worker.fetch(request, mockEnv);
        
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('application/json');
      });
    });

    describe('/api/metrics', () => {
      it('should provide system metrics', async () => {
        const request = createMockRequest('https://test.com/api/metrics');
        
        const response = await worker.fetch(request, mockEnv);
        
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('application/json');
      });
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown API endpoints', async () => {
      const request = createMockRequest('https://test.com/api/unknown');
      
      const response = await worker.fetch(request, mockEnv);
      
      expect(response.status).toBe(404);
    });

    it('should handle malformed requests gracefully', async () => {
      const request = createMockRequest('https://test.com/api/stats', {
        method: 'POST',
        body: 'invalid json'
      });
      
      const response = await worker.fetch(request, mockEnv);
      
      expect(response.status).toBe(404); // API stats endpoint only accepts GET requests
    });
  });
});