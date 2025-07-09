import { describe, it, expect, beforeEach, vi } from 'vitest';
import worker, { Env } from '../index';
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
    mockEnv = createMockEnv() as any;
  });

  describe('Static Content', () => {
    it('should serve HTML content at root path', async () => {
      const request = createMockRequest('https://test.com/');
      const response = await worker.fetch(request, mockEnv);
      
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/html');
      
      const html = await response.text();
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Durable Objects Chat');
    });

    it('should include WebSocket client code in HTML', async () => {
      const request = createMockRequest('https://test.com/');
      const response = await worker.fetch(request, mockEnv);
      
      const html = await response.text();
      expect(html).toContain('WebSocket');
      expect(html).toContain('toggleConnection');
      expect(html).toContain('sendMessage');
    });

    it('should include CSS styling in HTML', async () => {
      const request = createMockRequest('https://test.com/');
      const response = await worker.fetch(request, mockEnv);
      
      const html = await response.text();
      expect(html).toContain('<style>');
      expect(html).toContain('chat-box');
      expect(html).toContain('room-list');
    });
  });

  describe('WebSocket Handling', () => {
    it('should reject non-WebSocket requests to /ws', async () => {
      const request = createMockRequest('https://test.com/ws');
      const response = await worker.fetch(request, mockEnv);
      
      expect(response.status).toBe(426);
    });
  });

  describe('API Endpoints', () => {
    describe('/api/stats', () => {
      it('should provide system statistics', async () => {
        const request = createMockRequest('https://test.com/api/stats');
        
        const response = await worker.fetch(request, mockEnv);
        
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('application/json');
        
        const stats = await response.json();
        expect(stats).toHaveProperty('totalRooms');
        expect(stats).toHaveProperty('totalUsers');
        expect(stats).toHaveProperty('roomStats');
      });
    });

    describe('/api/rooms', () => {
      it('should provide room list', async () => {
        const request = createMockRequest('https://test.com/api/rooms');
        
        const response = await worker.fetch(request, mockEnv);
        
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('application/json');
        
        const data = await response.json();
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
        const data = await response.json();
        
        expect(data.rooms).toBeInstanceOf(Array);
        expect(data.rooms.length).toBe(3); // Default rooms: general, random, help
        expect(data.rooms.find((r: any) => r.id === 'general')).toBeDefined();
        expect(data.rooms.find((r: any) => r.id === 'random')).toBeDefined();
        expect(data.rooms.find((r: any) => r.id === 'help')).toBeDefined();
      });

      it('should format room names correctly', async () => {
        const request = createMockRequest('https://test.com/api/rooms');
        
        const response = await worker.fetch(request, mockEnv);
        const data = await response.json();
        
        // Should have at least the default rooms with proper capitalization
        expect(data.rooms.find((r: any) => r.name === 'General')).toBeDefined();
        expect(data.rooms.find((r: any) => r.name === 'Random')).toBeDefined();
        expect(data.rooms.find((r: any) => r.name === 'Help')).toBeDefined();
      });
    });

    describe('/api/health', () => {
      it('should provide health check', async () => {
        const request = createMockRequest('https://test.com/api/health');
        
        const response = await worker.fetch(request, mockEnv);
        
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('application/json');
        
        const health = await response.json();
        expect(health).toHaveProperty('status');
        expect(health).toHaveProperty('timestamp');
      });

      it('should handle health check errors', async () => {
        const request = createMockRequest('https://test.com/api/health');
        
        // Mock the LoadBalancer to throw an error
        const mockLoadBalancer = mockEnv.LOAD_BALANCER.get(mockEnv.LOAD_BALANCER.idFromName('singleton')) as MockDurableObjectStub;
        mockLoadBalancer.setResponse('/health', new Response(null, { status: 500 }));
        
        const response = await worker.fetch(request, mockEnv);
        
        expect(response.status).toBe(500);
      });
    });

    describe('/api/metrics', () => {
      it('should provide detailed metrics', async () => {
        const request = createMockRequest('https://test.com/api/metrics');
        
        const response = await worker.fetch(request, mockEnv);
        
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('application/json');
        
        const metrics = await response.json();
        expect(metrics).toHaveProperty('loadBalancer');
        expect(metrics).toHaveProperty('protection');
      });

      it('should handle metrics errors', async () => {
        const request = createMockRequest('https://test.com/api/metrics');
        
        // Mock the LoadBalancer to throw an error
        const mockLoadBalancer = mockEnv.LOAD_BALANCER.get(mockEnv.LOAD_BALANCER.idFromName('singleton')) as MockDurableObjectStub;
        mockLoadBalancer.setResponse('/metrics', new Response(null, { status: 500 }));
        
        const response = await worker.fetch(request, mockEnv);
        
        expect(response.status).toBe(500);
      });
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown routes', async () => {
      const request = createMockRequest('https://test.com/unknown-route');
      const response = await worker.fetch(request, mockEnv);
      
      expect(response.status).toBe(404);
      expect(await response.text()).toBe('Not Found');
    });


    it('should handle missing environment bindings', async () => {
      const brokenEnv = { ...mockEnv, LOAD_BALANCER: undefined } as any;
      const request = createMockRequest('https://test.com/api/stats');
      
      // This should throw an error due to missing binding
      await expect(worker.fetch(request, brokenEnv)).rejects.toThrow();
    });
  });

  describe('Request Routing', () => {
    it('should route requests to correct handlers', async () => {
      const routes = [
        { path: '/', expectedStatus: 200 },
        { path: '/api/stats', expectedStatus: 200 },
        { path: '/api/rooms', expectedStatus: 200 },
        { path: '/api/health', expectedStatus: 200 },
        { path: '/api/metrics', expectedStatus: 200 },
        { path: '/unknown', expectedStatus: 404 }
      ];

      for (const route of routes) {
        const request = createMockRequest(`https://test.com${route.path}`);
        const response = await worker.fetch(request, mockEnv);
        
        expect(response.status).toBe(route.expectedStatus);
      }
    });

    it('should handle different HTTP methods correctly', async () => {
      // GET to root should serve HTML
      const getRequest = createMockRequest('https://test.com/', { method: 'GET' });
      const getResponse = await worker.fetch(getRequest, mockEnv);
      expect(getResponse.status).toBe(200);
      
      // POST to unknown endpoint should return 404 (no handler)
      const postRequest = createMockRequest('https://test.com/unknown', { method: 'POST' });
      const postResponse = await worker.fetch(postRequest, mockEnv);
      expect(postResponse.status).toBe(404);
    });
  });


  describe('Content Security', () => {
    it('should serve HTML with proper content type', async () => {
      const request = createMockRequest('https://test.com/');
      const response = await worker.fetch(request, mockEnv);
      
      expect(response.headers.get('Content-Type')).toBe('text/html');
    });

    it('should serve API responses with proper content type', async () => {
      const request = createMockRequest('https://test.com/api/stats');
      const response = await worker.fetch(request, mockEnv);
      
      expect(response.headers.get('Content-Type')).toBe('application/json');
    });
  });
});