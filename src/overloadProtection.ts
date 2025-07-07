export class CircuitBreaker {
  private failures: number = 0;
  private lastFailureTime: number = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private readonly failureThreshold: number;
  private readonly recoveryTimeout: number;

  constructor(
    failureThreshold: number = 5,
    recoveryTimeout: number = 60000 // 1 minute
  ) {
    this.failureThreshold = failureThreshold;
    this.recoveryTimeout = recoveryTimeout;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.recoveryTimeout) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }

  getState(): 'CLOSED' | 'OPEN' | 'HALF_OPEN' {
    return this.state;
  }

  getFailureCount(): number {
    return this.failures;
  }
}

export class RateLimiter {
  private requests: Map<string, number[]> = new Map();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number = 100, windowMs: number = 60000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  isAllowed(identifier: string): boolean {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    const requestTimes = this.requests.get(identifier) || [];
    const validRequests = requestTimes.filter(time => time > windowStart);
    
    if (validRequests.length >= this.maxRequests) {
      return false;
    }
    
    validRequests.push(now);
    this.requests.set(identifier, validRequests);
    
    return true;
  }

  getRequestCount(identifier: string): number {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const requestTimes = this.requests.get(identifier) || [];
    
    return requestTimes.filter(time => time > windowStart).length;
  }

  cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    for (const [identifier, requestTimes] of this.requests.entries()) {
      const validRequests = requestTimes.filter(time => time > windowStart);
      
      if (validRequests.length === 0) {
        this.requests.delete(identifier);
      } else {
        this.requests.set(identifier, validRequests);
      }
    }
  }
}

export class ConnectionMonitor {
  private connectionCount: number = 0;
  private requestCount: number = 0;
  private lastRequestTime: number = Date.now();
  private readonly maxConnections: number = 500;

  updateConnectionCount(count: number): void {
    this.connectionCount = count;
  }

  incrementRequestCount(): void {
    this.requestCount++;
    this.lastRequestTime = Date.now();
  }

  isOverloaded(): boolean {
    return this.connectionCount > this.maxConnections;
  }

  getHealthStatus(): {
    status: 'healthy' | 'warning' | 'critical';
    connections: number;
    requests: number;
    issues: string[];
  } {
    const issues: string[] = [];
    
    if (this.connectionCount > this.maxConnections * 0.8) {
      issues.push(`High connection count: ${this.connectionCount}`);
    }
    
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    
    if (issues.length > 0) {
      status = this.isOverloaded() ? 'critical' : 'warning';
    }
    
    return {
      status,
      connections: this.connectionCount,
      requests: this.requestCount,
      issues
    };
  }

  reset(): void {
    this.requestCount = 0;
  }
}

export class OverloadProtectionManager {
  private circuitBreaker: CircuitBreaker;
  private rateLimiter: RateLimiter;
  private connectionMonitor: ConnectionMonitor;
  private isShuttingDown: boolean = false;

  constructor() {
    this.circuitBreaker = new CircuitBreaker(10, 60000);
    this.rateLimiter = new RateLimiter(200, 60000);
    this.connectionMonitor = new ConnectionMonitor();
  }

  async executeWithProtection<T>(
    identifier: string,
    operation: () => Promise<T>
  ): Promise<T> {
    if (this.isShuttingDown) {
      throw new Error('Service is shutting down');
    }

    if (!this.rateLimiter.isAllowed(identifier)) {
      throw new Error('Rate limit exceeded');
    }

    if (this.connectionMonitor.isOverloaded()) {
      throw new Error('Too many connections');
    }

    this.connectionMonitor.incrementRequestCount();

    return await this.circuitBreaker.execute(operation);
  }

  updateConnectionCount(count: number): void {
    this.connectionMonitor.updateConnectionCount(count);
  }

  getProtectionStatus(): {
    circuitBreaker: {
      state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
      failures: number;
    };
    rateLimiter: {
      activeIdentifiers: number;
    };
    connectionMonitor: {
      status: 'healthy' | 'warning' | 'critical';
      connections: number;
      requests: number;
      issues: string[];
    };
    isShuttingDown: boolean;
  } {
    return {
      circuitBreaker: {
        state: this.circuitBreaker.getState(),
        failures: this.circuitBreaker.getFailureCount()
      },
      rateLimiter: {
        activeIdentifiers: this.rateLimiter['requests'].size
      },
      connectionMonitor: this.connectionMonitor.getHealthStatus(),
      isShuttingDown: this.isShuttingDown
    };
  }

  initiateGracefulShutdown(): void {
    this.isShuttingDown = true;
    console.log('Overload protection: Initiating graceful shutdown');
  }

  isSystemHealthy(): boolean {
    const health = this.connectionMonitor.getHealthStatus();
    return health.status === 'healthy' && 
           this.circuitBreaker.getState() === 'CLOSED' && 
           !this.isShuttingDown;
  }

  cleanup(): void {
    this.rateLimiter.cleanup();
  }
}