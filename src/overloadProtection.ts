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

export class WorkerResourceMonitor {
  private startTime: number;
  private connectionCount: number = 0;
  private requestCount: number = 0;
  private lastRequestTime: number = Date.now();
  private readonly limits = {
    cpuTime: 50000, // 50 seconds for paid plan
    memoryMB: 128,  // 128MB limit
    maxConnections: 1000
  };

  constructor() {
    this.startTime = this.getHighResolutionTime();
  }

  private getHighResolutionTime(): number {
    if (typeof performance !== 'undefined' && performance.now) {
      return performance.now();
    }
    return Date.now();
  }

  updateConnectionCount(count: number): void {
    this.connectionCount = count;
  }

  incrementRequestCount(): void {
    this.requestCount++;
    this.lastRequestTime = Date.now();
  }

  getExecutionTime(): number {
    return this.getHighResolutionTime() - this.startTime;
  }

  getMemoryUsage(): number {
    if (typeof performance !== 'undefined' && (performance as any).memory && (performance as any).memory.usedJSHeapSize) {
      return (performance as any).memory.usedJSHeapSize / (1024 * 1024); // Convert to MB
    }
    return 0;
  }

  isApproachingCpuLimit(): boolean {
    const executionTime = this.getExecutionTime();
    return executionTime > (this.limits.cpuTime * 0.8); // 80% of limit
  }

  isApproachingMemoryLimit(): boolean {
    const memoryUsage = this.getMemoryUsage();
    return memoryUsage > 0 && memoryUsage > (this.limits.memoryMB * 0.8); // 80% of limit
  }

  isOverloaded(): boolean {
    return (
      this.isApproachingCpuLimit() ||
      this.isApproachingMemoryLimit() ||
      this.connectionCount > this.limits.maxConnections
    );
  }

  getHealthStatus(): {
    status: 'healthy' | 'warning' | 'critical';
    executionTime: number;
    memory: number;
    connections: number;
    requests: number;
    issues: string[];
  } {
    const issues: string[] = [];
    const executionTime = this.getExecutionTime();
    const memory = this.getMemoryUsage();
    
    if (this.isApproachingCpuLimit()) {
      issues.push(`High CPU time: ${executionTime.toFixed(1)}ms`);
    }
    
    if (this.isApproachingMemoryLimit()) {
      issues.push(`High memory usage: ${memory.toFixed(1)}MB`);
    }
    
    if (this.connectionCount > this.limits.maxConnections * 0.8) {
      issues.push(`High connection count: ${this.connectionCount}`);
    }
    
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    
    if (issues.length > 0) {
      status = this.isOverloaded() ? 'critical' : 'warning';
    }
    
    return {
      status,
      executionTime,
      memory,
      connections: this.connectionCount,
      requests: this.requestCount,
      issues
    };
  }

  reset(): void {
    this.startTime = this.getHighResolutionTime();
    this.requestCount = 0;
  }
}

export class OverloadProtectionManager {
  private circuitBreaker: CircuitBreaker;
  private rateLimiter: RateLimiter;
  private resourceMonitor: WorkerResourceMonitor;
  private isShuttingDown: boolean = false;

  constructor() {
    this.circuitBreaker = new CircuitBreaker(5, 60000);
    this.rateLimiter = new RateLimiter(100, 60000);
    this.resourceMonitor = new WorkerResourceMonitor();
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

    if (this.resourceMonitor.isOverloaded()) {
      throw new Error('System overloaded');
    }

    this.resourceMonitor.incrementRequestCount();

    return await this.circuitBreaker.execute(operation);
  }

  updateConnectionCount(count: number): void {
    this.resourceMonitor.updateConnectionCount(count);
  }

  getProtectionStatus(): {
    circuitBreaker: {
      state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
      failures: number;
    };
    rateLimiter: {
      activeIdentifiers: number;
    };
    resourceMonitor: {
      status: 'healthy' | 'warning' | 'critical';
      executionTime: number;
      memory: number;
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
      resourceMonitor: this.resourceMonitor.getHealthStatus(),
      isShuttingDown: this.isShuttingDown
    };
  }

  initiateGracefulShutdown(): void {
    this.isShuttingDown = true;
    console.log('Overload protection: Initiating graceful shutdown');
  }

  isSystemHealthy(): boolean {
    const health = this.resourceMonitor.getHealthStatus();
    return health.status === 'healthy' && 
           this.circuitBreaker.getState() === 'CLOSED' && 
           !this.isShuttingDown;
  }

  cleanup(): void {
    this.rateLimiter.cleanup();
  }
}