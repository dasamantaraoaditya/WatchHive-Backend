import { Response } from 'express';

/**
 * SSE Connection Manager
 * Manages active Server-Sent Events connections per user.
 * Supports multiple connections per user (multiple tabs/devices).
 */
class SSEManager {
    private connections: Map<string, Set<Response>> = new Map();
    private heartbeatInterval: NodeJS.Timeout | null = null;

    constructor() {
        // Send heartbeat every 30s to keep connections alive
        this.heartbeatInterval = setInterval(() => {
            this.connections.forEach((responses) => {
                responses.forEach((res) => {
                    try {
                        res.write(':heartbeat\n\n');
                    } catch {
                        // Connection dead, will be cleaned up
                    }
                });
            });
        }, 30000);
    }

    /**
     * Register a new SSE connection for a user
     */
    addConnection(userId: string, res: Response): void {
        if (!this.connections.has(userId)) {
            this.connections.set(userId, new Set());
        }
        this.connections.get(userId)!.add(res);

        // Clean up on disconnect
        res.on('close', () => {
            this.removeConnection(userId, res);
        });

        console.log(`[SSE] User ${userId} connected (${this.connections.get(userId)!.size} active connections)`);
    }

    /**
     * Remove a SSE connection for a user
     */
    removeConnection(userId: string, res: Response): void {
        const userConnections = this.connections.get(userId);
        if (userConnections) {
            userConnections.delete(res);
            if (userConnections.size === 0) {
                this.connections.delete(userId);
            }
            console.log(`[SSE] User ${userId} disconnected (${userConnections.size} remaining)`);
        }
    }

    /**
     * Send an event to all active connections for a user
     */
    sendToUser(userId: string, event: string, data: any): void {
        const userConnections = this.connections.get(userId);
        if (!userConnections || userConnections.size === 0) return;

        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

        userConnections.forEach((res) => {
            try {
                res.write(payload);
            } catch {
                // Connection dead, remove it
                this.removeConnection(userId, res);
            }
        });
    }

    /**
     * Get count of active connections for a user
     */
    getConnectionCount(userId: string): number {
        return this.connections.get(userId)?.size || 0;
    }

    /**
     * Get total active connections across all users
     */
    getTotalConnections(): number {
        let total = 0;
        this.connections.forEach((set) => {
            total += set.size;
        });
        return total;
    }

    /**
     * Cleanup on shutdown
     */
    destroy(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        this.connections.clear();
    }
}

// Singleton instance
export const sseManager = new SSEManager();
export default sseManager;
